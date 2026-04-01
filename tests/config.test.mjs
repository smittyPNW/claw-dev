import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../dist/config.js";

const ORIGINAL_ENV = process.env;

test.afterEach(() => {
  process.env = ORIGINAL_ENV;
});

test("loadConfig supports openrouter in the top-level app path", () => {
  process.env = {
    ...ORIGINAL_ENV,
    LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "or-key",
    OPENROUTER_MODEL: "anthropic/claude-sonnet-4",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  };

  const config = loadConfig();
  assert.equal(config.provider, "openrouter");
  assert.equal(config.apiKey, "or-key");
  assert.equal(config.model, "anthropic/claude-sonnet-4");
  assert.equal(config.baseUrl, "https://openrouter.ai/api/v1");
});

test("loadConfig supports ollama in the top-level app path", () => {
  process.env = {
    ...ORIGINAL_ENV,
    LLM_PROVIDER: "ollama",
    OLLAMA_MODEL: "qwen3",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    OLLAMA_API_KEY: "",
  };

  const config = loadConfig();
  assert.equal(config.provider, "ollama");
  assert.equal(config.apiKey, "");
  assert.equal(config.model, "qwen3");
  assert.equal(config.baseUrl, "http://127.0.0.1:11434");
});
