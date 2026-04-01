import test from "node:test";
import assert from "node:assert/strict";

import { getGuiModelGroups } from "../dist/modelCatalog.js";

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
            name: "Claude Sonnet 4",
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

    const freeGroup = groups.find((group) => group.id === "free");
    assert.ok(freeGroup);
    assert.ok(freeGroup.options.some((option) => option.value === "openai/gpt-oss-20b:free"));
    assert.ok(freeGroup.options.every((option) => option.badge === "Free now"));
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
