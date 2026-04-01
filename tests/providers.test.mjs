import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { OllamaProvider, OpenAIProvider, OpenRouterProvider } from "../dist/providers.js";

function buildJwtWithExp(expSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url");
  return `${header}.${payload}.sig`;
}

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

test("OpenAIProvider can use saved ChatGPT auth and call the responses endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;
  const calls = [];
  const futureExp = Math.floor(Date.now() / 1000) + 3600;

  process.env = {
    ...originalEnv,
    OPENAI_AUTH_TOKEN: buildJwtWithExp(futureExp),
    OPENAI_API_KEY: "",
  };

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      [
        'event: response.output_item.done',
        'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","id":"msg-1","content":[{"type":"output_text","text":"hello from chatgpt session"}]}}',
        "",
        'event: response.completed',
        'data: {"type":"response.completed","response":{"id":"resp-1"}}',
        "",
      ].join("\n"),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  };

  try {
    const provider = new OpenAIProvider({
      model: "gpt-5.2-codex",
      cwd: process.cwd(),
    });

    const result = await provider.runTurn("say hello");
    assert.equal(result.text, "hello from chatgpt session");
    assert.equal(calls[0].url, "https://chatgpt.com/backend-api/codex/responses");
    assert.match(calls[0].init.headers.Authorization, /^Bearer /);
    const requestBody = JSON.parse(calls[0].init.body);
    assert.equal(requestBody.reasoning.effort, "medium");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("OpenRouterProvider surfaces HTTP error details", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "rate limit exceeded",
        },
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const provider = new OpenRouterProvider({
      apiKey: "or-test-key",
      model: "anthropic/claude-sonnet-4",
      cwd: process.cwd(),
      baseUrl: "https://openrouter.ai/api/v1",
    });

    await assert.rejects(
      () => provider.runTurn("hello"),
      /Provider request failed with status 429: rate limit exceeded/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenRouterProvider tolerates malformed tool-call arguments and still completes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "claw-dev-openrouter-"));
  const originalFetch = globalThis.fetch;
  const calls = [];

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
                      name: "list_files",
                      arguments: "{not-valid-json",
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
              content: "recovered after malformed tool args",
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
      cwd: workspace,
      baseUrl: "https://openrouter.ai/api/v1",
    });

    const result = await provider.runTurn("list files");
    assert.equal(result.text, "recovered after malformed tool args");

    const secondBody = JSON.parse(calls[1].init.body);
    assert.equal(secondBody.messages.at(-1).role, "tool");
    assert.match(secondBody.messages.at(-1).content, /\(empty directory\)|dir |file /);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspace, { recursive: true, force: true });
  }
});

test("OpenRouterProvider emits lifecycle events for tool execution", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "claw-dev-openrouter-events-"));
  const originalFetch = globalThis.fetch;
  const events = [];

  await writeFile(join(workspace, "note.txt"), "event flow works", "utf8");

  globalThis.fetch = async (_url, _init) =>
    new Response(
      JSON.stringify({
        choices: events.some((event) => event.type === "tool_result")
          ? [
              {
                message: {
                  content: "done after tool event flow",
                },
              },
            ]
          : [
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

  try {
    const provider = new OpenRouterProvider({
      apiKey: "or-test-key",
      model: "anthropic/claude-sonnet-4",
      cwd: workspace,
      baseUrl: "https://openrouter.ai/api/v1",
    });

    const result = await provider.runTurn("read note", (event) => {
      events.push(event);
    });

    assert.equal(result.text, "done after tool event flow");
    assert.deepEqual(
      events.map((event) => event.type),
      ["status", "status", "status", "tool_start", "tool_result", "status", "status"],
    );
    assert.equal(events[3].toolName, "read_file");
    assert.match(events[4].contentPreview, /event flow works/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspace, { recursive: true, force: true });
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

test("OllamaProvider returns actionable setup guidance for missing models", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "model 'qwen3' not found",
        },
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const provider = new OllamaProvider({
      model: "qwen3",
      cwd: process.cwd(),
      baseUrl: "http://127.0.0.1:11434",
    });

    await assert.rejects(
      () => provider.runTurn("hello"),
      /Make sure Ollama is running.*model "qwen3" is pulled locally/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
