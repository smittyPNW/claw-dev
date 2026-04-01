import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getTelegramSetupState, saveTelegramSetup } from "../dist/guiTelegram.js";

test("getTelegramSetupState reports missing setup clearly", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("should not fetch without a token");
  };

  try {
    const state = await getTelegramSetupState({
      OPENAI_AUTH_TOKEN: "demo",
    });

    assert.equal(state.status, "missing-auth");
    assert.equal(state.hasToken, false);
    assert.equal(state.launchCommand, "npm run telegram");
  } finally {
    global.fetch = originalFetch;
  }
});

test("getTelegramSetupState reports a stopped bot as not ready", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    ({
      ok: true,
      async json() {
        return {
          ok: true,
          result: {
            username: "clawdev_bot",
          },
        };
      },
    });

  try {
    const state = await getTelegramSetupState(
      {
        TELEGRAM_BOT_TOKEN: "123456:ABCDEF",
        OPENAI_MODEL: "gpt-5.2-codex",
      },
      {
        isBotRunning: async () => false,
      },
    );

    assert.equal(state.status, "error");
    assert.equal(state.runtimeStatus, "stopped");
    assert.match(state.detail, /not running/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("saveTelegramSetup stores values and validates the bot token", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "claw-dev-telegram-"));
  const originalFetch = global.fetch;
  global.fetch = async () =>
    ({
      ok: true,
      async json() {
        return {
          ok: true,
          result: {
            username: "clawdev_bot",
          },
        };
      },
    });

  try {
    const env = {
      OPENAI_MODEL: "gpt-5.2-codex",
    };

    const state = await saveTelegramSetup(
      repoRoot,
      {
        botToken: "123456:ABCDEF",
        allowedChatIds: "123,456",
        provider: "openrouter",
        model: "minimax/minimax-m2.5:free",
        cwd: "/tmp/workspace",
      },
      env,
      {
        isBotRunning: async () => true,
      },
    );

    assert.equal(state.status, "configured");
    assert.equal(state.runtimeStatus, "running");
    assert.equal(state.botUsername, "@clawdev_bot");
    assert.equal(env.TELEGRAM_PROVIDER, "openrouter");

    const envContents = await fs.readFile(path.join(repoRoot, ".env"), "utf8");
    assert.match(envContents, /TELEGRAM_BOT_TOKEN=123456:ABCDEF/);
    assert.match(envContents, /TELEGRAM_ALLOWED_CHAT_IDS=123,456/);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("saveTelegramSetup reuses the stored token when editing settings later", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "claw-dev-telegram-"));
  const originalFetch = global.fetch;
  global.fetch = async () =>
    ({
      ok: true,
      async json() {
        return {
          ok: true,
          result: {
            username: "clawdev_bot",
          },
        };
      },
    });

  try {
    await fs.writeFile(
      path.join(repoRoot, ".env"),
      "TELEGRAM_BOT_TOKEN=123456:ABCDEF\nTELEGRAM_PROVIDER=openai\n",
      "utf8",
    );

    const env = {
      TELEGRAM_BOT_TOKEN: "123456:ABCDEF",
      OPENAI_MODEL: "gpt-5.2-codex",
    };

    const state = await saveTelegramSetup(
      repoRoot,
      {
        provider: "ollama",
        model: "qwen3:8b",
      },
      env,
      {
        isBotRunning: async () => true,
      },
    );

    assert.equal(state.status, "configured");
    assert.equal(env.TELEGRAM_PROVIDER, "ollama");

    const envContents = await fs.readFile(path.join(repoRoot, ".env"), "utf8");
    assert.match(envContents, /TELEGRAM_BOT_TOKEN=123456:ABCDEF/);
    assert.match(envContents, /TELEGRAM_PROVIDER=ollama/);
    assert.match(envContents, /TELEGRAM_MODEL=qwen3:8b/);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
