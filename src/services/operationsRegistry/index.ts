export {
  getRegistryOverview,
} from "./queries/overview";
export {
  getRegistryHealth,
} from "./queries/health";
export {
  getLeadSourceProjection,
  listLeadSourceProjections,
  getProjectionRoundTripCount,
  resetProjectionRoundTripCount,
  PROJECTION_ROUND_TRIP_BOUNDS,
} from "./queries/leadSourceProjection";
export type {
  LeadSourceDetail,
  LeadSourceDetailResult,
  LeadSourceListItem,
  LeadSourceListResult,
  OwnerReadinessPlanRow,
  OwnerReadinessAction,
} from "./queries/leadSourceProjection";
export {
  translateFinding,
  translateFindings,
  FINDING_TRANSLATIONS,
  TRANSLATED_HEALTH_CODES,
} from "./queries/findingTranslation";
export type { OwnerFinding } from "./queries/findingTranslation";
export {
  createLeadSourceSetup,
  previewLeadSourceSetup,
  validateLeadSourceSetup,
  deriveSetupKeys,
  buildReadinessPlan,
} from "./leadSourceSetup";
export type {
  LeadSourceSetupCommand,
  LeadSourceSetupPreview,
  LeadSourceSetupResult,
  ReadinessPlanRow,
} from "./leadSourceSetup";
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
  withMultiEntityRegistryMutation,
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
export { normalizeGranotCrmUsername } from "./catalogNormalization";

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
  resolveRegistryAgentByName,
  resolveRegistryMerchantByName,
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
  createLabelMapping,
  listLabelMappings,
  normalizeSourceLabel,
  previewLabelResolution,
  resolveLabelToFeed,
  resolveSheetOrLegacyLabel,
  setLabelMappingActivation,
  consultStaticSourceLabelMap,
  getStaticSourceLabelMapConsultCount,
  resetStaticSourceLabelMapConsultsForTests,
} from "./labelMappings";
export type {
  CreateLabelMappingCommand,
  LabelMappingRecord,
  LabelResolution,
  LabelMappingNamespace,
} from "./labelMappings";

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
  createOrUpdateGranotCrmSource,
  persistGranotCrmSourceInSession,
  getRegistryGranotCrmSource,
  listRegistryGranotCrmSources,
  setGranotCrmSourceLifecycleEnabled,
} from "./granotCrmSources";
export {
  createGranotNameFromOwnerIntent,
  translateOwnerArrivalPolicy,
  translateOwnerHandling,
  workspaceSlugFromNormalizedLabel,
  assembleOwnerGranotCreateForKnownFeed,
  assembleOneFeedRoutes,
  assertGranotNameAvailable,
} from "./ownerGranotNames";
export type {
  OwnerGranotNameCommand,
  OwnerGranotNameCreateResult,
  OwnerGranotNameGateState,
} from "./ownerGranotNames";
export {
  listRecentGranotCrmSourceSms,
  setGranotCrmSourceOutboundSms,
} from "./crmSourceOutboundSms";
export type {
  GranotCrmSourceCommand,
  GranotCrmSourceLifecycleActivationCommand,
  GranotCrmSourceLifecycleRoute,
  GranotCrmSourceRecord,
} from "./granotCrmSources";
export {
  getProjectedGranotCrmSource,
  listProjectedGranotCrmSources,
} from "./granotCrmSourceProjections";
export type {
  GranotCrmSourceProjection,
} from "./granotCrmSourceProjections";
export { setGranotAutomationSourceReference } from "./granotAutomationSources";
export {
  GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS,
  GRANOT_LIFECYCLE_SOURCE_HEALTH_CACHE_KEY,
  GRANOT_LIFECYCLE_SOURCE_LIST_CACHE_KEY,
  GRANOT_LIFECYCLE_SOURCE_POLICY_CACHE_KEY,
} from "./granotCrmSourceCache";

export {
  assertExactIdentifiersAvailable,
  deriveRegistryKey,
  persistNewSourceCompanyInSession,
  persistNewSourceGranularityInSession,
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
  createRingCentralAccountRouteValidator,
  validateRingCentralNumberAgainstAccount,
} from "./ringCentralValidation";
export type {
  RingCentralRouteValidationResult,
  RingCentralRouteValidator,
} from "./ringCentralValidation";
