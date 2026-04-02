import { resolveOpenAIAuth } from "./openaiAuth.js";

const PROVIDERS = ["anthropic", "openai", "gemini", "groq", "openrouter", "huggingface", "copilot", "zai", "ollama"];

const SECRET_KEYS_BY_PROVIDER = {
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  huggingface: ["HF_TOKEN"],
  copilot: ["COPILOT_TOKEN", "GITHUB_MODELS_TOKEN"],
  zai: ["ZAI_API_KEY"],
};

export function normalizeProviderName(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "claude") {
    return "anthropic";
  }
  if (value === "grok") {
    return "groq";
  }
  if (value === "github" || value === "github-models") {
    return "copilot";
  }
  if (value === "router") {
    return "openrouter";
  }
  if (value === "hf" || value === "huggingface" || value === "hugging-face") {
    return "huggingface";
  }
  if (value === "z.ai") {
    return "zai";
  }
  if (value === "chatgpt") {
    return "openai";
  }
  return value;
}

export function resolvePreferredProvider(env = process.env, options = {}) {
  const explicitProvider = normalizeProviderName(env.CLAW_PROVIDER || env.LLM_PROVIDER);
  if (PROVIDERS.includes(explicitProvider)) {
    return explicitProvider;
  }

  const configuredProvider = resolveConfiguredProvider(env, options);
  if (configuredProvider) {
    return configuredProvider;
  }

  return "anthropic";
}

export function resolveConfiguredProvider(env = process.env, options = {}) {
  const openAIAuth = options.openAIAuth ?? resolveOpenAIAuth({ env });
  if (openAIAuth.status === "ok") {
    return "openai";
  }

  if (hasConfiguredProviderSecret("openrouter", env)) {
    return "openrouter";
  }

  if (hasConfiguredProviderSecret("huggingface", env)) {
    return "huggingface";
  }

  if (hasConfiguredProviderSecret("anthropic", env)) {
    return "anthropic";
  }

  if (hasConfiguredProviderSecret("gemini", env)) {
    return "gemini";
  }

  if (hasConfiguredProviderSecret("groq", env)) {
    return "groq";
  }

  if (hasConfiguredProviderSecret("copilot", env)) {
    return "copilot";
  }

  if (hasConfiguredProviderSecret("zai", env)) {
    return "zai";
  }

  if (looksConfiguredForOllama(env)) {
    return "ollama";
  }

  return null;
}

export function shouldPromptForModelSelection(env = process.env, options = {}) {
  if (options.modelArg?.trim()) {
    return false;
  }

  if (isTruthy(env.CLAW_PROMPT_FOR_MODEL) || isTruthy(env.CLAW_INTERACTIVE_SETUP)) {
    return true;
  }

  return false;
}

function hasConfiguredProviderSecret(provider, env) {
  const keys = SECRET_KEYS_BY_PROVIDER[provider] ?? [];
  return keys.some((key) => normalizeCredential(env[key]).length > 0);
}

function looksConfiguredForOllama(env) {
  return normalizeCredential(env.OLLAMA_MODEL).length > 0 || normalizeCredential(env.OLLAMA_BASE_URL).length > 0;
}

function normalizeCredential(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized === "changeme" ||
    normalized === "replace-me" ||
    normalized === "your_api_key_here" ||
    normalized.startsWith("your_") ||
    normalized.startsWith("example_") ||
    normalized.includes("placeholder")
  ) {
    return "";
  }

  return trimmed;
}

function isTruthy(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
