export type GooglePickerConfig = {
  apiKey: string;
  appId: string;
};

export function getGooglePickerConfig(): GooglePickerConfig {
  return {
    apiKey: requiredEnv("GOOGLE_PICKER_API_KEY"),
    appId: requiredEnv("GOOGLE_PICKER_APP_ID"),
  };
}

export function tryGetGooglePickerConfig(): GooglePickerConfig | undefined {
  const apiKey = process.env.GOOGLE_PICKER_API_KEY?.trim();
  const appId = process.env.GOOGLE_PICKER_APP_ID?.trim();
  if (!apiKey || !appId) return undefined;
  return { apiKey, appId };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
