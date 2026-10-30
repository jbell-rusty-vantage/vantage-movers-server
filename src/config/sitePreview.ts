/** Deployment entrypoint policy; never loaded by the production API entrypoint. */
export function assertSitePreviewEnvironment(env: NodeJS.ProcessEnv): void {
  const required: Record<string, string> = {
    TEST_MODE: "true",
    TEST_MONGO_DATABASE_NAME: "testvantagemovers_sitepreview",
    CRM_FORM_LEAD_POSTING_ENABLED: "false",
    SHEET_SYNC_MODE: "disabled",
    LEAD_MESSAGING_MODE: "disabled",
    LEAD_MESSAGING_ALLOW_TEST_MODE: "false",
    SALES_INTELLIGENCE_ENABLED: "false",
  };
  for (const [key, expected] of Object.entries(required)) {
    if (env[key] !== expected) throw new Error(`Website preview requires ${key}=${expected}`);
  }
  if (!env.MONGO_URI || !env.VANTAGE_API_SECRET) throw new Error("Website preview requires Mongo and API credentials");
}

export function isSitePreviewRequestAllowed(method: string, path: string): boolean {
  if (method === "GET") {
    return ["/", "/health", "/db", "/api/v1/testimonials", "/api/v1/moving-carriers"].includes(path)
      || /^\/api\/v1\/form-leads\/[a-f0-9]{24}$/i.test(path);
  }
  return method === "POST" && path === "/api/v1/form-leads";
}
