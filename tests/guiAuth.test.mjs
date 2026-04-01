import test from "node:test";
import assert from "node:assert/strict";

import { getOpenAIAuthPanelState } from "../dist/guiAuth.js";

function buildJwtWithExp(expSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url");
  return `${header}.${payload}.sig`;
}

test("getOpenAIAuthPanelState reports a ready saved ChatGPT session", () => {
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const result = getOpenAIAuthPanelState({
    env: {},
    authJsonPath: "/mock/.codex/auth.json",
    readAuthJson: () =>
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: buildJwtWithExp(futureExp),
          account_id: "acct_123",
        },
      }),
  });

  assert.equal(result.status, "configured");
  assert.equal(result.authType, "oauth");
  assert.equal(result.sourceLabel, "Saved ChatGPT session");
  assert.equal(result.prefersChatGPTSession, true);
  assert.equal(result.accountId, "acct_123");
  assert.match(result.actionCommand, /codex login/);
});

test("getOpenAIAuthPanelState reports API-key fallback clearly", () => {
  const result = getOpenAIAuthPanelState({
    env: { OPENAI_API_KEY: "sk-test-123" },
    authJsonPath: "/mock/.codex/auth.json",
    readAuthJson: () => {
      throw new Error("should not read auth.json when OPENAI_API_KEY is set");
    },
  });

  assert.equal(result.status, "configured");
  assert.equal(result.authType, "api-key");
  assert.equal(result.prefersChatGPTSession, false);
  assert.match(result.detail, /OPENAI_API_KEY/);
});

test("getOpenAIAuthPanelState reports expired saved auth and reauth guidance", () => {
  const pastExp = Math.floor(Date.now() / 1000) - 3600;
  const result = getOpenAIAuthPanelState({
    env: {},
    authJsonPath: "/mock/.codex/auth.json",
    readAuthJson: () =>
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: buildJwtWithExp(pastExp),
        },
      }),
  });

  assert.equal(result.status, "expired");
  assert.equal(result.authType, "oauth");
  assert.match(result.detail, /expired Codex auth session/i);
  assert.match(result.nextAction, /Run codex login/i);
});
