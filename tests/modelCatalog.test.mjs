import test from "node:test";
import assert from "node:assert/strict";

import { getGuiModelGroups, getOpenRouterCatalogState } from "../dist/modelCatalog.js";

test("getGuiModelGroups highlights current free OpenRouter models from live metadata", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "openrouter/free",
            name: "Free Models Router",
            pricing: {
              prompt: "0",
              completion: "0",
            },
          },
          {
            id: "openai/gpt-oss-20b:free",
            name: "GPT OSS 20B Free",
            description: "Free hosted reasoning model.",
            pricing: {
              prompt: "0",
              completion: "0",
            },
            supported_parameters: ["tools"],
          },
          {
            id: "anthropic/claude-sonnet-4",
            name: "Anthropic Sonnet 4",
            pricing: {
              prompt: "0.000003",
              completion: "0.000015",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const groups = await getGuiModelGroups("openrouter", {
      OPENROUTER_MODEL: "anthropic/claude-sonnet-4",
    });

    const freeGroup = groups.find((group) => group.id === "free-catalog");
    assert.ok(freeGroup);
    assert.ok(freeGroup.options.some((option) => option.value === "openai/gpt-oss-20b:free"));
    assert.ok(freeGroup.options.every((option) => option.badge === "Free now"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getOpenRouterCatalogState prefers larger free flagship models when available", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "openai/gpt-oss-20b:free",
            name: "OpenAI: gpt-oss-20b (free)",
            context_length: 131072,
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools"],
          },
          {
            id: "nvidia/nemotron-3-super-120b-a12b:free",
            name: "NVIDIA: Nemotron 3 Super (free)",
            context_length: 262144,
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools"],
          },
          {
            id: "minimax/minimax-m2.5:free",
            name: "MiniMax: MiniMax M2.5 (free)",
            context_length: 196608,
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools"],
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const state = await getOpenRouterCatalogState({}, { forceRefresh: true });
    assert.equal(state.preferredModel.value, "minimax/minimax-m2.5:free");
    const bestFree = state.groups.find((group) => group.id === "best-free");
    assert.ok(bestFree);
    assert.equal(bestFree.options[0].value, "minimax/minimax-m2.5:free");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getGuiModelGroups returns small coding-focused Ollama recommendations", async () => {
  const groups = await getGuiModelGroups("ollama");
  const recommended = groups.find((group) => group.id === "recommended");
  const smallLocal = groups.find((group) => group.id === "small-local");

  assert.ok(recommended);
  assert.ok(recommended.options.some((option) => option.value === "qwen2.5-coder:7b"));
  assert.ok(smallLocal);
  assert.ok(smallLocal.options.some((option) => option.value === "codegemma:2b"));
});

test("getGuiModelGroups includes locally installed Ollama models when the runtime is available", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    if (String(url).includes("/api/tags")) {
      return new Response(
        JSON.stringify({
          models: [
            { name: "qwen3:14b" },
            { name: "gpt-oss:20b" },
            { name: "nomic-embed-text:latest" },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const groups = await getGuiModelGroups("ollama");
    const installed = groups.find((group) => group.id === "installed");

    assert.ok(installed);
    assert.equal(installed.options[0].value, "gpt-oss:20b");
    assert.ok(installed.options.some((option) => option.value === "qwen3:14b"));
    assert.ok(installed.options.some((option) => option.value === "nomic-embed-text:latest"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
