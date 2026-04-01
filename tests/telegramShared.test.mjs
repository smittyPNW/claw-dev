import test from "node:test";
import assert from "node:assert/strict";

import {
  formatTelegramStatus,
  parseTelegramInput,
  splitTelegramMessage,
} from "../dist/telegramShared.js";

test("parseTelegramInput recognizes provider and prompt commands", () => {
  assert.deepEqual(parseTelegramInput("/provider openrouter"), {
    type: "provider",
    provider: "openrouter",
  });

  assert.deepEqual(parseTelegramInput("inspect this repo"), {
    type: "prompt",
    prompt: "inspect this repo",
  });
});

test("parseTelegramInput resolves workspace paths", () => {
  const command = parseTelegramInput("/cwd ./src");
  assert.equal(command.type, "cwd");
  assert.match(command.cwd, /src$/);
});

test("splitTelegramMessage chunks long content safely", () => {
  const chunks = splitTelegramMessage(`${"a".repeat(3000)}\n\n${"b".repeat(2200)}`, 4096);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4096));
});

test("formatTelegramStatus summarizes the active session", () => {
  assert.equal(
    formatTelegramStatus({
      provider: "openai",
      model: "gpt-5.2-codex",
      cwd: "/tmp/work",
      turns: 3,
    }),
    ["Claw Dev session", "Provider: openai", "Model: gpt-5.2-codex", "Workspace: /tmp/work", "Turns: 3"].join("\n"),
  );
});
