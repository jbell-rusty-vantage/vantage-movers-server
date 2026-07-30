import { normalizeGranotCrmUsername } from "../../src/services/agents/receiverAgentCrmUsername";
import {
  computeMigrationChecksum,
  countPlannedActions,
  sortMigrationCollisions,
  summarizeMigrationCollisions,
  type MigrationCollision,
  type OperationsRegistryMigrationManifestBase,
} from "./operations-registry-migration.lib";

export const SCRIPT_VERSION = "operations-registry-agent-merchant-m2-v2";

export type AgentMigrationInput = {
  id: string;
  name: string;
  active: boolean;
  granot_crm_username?: string | null;
  granot_identity?: {
    username?: string | null;
    verified?: boolean;
    verified_at?: Date | string | null;
    last_observed_at?: Date | string | null;
  } | null;
  name_aliases?: string[] | null;
};

export type MerchantMigrationInput = {
  id: string;
  name: string;
  name_aliases?: string[] | null;
};

export type AgentMigrationAction =
  | "noop"
  | "update_identity"
  | "init_aliases"
  | "conflict";

export type MerchantMigrationAction = "noop" | "init_aliases";

export type AgentMigrationPlanItem = {
  agent_id: string;
  agent_name: string;
  action: AgentMigrationAction;
  flat_username?: string;
  embedded_username?: string;
  planned_identity?: {
    username: string;
    verified: boolean;
    verified_at?: string;
    last_observed_at?: string;
  };
  initialize_aliases?: boolean;
  conflict?: {
    code: string;
    message: string;
  };
};

export type MerchantMigrationPlanItem = {
  merchant_id: string;
  merchant_name: string;
  action: MerchantMigrationAction;
};

export type AgentMerchantCompatibilitySnapshot = {
  agents: AgentMigrationInput[];
  merchants: MerchantMigrationInput[];
};

export type AgentMerchantCompatibilityPlan = {
  agents: AgentMigrationPlanItem[];
  merchants: MerchantMigrationPlanItem[];
  collisions: MigrationCollision[];
  mappings: Array<{
    agent_id: string;
    flat_username?: string;
    nested_username?: string;
    receiver_match_agent_id?: string;
  }>;
  resume_cursor: {
    completed_agent_ids: string[];
    completed_merchant_ids: string[];
  };
};

export type AgentMerchantCompatibilityManifest =
  OperationsRegistryMigrationManifestBase & {
    source_counts: {
      agents: number;
      merchants: number;
      configured_usernames_before: number;
      configured_usernames_after: number;
    };
    validation_summary: {
      dry_run_performed_no_writes: boolean;
      has_blocking_collisions: boolean;
      receiver_matching_parity: boolean;
      booking_snapshots_untouched: true;
    };
    plan: {
      agents: AgentMigrationPlanItem[];
      merchants: MerchantMigrationPlanItem[];
    };
    mappings: AgentMerchantCompatibilityPlan["mappings"];
  };

function optionalIsoDate(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function buildGranotIdentityFromFlat(input: AgentMigrationInput, flatUsername: string) {
  const existing = input.granot_identity ?? {};
  return {
    username: flatUsername,
    verified: true,
    ...(optionalIsoDate(existing.verified_at)
      ? { verified_at: optionalIsoDate(existing.verified_at) }
      : {}),
    ...(optionalIsoDate(existing.last_observed_at)
      ? { last_observed_at: optionalIsoDate(existing.last_observed_at) }
      : {}),
  };
}

function resolveFinalUsername(agent: AgentMigrationInput): string | undefined {
  return (
    normalizeGranotCrmUsername(agent.granot_identity?.username) ??
    normalizeGranotCrmUsername(agent.granot_crm_username)
  );
}

function buildAgentPlanItem(agent: AgentMigrationInput): AgentMigrationPlanItem {
  const flatUsername = normalizeGranotCrmUsername(agent.granot_crm_username);
  const embeddedUsername = normalizeGranotCrmUsername(agent.granot_identity?.username);
  const needsAliasInit = agent.name_aliases === undefined || agent.name_aliases === null;

  if (embeddedUsername && flatUsername && embeddedUsername !== flatUsername) {
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      action: "conflict",
      flat_username: flatUsername,
      embedded_username: embeddedUsername,
      conflict: {
        code: "agent_granot_identity_flat_mismatch",
        message: `Agent ${agent.id} has mismatched flat and embedded Granot usernames.`,
      },
    };
  }

  if (embeddedUsername) {
    if (needsAliasInit) {
      return {
        agent_id: agent.id,
        agent_name: agent.name,
        action: "init_aliases",
        flat_username: flatUsername,
        embedded_username: embeddedUsername,
      };
    }
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      action: "noop",
      flat_username: flatUsername,
      embedded_username: embeddedUsername,
    };
  }

  if (!flatUsername) {
    if (needsAliasInit) {
      return {
        agent_id: agent.id,
        agent_name: agent.name,
        action: "init_aliases",
      };
    }
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      action: "noop",
    };
  }

  return {
    agent_id: agent.id,
    agent_name: agent.name,
    action: "update_identity",
    flat_username: flatUsername,
    planned_identity: buildGranotIdentityFromFlat(agent, flatUsername),
    ...(needsAliasInit ? { initialize_aliases: true } : {}),
  };
}

function buildMerchantPlanItem(merchant: MerchantMigrationInput): MerchantMigrationPlanItem {
  if (merchant.name_aliases === undefined || merchant.name_aliases === null) {
    return {
      merchant_id: merchant.id,
      merchant_name: merchant.name,
      action: "init_aliases",
    };
  }
  return {
    merchant_id: merchant.id,
    merchant_name: merchant.name,
    action: "noop",
  };
}

function collectDuplicateUsernameCollisions(
  snapshot: AgentMerchantCompatibilitySnapshot,
  agentPlans: AgentMigrationPlanItem[],
): MigrationCollision[] {
  const collisions: MigrationCollision[] = [];
  const usernameOwners = new Map<string, string[]>();

  for (const agent of snapshot.agents) {
    const plan = agentPlans.find((entry) => entry.agent_id === agent.id);
    if (plan?.action === "conflict") {
      continue;
    }
    const username =
      plan?.planned_identity?.username ??
      normalizeGranotCrmUsername(agent.granot_identity?.username) ??
      normalizeGranotCrmUsername(agent.granot_crm_username);
    if (!username) {
      continue;
    }
    usernameOwners.set(username, [...(usernameOwners.get(username) ?? []), agent.id]);
  }

  for (const [username, agentIds] of usernameOwners.entries()) {
    if (agentIds.length <= 1) {
      continue;
    }
    collisions.push({
      code: "agent_granot_username_collision",
      severity: "blocking",
      category: "agent",
      message: `Granot username ${username} is configured on multiple Agents.`,
      details: { username, agent_ids: [...agentIds].sort() },
    });
  }

  return collisions;
}

function collectAgentMismatchCollisions(
  agentPlans: AgentMigrationPlanItem[],
): MigrationCollision[] {
  return agentPlans
    .filter((plan) => plan.action === "conflict" && plan.conflict)
    .map((plan) => ({
      code: plan.conflict!.code,
      severity: "blocking" as const,
      category: "agent",
      message: plan.conflict!.message,
      details: {
        agent_id: plan.agent_id,
        flat_username: plan.flat_username,
        embedded_username: plan.embedded_username,
      },
    }));
}

function buildReceiverMatchingMappings(
  snapshot: AgentMerchantCompatibilitySnapshot,
  agentPlans: AgentMigrationPlanItem[],
): AgentMerchantCompatibilityPlan["mappings"] {
  const usernameToAgentId = new Map<string, string>();
  for (const agent of snapshot.agents) {
    const plan = agentPlans.find((entry) => entry.agent_id === agent.id);
    if (plan?.action === "conflict") {
      continue;
    }
    const username =
      plan?.planned_identity?.username ??
      normalizeGranotCrmUsername(agent.granot_identity?.username) ??
      normalizeGranotCrmUsername(agent.granot_crm_username);
    if (!username) {
      continue;
    }
    usernameToAgentId.set(username, agent.id);
  }

  return [...usernameToAgentId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([username, agentId]) => {
      const matches = snapshot.agents.filter(
        (agent) => resolveFinalUsername(agent) === username,
      );
      return {
        agent_id: agentId,
        flat_username: username,
        nested_username: username,
        receiver_match_agent_id: matches.length === 1 ? matches[0].id : undefined,
      };
    });
}

export function buildAgentMerchantCompatibilityPlan(
  snapshot: AgentMerchantCompatibilitySnapshot,
  resumeCursor: AgentMerchantCompatibilityPlan["resume_cursor"] = {
    completed_agent_ids: [],
    completed_merchant_ids: [],
  },
): AgentMerchantCompatibilityPlan {
  const completedAgents = new Set(resumeCursor.completed_agent_ids);
  const completedMerchants = new Set(resumeCursor.completed_merchant_ids);

  const agents = snapshot.agents
    .filter((agent) => !completedAgents.has(agent.id))
    .map(buildAgentPlanItem);
  const merchants = snapshot.merchants
    .filter((merchant) => !completedMerchants.has(merchant.id))
    .map(buildMerchantPlanItem);

  const collisions = sortMigrationCollisions([
    ...collectAgentMismatchCollisions(agents),
    ...collectDuplicateUsernameCollisions(snapshot, agents),
  ]);

  return {
    agents,
    merchants,
    collisions,
    mappings: buildReceiverMatchingMappings(snapshot, agents),
    resume_cursor: resumeCursor,
  };
}

function countConfiguredUsernamesBefore(snapshot: AgentMerchantCompatibilitySnapshot): number {
  const usernames = new Set<string>();
  for (const agent of snapshot.agents) {
    const username =
      normalizeGranotCrmUsername(agent.granot_identity?.username) ??
      normalizeGranotCrmUsername(agent.granot_crm_username);
    if (username) {
      usernames.add(username);
    }
  }
  return usernames.size;
}

function countConfiguredUsernamesAfter(
  snapshot: AgentMerchantCompatibilitySnapshot,
  agentPlans: AgentMigrationPlanItem[],
): number {
  const usernames = new Set<string>();
  for (const agent of snapshot.agents) {
    const plan = agentPlans.find((entry) => entry.agent_id === agent.id);
    if (plan?.action === "conflict") {
      continue;
    }
    const username =
      plan?.planned_identity?.username ??
      normalizeGranotCrmUsername(agent.granot_identity?.username) ??
      normalizeGranotCrmUsername(agent.granot_crm_username);
    if (username) {
      usernames.add(username);
    }
  }
  return usernames.size;
}

function buildChecksumPayload(
  snapshot: AgentMerchantCompatibilitySnapshot,
  plan: AgentMerchantCompatibilityPlan,
): unknown {
  return {
    agents: [...snapshot.agents]
      .map((agent) => ({
        id: agent.id,
        granot_crm_username: normalizeGranotCrmUsername(agent.granot_crm_username),
        granot_identity_username: normalizeGranotCrmUsername(agent.granot_identity?.username),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    merchants: [...snapshot.merchants]
      .map((merchant) => ({ id: merchant.id, name_aliases: merchant.name_aliases ?? [] }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    agent_plan: [...plan.agents].sort((left, right) =>
      left.agent_id.localeCompare(right.agent_id),
    ),
    merchant_plan: [...plan.merchants].sort((left, right) =>
      left.merchant_id.localeCompare(right.merchant_id),
    ),
    collisions: plan.collisions,
    mappings: plan.mappings,
  };
}

export function buildAgentMerchantCompatibilityManifest(input: {
  snapshot: AgentMerchantCompatibilitySnapshot;
  plan: AgentMerchantCompatibilityPlan;
  databaseName: string;
  mode: "dry_run" | "apply";
  runId: string;
  startedAt: string;
  completedAt: string;
  gitSha?: string;
  operator?: string;
  applied?: AgentMerchantCompatibilityManifest["applied"];
}): AgentMerchantCompatibilityManifest {
  const allAgentPlans = [
    ...input.plan.agents,
    ...input.snapshot.agents
      .filter(
        (agent) =>
          input.plan.resume_cursor.completed_agent_ids.includes(agent.id) &&
          !input.plan.agents.some((entry) => entry.agent_id === agent.id),
      )
      .map((agent) => ({
        agent_id: agent.id,
        agent_name: agent.name,
        action: "noop" as const,
      })),
  ];
  const configuredBefore = countConfiguredUsernamesBefore(input.snapshot);
  const configuredAfter = countConfiguredUsernamesAfter(input.snapshot, allAgentPlans);
  const conflictSummary = summarizeMigrationCollisions(input.plan.collisions);
  const planned = {
    creates: 0,
    updates:
      countPlannedActions(input.plan.agents).updates +
      countPlannedActions(input.plan.merchants).updates,
    no_ops:
      countPlannedActions(input.plan.agents).no_ops +
      countPlannedActions(input.plan.merchants).no_ops,
    conflicts: input.plan.collisions.length,
  };
  const receiverMatchingParity = input.plan.mappings.every(
    (mapping) =>
      !mapping.flat_username ||
      (mapping.receiver_match_agent_id !== undefined &&
        mapping.receiver_match_agent_id === mapping.agent_id),
  );

  return {
    run_id: input.runId,
    script_version: SCRIPT_VERSION,
    git_sha: input.gitSha,
    database_name: input.databaseName,
    mode: input.mode,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    operator: input.operator,
    source_counts: {
      agents: input.snapshot.agents.length,
      merchants: input.snapshot.merchants.length,
      configured_usernames_before: configuredBefore,
      configured_usernames_after: configuredAfter,
    },
    planned,
    applied: input.applied ?? {
      creates: 0,
      updates: 0,
      no_ops: 0,
      failures: 0,
    },
    mapping_checksum: computeMigrationChecksum(
      buildChecksumPayload(input.snapshot, input.plan),
    ),
    conflict_summary: conflictSummary,
    collisions: input.plan.collisions,
    validation_summary: {
      dry_run_performed_no_writes: input.mode === "dry_run",
      has_blocking_collisions: conflictSummary.blocking > 0,
      receiver_matching_parity: receiverMatchingParity,
      booking_snapshots_untouched: true,
    },
    plan: {
      agents: [...input.plan.agents].sort((left, right) =>
        left.agent_id.localeCompare(right.agent_id),
      ),
      merchants: [...input.plan.merchants].sort((left, right) =>
        left.merchant_id.localeCompare(right.merchant_id),
      ),
    },
    mappings: input.plan.mappings,
    resume_cursor: input.plan.resume_cursor,
  };
}

export function agentMigrationUpdateFilter(plan: AgentMigrationPlanItem): Record<string, unknown> | null {
  if (plan.action === "update_identity" && plan.planned_identity) {
    const identity: Record<string, unknown> = {
      username: plan.planned_identity.username,
      verified: plan.planned_identity.verified,
    };
    if (plan.planned_identity.verified_at) {
      identity.verified_at = new Date(plan.planned_identity.verified_at);
    }
    if (plan.planned_identity.last_observed_at) {
      identity.last_observed_at = new Date(plan.planned_identity.last_observed_at);
    }
    return {
      $set: {
        granot_identity: identity,
        ...(plan.initialize_aliases ? { name_aliases: [] } : {}),
      },
    };
  }
  if (plan.action === "init_aliases") {
    return { $set: { name_aliases: [] } };
  }
  return null;
}

export function merchantMigrationUpdateFilter(
  plan: MerchantMigrationPlanItem,
): Record<string, unknown> | null {
  if (plan.action === "init_aliases") {
    return { $set: { name_aliases: [] } };
  }
  return null;
}

export function advanceAgentMerchantResumeCursor(
  cursor: AgentMerchantCompatibilityPlan["resume_cursor"],
  appliedAgentIds: readonly string[],
  appliedMerchantIds: readonly string[],
): AgentMerchantCompatibilityPlan["resume_cursor"] {
  return {
    completed_agent_ids: [
      ...new Set([...cursor.completed_agent_ids, ...appliedAgentIds]),
    ].sort(),
    completed_merchant_ids: [
      ...new Set([...cursor.completed_merchant_ids, ...appliedMerchantIds]),
    ].sort(),
  };
}
