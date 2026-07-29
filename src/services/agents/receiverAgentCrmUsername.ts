import { Agent, type AgentDocument } from "../../models/Agent";

export const CRM_USERNAME_RECEIVER_SOURCE = "extension_crm_username_match" as const;

export type ReceiverAgentCrmUsernameMatchResult =
  | {
      status: "empty";
      changed: false;
    }
  | {
      status: "already_linked";
      changed: false;
      username: string;
    }
  | {
      status: "not_found";
      changed: false;
      username: string;
      message: string;
    }
  | {
      status: "matched";
      changed: true;
      username: string;
      agentId: string;
      agentName: string;
      active: boolean;
      message: string;
    };

type ReceiverAgentLead = {
  receiver_agent?: unknown;
  receiver_agent_name_snapshot?: string | null;
  receiver_agent_source?: string | null;
  receiver_agent_source_value?: string | null;
  receiver_agent_set_at?: Date | null;
};

export function normalizeGranotCrmUsername(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
}

export async function findAgentByGranotCrmUsername(
  value: string | null | undefined,
  options: { includeInactive?: boolean } = {},
): Promise<AgentDocument | undefined> {
  const username = normalizeGranotCrmUsername(value);
  if (!username) {
    return undefined;
  }
  return (
    (await Agent.findOne({
      $or: [
        { "granot_identity.username": username },
        {
          "granot_identity.username": { $exists: false },
          granot_crm_username: username,
        },
      ],
      ...(options.includeInactive ? {} : { active: true }),
    }).exec()) ?? undefined
  );
}

export async function applyGranotCrmUsernameReceiverMatch(
  lead: ReceiverAgentLead,
  rawUsername: string | null | undefined,
): Promise<ReceiverAgentCrmUsernameMatchResult> {
  const username = normalizeGranotCrmUsername(rawUsername);
  if (!username) {
    return { status: "empty", changed: false };
  }

  if (lead.receiver_agent) {
    return { status: "already_linked", changed: false, username };
  }

  const agent = await findAgentByGranotCrmUsername(username);
  if (!agent) {
    return {
      status: "not_found",
      changed: false,
      username,
      message: `No Agent matched CRM username ${username}.`,
    };
  }

  lead.receiver_agent = agent._id;
  lead.receiver_agent_name_snapshot = agent.name;
  lead.receiver_agent_source = CRM_USERNAME_RECEIVER_SOURCE;
  lead.receiver_agent_source_value = username;
  lead.receiver_agent_set_at = new Date();

  const activeLabel = agent.active ? "active" : "inactive";
  return {
    status: "matched",
    changed: true,
    username,
    agentId: agent._id.toString(),
    agentName: agent.name,
    active: agent.active,
    message: `Matched ${activeLabel} Agent "${agent.name}" by CRM username ${username}.`,
  };
}
