import { providerModelCatalog } from "../shared/providerModels.js";

export type GuiModelOption = {
  value: string;
  label: string;
  description: string;
  badge?: string;
  emphasis?: "default" | "recommended" | "free" | "local";
};

export type GuiModelGroup = {
  id: string;
  label: string;
  options: GuiModelOption[];
};

type OpenRouterModelResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    description?: string;
    pricing?: {
      prompt?: string;
      completion?: string;
      request?: string;
      image?: string;
    };
    supported_parameters?: string[];
  }>;
};

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_CACHE_TTL_MS = 1000 * 60 * 10;

let openRouterCache:
  | {
      expiresAt: number;
      groups: GuiModelGroup[];
    }
  | undefined;

export async function getGuiModelGroups(
  provider: "anthropic" | "gemini" | "openrouter" | "ollama",
  env: NodeJS.ProcessEnv = process.env,
): Promise<GuiModelGroup[]> {
  if (provider === "anthropic") {
    return [
      {
        id: "default",
        label: "Anthropic Models",
        options: [
          {
            value: env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514",
            label: env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514",
            description: "Configured Anthropic default for the direct app path.",
            badge: "Configured",
            emphasis: "recommended",
          },
          {
            value: "claude-sonnet-4-20250514",
            label: "Claude Sonnet 4",
            description: "General coding and repo analysis default.",
          },
        ],
      },
    ];
  }

  if (provider === "gemini") {
    return [
      {
        id: "default",
        label: "Gemini Models",
        options: uniqueOptions([
          {
            value: env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
            label: env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
            description: "Configured Gemini default for the direct app path.",
            badge: "Configured",
            emphasis: "recommended",
          },
          {
            value: "gemini-2.5-flash",
            label: "Gemini 2.5 Flash",
            description: "Fast interactive coding loop.",
          },
          {
            value: "gemini-2.5-pro",
            label: "Gemini 2.5 Pro",
            description: "Stronger reasoning for larger tasks.",
          },
        ]),
      },
    ];
  }

  if (provider === "openrouter") {
    return getOpenRouterModelGroups(env);
  }

  if (provider === "ollama") {
    return getOllamaModelGroups();
  }

  return [];
}

async function getOpenRouterModelGroups(env: NodeJS.ProcessEnv): Promise<GuiModelGroup[]> {
  const now = Date.now();
  if (openRouterCache && openRouterCache.expiresAt > now) {
    return openRouterCache.groups;
  }

  const fallbackGroups = buildOpenRouterFallbackGroups(env);

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      openRouterCache = {
        expiresAt: now + OPENROUTER_CACHE_TTL_MS,
        groups: fallbackGroups,
      };
      return fallbackGroups;
    }

    const payload = (await response.json()) as OpenRouterModelResponse;
    const freeOptions = (payload.data ?? [])
      .filter((model) => isOpenRouterFreeModel(model) && isCodingFriendlyOpenRouterModel(model))
      .map((model) => ({
        value: model.id?.trim() || "",
        label: model.name?.trim() || model.id?.trim() || "",
        description: summarizeOpenRouterDescription(model),
        badge: "Free now",
        emphasis: "free" as const,
      }))
      .filter((option) => option.value.length > 0)
      .sort((left, right) => left.label.localeCompare(right.label))
      .slice(0, 14);

    const groups = [
      {
        id: "router",
        label: "OpenRouter Routers",
        options: [
          {
            value: "openrouter/free",
            label: "Free Models Router",
            description: "Automatically selects a currently free model on OpenRouter.",
            badge: "Free now",
            emphasis: "recommended" as const,
          },
        ],
      },
      {
        id: "free",
        label: "Current Free Coding-Friendly Models",
        options: uniqueOptions([
          ...freeOptions,
          ...buildOpenRouterFallbackGroups(env).find((group) => group.id === "free")?.options ?? [],
        ]),
      },
      ...buildOpenRouterFallbackGroups(env).filter((group) => group.id !== "free" && group.id !== "router"),
    ].filter((group) => group.options.length > 0);

    openRouterCache = {
      expiresAt: now + OPENROUTER_CACHE_TTL_MS,
      groups,
    };
    return groups;
  } catch {
    openRouterCache = {
      expiresAt: now + OPENROUTER_CACHE_TTL_MS,
      groups: fallbackGroups,
    };
    return fallbackGroups;
  }
}

function buildOpenRouterFallbackGroups(env: NodeJS.ProcessEnv): GuiModelGroup[] {
  const catalog = providerModelCatalog("openrouter", env);
  const freeFallback = catalog
    .filter((model) => model === "openrouter/free" || model.endsWith(":free"))
    .map((model) => ({
      value: model,
      label: model === "openrouter/free" ? "Free Models Router" : model,
      description:
        model === "openrouter/free"
          ? "Automatically selects a currently free OpenRouter model."
          : "OpenRouter free-variant model.",
      badge: "Free now",
      emphasis: "free" as const,
    }));

  const featured = [
    option("anthropic/claude-sonnet-4", "Claude Sonnet 4", "Strong general coding and repo analysis."),
    option("google/gemini-2.5-flash", "Gemini 2.5 Flash", "Fast interactive coding and review loops."),
    option("google/gemini-2.5-pro", "Gemini 2.5 Pro", "Heavier reasoning for larger code tasks."),
    option("openai/gpt-oss-120b", "gpt-oss-120b", "Open reasoning-heavy model on OpenRouter."),
  ].filter((item) => catalog.includes(item.value) || item.value === "anthropic/claude-sonnet-4");

  return [
    {
      id: "router",
      label: "OpenRouter Routers",
      options: [
        {
          value: "openrouter/free",
          label: "Free Models Router",
          description: "Automatically selects a currently free model on OpenRouter.",
          badge: "Free now",
          emphasis: "recommended" as const,
        },
      ],
    },
    {
      id: "free",
      label: "Current Free Coding-Friendly Models",
      options: freeFallback,
    },
    {
      id: "featured",
      label: "Featured Hosted Models",
      options: featured,
    },
  ].filter((group) => group.options.length > 0);
}

function getOllamaModelGroups(): GuiModelGroup[] {
  return [
    {
      id: "recommended",
      label: "Recommended Coding Models",
      options: [
        {
          value: "qwen2.5-coder:7b",
          label: "Qwen2.5 Coder 7B",
          description: "Best default balance for local coding on a typical desktop.",
          badge: "Recommended",
          emphasis: "recommended",
        },
        {
          value: "qwen2.5-coder:3b",
          label: "Qwen2.5 Coder 3B",
          description: "Very light local coding model for smaller machines.",
          badge: "Lightweight",
          emphasis: "local",
        },
        {
          value: "qwen2.5-coder:14b",
          label: "Qwen2.5 Coder 14B",
          description: "Stronger local code reasoning if you have more RAM or VRAM.",
          badge: "Stronger",
          emphasis: "local",
        },
      ],
    },
    {
      id: "small-local",
      label: "Small Local Specialists",
      options: [
        {
          value: "codegemma:2b",
          label: "CodeGemma 2B",
          description: "Tiny code-focused local model for constrained hardware.",
          badge: "Tiny",
          emphasis: "local",
        },
        {
          value: "qwen2.5-coder:1.5b",
          label: "Qwen2.5 Coder 1.5B",
          description: "Ultra-light coding option for experimentation and laptop use.",
          badge: "Tiny",
          emphasis: "local",
        },
      ],
    },
    {
      id: "other",
      label: "Other Local Options",
      options: [
        {
          value: "qwen3",
          label: "Qwen3",
          description: "General local model if you want broader assistant behavior.",
          emphasis: "default",
        },
        {
          value: "codestral",
          label: "Codestral",
          description: "Larger code model if you want more capability and can afford the memory.",
          emphasis: "default",
        },
      ],
    },
  ];
}

function isOpenRouterFreeModel(model: NonNullable<OpenRouterModelResponse["data"]>[number]): boolean {
  const id = model.id?.trim() || "";
  if (id === "openrouter/free" || id.endsWith(":free")) {
    return true;
  }

  const prompt = normalizePrice(model.pricing?.prompt);
  const completion = normalizePrice(model.pricing?.completion);
  return prompt === 0 && completion === 0;
}

function summarizeOpenRouterDescription(model: NonNullable<OpenRouterModelResponse["data"]>[number]): string {
  const description = model.description?.replace(/\s+/g, " ").trim() || "";
  const tools = model.supported_parameters?.includes("tools") ? "Supports tools." : "General text route.";
  if (!description) {
    return tools;
  }
  const short = description.length > 120 ? `${description.slice(0, 117)}...` : description;
  return `${short} ${tools}`;
}

function isCodingFriendlyOpenRouterModel(model: NonNullable<OpenRouterModelResponse["data"]>[number]): boolean {
  const id = (model.id ?? "").toLowerCase();
  const name = (model.name ?? "").toLowerCase();
  const description = (model.description ?? "").toLowerCase();

  const text = `${id} ${name} ${description}`;
  const positiveSignals = [
    "llama",
    "gemma",
    "qwen",
    "coder",
    "code",
    "gpt",
    "deepseek",
    "mistral",
    "instruct",
    "reason",
  ];
  const negativeSignals = ["lyria", "image", "vision-image", "speech", "music", "audio", "video"];

  if (negativeSignals.some((signal) => text.includes(signal))) {
    return false;
  }

  if (id === "openrouter/free") {
    return true;
  }

  return positiveSignals.some((signal) => text.includes(signal));
}

function normalizePrice(value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function uniqueOptions(options: GuiModelOption[]): GuiModelOption[] {
  const seen = new Set<string>();
  const result: GuiModelOption[] = [];
  for (const option of options) {
    if (seen.has(option.value)) {
      continue;
    }
    seen.add(option.value);
    result.push(option);
  }
  return result;
}

function option(value: string, label: string, description: string): GuiModelOption {
  return {
    value,
    label,
    description,
  };
}
