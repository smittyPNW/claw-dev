import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { OllamaProvider, OpenRouterProvider } from "../dist/providers.js";

test("OpenRouterProvider sends requests to the configured base URL with auth", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "hello from openrouter",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const provider = new OpenRouterProvider({
      apiKey: "or-test-key",
      model: "anthropic/claude-sonnet-4",
      cwd: process.cwd(),
      baseUrl: "https://openrouter.ai/api/v1",
    });

    const result = await provider.runTurn("say hello");
    assert.equal(result.text, "hello from openrouter");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(calls[0].init.headers.Authorization, "Bearer or-test-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OllamaProvider normalizes base URL and can complete a tool loop", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "claw-dev-ollama-"));
  const originalFetch = globalThis.fetch;
  const calls = [];

  await writeFile(join(workspace, "note.txt"), "tool loop works", "utf8");

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });

    if (calls.length === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: JSON.stringify({ path: "note.txt" }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "final answer from ollama",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const provider = new OllamaProvider({
      model: "qwen3",
      cwd: workspace,
      baseUrl: "http://127.0.0.1:11434",
    });

    const result = await provider.runTurn("read the file");
    assert.equal(result.text, "final answer from ollama");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal("Authorization" in calls[0].init.headers, false);

    const secondBody = JSON.parse(calls[1].init.body);
    assert.equal(secondBody.messages.at(-1).role, "tool");
    assert.match(secondBody.messages.at(-1).content, /tool loop works/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspace, { recursive: true, force: true });
  }
});
