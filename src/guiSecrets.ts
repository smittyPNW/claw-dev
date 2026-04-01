import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type KeyBackedProvider = "anthropic" | "gemini" | "openai" | "openrouter";

type ProviderSecretMeta = {
  envKey: string;
  label: string;
};

const PROVIDER_SECRET_META: Record<KeyBackedProvider, ProviderSecretMeta> = {
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
  },
  gemini: {
    envKey: "GEMINI_API_KEY",
    label: "Gemini API Key",
  },
  openai: {
    envKey: "OPENAI_API_KEY",
    label: "OpenAI API Key",
  },
  openrouter: {
    envKey: "OPENROUTER_API_KEY",
    label: "OpenRouter API Key",
  },
};

export type ProviderSecretState = {
  provider: KeyBackedProvider;
  envKey: string;
  label: string;
  hasStoredKey: boolean;
  maskedValue: string;
  source: "env" | "none";
  detail: string;
};

export function getProviderSecretState(provider: KeyBackedProvider, env: NodeJS.ProcessEnv = process.env): ProviderSecretState {
  const meta = getProviderSecretMeta(provider);
  const raw = env[meta.envKey]?.trim() || "";

  if (!raw) {
    return {
      provider,
      envKey: meta.envKey,
      label: meta.label,
      hasStoredKey: false,
      maskedValue: "",
      source: "none",
      detail: `No ${meta.label} is stored for this project yet.`,
    };
  }

  return {
    provider,
    envKey: meta.envKey,
    label: meta.label,
    hasStoredKey: true,
    maskedValue: maskSecret(raw),
    source: "env",
    detail: `${meta.label} is stored in this project's local environment file.`,
  };
}

export async function saveProviderSecret(
  repoRoot: string,
  provider: KeyBackedProvider,
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderSecretState> {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("API key cannot be empty.");
  }

  const meta = getProviderSecretMeta(provider);
  const envPath = path.join(repoRoot, ".env");
  const nextContents = upsertEnvLine(await readEnvFileIfPresent(envPath), meta.envKey, trimmed);

  await writeFile(envPath, nextContents, "utf8");
  await chmod(envPath, 0o600).catch(() => {});
  env[meta.envKey] = trimmed;

  return getProviderSecretState(provider, env);
}

function getProviderSecretMeta(provider: KeyBackedProvider): ProviderSecretMeta {
  const meta = PROVIDER_SECRET_META[provider];
  if (!meta) {
    throw new Error(`Provider ${provider} does not support API-key storage here.`);
  }
  return meta;
}

async function readEnvFileIfPresent(envPath: string): Promise<string> {
  try {
    return await readFile(envPath, "utf8");
  } catch {
    return "";
  }
}

function upsertEnvLine(contents: string, envKey: string, value: string): string {
  const lines = contents.length > 0 ? contents.split(/\r?\n/) : [];
  let updated = false;

  const nextLines = lines.map((line) => {
    if (line.startsWith(`${envKey}=`)) {
      updated = true;
      return `${envKey}=${value}`;
    }
    return line;
  });

  if (!updated) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(`${envKey}=${value}`);
  }

  return `${nextLines.join("\n").replace(/\n+$/u, "")}\n`;
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "••••••••";
  }

  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
