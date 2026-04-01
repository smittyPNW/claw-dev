import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProviderName,
  resolveConfiguredProvider,
  resolvePreferredProvider,
  shouldPromptForModelSelection,
} from "../shared/tuiDefaults.js";

function buildJwt(expSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url");
  return `${header}.${payload}.sig`;
}

test("normalizeProviderName maps common aliases", () => {
  assert.equal(normalizeProviderName("chatgpt"), "openai");
  assert.equal(normalizeProviderName("router"), "openrouter");
  assert.equal(normalizeProviderName("github-models"), "copilot");
});

test("resolveConfiguredProvider prefers saved ChatGPT auth", () => {
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const env = {
    OPENAI_AUTH_TOKEN: buildJwt(futureExp),
    OPENROUTER_API_KEY: "or-test-key",
  };

  assert.equal(resolveConfiguredProvider(env), "openai");
});

test("resolveConfiguredProvider falls back to OpenRouter when ChatGPT is unavailable", () => {
  const env = {
    OPENAI_AUTH_TOKEN: "",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "or-test-key",
  };

  assert.equal(resolveConfiguredProvider(env, { openAIAuth: { status: "missing" } }), "openrouter");
});

test("resolvePreferredProvider respects an explicit configured provider", () => {
  const env = {
    LLM_PROVIDER: "ollama",
    OPENAI_AUTH_TOKEN: "",
  };

  assert.equal(resolvePreferredProvider(env), "ollama");
});

test("shouldPromptForModelSelection defaults to straight-through startup", () => {
  assert.equal(shouldPromptForModelSelection({}), false);
  assert.equal(shouldPromptForModelSelection({ CLAW_PROMPT_FOR_MODEL: "1" }), true);
});
