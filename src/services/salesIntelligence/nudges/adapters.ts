import { z } from "zod";
import { getValidToken } from "../../ringcentral/auth";
import { isTestMode } from "../../../config/domain/runtime";
import { csiFlag, csiNudgeConfiguration } from "../../../config/domain/salesIntelligence";
import { toE164 } from "../../numberActivity/phone";

export type NudgeChannel = "team_messaging" | "sms_to_rep" | "pager";
export type NudgeRecipient = { account: string; extension: string; person: string | null; senderExtension: string; senderExtensionNumber: string; senderPerson: string; senderDid: string };
export type NudgeSubmission = NudgeRecipient & { channel: NudgeChannel; destination: string; body: string };
export type NudgeReceipt = { id: string; status: number };
export class NudgeProviderError extends Error {
  constructor(readonly code: "chat_rejected" | "recipient_mismatch" | "provider_rejected" | "provider_unavailable" | "delivery_uncertain", readonly definitive = false) { super(code); }
}
/** Production and test adapters have identical narrow contracts. No adapter retries a submission. */
export interface NudgeAdapter {
  resolveDirect(recipient: NudgeRecipient): Promise<{ id: string; type: "Direct"; members: string[] }>;
  submit(input: NudgeSubmission): Promise<NudgeReceipt>;
  receipt(input: NudgeSubmission & { messageId: string }): Promise<boolean>;
}
const id = z.union([z.string().min(1).max(200), z.number().int().nonnegative()]).transform(String);
export function assertDirectChat(chat: { id: string; type: string; members: string[] }, recipient: NudgeRecipient) {
  if (chat.type !== "Direct" || !recipient.person || recipient.person === recipient.senderPerson ||
      chat.members.length !== 2 || new Set(chat.members).size !== 2 ||
      !chat.members.includes(recipient.person) || !chat.members.includes(recipient.senderPerson)) throw new NudgeProviderError("recipient_mismatch", true);
  return chat.id;
}
type Transport = (method: "GET" | "POST", path: string, body?: unknown) => Promise<{ status: number; value: unknown }>;
/** Native fetch deliberately bypasses ringCentralRequest's automatic 401 POST replay. */
export function createNudgeAdapter(transport: Transport = singleAttemptTransport): NudgeAdapter {
  return {
    async resolveDirect(recipient) {
      const self = await transport("GET", "/restapi/v1.0/glip/persons/~");
      const sender = z.object({ id }).safeParse(self.value);
      if (self.status !== 200 || !sender.success || sender.data.id !== recipient.senderPerson) throw new NudgeProviderError("recipient_mismatch", true);
      const result = await transport("POST", "/restapi/v1.0/glip/conversations", { members: [{ id: recipient.person }] });
      if (result.status < 200 || result.status >= 300) throw new NudgeProviderError("chat_rejected", result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status));
      const parsed = z.object({ id, type: z.literal("Direct"), members: z.array(z.union([id, z.object({ id }).transform(v => v.id)])) }).safeParse(result.value);
      if (!parsed.success) throw new NudgeProviderError("recipient_mismatch", true);
      assertDirectChat(parsed.data, recipient);
      return parsed.data;
    },
    async submit(input) {
      if (input.channel === "pager") {
        const self = await transport("GET", "/restapi/v1.0/account/~/extension/~");
        const sender = z.object({ id, extensionNumber: z.string() }).safeParse(self.value);
        if (self.status !== 200 || !sender.success || sender.data.id !== input.senderExtension || sender.data.extensionNumber !== input.senderExtensionNumber) throw new NudgeProviderError("provider_unavailable", true);
      }
      if (input.channel === "sms_to_rep") {
        const numbers = await transport("GET", "/restapi/v1.0/account/~/extension/~/phone-number?perPage=1000");
        const sender = z.object({ records: z.array(z.object({ phoneNumber: z.string(), features: z.array(z.string()).optional() })) }).safeParse(numbers.value);
        if (numbers.status !== 200 || !sender.success || !sender.data.records.some(n => toE164(n.phoneNumber) === input.senderDid && n.features?.includes("SmsSender"))) throw new NudgeProviderError("provider_unavailable", true);
      }
      const path = input.channel === "team_messaging" ? `/team-messaging/v1/chats/${encodeURIComponent(input.destination)}/posts` :
        `/restapi/v1.0/account/~/extension/~/${input.channel === "pager" ? "company-pager" : "sms"}`;
      const body = input.channel === "team_messaging" ? { text: input.body } : input.channel === "pager" ?
        { from: { extensionNumber: input.senderExtensionNumber }, to: [{ extensionNumber: input.destination }], text: input.body } :
        { from: { phoneNumber: input.senderDid }, to: [{ phoneNumber: input.destination }], text: input.body };
      const result = await transport("POST", path, body);
      if (result.status < 200 || result.status >= 300) throw new NudgeProviderError("provider_rejected", result.status >= 400 && result.status < 500 && ![408, 429].includes(result.status));
      const parsed = z.object({ id }).safeParse(result.value);
      if (!parsed.success) throw new NudgeProviderError("delivery_uncertain");
      return { id: parsed.data.id, status: result.status };
    },
    async receipt(input) {
      const path = input.channel === "team_messaging" ? `/team-messaging/v1/chats/${encodeURIComponent(input.destination)}/posts/${encodeURIComponent(input.messageId)}` :
        `/restapi/v1.0/account/~/extension/~/message-store/${encodeURIComponent(input.messageId)}`;
      const result = await transport("GET", path);
      if (result.status !== 200) return false;
      // Exact provider ID and sender/recipient scope, never a similar text/time search.
      if (input.channel === "team_messaging") {
        const chat = await transport("GET", `/team-messaging/v1/chats/${encodeURIComponent(input.destination)}`);
        const parsedChat = z.object({ id, type: z.literal("Direct"), members: z.array(z.union([id, z.object({ id }).transform(v => v.id)])) }).safeParse(chat.value);
        if (chat.status !== 200 || !parsedChat.success || parsedChat.data.id !== input.destination) return false;
        try { assertDirectChat(parsedChat.data, input); } catch { return false; }
        const post = z.object({ id, creatorId: id }).safeParse(result.value);
        return post.success && post.data.id === input.messageId && post.data.creatorId === input.senderPerson;
      }
      const message = z.object({ id, direction: z.literal("Outbound"), messageStatus: z.enum(["Sent", "Delivered"]),
        from: z.object({ extensionId: id.optional(), phoneNumber: z.string().optional() }),
        to: z.array(z.object({ extensionNumber: z.string().optional(), phoneNumber: z.string().optional() })) }).safeParse(result.value);
      return message.success && message.data.id === input.messageId && message.data.to.length === 1 &&
        (input.channel === "pager" ? message.data.from.extensionId === input.senderExtension && message.data.to[0]!.extensionNumber === input.destination :
          message.data.from.phoneNumber === input.senderDid && message.data.to[0]!.phoneNumber === input.destination);
    },
  };
}
async function singleAttemptTransport(method: "GET" | "POST", path: string, body?: unknown) {
  // Isolated tests must inject a fake. Never discover credentials in TEST_MODE.
  if (isTestMode()) throw new NudgeProviderError("provider_unavailable", true);
  const config = csiNudgeConfiguration();
  const server = process.env.RC_SERVER_URL;
  if (!server || !/^https:\/\/platform(?:\.devtest)?\.ringcentral\.com\/?$/.test(server)) throw new NudgeProviderError("provider_unavailable", true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const token = await Promise.race([getValidToken(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new NudgeProviderError("provider_unavailable", true)), 5000); })]).finally(() => clearTimeout(timer));
  if (!token.owner_id || String(token.owner_id) !== config.senderExtension) throw new NudgeProviderError("provider_unavailable", true);
  // Bind the JWT to the configured account before any resource creation/submission.
  try {
    const account = await fetch(`${server.replace(/\/$/, "")}/restapi/v1.0/account/~`, { headers: { Authorization: `Bearer ${token.access_token}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
    const parsed = account.ok ? z.object({ id }).safeParse(await account.json()) : null;
    if (!parsed?.success || parsed.data.id !== config.account) throw new Error();
  } catch { throw new NudgeProviderError("provider_unavailable", true); }
  try {
    if (method === "POST" && (!csiFlag("ENABLED") || !csiFlag("NUDGE_ENABLED"))) throw new NudgeProviderError("provider_unavailable", true);
    const response = await fetch(`${server.replace(/\/$/, "")}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value: unknown = response.ok ? await response.json() : null;
    return { status: response.status, value };
  } catch (error) { if (error instanceof NudgeProviderError) throw error; throw new NudgeProviderError("delivery_uncertain"); }
}
