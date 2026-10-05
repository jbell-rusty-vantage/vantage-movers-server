import assert from "node:assert/strict";
import { test } from "node:test";
import { canMessage, messageChannels } from "./accounts";

const config = { account: "acc", senderExtension: "e9", senderExtensionNumber: "109", senderPerson: "p9", senderDid: "", recordBaseUrl: "", hourlyLimit: 6,
  channels: { team_messaging: true, sms_to_rep: false, pager: false } };
const extension = { id: "e1", type: "User", status: "Enabled", extension_number: "101" };
const link = { status: "reviewed" as const, role_kind: "sales_rep" as const, nudge_channels_allowed: ["team_messaging", "pager"], rc_team_messaging_person_id: "77" };

test("Accounts: message_channels names what the Owner's Message can use, so the client never guesses pager", () => {
  // The server default: Team Messaging on, pager off. An extension number alone offers nothing.
  assert.deepEqual(messageChannels({ extension, link: null, account: "acc", nudgesOn: true, config }), []);
  assert.deepEqual(messageChannels({ extension, link, account: "acc", nudgesOn: true, config }), ["team_messaging"]);
  const both = { ...config, channels: { ...config.channels, pager: true } };
  assert.deepEqual(messageChannels({ extension, link, account: "acc", nudgesOn: true, config: both }), ["team_messaging", "pager"], "Team Messaging first");
  assert.deepEqual(messageChannels({ extension, link: { ...link, nudge_channels_allowed: ["pager"] }, account: "acc", nudgesOn: true, config: both }), ["pager"], "the link narrows");
  assert.deepEqual(messageChannels({ extension, link, account: "other", nudgesOn: true, config }), [], "another account");
  assert.equal(canMessage({ extension, link, account: "acc", nudgesOn: true, config }), true);
  assert.equal(canMessage({ extension, link, account: "acc", nudgesOn: false, config }), false);
});
