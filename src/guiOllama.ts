import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
};

export type OllamaRuntimeState = {
  baseUrl: string;
  apiKeyConfigured: boolean;
  reachable: boolean;
  modelCount: number;
  installedModels: string[];
  detail: string;
};

export type SaveOllamaConfigInput = {
  baseUrl?: string;
  apiKey?: string;
};

export async function getOllamaRuntimeState(env: NodeJS.ProcessEnv = process.env): Promise<OllamaRuntimeState> {
  const baseUrl = normalizeBaseUrl(env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434");
  const apiKey = env.OLLAMA_API_KEY?.trim() || "";

  try {
    const init = apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {};
    const response = await fetch(`${baseUrl}/api/tags`, init);

    if (!response.ok) {
      return {
        baseUrl,
        apiKeyConfigured: Boolean(apiKey),
        reachable: false,
        modelCount: 0,
        installedModels: [],
        detail: `Ollama did not respond cleanly at ${baseUrl}.`,
      };
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const installedModels = [...new Set((payload.models ?? [])
      .map((model) => model.name?.trim() || model.model?.trim() || "")
      .filter(Boolean))];

    return {
      baseUrl,
      apiKeyConfigured: Boolean(apiKey),
      reachable: true,
      modelCount: installedModels.length,
      installedModels,
      detail: installedModels.length > 0
        ? `Found ${installedModels.length} local Ollama model${installedModels.length === 1 ? "" : "s"} at ${baseUrl}.`
        : `Ollama is reachable at ${baseUrl}, but no local models are installed yet.`,
    };
  } catch {
    return {
      baseUrl,
      apiKeyConfigured: Boolean(apiKey),
      reachable: false,
      modelCount: 0,
      installedModels: [],
      detail: `Ollama is not reachable at ${baseUrl}. Start Ollama or set the correct base URL.`,
    };
  }
}

export async function saveOllamaRuntimeConfig(
  repoRoot: string,
  input: SaveOllamaConfigInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OllamaRuntimeState> {
  const envPath = path.join(repoRoot, ".env");
  let contents = await readEnvFileIfPresent(envPath);

  const baseUrl = normalizeBaseUrl(input.baseUrl?.trim() || "http://127.0.0.1:11434");
  contents = upsertEnvLine(contents, "OLLAMA_BASE_URL", baseUrl);
  env.OLLAMA_BASE_URL = baseUrl;

  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    const apiKey = input.apiKey.trim();
    contents = upsertEnvLine(contents, "OLLAMA_API_KEY", apiKey);
    env.OLLAMA_API_KEY = apiKey;
  }

  await writeFile(envPath, contents, "utf8");
  await chmod(envPath, 0o600).catch(() => {});

  return getOllamaRuntimeState(env);
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
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
