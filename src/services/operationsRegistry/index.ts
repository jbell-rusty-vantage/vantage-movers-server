export {
  getRegistryOverview,
} from "./queries/overview";
export {
  getRegistryHealth,
} from "./queries/health";
export {
  listRegistryChanges,
} from "./queries/changes";

export {
  verifyRegistryActor,
  requireRegistryReadActor,
  requireRegistryOwnerActor,
  readAdminActorHeaders,
  computeAdminActorSignature,
  verifyAdminActorSignature,
  signAdminActorPayload,
  redactSensitiveActorSnapshot,
} from "./trustedActor";

export {
  ADMIN_PROXY_HEADER_NAMES,
  APPROVED_REGISTRY_READ_ROLES,
  buildCanonicalAdminActorPayload,
  normalizeAdminEmail,
  normalizeAdminRole,
  normalizeAdminMethod,
  normalizeAdminPath,
} from "./trustedActorCanonical";

export {
  withRegistryMutation,
  insertRegistryChangeAudit,
} from "./registryAudit";

export {
  sanitizeRegistrySnapshot,
  sanitizeRegistryMetadata,
} from "./snapshotSanitizer";

export {
  invalidateRegistryCaches,
  onRegistryCacheInvalidation,
  getRegistryCacheInvalidationLogForTests,
  resetRegistryCacheInvalidationForTests,
} from "./cacheInvalidation";

export {
  getAdminProxySigningSecret,
  getAdminProxySignatureMaxAgeMs,
  isOperationsRegistryPreviewUnsignedAllowed,
  isProductionRuntime,
} from "./config";

export { RegistryError, isRegistryError } from "./errors";

export type {
  RegistryActorContext,
  RegistryAuditInput,
  RegistryMutationInput,
  RegistryOverviewResult,
  RegistryHealthResult,
  RegistryHealthFinding,
  ListRegistryChangesResult,
  ListRegistryChangesQuery,
  RegistryChangeListItem,
  TransactionRunner,
} from "./types";

export type {
  AdminActorHeaders,
  VerifyActorInput,
} from "./trustedActor";

export type { RegistryAuditDeps } from "./registryAudit";

export type {
  CanonicalAdminActorFields,
  ApprovedRegistryReadRole,
} from "./trustedActorCanonical";

export {
  createOrUpdateAgent,
  createOrUpdateMerchant,
  getRegistryAgent,
  getRegistryMerchant,
  listRegistryAgents,
  listRegistryMerchants,
  previewRegistryDependency,
  resolveAgentByGranotUsername,
  setAgentActivation,
  setMerchantActivation,
} from "./catalogRegistry";
export type {
  AgentRegistryCommand,
  CatalogActivationCommand,
  MerchantRegistryCommand,
  RegistryCatalogItem,
  RegistryDependencyPreview,
} from "./catalogRegistry";

export {
  previewSourceAttribution,
} from "./sourceResolution";
export type {
  RegistrySourceChannel,
  RegistrySourceCompanyRecord,
  RegistrySourceGranularityRecord,
  SourceAttribution,
  SourceAttributionInput,
  SourceResolutionPreview,
} from "./sourceResolution";

export {
  createOrUpdateSourceCompany,
  createOrUpdateSourceGranularity,
  getSourceCompany,
  getSourceCompanyBySlug,
  getSourceGranularity,
  listSourceCompanies,
  listSourceGranularities,
  previewSourceDependency,
  previewSourceResolution,
  resolveSourceAttribution,
  setSourceCompanyActivation,
  setSourceGranularityActivation,
} from "./sourceRegistry";
export type {
  SourceActivationCommand,
  SourceCompanyCommand,
  SourceCompanyItem,
  SourceGranularityCommand,
  SourceGranularityItem,
} from "./sourceRegistry";
