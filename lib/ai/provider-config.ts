import {
  PersistedAppSettings,
  SearchAiProvider,
  TextAiProvider,
} from "@/lib/persistence/types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GROK2API_BASE_URL =
  process.env.META_PLAYER_GROK2API_BASE_URL?.trim() || "http://127.0.0.1:8000/v1";

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const getDefaultBaseUrl = (provider: TextAiProvider | SearchAiProvider) =>
  provider === "grok2api" ? DEFAULT_GROK2API_BASE_URL : DEFAULT_OPENAI_BASE_URL;

const getProviderBaseUrlFromSettings = (
  settings: Pick<
    PersistedAppSettings,
    "openaiApiBaseUrl" | "grok2apiBaseUrl"
  >,
  provider: TextAiProvider | SearchAiProvider
) =>
  provider === "grok2api"
    ? settings.grok2apiBaseUrl
    : settings.openaiApiBaseUrl;

const getProviderApiKeyFromSettings = (
  settings: Pick<
    PersistedAppSettings,
    "openaiApiKey" | "grok2apiApiKey"
  >,
  provider: TextAiProvider | SearchAiProvider
) =>
  provider === "grok2api"
    ? settings.grok2apiApiKey
    : settings.openaiApiKey;

const getProviderTextModelNameFromSettings = (
  settings: Pick<
    PersistedAppSettings,
    "openaiTextModelName" | "grok2apiTextModelName"
  >,
  provider: TextAiProvider | SearchAiProvider
) =>
  provider === "grok2api"
    ? settings.grok2apiTextModelName
    : settings.openaiTextModelName;

export const getProviderDisplayName = (
  provider: TextAiProvider | SearchAiProvider
) => (provider === "grok2api" ? "grok2api" : "OpenAI 兼容");

export const resolveTextModelProviderConfig = (settings: Pick<
  PersistedAppSettings,
  | "aiTextProvider"
  | "openaiApiBaseUrl"
  | "openaiApiKey"
  | "grok2apiBaseUrl"
  | "grok2apiApiKey"
  | "openaiTextModelName"
  | "grok2apiTextModelName"
>) => {
  const provider = settings.aiTextProvider;
  const baseUrl = normalizeBaseUrl(
    getProviderBaseUrlFromSettings(settings, provider) || getDefaultBaseUrl(provider)
  );

  return {
    provider,
    baseUrl,
    apiKey: getProviderApiKeyFromSettings(settings, provider).trim(),
    model: getProviderTextModelNameFromSettings(settings, provider).trim(),
  };
};

export const resolveSearchModelProviderConfig = (settings: Pick<
  PersistedAppSettings,
  | "aiSearchProvider"
  | "openaiApiBaseUrl"
  | "openaiApiKey"
  | "grok2apiBaseUrl"
  | "grok2apiApiKey"
  | "aiSearchModelName"
  | "openaiTextModelName"
  | "grok2apiTextModelName"
>) => {
  const provider = settings.aiSearchProvider;
  const baseUrl = normalizeBaseUrl(
    getProviderBaseUrlFromSettings(settings, provider) || getDefaultBaseUrl(provider)
  );

  return {
    provider,
    baseUrl,
    apiKey: getProviderApiKeyFromSettings(settings, provider).trim(),
    model:
      settings.aiSearchModelName.trim() ||
      getProviderTextModelNameFromSettings(settings, provider).trim(),
  };
};

export const getDefaultProviderBaseUrl = (
  provider: TextAiProvider | SearchAiProvider
) => getDefaultBaseUrl(provider);

export const getEditableProviderBaseUrl = (
  settings: Pick<
    PersistedAppSettings,
    "openaiApiBaseUrl" | "grok2apiBaseUrl"
  >,
  provider: TextAiProvider | SearchAiProvider
) => getProviderBaseUrlFromSettings(settings, provider);

export const getEditableProviderApiKey = (
  settings: Pick<
    PersistedAppSettings,
    "openaiApiKey" | "grok2apiApiKey"
  >,
  provider: TextAiProvider | SearchAiProvider
) => getProviderApiKeyFromSettings(settings, provider);

export const getEditableProviderTextModelName = (
  settings: Pick<
    PersistedAppSettings,
    "openaiTextModelName" | "grok2apiTextModelName"
  >,
  provider: TextAiProvider | SearchAiProvider
) => getProviderTextModelNameFromSettings(settings, provider);
