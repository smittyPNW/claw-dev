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

export type OpenRouterCatalogState = {
  groups: GuiModelGroup[];
  preferredModel: GuiModelOption;
  refreshedAt: string | null;
  nextRefreshAt: string | null;
  source: "live" | "fallback";
};

type OpenRouterModelResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    description?: string;
    context_length?: number;
    pricing?: {
      prompt?: string;
      completion?: string;
      request?: string;
      image?: string;
    };
    supported_parameters?: string[];
  }>;
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    modified_at?: string;
    size?: number;
  }>;
};

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_HEARTBEAT_MS = Number(process.env.CLAW_OPENROUTER_HEARTBEAT_MS || "300000");
const OPENROUTER_CACHE_TTL_MS = OPENROUTER_HEARTBEAT_MS;

let openRouterCache:
  | {
      expiresAt: number;
      state: OpenRouterCatalogState;
    }
  | undefined;

export async function getGuiModelGroups(
  provider: "anthropic" | "gemini" | "openai" | "openrouter" | "ollama",
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
            label: "Anthropic Sonnet 4",
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

  if (provider === "openai") {
    return [
      {
        id: "chatgpt",
        label: "ChatGPT Codex",
        options: uniqueOptions([
          {
            value: env.OPENAI_MODEL?.trim() || "gpt-5.2-codex",
            label: env.OPENAI_MODEL?.trim() || "gpt-5.2-codex",
            description: "Configured Codex model for the ChatGPT lane in the direct app path.",
            badge: "Default",
            emphasis: "recommended",
          },
          {
            value: "gpt-5.2-codex",
            label: "GPT-5.2 Codex",
            description: "Primary ChatGPT coding model for this app.",
            badge: "Best Codex",
            emphasis: "recommended",
          },
        ]),
      },
    ];
  }

  if (provider === "openrouter") {
    return (await getOpenRouterCatalogState(env)).groups;
  }

  if (provider === "ollama") {
    return getOllamaModelGroups(env);
  }

  return [];
}

export async function getOpenRouterCatalogState(
  env: NodeJS.ProcessEnv = process.env,
  options?: { forceRefresh?: boolean },
): Promise<OpenRouterCatalogState> {
  const now = Date.now();
  if (!options?.forceRefresh && openRouterCache && openRouterCache.expiresAt > now) {
    return openRouterCache.state;
  }

  const fallbackState = buildOpenRouterFallbackState(env, now);

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      openRouterCache = {
        expiresAt: now + OPENROUTER_CACHE_TTL_MS,
        state: fallbackState,
      };
      return fallbackState;
    }

    const payload = (await response.json()) as OpenRouterModelResponse;
    const rankedFreeOptions = (payload.data ?? [])
      .filter((model) => isOpenRouterFreeModel(model) && isCodingFriendlyOpenRouterModel(model))
      .map((model) => ({
        option: {
          value: model.id?.trim() || "",
          label: model.name?.trim() || model.id?.trim() || "",
          description: summarizeOpenRouterDescription(model),
          badge: "Free now",
          emphasis: "free" as const,
        },
        score: scoreOpenRouterModel(model),
      }))
      .filter((entry) => entry.option.value.length > 0)
      .sort((left, right) => right.score - left.score || left.option.label.localeCompare(right.option.label));

    const bestFreeNow = uniqueOptions(rankedFreeOptions.map((entry) => entry.option)).slice(0, 10);
    const freeCatalog = uniqueOptions([
      ...bestFreeNow,
      ...(buildOpenRouterFallbackState(env, now).groups.find((group) => group.id === "free-catalog")?.options ?? []),
    ]).slice(0, 18);

    const preferredModel = bestFreeNow[0] ?? {
      value: "openrouter/free",
      label: "Free Models Router",
      description: "Automatically selects a currently free OpenRouter model.",
      badge: "Free now",
      emphasis: "recommended" as const,
    };

    const state: OpenRouterCatalogState = {
      groups: [
        {
          id: "best-free",
          label: "Best Free Right Now",
          options: bestFreeNow.length > 0 ? bestFreeNow : [preferredModel],
        },
        {
          id: "router",
          label: "OpenRouter Routers",
          options: [
            {
              value: "openrouter/free",
              label: "Free Models Router",
              description: "Automatically selects a currently free model on OpenRouter.",
              badge: "Free router",
              emphasis: "recommended" as const,
            },
          ],
        },
        {
          id: "free-catalog",
          label: "More Free Coding-Friendly Models",
          options: freeCatalog,
        },
        ...buildOpenRouterFallbackState(env, now).groups.filter(
          (group) => group.id !== "free-catalog" && group.id !== "router" && group.id !== "best-free",
        ),
      ].filter((group) => group.options.length > 0),
      preferredModel,
      refreshedAt: new Date(now).toISOString(),
      nextRefreshAt: new Date(now + OPENROUTER_HEARTBEAT_MS).toISOString(),
      source: "live",
    };

    openRouterCache = {
      expiresAt: now + OPENROUTER_CACHE_TTL_MS,
      state,
    };
    return state;
  } catch {
    openRouterCache = {
      expiresAt: now + OPENROUTER_CACHE_TTL_MS,
      state: fallbackState,
    };
    return fallbackState;
  }
}

export function startOpenRouterHeartbeat(env: NodeJS.ProcessEnv = process.env): void {
  void getOpenRouterCatalogState(env, { forceRefresh: true });

  const timer = setInterval(() => {
    void getOpenRouterCatalogState(env, { forceRefresh: true });
  }, OPENROUTER_HEARTBEAT_MS);

  timer.unref();
}

function buildOpenRouterFallbackState(env: NodeJS.ProcessEnv, now: number): OpenRouterCatalogState {
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
    option("anthropic/claude-sonnet-4", "Anthropic Sonnet 4", "Strong general coding and repo analysis."),
    option("google/gemini-2.5-flash", "Gemini 2.5 Flash", "Fast interactive coding and review loops."),
    option("google/gemini-2.5-pro", "Gemini 2.5 Pro", "Heavier reasoning for larger code tasks."),
    option("openai/gpt-oss-120b", "gpt-oss-120b", "Open reasoning-heavy model on OpenRouter."),
  ].filter((item) => catalog.includes(item.value) || item.value === "anthropic/claude-sonnet-4");

  const preferredModel =
    freeFallback[0]
    ?? {
      value: "openrouter/free",
      label: "Free Models Router",
      description: "Automatically selects a currently free OpenRouter model.",
      badge: "Free router",
      emphasis: "recommended" as const,
    };

  return {
    groups: [
      {
        id: "best-free",
        label: "Best Free Right Now",
        options: [preferredModel],
      },
      {
        id: "router",
        label: "OpenRouter Routers",
        options: [
          {
            value: "openrouter/free",
            label: "Free Models Router",
            description: "Automatically selects a currently free model on OpenRouter.",
            badge: "Free router",
            emphasis: "recommended" as const,
          },
        ],
      },
      {
        id: "free-catalog",
        label: "More Free Coding-Friendly Models",
        options: freeFallback,
      },
      {
        id: "featured",
        label: "Featured Hosted Models",
        options: featured,
      },
    ].filter((group) => group.options.length > 0),
    preferredModel,
    refreshedAt: null,
    nextRefreshAt: new Date(now + OPENROUTER_HEARTBEAT_MS).toISOString(),
    source: "fallback",
  };
}

async function getOllamaModelGroups(env: NodeJS.ProcessEnv): Promise<GuiModelGroup[]> {
  const installed = await getInstalledOllamaModelOptions(env);

  const groups: GuiModelGroup[] = [];

  if (installed.length > 0) {
    groups.push({
      id: "installed",
      label: "Installed On This Machine",
      options: installed,
    });
  }

  groups.push({
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
    });
  groups.push({
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
    });
  groups.push({
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
    });

  return groups.filter((group) => group.options.length > 0);
}

async function getInstalledOllamaModelOptions(env: NodeJS.ProcessEnv): Promise<GuiModelOption[]> {
  const baseUrl = (env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/$/, "");

  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const options: GuiModelOption[] = [];

    for (const model of payload.models ?? []) {
      const value = model.name?.trim() || model.model?.trim() || "";
      if (!value) {
        continue;
      }

      const option: GuiModelOption = {
        value,
        label: formatInstalledOllamaLabel(value),
        description: describeInstalledOllamaModel(value),
      };

      const badge = pickInstalledOllamaBadge(value);
      if (badge) {
        option.badge = badge;
      }

      option.emphasis = pickInstalledOllamaEmphasis(value);

      options.push(option);
    }

    return uniqueOptions(options.sort(compareInstalledOllamaOptions));
  } catch {
    return [];
  }
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
    "nemotron",
    "minimax",
    "hermes",
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

function scoreOpenRouterModel(model: NonNullable<OpenRouterModelResponse["data"]>[number]): number {
  const text = `${model.id ?? ""} ${model.name ?? ""} ${model.description ?? ""}`.toLowerCase();
  let score = 0;

  if (model.supported_parameters?.includes("tools")) {
    score += 40;
  }

  score += Math.min((model.context_length ?? 0) / 8192, 28);

  if (text.includes("minimax")) {
    score += 280;
  }
  if (text.includes("nemotron")) {
    score += 135;
  }
  if (text.includes("qwen3-coder")) {
    score += 145;
  }
  if (text.includes("qwen3.6")) {
    score += 130;
  }
  if (text.includes("gpt-oss-120b")) {
    score += 132;
  }
  if (text.includes("hermes") && text.includes("405b")) {
    score += 128;
  }
  if (text.includes("llama") && text.includes("70b")) {
    score += 110;
  }

  const sizeSignals = [
    { pattern: /480b|405b/, bonus: 110 },
    { pattern: /120b/, bonus: 90 },
    { pattern: /80b/, bonus: 80 },
    { pattern: /70b/, bonus: 72 },
    { pattern: /30b/, bonus: 38 },
    { pattern: /20b/, bonus: 24 },
    { pattern: /12b/, bonus: 14 },
    { pattern: /9b|4b|3b|2b|1\.5b/, bonus: -8 },
    { pattern: /nano|mini/, bonus: -16 },
  ];

  for (const signal of sizeSignals) {
    if (signal.pattern.test(text)) {
      score += signal.bonus;
      break;
    }
  }

  return score;
}

function formatInstalledOllamaLabel(value: string): string {
  const [baseName = "", tag] = value.split(":");

  return baseName
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .concat(tag ? ` ${tag.toUpperCase()}` : "");
}

function describeInstalledOllamaModel(value: string): string {
  const text = value.toLowerCase();

  if (text.includes("oss")) {
    return "Installed local open-weight reasoning model.";
  }
  if (text.includes("coder") || text.includes("code")) {
    return "Installed local coding model.";
  }
  if (text.includes("qwen3")) {
    return "Installed Qwen3 local model for coding and general assistant work.";
  }
  if (text.includes("ministral")) {
    return "Installed lightweight local model for fast responses.";
  }

  return "Installed local Ollama model.";
}

function pickInstalledOllamaBadge(value: string): string | undefined {
  const text = value.toLowerCase();

  if (text.includes("coder") || text.includes("oss")) {
    return "Installed";
  }
  if (text.includes("qwen3")) {
    return "Local";
  }

  return undefined;
}

function pickInstalledOllamaEmphasis(value: string): NonNullable<GuiModelOption["emphasis"]> {
  const text = value.toLowerCase();
  if (text.includes("coder") || text.includes("oss")) {
    return "recommended";
  }
  return "local";
}

function compareInstalledOllamaOptions(left: GuiModelOption, right: GuiModelOption): number {
  return scoreInstalledOllamaOption(right.value) - scoreInstalledOllamaOption(left.value)
    || left.label.localeCompare(right.label);
}

function scoreInstalledOllamaOption(value: string): number {
  const text = value.toLowerCase();
  let score = 0;

  if (text.includes("coder")) {
    score += 80;
  }
  if (text.includes("oss")) {
    score += 72;
  }
  if (text.includes("qwen3")) {
    score += 54;
  }
  if (text.includes("ministral")) {
    score += 28;
  }
  if (text.includes("embed")) {
    score -= 100;
  }
  if (text.includes("14b")) {
    score += 12;
  }
  if (text.includes("8b")) {
    score += 8;
  }

  return score;
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
