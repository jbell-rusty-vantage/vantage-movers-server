export {
  browseAdminResource,
  exportAdminResourceRows,
  getAdminResourceConfig,
  getAdminResourceDetail,
  type AdminBrowseResult,
} from "./adminBrowse.service";
export { exportAdminResourceCsv } from "./adminExport.service";
export { globalAdminSearch, type AdminSearchGroup, type AdminSearchItem } from "./adminSearch.service";
export {
  concreteScopes,
  getAdminModels,
  rejectCombinedDetailScope,
  type AdminResource,
  type ConcreteAdminScope,
} from "./adminScope.service";
