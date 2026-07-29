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
  getRegistryRuntimeTelemetry,
  mergeDurableCompatibilityTelemetry,
  recordCompatibilityRead,
  recordDurableCompatibilityRead,
  recordRegistryResolverAttempt,
  recordRegistryResolverFailure,
  recordRegistryResolverStaleServe,
  recordRegistryResolverSuccess,
} from "./runtimeTelemetry";
export type {
  RegistryCompatibilityTelemetry,
  RegistryResolverTelemetry,
  RegistryRuntimeTelemetry,
} from "./runtimeTelemetry";

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

export {
  applySimpleCplSchedule,
  businessDateToUtc,
  constructAdvancedCplSchedule,
  constructSimpleCplSchedule,
  dollarsToCents,
  listCplSchedule,
  mutateAdvancedCplSchedule,
  ownerInclusiveEndDateToExclusive,
  resolveCpl,
  resolveCplFromPeriods,
  storedLeadTimestampToCplInstant,
  validateCplSchedule,
} from "./cplSchedule";
export type {
  AdvancedCplOperation,
  AdvancedCplScheduleCommand,
  CplResolution,
  CplScheduleCommandResult,
  CplSchedulePeriod,
  CplSchedulePeriodInput,
  CplScheduleState,
  ResolveCplInput,
  SimpleCplScheduleCommand,
} from "./cplSchedule";

export {
  cancelCplCorrectionJob,
  computeCplCorrectionPreviewHash,
  configureCplCorrectionAnalyticsInvalidation,
  createCplCorrection,
  createDefaultCplCorrectionDependencies,
  getCplCorrectionAnalyticsInvalidationSeam,
  getCplCorrectionJob,
  normalizeCplCorrectionSelection,
  previewCplCorrection,
  processCplCorrectionBatch,
  runDueCplCorrectionJobs,
} from "./cplCorrections";
export type {
  CplCorrectionAnalyticsInvalidationRequest,
  CplCorrectionBatchResult,
  CplCorrectionDependencies,
  CplCorrectionJobView,
  CplCorrectionPreviewResult,
  CreateCplCorrectionCommand,
  PreviewCplCorrectionCommand,
} from "./cplCorrections";

export {
  activateRingCentralRoute,
  createOrUpdateRingCentralRoute,
  deactivateRingCentralRoute,
  getRingCentralInboundRoute,
  listRingCentralInboundRoutes,
  previewRingCentralRouteDependencies,
  recordRingCentralRouteObservation,
  reassignRingCentralRoute,
  validateRingCentralRoute,
} from "./ringCentralRegistry";
export type {
  RingCentralRouteActivationCommand,
  RingCentralRouteAssignmentItem,
  RingCentralRouteCommand,
  RingCentralRouteDeactivationCommand,
  RingCentralRouteItem,
} from "./ringCentralRegistry";

export {
  buildRingCentralRouteSnapshot,
  listActiveRingCentralSnapshotNumbers,
  listRingCentralSnapshotNumbers,
  loadRingCentralRouteSnapshot,
  resetRingCentralRouteSnapshotForTests,
  resolveRingCentralInboundRoute,
  RINGCENTRAL_ROUTE_CACHE_KEY,
} from "./ringCentralSnapshot";
export type {
  RingCentralRouteResolution,
  RingCentralRouteSnapshot,
  RingCentralRouteSnapshotEntry,
  RingCentralSnapshotInput,
} from "./ringCentralSnapshot";

export {
  validateRingCentralNumberAgainstAccount,
} from "./ringCentralValidation";
export type {
  RingCentralRouteValidationResult,
  RingCentralRouteValidator,
} from "./ringCentralValidation";
