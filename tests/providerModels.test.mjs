import test from "node:test";
import assert from "node:assert/strict";

import {
  providerAdditionalModelOptions,
  providerLabel,
  providerModelCatalog,
  providerPromptSuggestions,
} from "../shared/providerModels.js";

test("providerLabel returns human readable provider names", () => {
  assert.equal(providerLabel("openai"), "OpenAI");
  assert.equal(providerLabel("gemini"), "Google Gemini");
  assert.equal(providerLabel("openrouter"), "OpenRouter");
  assert.equal(providerLabel("huggingface"), "Hugging Face");
});

test("providerModelCatalog keeps the ChatGPT lane focused on Codex", () => {
  const catalog = providerModelCatalog("openai", { OPENAI_MODEL: "gpt-5.2-codex" });
  assert.deepEqual(catalog, ["gpt-5.2-codex"]);
});

test("providerModelCatalog merges custom environment models", () => {
  const catalog = providerModelCatalog("gemini", {
    GEMINI_MODEL: "gemini-2.5-pro",
    GEMINI_MODELS: "gemini-2.5-pro-exp,gemini-2.5-flash-lite-preview",
  });
  assert.ok(catalog.includes("gemini-2.5-pro-exp"));
  assert.ok(catalog.includes("gemini-2.5-flash-lite-preview"));
});

test("providerPromptSuggestions mirrors the provider catalog", () => {
  const suggestions = providerPromptSuggestions("zai", { ZAI_MODEL: "glm-5" });
  assert.deepEqual(suggestions, providerModelCatalog("zai", { ZAI_MODEL: "glm-5" }));
});

test("providerAdditionalModelOptions expose only ChatGPT Codex for the OpenAI lane", () => {
  const options = providerAdditionalModelOptions("openai", { OPENAI_MODEL: "gpt-5.2-codex" });
  assert.deepEqual(options, [
    {
      value: "gpt-5.2-codex",
      label: "gpt-5.2-codex",
      description: "OpenAI model",
    },
  ]);
});

test("openrouter catalog includes provider-qualified model ids", () => {
  const catalog = providerModelCatalog("openrouter", { OPENROUTER_MODEL: "anthropic/claude-sonnet-4" });
  assert.equal(catalog[0], "anthropic/claude-sonnet-4");
  assert.ok(catalog.includes("google/gemini-2.5-flash"));
  assert.ok(catalog.includes("openai/gpt-oss-120b"));
});

test("huggingface catalog includes hosted router model ids", () => {
  const catalog = providerModelCatalog("huggingface", { HUGGINGFACE_MODEL: "openai/gpt-oss-120b:fastest" });
  assert.equal(catalog[0], "openai/gpt-oss-120b:fastest");
  assert.ok(catalog.includes("deepseek-ai/DeepSeek-R1:fastest"));
});
