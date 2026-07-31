import { normalizeJobNo } from "../bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import { buildHistoricalManifest } from "./manifest";
import { classifyHistoricalLeads, FORM_DUPLICATE_CUTOFF, type CanonicalLead } from "./classification";
import { allocateCents, normalizeDisplay, normalizeExact, parseAgentNames, parseCustomerName, parseMoneyToCents } from "./normalization";
import { parseEasternDate } from "./dateParsing";
import { deterministicObjectId, sha256 } from "./stableJson";
import { HISTORICAL_RULE_VERSION, type ConflictCase, type DecisionBundle, type HistoricalManifest, type HistoricalOperation, type HistoricalSnapshot, type SourceProvenance } from "./types";

type MappingBundle = {
  source_mappings: { mappings: Record<string, { source_company?: string; source_granularity_key?: string; referral?: boolean }> };
  aliases: { merchant_aliases: Record<string, string>; agent_aliases: Record<string, string> };
  field_matrix_hash: string;
};

type MigrationActor = { actor_id: string; actor_label: string; actor_role: "owner" };

export type HistoricalPlanningInput = {
  snapshot: HistoricalSnapshot;
  decisions: DecisionBundle;
  mappings: MappingBundle;
  planning_timestamp: string;
  git_sha: string;
  actor: MigrationActor;
};

export type HistoricalPlanningResult = {
  manifest: HistoricalManifest;
  parsed_candidates: Array<Record<string, unknown>>;
  canonical_entities: Array<Record<string, unknown>>;
  conflicts: ConflictCase[];
};

type Row = {
  workbook_key: string;
  kind: "form" | "call" | "bad_leads" | "booked" | "refund";
  source_company: string | null;
  source_granularity_key: string | null;
  provenance: SourceProvenance;
  values: Record<string, unknown>;
};

type LeadCandidate = {
  id: string;
  kind: "form" | "call";
  provenance: SourceProvenance[];
  source_company: string;
  source_company_id: string;
  source_granularity_id: string;
  source_granularity_key: string;
  source_company_label: string;
  source_granularity_label: string;
  timestamp: string;
  normalized_phone: string | null;
  normalized_email: string | null;
  document: Record<string, unknown>;
  historical_id?: string;
  production_id?: string;
  preserve_duplicate?: boolean;
  bad_tab?: boolean;
};

const COLLECTIONS = {
  Agent: "agents",
  Merchant: "merchants",
  LeadSourceCompany: "lead_source_companies",
  LeadSourceGranularity: "lead_source_granularities",
  OperationsRegistryChange: "operations_registry_changes",
  Customer: "customers",
  FormLead: "form_leads",
  CallLead: "call_leads",
  BookedLead: "booked_leads",
  CancelledLead: "cancelled_leads",
} as const;

export function planHistoricalConsolidation(input: HistoricalPlanningInput): HistoricalPlanningResult {
  if (!Number.isFinite(new Date(input.planning_timestamp).getTime())) throw new Error("planning_timestamp must be a valid fixed ISO timestamp");
  if (!input.git_sha.trim()) throw new Error("git_sha is required");
  if (input.actor.actor_role !== "owner") throw new Error("Catalog migration actor must have Owner role");
  const production = snapshotDb(input.snapshot, "vantagemovers");
  const historical = snapshotDb(input.snapshot, "vantagemovershistorical");
  const rows = flattenRows(input.snapshot);
  const conflicts: ConflictCase[] = [];
  const parsedCandidates: Array<Record<string, unknown>> = [];
  const canonicalEntities: Array<Record<string, unknown>> = [];
  const operations: Array<Omit<HistoricalOperation, "operation_id">> = [];
  const catalog = buildCatalog(production, input, operations);
  const mainFormRows = rows.filter((row) => row.kind === "form");
  const badRows = rows.filter((row) => row.kind === "bad_leads");
  const badAssignments = matchBadRows(mainFormRows, badRows, conflicts);
  const leads: LeadCandidate[] = [];

  for (const row of [...mainFormRows, ...badAssignments.orphans]) {
    const candidate = parseFormCandidate(row, badAssignments.matchedByFormChecksum.get(row.provenance.row_checksum) ?? (row.kind === "bad_leads" ? [row.provenance] : []), catalog, historical, production, input.planning_timestamp, conflicts);
    parsedCandidates.push(candidate.audit);
    if (candidate.lead) leads.push(candidate.lead);
  }
  for (const row of rows.filter((entry) => entry.kind === "call")) {
    const candidate = parseCallCandidate(row, catalog, historical, production, input.planning_timestamp, conflicts);
    parsedCandidates.push(candidate.audit);
    if (candidate.lead) leads.push(candidate.lead);
  }

  const classified = classifyHistoricalLeads(leads.map(toClassifierLead));
  const classificationById = new Map(classified.map((lead) => [lead.id, lead]));
  for (const lead of leads.sort(compareLead)) {
    const classification = classificationById.get(lead.id)!;
    lead.document.duplicate = classification.duplicate;
    if (classification.duplicate) {
      lead.document.cpl = 0;
      lead.document.cpl_resolution_status = "duplicate_zero";
    }
    if (lead.kind === "call") lead.document.form_fill = classification.form_fill ?? false;
    if (lead.bad_tab && !classification.duplicate && !lead.document.booked && !lead.document.cancelled) lead.document.bad_lead = "legacy_bad_tab";
    canonicalEntities.push({ id: lead.id, model: lead.kind === "form" ? "FormLead" : "CallLead", production_id: lead.production_id ?? null, historical_id: lead.historical_id ?? null, duplicate: classification.duplicate, duplicate_anchor_ids: classification.duplicate_anchor_ids, form_fill: classification.form_fill ?? null, provenance: lead.provenance });
    planLeadOperation(lead, classification, production, input.planning_timestamp, conflicts, operations);
  }

  const bookingPlans = planBookings(rows.filter((row) => row.kind === "booked"), leads, catalog, production, input, conflicts, operations, canonicalEntities, parsedCandidates);
  planCancellations(rows.filter((row) => row.kind === "refund"), bookingPlans, production, input, conflicts, operations, canonicalEntities, parsedCandidates);

  const unresolvedRows = new Set(conflicts.flatMap((entry) => entry.source_provenance.map(provenanceKey)));
  const terminalRows = new Set([
    ...leads.flatMap((entry) => entry.provenance.map(provenanceKey)),
    ...canonicalEntities.flatMap((entry) => ((entry.provenance as SourceProvenance[] | undefined) ?? []).map(provenanceKey)),
    ...unresolvedRows,
    ...badRows.map((entry) => provenanceKey(entry.provenance)),
  ]);
  for (const row of rows) if (!terminalRows.has(provenanceKey(row.provenance))) conflicts.push(makeConflict("unclassified_source_row", true, [row.provenance], {}, [], "every_row_terminal", ["quarantine"]));

  const productionFingerprint = production.fingerprint;
  const expectedCounts = buildExpectedCounts(production, operations);
  const manifest = buildHistoricalManifest({
    created_at: input.planning_timestamp,
    planning_timestamp: input.planning_timestamp,
    git_sha: input.git_sha,
    target_database: "vantagemovers",
    target_cluster_fingerprint: productionFingerprint,
    source_inventory_checksum: input.snapshot.inventory_checksum,
    source_snapshot_hash: input.snapshot.snapshot_hash,
    historical_snapshot_hash: sha256(historical.collections),
    production_snapshot_hash: sha256(production.collections),
    target_collection_checksums: Object.fromEntries(Object.entries(production.collections).filter(([name]) => name !== "__indexes").map(([name, value]) => [name, value.checksum])),
    policy_hashes: { field_matrix: input.mappings.field_matrix_hash, source_mappings: sha256(input.mappings.source_mappings), aliases: sha256(input.mappings.aliases), form_duplicate_cutoff: sha256(FORM_DUPLICATE_CUTOFF.toISOString()) },
    decision_bundle_hash: "",
    expected_indexes: [
      { collection: "booked_leads", name: "normalized_job_no_1", key: { normalized_job_no: 1 }, unique: true },
      { collection: "historical_import_registry", name: "operation_id_unique", key: { operation_id: 1 }, unique: true },
    ],
    expected_counts: expectedCounts,
    operations,
    conflicts,
    quarantine: conflicts.filter((entry) => !entry.blocking),
    decisions: input.decisions,
  });
  return { manifest, parsed_candidates: parsedCandidates, canonical_entities: canonicalEntities, conflicts };
}

function buildCatalog(production: HistoricalSnapshot["mongo"][number], input: HistoricalPlanningInput, operations: Array<Omit<HistoricalOperation, "operation_id">>) {
  const companies = documents(production, "lead_source_companies");
  const granularities = documents(production, "lead_source_granularities");
  const agents = documents(production, "agents");
  const merchants = documents(production, "merchants");
  const companyBySlug = new Map(companies.map((entry) => [normalizeExact(String(entry.company_slug ?? "")), entry]));
  const granularityByKey = new Map(granularities.map((entry) => [normalizeExact(String(entry.granularity_key ?? "")), entry]));
  const agentByName = new Map<string, Record<string, unknown>>();
  for (const agent of agents) for (const name of [agent.name, ...(Array.isArray(agent.name_aliases) ? agent.name_aliases : [])]) if (name) agentByName.set(normalizeExact(String(name)), agent);
  const merchantByName = new Map<string, Record<string, unknown>>();
  for (const merchant of merchants) for (const name of [merchant.name, ...(Array.isArray(merchant.name_aliases) ? merchant.name_aliases : [])]) if (name) merchantByName.set(normalizeExact(String(name)), merchant);

  function source(companySlug: string, granularityKey: string) {
    let company = companyBySlug.get(normalizeExact(companySlug));
    if (!company) {
      const id = deterministicObjectId("historical-source-company", companySlug);
      company = { _id: { $oid: id }, company_slug: companySlug, name: companySlug, owner_label: companySlug, aliases: [], active: false, deactivation_reason: "Created inactive by historical consolidation", granularities: [], sheet_config: { has_bad_tabs: false, projection_mode: "derived_import" }, created_from: "historical_consolidation", createdAt: { $date: input.planning_timestamp }, updatedAt: { $date: input.planning_timestamp } };
      addCatalogOperation("LeadSourceCompany", id, company, input, operations);
      companyBySlug.set(normalizeExact(companySlug), company);
    }
    let granularity = granularityByKey.get(normalizeExact(granularityKey));
    if (!granularity) {
      const id = deterministicObjectId("historical-source-granularity", granularityKey);
      const channel = granularityKey.includes("call") ? "call" : "form";
      granularity = { _id: { $oid: id }, source_company: { $oid: objectId(company) }, granularity_key: granularityKey, channel, owner_label: granularityKey, crm_label: granularityKey, aliases: [], active: false, source_sites: [], priority: 0, schedule_revision: 0, created_from: "historical_consolidation", createdAt: { $date: input.planning_timestamp }, updatedAt: { $date: input.planning_timestamp } };
      addCatalogOperation("LeadSourceGranularity", id, granularity, input, operations);
      granularityByKey.set(normalizeExact(granularityKey), granularity);
    }
    if (objectId(granularity, "source_company") !== objectId(company)) throw new Error(`Granularity ${granularityKey} does not belong to ${companySlug}`);
    return { company_id: objectId(company), granularity_id: objectId(granularity), company_label: String(company.owner_label ?? company.name ?? companySlug), granularity_label: String(granularity.owner_label ?? granularity.crm_label ?? granularityKey) };
  }

  function agent(rawName: string) {
    const alias = input.mappings.aliases.agent_aliases[normalizeExact(rawName)];
    const canonical = alias ?? rawName;
    let record = agentByName.get(normalizeExact(canonical));
    if (!record) {
      const id = deterministicObjectId("historical-agent", normalizeExact(canonical));
      record = { _id: { $oid: id }, name: normalizeDisplay(canonical), normalized_name: normalizeExact(canonical), active: false, role: "agent", created_from: "historical_consolidation", name_aliases: [], granot_identity: { verified: false }, createdAt: { $date: input.planning_timestamp }, updatedAt: { $date: input.planning_timestamp } };
      addCatalogOperation("Agent", id, record, input, operations);
      agentByName.set(normalizeExact(canonical), record);
    }
    return { id: objectId(record), name: String(record.name) };
  }

  function merchant(rawName: string) {
    const canonical = input.mappings.aliases.merchant_aliases[normalizeExact(rawName)] ?? normalizeDisplay(rawName);
    let record = merchantByName.get(normalizeExact(canonical));
    if (!record) {
      const id = deterministicObjectId("historical-merchant", normalizeExact(canonical));
      record = { _id: { $oid: id }, name: canonical, normalized_name: normalizeExact(canonical), active: false, created_from: "historical_consolidation", name_aliases: [], createdAt: { $date: input.planning_timestamp }, updatedAt: { $date: input.planning_timestamp } };
      addCatalogOperation("Merchant", id, record, input, operations);
      merchantByName.set(normalizeExact(canonical), record);
    }
    return { id: objectId(record), name: String(record.name) };
  }
  return { source, agent, merchant, companyBySlug, granularityByKey };
}

function addCatalogOperation(model: "Agent" | "Merchant" | "LeadSourceCompany" | "LeadSourceGranularity", id: string, document: Record<string, unknown>, input: HistoricalPlanningInput, operations: Array<Omit<HistoricalOperation, "operation_id">>) {
  operations.push({ migration_key: `catalog:${model}:${id}`, order: 10, action: "insert", model, collection: COLLECTIONS[model], target_id: id, provenance: [], document: withoutId(document), precondition: { _id: { $exists: false } } });
  const auditId = deterministicObjectId("historical-registry-audit", `${input.snapshot.stage_run_id}:${model}:${id}`);
  const entityType = model === "LeadSourceCompany" ? "source_company" : model === "LeadSourceGranularity" ? "source_granularity" : model.toLowerCase();
  operations.push({ migration_key: `catalog-audit:${model}:${id}`, order: 11, action: "insert", model: "OperationsRegistryChange", collection: "operations_registry_changes", target_id: auditId, provenance: [], document: { entity_type: entityType, entity_id: id, action: "create", actor_type: "owner", actor_id: input.actor.actor_id, actor_label: input.actor.actor_label, actor_role: input.actor.actor_role, request_id: `historical:${input.snapshot.stage_run_id}:${model}:${id}`, reason: "Inactive catalog creation for reviewed historical consolidation manifest", before: null, after: document, metadata: { manifest_stage_run_id: input.snapshot.stage_run_id }, created_at: { $date: input.planning_timestamp } }, precondition: { _id: { $exists: false } } });
}

function parseFormCandidate(row: Row, badProvenance: SourceProvenance[], catalog: ReturnType<typeof buildCatalog>, historical: HistoricalSnapshot["mongo"][number], production: HistoricalSnapshot["mongo"][number], planningTimestamp: string, conflicts: ConflictCase[]) {
  const timestamp = parseEasternDate(row.values["Time Stamp"]);
  const moveDate = parseEasternDate(row.values["Move Date"]);
  const name = normalizeDisplay(String(row.values.Name ?? ""));
  const phone = normalizeDisplay(String(row.values.Phone ?? ""));
  const normalizedPhone = normalizePhoneNumberForMatch(phone) || null;
  if (
    timestamp.disposition !== "accepted" ||
    moveDate.disposition !== "accepted" ||
    !name ||
    !normalizedPhone ||
    !String(row.values["Pickup Zip"] ?? "").trim() ||
    !String(row.values["Destination Zip"] ?? "").trim()
  ) {
    const conflict = makeConflict("invalid_form_lead", false, [row.provenance], { reasons: [...timestamp.reason_codes, ...moveDate.reason_codes] }, [], "strict_form_parse", ["quarantine"]);
    conflicts.push(conflict);
    return { audit: { provenance: row.provenance, disposition: "quarantined", case_id: conflict.case_id } };
  }
  const source = catalog.source(row.source_company!, row.source_granularity_key!);
  const historicalDoc = findHistoricalByRow(historical, "form_leads", row);
  const id = sha256({ kind: "form", company: source.company_id, lid: normalizeExact(String(row.values["Lead ID"] ?? "")), phone: normalizedPhone, timestamp: timestamp.value, provenance: row.provenance });
  const lid = normalizeDisplay(String(row.values["Lead ID"] ?? ""));
  const refNo = normalizeDisplay(String(row.values["Ref No"] ?? "")) || "not provided";
  const productionMatches = resolveProductionForm(production, source.company_id, lid, refNo, normalizedPhone, timestamp.value);
  if (productionMatches.length > 1) {
    const conflict = makeConflict("ambiguous_production_form_identity", true, [row.provenance], { lid, ref_no: refNo }, productionMatches.map((entry) => objectId(entry)), "form_identity_order", ["select_candidate", "quarantine"]);
    conflicts.push(conflict);
    return { audit: { provenance: row.provenance, disposition: "conflict", case_id: conflict.case_id } };
  }
  const productionDoc = productionMatches[0];
  const allProvenance = [row.provenance, ...badProvenance.filter((entry) => entry.row_checksum !== row.provenance.row_checksum)];
  const local = row.provenance.tab_name === "Local Forms" ? "local" : String(historicalDoc?.local ?? "long_distance");
  const document: Record<string, unknown> = {
    source_company: row.source_company,
    lead_source_company: { $oid: source.company_id },
    source_granularity_id: { $oid: source.granularity_id },
    source_granularity_key: row.source_granularity_key,
    source_company_label_snapshot: source.company_label,
    source_granularity_label_snapshot: source.granularity_label,
    crm_source_label_snapshot: source.granularity_label,
    name,
    timestamp: { $date: timestamp.value },
    lid: lid || undefined,
    normalized_lid: lid ? normalizeExact(lid) : undefined,
    pickup_zip: normalizeDisplay(String(row.values["Pickup Zip"])),
    destination_zip: normalizeDisplay(String(row.values["Destination Zip"])),
    pickup_state: String(historicalDoc?.pickup_state ?? "not_found"),
    delivery_state: String(historicalDoc?.delivery_state ?? "not_found"),
    move_size: normalizeMoveSize(String(row.values["Move Size"])),
    move_date: { $date: moveDate.value },
    ref_no: refNo,
    local: local === "local" ? "local" : "long_distance",
    phone_number: phone,
    normalized_phone_number: normalizedPhone,
    normalized_contact_name: normalizeExact(name),
    cpl: Number(historicalDoc?.cpl ?? 0),
    cpl_resolution_status: "not_applicable",
    quoted: Boolean(historicalDoc?.quoted),
    over_2000: truthy(row.values[">2K"]),
    over_4000: truthy(row.values[">4K"]),
    post_to_granot: false,
    sheet_sync: [],
    createdAt: { $date: timestamp.value },
    updatedAt: { $date: planningTimestamp },
  };
  if (productionDoc) document.duplicate = Boolean(productionDoc.duplicate);
  return { audit: { provenance: allProvenance, disposition: "accepted", candidate_id: id }, lead: { id, kind: "form" as const, provenance: allProvenance, source_company: row.source_company!, source_company_id: source.company_id, source_granularity_id: source.granularity_id, source_granularity_key: row.source_granularity_key!, source_company_label: source.company_label, source_granularity_label: source.granularity_label, timestamp: timestamp.value, normalized_phone: normalizedPhone, normalized_email: null, document, historical_id: historicalDoc ? objectId(historicalDoc) : undefined, production_id: productionDoc ? objectId(productionDoc) : undefined, preserve_duplicate: productionDoc ? new Date(timestamp.value) >= FORM_DUPLICATE_CUTOFF : false, bad_tab: badProvenance.length > 0 } satisfies LeadCandidate };
}

function parseCallCandidate(row: Row, catalog: ReturnType<typeof buildCatalog>, historical: HistoricalSnapshot["mongo"][number], production: HistoricalSnapshot["mongo"][number], planningTimestamp: string, conflicts: ConflictCase[]) {
  const timestamp = parseEasternDate(`${row.values.Date ?? ""} ${row.values.Time ?? ""}`.trim());
  const phone = normalizeDisplay(String(row.values["PHONE NUMBER"] ?? ""));
  const normalizedPhone = normalizePhoneNumberForMatch(phone) || null;
  if (timestamp.disposition !== "accepted" || !normalizedPhone) {
    const conflict = makeConflict("invalid_call_lead_identity", true, [row.provenance], { reasons: timestamp.reason_codes, has_phone: Boolean(normalizedPhone), has_job_no: false }, [], "call_requires_phone_or_job", ["quarantine"]);
    conflicts.push(conflict);
    return { audit: { provenance: row.provenance, disposition: "conflict", case_id: conflict.case_id } };
  }
  const source = catalog.source(row.source_company!, row.source_granularity_key!);
  const historicalDoc = findHistoricalByRow(historical, "call_leads", row);
  const productionMatches = resolveProductionCall(production, source.company_id, normalizedPhone, timestamp.value);
  if (productionMatches.length > 1) {
    const conflict = makeConflict("ambiguous_production_call_identity", true, [row.provenance], {}, productionMatches.map((entry) => objectId(entry)), "call_identity_order", ["select_candidate", "quarantine"]);
    conflicts.push(conflict);
    return { audit: { provenance: row.provenance, disposition: "conflict", case_id: conflict.case_id } };
  }
  const id = sha256({ kind: "call", granularity: source.granularity_id, phone: normalizedPhone, timestamp: timestamp.value, provenance: row.provenance });
  const document: Record<string, unknown> = {
    source_company: row.source_company,
    lead_source_company: { $oid: source.company_id },
    source_granularity_id: { $oid: source.granularity_id },
    source_granularity_key: row.source_granularity_key,
    source_company_label_snapshot: source.company_label,
    source_granularity_label_snapshot: source.granularity_label,
    crm_source_label_snapshot: source.granularity_label,
    timestamp: { $date: timestamp.value },
    start_time: { $date: timestamp.value },
    phone_number: phone,
    normalized_phone_number: normalizedPhone,
    local: row.provenance.tab_name === "Local Calls" ? "local" : historicalDoc?.local,
    duration: historicalDoc?.duration,
    cubic_feet: numberOrUndefined(row.values["Cubic Feet"]),
    over_2000: truthy(row.values["Over 2000"]),
    over_4000: truthy(row.values["Over 4000"]),
    cpl: Number(historicalDoc?.cpl ?? 0),
    cpl_resolution_status: "not_applicable",
    created_on_unmatched: false,
    sheet_sync: [],
    createdAt: { $date: timestamp.value },
    updatedAt: { $date: planningTimestamp },
  };
  return { audit: { provenance: row.provenance, disposition: "accepted", candidate_id: id }, lead: { id, kind: "call" as const, provenance: [row.provenance], source_company: row.source_company!, source_company_id: source.company_id, source_granularity_id: source.granularity_id, source_granularity_key: row.source_granularity_key!, source_company_label: source.company_label, source_granularity_label: source.granularity_label, timestamp: timestamp.value, normalized_phone: normalizedPhone, normalized_email: null, document, historical_id: historicalDoc ? objectId(historicalDoc) : undefined, production_id: productionMatches[0] ? objectId(productionMatches[0]) : undefined } satisfies LeadCandidate };
}

function planLeadOperation(lead: LeadCandidate, classification: ReturnType<typeof classifyHistoricalLeads>[number], production: HistoricalSnapshot["mongo"][number], planningTimestamp: string, conflicts: ConflictCase[], operations: Array<Omit<HistoricalOperation, "operation_id">>) {
  const model = lead.kind === "form" ? "FormLead" : "CallLead";
  const collection = lead.kind === "form" ? "form_leads" : "call_leads";
  if (!lead.production_id) {
    const targetId = deterministicObjectId(`historical-${collection}`, lead.id);
    operations.push({ migration_key: `${collection}:${lead.id}`, order: 30, action: "insert", model, collection, target_id: targetId, provenance: lead.provenance, document: lead.document, precondition: { _id: { $exists: false } } });
    lead.production_id = targetId;
    return;
  }
  const existing = documents(production, collection).find((entry) => objectId(entry) === lead.production_id)!;
  const authoritative = new Set(["timestamp", ...(lead.kind === "form" && !lead.preserve_duplicate ? ["duplicate"] : []), ...(lead.kind === "call" ? ["duplicate", "form_fill"] : [])]);
  const set: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const precondition: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(lead.document)) {
    if (["createdAt", "updatedAt", "sheet_sync", "post_to_granot"].includes(field)) continue;
    const current = existing[field];
    if (authoritative.has(field) || empty(current)) {
      if (!equalValue(current, value)) {
        set[field] = value;
        before[field] = current ?? null;
        precondition[field] = current === undefined ? { $exists: false } : current;
      }
    } else if (!equalValue(current, value) && !["cpl", "cpl_resolution_status"].includes(field)) {
      conflicts.push(makeConflict("non_empty_production_field_conflict", false, lead.provenance, { field, production_id: lead.production_id }, [lead.production_id], "preserve_production_scalar", ["preserve_production"]));
    }
  }
  if (Object.keys(set).length) {
    set.updatedAt = { $date: planningTimestamp };
    before.updatedAt = existing.updatedAt ?? null;
    precondition.updatedAt = existing.updatedAt === undefined ? { $exists: false } : existing.updatedAt;
    operations.push({ migration_key: `${collection}:${lead.id}`, order: 31, action: "update", model, collection, target_id: lead.production_id, provenance: lead.provenance, set, before, after: { ...existing, ...set }, precondition });
  }
}

type BookingPlan = { job: string; target_id: string; document: Record<string, unknown>; provenance: SourceProvenance[]; lead?: LeadCandidate };

function planBookings(rows: Row[], leads: LeadCandidate[], catalog: ReturnType<typeof buildCatalog>, production: HistoricalSnapshot["mongo"][number], input: HistoricalPlanningInput, conflicts: ConflictCase[], operations: Array<Omit<HistoricalOperation, "operation_id">>, canonical: Array<Record<string, unknown>>, parsed: Array<Record<string, unknown>>): Map<string, BookingPlan> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const job = normalizeJobNo(String(row.values["Job Number:"] ?? ""));
    if (!job) {
      const conflict = makeConflict("booking_missing_job_number", true, [row.provenance], {}, [], "booking_job_identity", ["quarantine"]);
      conflicts.push(conflict); parsed.push({ provenance: row.provenance, disposition: "conflict", case_id: conflict.case_id }); continue;
    }
    groups.set(job, [...(groups.get(job) ?? []), row]);
  }
  const plans = new Map<string, BookingPlan>();
  for (const [job, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parsedRows = group.map((row) => parseBookingRow(row, catalog, input, conflicts)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (parsedRows.length !== group.length) continue;
    const facts = new Set(parsedRows.map((entry) => sha256({ book_date: entry.book_date, customer: normalizeExact(entry.customer_name), merchant: normalizeExact(entry.merchant), source: normalizeExact(entry.source), deposit_cents: entry.deposit_cents })));
    if (facts.size !== 1) {
      const conflict = makeConflict("conflicting_duplicate_booking_facts", true, group.map((row) => row.provenance), { normalized_job_no: job }, [], "booking_group_compatibility", ["field_decision", "quarantine"]);
      conflicts.push(conflict); continue;
    }
    const uniqueSales = new Map<string, typeof parsedRows[number]>();
    for (const entry of parsedRows) uniqueSales.set(sha256({ agents: entry.agents.map((agent) => agent.id), binder: entry.binder_cents, values: entry.row.values }), entry);
    const allocationCents = new Map<string, { name: string; cents: number }>();
    for (const sale of uniqueSales.values()) for (const allocation of allocateCents(sale.binder_cents, sale.agents.map((agent) => agent.id))) { const agent = sale.agents.find((entry) => entry.id === allocation.agent_id)!; const current = allocationCents.get(agent.id); allocationCents.set(agent.id, { name: agent.name, cents: (current?.cents ?? 0) + allocation.cents }); }
    const first = parsedRows[0]!;
    const existingBooking = documents(production, "booked_leads").filter((entry) => normalizeJobNo(String(entry.normalized_job_no ?? entry.job_no ?? "")) === job);
    if (existingBooking.length > 1) { conflicts.push(makeConflict("ambiguous_production_booking_identity", true, group.map((row) => row.provenance), { normalized_job_no: job }, existingBooking.map((entry) => objectId(entry)), "booking_job_identity", ["select_candidate"])); continue; }
    const lead = resolveBookingLead(first.lid, job, leads, production, conflicts, group.map((row) => row.provenance));
    const sourceMapping = input.mappings.source_mappings.mappings[first.source];
    if (!sourceMapping) { conflicts.push(makeConflict("unresolved_booking_source_mapping", true, group.map((row) => row.provenance), { source_label: first.source }, [], "explicit_source_mapping", ["supply_mapping", "quarantine"])); continue; }
    const referral = sourceMapping.referral === true;
    let customerId: string | undefined = existingBooking[0] ? objectIdField(existingBooking[0], "customer") : undefined;
    if (!customerId) {
      const candidates = documents(production, "customers").filter((entry) => lead && ((lead.normalized_phone && normalizePhoneNumberForMatch(String(entry.phone_number ?? "")) === lead.normalized_phone) || (lead.normalized_email && normalizeExact(String(entry.email ?? "")) === lead.normalized_email)));
      if (candidates.length === 1) customerId = objectId(candidates[0]!);
      else if (candidates.length > 1) { conflicts.push(makeConflict("ambiguous_customer_contact_identity", true, group.map((row) => row.provenance), { normalized_job_no: job }, candidates.map((entry) => objectId(entry)), "customer_resolution_order", ["select_candidate", "create_job_scoped"])); continue; }
    }
    if (!customerId) {
      customerId = deterministicObjectId("historical-job-customer", job);
      operations.push({ migration_key: `customer:job:${job}`, order: 20, action: "insert", model: "Customer", collection: "customers", target_id: customerId, provenance: group.map((row) => row.provenance), document: { full_name: first.customer_name, normalized_name: normalizeExact(first.customer_name), ...(lead?.normalized_phone ? { phone_number: lead.document.phone_number } : {}), createdAt: { $date: input.planning_timestamp }, updatedAt: { $date: input.planning_timestamp } }, precondition: { _id: { $exists: false } } });
    }
    const targetId = existingBooking[0] ? objectId(existingBooking[0]) : deterministicObjectId("historical-booking", job);
    const totalCents = [...allocationCents.values()].reduce((sum, entry) => sum + entry.cents, 0);
    const document: Record<string, unknown> = { timestamp: { $date: first.timestamp }, book_date: { $date: first.book_date }, job_no: String(group[0]!.values["Job Number:"]).trim(), normalized_job_no: job, customer: { $oid: customerId }, customer_name: first.customer_name, agent_allocations: [...allocationCents.entries()].map(([id, allocation]) => ({ agent: { $oid: id }, agent_name_snapshot: allocation.name, binder_amount: allocation.cents / 100 })), total_binder_amount: totalCents / 100, deposit_amount: first.deposit_cents / 100, merchant: first.merchant, source: first.source, ...(lead ? { lead_ref: { $oid: lead.production_id! }, lead_model: lead.kind === "form" ? "FormLead" : "CallLead" } : {}), is_referral_booking: referral, is_leadless_booking: !lead && !referral, auto_match: { enabled_rules_snapshot: [] }, over_2000: first.deposit_cents >= 200_000, over_4000: first.deposit_cents >= 400_000, sheet_sync: [], createdAt: { $date: first.timestamp }, updatedAt: { $date: input.planning_timestamp } };
    if (existingBooking[0]) planSafeUpdate("BookedLead", "booked_leads", targetId, `booking:${job}`, document, existingBooking[0], group.map((row) => row.provenance), 40, conflicts, operations, new Set(["timestamp", "book_date"]));
    else operations.push({ migration_key: `booking:${job}`, order: 40, action: "insert", model: "BookedLead", collection: "booked_leads", target_id: targetId, provenance: group.map((row) => row.provenance), document, precondition: { _id: { $exists: false } } });
    const provenance = group.map((row) => row.provenance);
    plans.set(job, { job, target_id: targetId, document, provenance, lead });
    if (lead) planBookingRelationship(lead, targetId, document, production, input.planning_timestamp, provenance, conflicts, operations);
    canonical.push({ id: job, model: "BookedLead", production_id: existingBooking[0] ? targetId : null, provenance: group.map((row) => row.provenance) });
    for (const row of group) parsed.push({ provenance: row.provenance, disposition: "accepted", canonical_id: job });
    if (first.corrected_0205 !== true && group.some((row) => String(row.values["Book Date"] ?? "").includes("0205"))) conflicts.push(makeConflict("missing_known_0205_correction", true, group.map((row) => row.provenance), { normalized_job_no: job }, [], "known_date_correction", ["quarantine"]));
  }
  return plans;
}

function parseBookingRow(row: Row, catalog: ReturnType<typeof buildCatalog>, input: HistoricalPlanningInput, conflicts: ConflictCase[]) {
  const timestamp = parseEasternDate(row.values.Timestamp);
  const bookDate = parseEasternDate(row.values["Book Date"], { allow_known_0205_correction: true });
  const customer = parseCustomerName(String(row.values["Customer Name"] ?? ""));
  const agents = parseAgentNames(String(row.values.Agent ?? ""));
  const binder = parseMoneyToCents(row.values["Binder Amount"]);
  const deposit = parseMoneyToCents(row.values["Deposit Amount"]);
  const merchantRaw = normalizeDisplay(String(row.values.Merchant ?? ""));
  const source = normalizeDisplay(String(row.values["Lead Source"] ?? ""));
  if (timestamp.disposition !== "accepted" || bookDate.disposition !== "accepted" || customer.disposition !== "accepted" || agents.disposition !== "accepted" || binder.disposition !== "accepted" || deposit.disposition !== "accepted" || !merchantRaw || !source) {
    const conflict = makeConflict(agents.disposition === "ambiguous" ? "ambiguous_agent_parse" : "invalid_booking_row", agents.disposition === "ambiguous", [row.provenance], { reason_codes: [...timestamp.reason_codes, ...bookDate.reason_codes, ...customer.reason_codes, ...agents.reason_codes, ...binder.reason_codes, ...deposit.reason_codes] }, [], "strict_booking_parse", ["quarantine", ...(agents.disposition === "ambiguous" ? ["supply_agent_tokens"] : [])]);
    conflicts.push(conflict); return null;
  }
  const resolvedAgents = agents.tokens.map((name) => catalog.agent(name));
  const merchant = catalog.merchant(merchantRaw).name;
  return { row, timestamp: timestamp.value, book_date: bookDate.value, corrected_0205: bookDate.reason_codes.includes("corrected_7_20_0205_to_2025_07_20"), customer_name: customer.display_value, agents: resolvedAgents, binder_cents: binder.value, deposit_cents: deposit.value, merchant, source, lid: normalizeDisplay(String(row.values.LID ?? "")) };
}

function planCancellations(rows: Row[], bookings: Map<string, BookingPlan>, production: HistoricalSnapshot["mongo"][number], input: HistoricalPlanningInput, conflicts: ConflictCase[], operations: Array<Omit<HistoricalOperation, "operation_id">>, canonical: Array<Record<string, unknown>>, parsed: Array<Record<string, unknown>>) {
  for (const row of rows) {
    const job = normalizeJobNo(String(row.values["Job Number:"] ?? "")) ?? "";
    const booking = bookings.get(job) ?? (() => { const existing = documents(production, "booked_leads").find((entry) => normalizeJobNo(String(entry.normalized_job_no ?? entry.job_no ?? "")) === job); return existing ? { job, target_id: objectId(existing), document: existing, provenance: [] } : undefined; })();
    const cancelDate = parseEasternDate(row.values["Refund Request Date"]);
    const timestamp = parseEasternDate(row.values.Timestamp);
    const refund = parseMoneyToCents(row.values["Deposit Amount"] ?? row.values["Binder Amount"]);
    if (!booking || cancelDate.disposition !== "accepted" || timestamp.disposition !== "accepted" || refund.disposition !== "accepted") {
      const conflict = makeConflict("unlinked_or_invalid_cancellation", true, [row.provenance], { normalized_job_no: job, booking_found: Boolean(booking), reasons: [...cancelDate.reason_codes, ...timestamp.reason_codes, ...refund.reason_codes] }, [], "cancellation_booking_chain", ["quarantine", "select_booking"]);
      conflicts.push(conflict); parsed.push({ provenance: row.provenance, disposition: "conflict", case_id: conflict.case_id }); continue;
    }
    const agent = normalizeDisplay(String(row.values.Agent ?? ""));
    const identity = `${booking.target_id}:${cancelDate.value}:${normalizeExact(agent)}`;
    const existing = documents(production, "cancelled_leads").find((entry) => objectIdField(entry, "booked_lead") === booking.target_id && dateString(entry.cancel_date) === cancelDate.value && normalizeExact(String(entry.agent ?? "")) === normalizeExact(agent));
    const targetId = existing ? objectId(existing) : deterministicObjectId("historical-cancellation", identity);
    const bookingDoc = booking.document;
    const document: Record<string, unknown> = { timestamp: { $date: timestamp.value }, booked_lead: { $oid: booking.target_id }, customer: bookingDoc.customer, lead_ref: bookingDoc.lead_ref, lead_model: bookingDoc.lead_model, reason: normalizeDisplay(String(row.values.Status ?? "")) || undefined, notes: normalizeDisplay(String(row.values.Status ?? "")) || undefined, cancel_date: { $date: cancelDate.value }, agent, book_date: bookingDoc.book_date, job_no: String(row.values["Job Number:"] ?? "").trim(), customer_name: normalizeDisplay(String(row.values["Customer Name"] ?? "")), refund_amount: refund.value / 100, merchant: bookingDoc.merchant ?? normalizeDisplay(String(row.values.Merchant ?? "")), source: bookingDoc.source ?? normalizeDisplay(String(row.values["Lead Source"] ?? "")), sheet_sync: [], createdAt: { $date: timestamp.value }, updatedAt: { $date: input.planning_timestamp } };
    if (existing) planSafeUpdate("CancelledLead", "cancelled_leads", targetId, `cancellation:${identity}`, document, existing, [row.provenance], 50, conflicts, operations, new Set(["timestamp", "cancel_date"]));
    else operations.push({ migration_key: `cancellation:${identity}`, order: 50, action: "insert", model: "CancelledLead", collection: "cancelled_leads", target_id: targetId, provenance: [row.provenance], document, precondition: { _id: { $exists: false } } });
    planCancellationRelationships(booking, targetId, production, input.planning_timestamp, [row.provenance], conflicts, operations);
    canonical.push({ id: identity, model: "CancelledLead", production_id: existing ? targetId : null, provenance: [row.provenance] });
    parsed.push({ provenance: row.provenance, disposition: "accepted", canonical_id: identity });
  }
}

function resolveBookingLead(lid: string, job: string, leads: LeadCandidate[], production: HistoricalSnapshot["mongo"][number], conflicts: ConflictCase[], provenance: SourceProvenance[]): LeadCandidate | undefined {
  const normalizedLid = normalizeExact(lid);
  const staged = leads.filter((lead) => lead.kind === "form" && normalizedLid && normalizeExact(String(lead.document.lid ?? "")) === normalizedLid);
  const stagedCalls = leads.filter((lead) => lead.kind === "call" && normalizeJobNo(String(lead.document.job_no ?? "")) === job);
  const all = [...staged, ...stagedCalls];
  if (all.length === 1) return all[0];
  if (all.length > 1) { conflicts.push(makeConflict("ambiguous_booking_lead_link", true, provenance, { lid, job }, all.map((entry) => entry.production_id ?? entry.id), "booking_lead_identity", ["select_candidate", "leadless"])); return undefined; }
  const prodForms = documents(production, "form_leads").filter((entry) => normalizedLid && normalizeExact(String(entry.normalized_lid ?? entry.lid ?? "")) === normalizedLid);
  const prodCalls = documents(production, "call_leads").filter((entry) => normalizeJobNo(String(entry.normalized_job_no ?? entry.job_no ?? "")) === job);
  const prod = [...prodForms.map((entry) => ({ entry, kind: "form" as const })), ...prodCalls.map((entry) => ({ entry, kind: "call" as const }))];
  if (prod.length === 1) return { id: objectId(prod[0]!.entry), kind: prod[0]!.kind, provenance: [], source_company: String(prod[0]!.entry.source_company ?? ""), source_company_id: objectIdField(prod[0]!.entry, "lead_source_company") ?? "", source_granularity_id: objectIdField(prod[0]!.entry, "source_granularity_id") ?? "", source_granularity_key: String(prod[0]!.entry.source_granularity_key ?? ""), source_company_label: String(prod[0]!.entry.source_company_label_snapshot ?? ""), source_granularity_label: String(prod[0]!.entry.source_granularity_label_snapshot ?? ""), timestamp: dateString(prod[0]!.entry.timestamp) ?? "", normalized_phone: normalizePhoneNumberForMatch(String(prod[0]!.entry.phone_number ?? "")) || null, normalized_email: prod[0]!.entry.email ? normalizeExact(String(prod[0]!.entry.email)) : null, document: prod[0]!.entry, production_id: objectId(prod[0]!.entry) };
  if (prod.length > 1) conflicts.push(makeConflict("ambiguous_booking_lead_link", true, provenance, { lid, job }, prod.map((entry) => objectId(entry.entry)), "booking_lead_identity", ["select_candidate", "leadless"]));
  return undefined;
}

function planBookingRelationship(
  lead: LeadCandidate,
  bookingId: string,
  booking: Record<string, unknown>,
  production: HistoricalSnapshot["mongo"][number],
  planningTimestamp: string,
  provenance: SourceProvenance[],
  conflicts: ConflictCase[],
  operations: Array<Omit<HistoricalOperation, "operation_id">>,
): void {
  const insert = operations.find((entry) => entry.action === "insert" && entry.target_id === lead.production_id);
  const existing = insert?.document ?? documents(production, lead.kind === "form" ? "form_leads" : "call_leads").find((entry) => objectId(entry) === lead.production_id);
  if (!existing) throw new Error(`Cannot plan booking relationship for unresolved lead ${lead.id}`);
  const currentBooked = objectIdField(existing, "booked");
  if (currentBooked && currentBooked !== bookingId) {
    conflicts.push(makeConflict("lead_already_linked_to_other_booking", true, provenance, { lead_id: lead.production_id, existing_booking_id: currentBooked }, [currentBooked, bookingId], "preserve_valid_relationship", ["quarantine"]));
    return;
  }
  const allocations = booking.agent_allocations as Array<Record<string, unknown>> | undefined;
  const primary = allocations?.[0];
  const receiverId = objectIdField(existing, "receiver_agent");
  const relationship: Record<string, unknown> = currentBooked ? {} : { booked: { $oid: bookingId } };
  if (!receiverId && primary) {
    relationship.receiver_agent = primary.agent;
    relationship.receiver_agent_name_snapshot = primary.agent_name_snapshot;
    relationship.receiver_agent_source = "manual";
    relationship.receiver_agent_source_value = "historical_booking_sales_agent";
    relationship.receiver_agent_set_at = { $date: planningTimestamp };
  }
  if (lead.bad_tab) {
    delete lead.document.bad_lead;
    if (insert?.document) delete insert.document.bad_lead;
    const earlierUpdateIndex = operations.findIndex((entry) => entry.action === "update" && entry.target_id === lead.production_id && entry.set?.bad_lead !== undefined);
    if (earlierUpdateIndex >= 0) {
      const earlier = operations[earlierUpdateIndex]!;
      delete earlier.set!.bad_lead;
      delete earlier.before!.bad_lead;
      delete earlier.precondition.bad_lead;
      if (earlier.after) delete earlier.after.bad_lead;
      if (Object.keys(earlier.set!).every((field) => field === "updatedAt")) operations.splice(earlierUpdateIndex, 1);
    }
    delete relationship.bad_lead;
  }
  if (!Object.keys(relationship).length) return;
  if (insert?.document) {
    Object.assign(insert.document, relationship);
    return;
  }
  const before = Object.fromEntries(Object.keys(relationship).map((field) => [field, existing[field] ?? null]));
  const precondition = Object.fromEntries(Object.keys(relationship).map((field) => [field, existing[field] === undefined ? { $exists: false } : existing[field]]));
  relationship.updatedAt = { $date: planningTimestamp };
  before.updatedAt = existing.updatedAt ?? null;
  precondition.updatedAt = existing.updatedAt === undefined ? { $exists: false } : existing.updatedAt;
  operations.push({ migration_key: `relationship:lead-booking:${lead.production_id}:${bookingId}`, order: 60, action: "update", model: lead.kind === "form" ? "FormLead" : "CallLead", collection: lead.kind === "form" ? "form_leads" : "call_leads", target_id: lead.production_id!, provenance, set: relationship, before, after: { ...existing, ...relationship }, precondition });
}

function planCancellationRelationships(
  booking: BookingPlan,
  cancellationId: string,
  production: HistoricalSnapshot["mongo"][number],
  planningTimestamp: string,
  provenance: SourceProvenance[],
  conflicts: ConflictCase[],
  operations: Array<Omit<HistoricalOperation, "operation_id">>,
): void {
  planSingleRelationship("BookedLead", "booked_leads", booking.target_id, "cancelled", cancellationId, production, planningTimestamp, provenance, conflicts, operations);
  const leadId = objectIdField(booking.document, "lead_ref");
  const leadModel = booking.document.lead_model;
  if (leadId && (leadModel === "FormLead" || leadModel === "CallLead")) planSingleRelationship(leadModel, leadModel === "FormLead" ? "form_leads" : "call_leads", leadId, "cancelled", cancellationId, production, planningTimestamp, provenance, conflicts, operations);
}

function planSingleRelationship(
  model: "FormLead" | "CallLead" | "BookedLead",
  collection: "form_leads" | "call_leads" | "booked_leads",
  targetId: string,
  field: "cancelled",
  value: string,
  production: HistoricalSnapshot["mongo"][number],
  planningTimestamp: string,
  provenance: SourceProvenance[],
  conflicts: ConflictCase[],
  operations: Array<Omit<HistoricalOperation, "operation_id">>,
): void {
  const insert = operations.find((entry) => entry.action === "insert" && entry.target_id === targetId);
  const existing = insert?.document ?? documents(production, collection).find((entry) => objectId(entry) === targetId);
  if (!existing) throw new Error(`Cannot plan ${field} relationship for ${targetId}`);
  const current = objectIdField(existing, field);
  if (current === value) return;
  if (current) {
    conflicts.push(makeConflict("relationship_conflict", true, provenance, { target_id: targetId, field }, [current, value], "preserve_valid_relationship", ["quarantine"]));
    return;
  }
  if (insert?.document) {
    insert.document[field] = { $oid: value };
    return;
  }
  const set = { [field]: { $oid: value }, updatedAt: { $date: planningTimestamp } };
  const before = { [field]: null, updatedAt: existing.updatedAt ?? null };
  const precondition = { [field]: { $exists: false }, updatedAt: existing.updatedAt === undefined ? { $exists: false } : existing.updatedAt };
  operations.push({ migration_key: `relationship:${collection}:${targetId}:${field}:${value}`, order: 60, action: "update", model, collection, target_id: targetId, provenance, set, before, after: { ...existing, ...set }, precondition });
}

function planSafeUpdate(model: "BookedLead" | "CancelledLead", collection: "booked_leads" | "cancelled_leads", id: string, key: string, planned: Record<string, unknown>, existing: Record<string, unknown>, provenance: SourceProvenance[], order: number, conflicts: ConflictCase[], operations: Array<Omit<HistoricalOperation, "operation_id">>, authoritative: Set<string>) {
  const set: Record<string, unknown> = {}; const before: Record<string, unknown> = {}; const precondition: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(planned)) {
    if (["createdAt", "updatedAt", "sheet_sync"].includes(field)) continue;
    const current = existing[field];
    if (authoritative.has(field) || empty(current)) { if (!equalValue(current, value)) { set[field] = value; before[field] = current ?? null; precondition[field] = current === undefined ? { $exists: false } : current; } }
    else if (!equalValue(current, value)) conflicts.push(makeConflict("non_empty_production_field_conflict", false, provenance, { field, production_id: id }, [id], "preserve_production_scalar", ["preserve_production"]));
  }
  if (Object.keys(set).length) {
    if (planned.updatedAt !== undefined) {
      set.updatedAt = planned.updatedAt;
      before.updatedAt = existing.updatedAt ?? null;
      precondition.updatedAt = existing.updatedAt === undefined ? { $exists: false } : existing.updatedAt;
    }
    operations.push({ migration_key: key, order, action: "update", model, collection, target_id: id, provenance, set, before, after: { ...existing, ...set }, precondition });
  }
}

function matchBadRows(forms: Row[], badRows: Row[], conflicts: ConflictCase[]) {
  const byLid = groupBy(forms, (row) => normalizeExact(String(row.values["Lead ID"] ?? "")));
  const byPhone = groupBy(forms, (row) => normalizePhoneNumberForMatch(String(row.values.Phone ?? "")) ?? "");
  const badRowChecksums = new Set<string>(); const orphans: Row[] = []; const matchedByFormChecksum = new Map<string, SourceProvenance[]>();
  for (const row of badRows) {
    const lid = normalizeExact(String(row.values["Lead ID"] ?? "")); const phone = normalizePhoneNumberForMatch(String(row.values.Phone ?? "")) ?? "";
    const candidates = lid && byLid.get(lid)?.length === 1 ? byLid.get(lid)! : phone && byPhone.get(phone)?.length === 1 ? byPhone.get(phone)! : [];
    if (candidates.length === 1) { badRowChecksums.add(candidates[0]!.provenance.row_checksum); badRowChecksums.add(row.provenance.row_checksum); matchedByFormChecksum.set(candidates[0]!.provenance.row_checksum, [...(matchedByFormChecksum.get(candidates[0]!.provenance.row_checksum) ?? []), row.provenance]); }
    else if ((lid && (byLid.get(lid)?.length ?? 0) > 1) || (phone && (byPhone.get(phone)?.length ?? 0) > 1)) conflicts.push(makeConflict("ambiguous_bad_lead_match", true, [row.provenance], { lid_present: Boolean(lid), phone_present: Boolean(phone) }, [], "bad_lead_lid_then_phone", ["select_candidate", "create_orphan", "quarantine"]));
    else { orphans.push(row); badRowChecksums.add(row.provenance.row_checksum); }
  }
  return { badRowChecksums, matchedByFormChecksum, orphans };
}

function flattenRows(snapshot: HistoricalSnapshot): Row[] {
  return snapshot.sheets.flatMap((workbook) =>
    workbook.tabs.flatMap((tab) =>
      tab.rows.map((row) => ({
        workbook_key: workbook.workbook_key,
        kind: tab.kind,
        source_company: tab.source_company,
        source_granularity_key: tab.source_granularity_key,
        provenance: {
          spreadsheet_id: workbook.spreadsheet_id,
          tab_id: tab.tab_id,
          tab_name: tab.tab_name,
          physical_row: row.physical_row,
          row_checksum: row.row_checksum,
        },
        values: Object.fromEntries(
          tab.headers.map((header, index) => [header, row.formatted[index] ?? ""]),
        ),
      })),
    ),
  );
}

function resolveProductionForm(production: HistoricalSnapshot["mongo"][number], companyId: string, lid: string, refNo: string, phone: string | null, timestamp: string) {
  const forms = documents(production, "form_leads").filter((entry) => objectIdField(entry, "lead_source_company") === companyId);
  for (const predicate of [
    (entry: Record<string, unknown>) => lid && normalizeExact(String(entry.normalized_lid ?? entry.lid ?? "")) === normalizeExact(lid),
    (entry: Record<string, unknown>) => refNo !== "not provided" && normalizeExact(String(entry.ref_no ?? "")) === normalizeExact(refNo),
    (entry: Record<string, unknown>) => phone && normalizePhoneNumberForMatch(String(entry.phone_number ?? "")) === phone && dateString(entry.timestamp) === timestamp,
  ]) { const matches = forms.filter(predicate); if (matches.length) return matches; }
  return [];
}

function resolveProductionCall(production: HistoricalSnapshot["mongo"][number], companyId: string, phone: string, timestamp: string) {
  const exact = documents(production, "call_leads").filter((entry) => objectIdField(entry, "lead_source_company") === companyId && normalizePhoneNumberForMatch(String(entry.phone_number ?? "")) === phone && dateString(entry.timestamp) === timestamp);
  if (exact.length) return exact;
  const target = new Date(timestamp).getTime();
  return documents(production, "call_leads").filter((entry) => objectIdField(entry, "lead_source_company") === companyId && normalizePhoneNumberForMatch(String(entry.phone_number ?? "")) === phone && Math.abs(new Date(dateString(entry.timestamp) ?? 0).getTime() - target) <= 60_000);
}

function findHistoricalByRow(database: HistoricalSnapshot["mongo"][number], collection: string, row: Row) {
  return documents(database, collection).find((entry) => String(entry.source_workbook ?? "") === row.workbook_key && String(entry.source_tab ?? "") === row.provenance.tab_name && Number(entry.source_row) === row.provenance.physical_row);
}

function makeConflict(kind: string, blocking: boolean, provenance: SourceProvenance[], normalized: Record<string, unknown>, candidates: string[], rule: string, allowed: string[]): ConflictCase {
  const basis = { kind, provenance: [...provenance].sort((a, b) => provenanceKey(a).localeCompare(provenanceKey(b))).map(provenanceKey), candidates: [...candidates].sort(), rule_version: HISTORICAL_RULE_VERSION };
  const evidence = [{ normalized, candidate_count: candidates.length }];
  return { case_id: sha256(basis), evidence_hash: sha256({ ...basis, evidence }), rule_version: HISTORICAL_RULE_VERSION, kind, blocking, status: "unresolved", source_provenance: provenance, normalized_fields: normalized, candidate_ids: candidates, rule_attempted: rule, evidence, allowed_resolutions: allowed };
}

function snapshotDb(snapshot: HistoricalSnapshot, name: "vantagemovers" | "vantagemovershistorical") { const database = snapshot.mongo.find((entry) => entry.database === name); if (!database) throw new Error(`Snapshot is missing ${name}`); return database; }
function documents(database: HistoricalSnapshot["mongo"][number], collection: string): Record<string, unknown>[] { return (database.collections[collection]?.documents ?? []) as Record<string, unknown>[]; }
function objectId(record: Record<string, unknown>, field = "_id"): string { const value = record[field] as { $oid?: string } | string | undefined; const id = typeof value === "string" ? value : value?.$oid; if (!id) throw new Error(`Expected ObjectId in ${field}`); return id; }
function objectIdField(record: Record<string, unknown>, field: string): string | undefined { try { return objectId(record, field); } catch { return undefined; } }
function withoutId(record: Record<string, unknown>): Record<string, unknown> { const { _id, ...rest } = record; return rest; }
function dateString(value: unknown): string | undefined { if (typeof value === "string") return value; if (value && typeof value === "object" && typeof (value as { $date?: unknown }).$date === "string") return (value as { $date: string }).$date; return undefined; }
function toClassifierLead(lead: LeadCandidate): CanonicalLead { return { id: lead.id, kind: lead.kind, timestamp: lead.timestamp, source_company_id: lead.source_company_id, source_granularity_id: lead.source_granularity_id, normalized_phone: lead.normalized_phone, normalized_email: lead.normalized_email, duplicate: lead.production_id ? Boolean(lead.document.duplicate) : false, preserve_duplicate: lead.preserve_duplicate }; }
function compareLead(a: LeadCandidate, b: LeadCandidate) { return a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id); }
function provenanceKey(value: SourceProvenance) { return `${value.spreadsheet_id}:${value.tab_id}:${value.physical_row}:${value.row_checksum}`; }
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> { const result = new Map<string, T[]>(); for (const item of items) { const value = key(item); if (value) result.set(value, [...(result.get(value) ?? []), item]); } return result; }
function truthy(value: unknown) { return ["true", "yes", "y", "1", "x"].includes(normalizeExact(String(value ?? ""))); }
function numberOrUndefined(value: unknown) { const parsed = Number(String(value ?? "").replaceAll(",", "")); return Number.isFinite(parsed) ? parsed : undefined; }
function empty(value: unknown) { return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0); }
function equalValue(left: unknown, right: unknown) { return sha256(left ?? null) === sha256(right ?? null); }
function normalizeMoveSize(value: string) { const normalized = normalizeExact(value); const map: Record<string, string> = { studio: "Studio", "1 bedroom": "1 Bedroom", "2 bedrooms": "2 Bedrooms", "3 bedrooms": "3 Bedrooms", "4 bedrooms": "4 Bedrooms", "5+ bedrooms": "5+ Bedrooms", office: "Office" }; return map[normalized] ?? normalizeDisplay(value); }
function buildExpectedCounts(production: HistoricalSnapshot["mongo"][number], operations: Array<Omit<HistoricalOperation, "operation_id">>) { const result: Record<string, { before: number; inserts: number; after: number }> = {}; for (const collection of Object.values(COLLECTIONS)) { const before = production.collections[collection]?.count ?? 0; const inserts = operations.filter((entry) => entry.collection === collection && entry.action === "insert").length; if (before || inserts) result[collection] = { before, inserts, after: before + inserts }; } return result; }
