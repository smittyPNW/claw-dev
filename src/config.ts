import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { formatOpenAIAuthHint, resolveOpenAIAuth } from "../shared/openaiAuth.js";
import { resolvePreferredProvider } from "../shared/tuiDefaults.js";
import type { ProviderName } from "./providers.js";

loadEnv({ quiet: true });

const providerSchema = z.enum(["anthropic", "gemini", "openai", "openrouter", "huggingface", "ollama"]);

const envSchema = z.object({
  LLM_PROVIDER: z.preprocess(
    (value) => {
      const normalized = typeof value === "string" ? value.trim() : value;
      return normalized ? normalized : undefined;
    },
    providerSchema.default("anthropic"),
  ),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-20250514"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_AUTH_TOKEN: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.2-codex"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-sonnet-4"),
  HF_TOKEN: z.string().optional(),
  HUGGINGFACE_MODEL: z.string().min(1).default("openai/gpt-oss-120b:fastest"),
  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().min(1).default("qwen3"),
  OLLAMA_API_KEY: z.string().optional(),
});

export type AppConfig = {
  provider: ProviderName;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export function loadConfig(overrides?: Partial<Pick<AppConfig, "provider" | "model">>): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    throw new Error(message);
  }
  const provider = (
    overrides?.provider ??
    (process.env.LLM_PROVIDER?.trim() ? parsed.data.LLM_PROVIDER : resolvePreferredProvider(process.env))
  ) as ProviderName;

  if (provider === "openai") {
    const auth = resolveOpenAIAuth({ env: process.env });
    if (auth.status !== "ok") {
      throw new Error(formatOpenAIAuthHint(auth));
    }
    return {
      provider,
      apiKey: auth.bearerToken,
      model: overrides?.model ?? parsed.data.OPENAI_MODEL,
    };
  }

  if (provider === "gemini") {
    const apiKey = parsed.data.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
    }
    return {
      provider,
      apiKey,
      model: overrides?.model ?? parsed.data.GEMINI_MODEL,
    };
  }

  if (provider === "openrouter") {
    const apiKey = parsed.data.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "OpenRouter mode requires OPENROUTER_API_KEY. Set it in your environment or .env file and try again.",
      );
    }
    return {
      provider,
      apiKey,
      model: overrides?.model ?? parsed.data.OPENROUTER_MODEL,
      baseUrl: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    };
  }

  if (provider === "huggingface") {
    const apiKey = parsed.data.HF_TOKEN?.trim();
    if (!apiKey) {
      throw new Error("HF_TOKEN is required when LLM_PROVIDER=huggingface");
    }
    return {
      provider,
      apiKey,
      model: overrides?.model ?? parsed.data.HUGGINGFACE_MODEL,
      baseUrl: process.env.HUGGINGFACE_BASE_URL?.trim() || "https://router.huggingface.co/v1",
    };
  }

  if (provider === "ollama") {
    return {
      provider,
      apiKey: parsed.data.OLLAMA_API_KEY?.trim() || "",
      model: overrides?.model ?? parsed.data.OLLAMA_MODEL,
      baseUrl: parsed.data.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
    };
  }

  const apiKey = parsed.data.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
  }

  return {
    provider,
    apiKey,
    model: overrides?.model ?? parsed.data.ANTHROPIC_MODEL,
  };
}
