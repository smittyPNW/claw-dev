import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";

import { toolDefinitions, toolHandlers } from "./tools.js";

export type AgentTurnResult = {
  text: string;
};

export type ProviderName = "anthropic" | "gemini" | "openrouter" | "ollama";

const SYSTEM_PROMPT = `
You are Claw Dev, a terminal coding assistant.
Work step by step, prefer inspecting files before editing, and use tools when needed.
When you use tools, keep tool inputs minimal and precise.
Assume the workspace root is the allowed boundary and do not request paths outside it.
`.trim();

export interface LlmProvider {
  runTurn(prompt: string): Promise<AgentTurnResult>;
  clear(): void;
}

export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly cwd: string;
  private readonly messages: MessageParam[] = [];

  constructor(args: { apiKey: string; model: string; cwd: string }) {
    this.client = new Anthropic({ apiKey: args.apiKey });
    this.model = args.model;
    this.cwd = args.cwd;
  }

  clear(): void {
    this.messages.length = 0;
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    this.messages.push({
      role: "user",
      content: prompt,
    });

    let assistantText = "";

    for (let i = 0; i < 8; i += 1) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: this.messages,
        tools: toolDefinitions,
      });

      this.messages.push({
        role: "assistant",
        content: response.content,
      });

      const textBlocks = response.content.filter((block) => block.type === "text");
      if (textBlocks.length > 0) {
        assistantText = textBlocks.map((block) => block.text).join("\n");
      }

      const toolUses = response.content.filter((block) => block.type === "tool_use");
      if (toolUses.length === 0) {
        return { text: assistantText };
      }

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const handler = toolHandlers[toolUse.name];
        if (!handler) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: `Unknown tool: ${toolUse.name}`,
          });
          continue;
        }

        try {
          const result = await handler(toolUse.input as Record<string, unknown>, this.cwd);
          const toolResult: ToolResultBlockParam = {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result.content,
          };
          if (result.isError !== undefined) {
            toolResult.is_error = result.isError;
          }
          toolResults.push(toolResult);
        } catch (error) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.messages.push({
        role: "user",
        content: toolResults,
      });
    }

    return {
      text: assistantText || "Stopped after reaching the tool iteration limit.",
    };
  }
}

type GeminiContent = {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
};

export class GeminiProvider implements LlmProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly cwd: string;
  private readonly contents: GeminiContent[] = [];

  constructor(args: { apiKey: string; model: string; cwd: string }) {
    this.client = new GoogleGenAI({ apiKey: args.apiKey });
    this.model = args.model;
    this.cwd = args.cwd;
  }

  clear(): void {
    this.contents.length = 0;
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    this.contents.push({
      role: "user",
      parts: [{ text: prompt }],
    });

    let assistantText = "";

    for (let i = 0; i < 8; i += 1) {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: this.contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [
            {
              functionDeclarations: toolDefinitions.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.input_schema,
              })),
            },
          ],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.AUTO,
            },
          },
        },
      });

      const candidate = response.candidates?.[0];
      const parts = (candidate?.content?.parts ?? []) as Array<Record<string, unknown>>;
      this.contents.push({
        role: "model",
        parts,
      });

      const textParts = parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .filter((text) => text.length > 0);
      if (textParts.length > 0) {
        assistantText = textParts.join("\n");
      }

      const functionCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is { id?: string; name?: string; args?: unknown } => typeof call === "object" && call !== null);

      if (functionCalls.length === 0) {
        return { text: assistantText || response.text || "" };
      }

      const functionResponses: Array<Record<string, unknown>> = [];

      for (const functionCall of functionCalls) {
        const name = typeof functionCall.name === "string" ? functionCall.name : "";
        const callId = typeof functionCall.id === "string" ? functionCall.id : name;
        const handler = toolHandlers[name];

        if (!handler) {
          functionResponses.push({
            functionResponse: {
              name,
              id: callId,
              response: {
                error: `Unknown tool: ${name}`,
              },
            },
          });
          continue;
        }

        try {
          const input = isRecord(functionCall.args) ? functionCall.args : {};
          const result = await handler(input, this.cwd);
          functionResponses.push({
            functionResponse: {
              name,
              id: callId,
              response: {
                content: result.content,
                isError: result.isError ?? false,
              },
            },
          });
        } catch (error) {
          functionResponses.push({
            functionResponse: {
              name,
              id: callId,
              response: {
                error: error instanceof Error ? error.message : String(error),
              },
            },
          });
        }
      }

      this.contents.push({
        role: "user",
        parts: functionResponses,
      });
    }

    return {
      text: assistantText || "Stopped after reaching the tool iteration limit.",
    };
  }
}

type OpenAICompatibleMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

type OpenAICompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

class OpenAICompatibleProvider implements LlmProvider {
  private readonly model: string;
  private readonly cwd: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly messages: OpenAICompatibleMessage[] = [];

  constructor(args: { apiKey?: string; model: string; cwd: string; baseUrl: string }) {
    this.model = args.model;
    this.cwd = args.cwd;
    this.baseUrl = args.baseUrl.replace(/\/$/, "");
    this.apiKey = args.apiKey?.trim() || undefined;
  }

  clear(): void {
    this.messages.length = 0;
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    this.messages.push({
      role: "user",
      content: prompt,
    });

    let assistantText = "";

    for (let i = 0; i < 8; i += 1) {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...this.messages],
          tools: toolDefinitions.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.input_schema,
            },
          })),
        }),
      });

      const json = (await response.json()) as OpenAICompatibleResponse;
      if (!response.ok) {
        throw new Error(formatOpenAICompatibleProviderError(this.baseUrl, this.model, response.status, json));
      }

      const message = json.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];
      assistantText = typeof message?.content === "string" ? message.content : assistantText;

      this.messages.push({
        role: "assistant",
        content: typeof message?.content === "string" ? message.content : "",
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls
                .map((call, index) => {
                  const name = call.function?.name?.trim();
                  if (!name) {
                    return null;
                  }
                  return {
                    id: call.id?.trim() || `tool-call-${index + 1}`,
                    type: "function" as const,
                    function: {
                      name,
                      arguments: call.function?.arguments ?? "{}",
                    },
                  };
                })
                .filter((call): call is NonNullable<typeof call> => call !== null),
            }
          : {}),
      });

      if (toolCalls.length === 0) {
        return { text: assistantText };
      }

      for (const [index, call] of toolCalls.entries()) {
        const name = call.function?.name?.trim() || "";
        const callId = call.id?.trim() || `tool-call-${index + 1}`;
        const handler = toolHandlers[name];

        if (!handler) {
          this.messages.push({
            role: "tool",
            tool_call_id: callId,
            content: `Unknown tool: ${name}`,
          });
          continue;
        }

        try {
          const rawArgs = call.function?.arguments ?? "{}";
          const input = parseJsonRecord(rawArgs);
          const result = await handler(input, this.cwd);
          this.messages.push({
            role: "tool",
            tool_call_id: callId,
            content: result.content,
          });
        } catch (error) {
          this.messages.push({
            role: "tool",
            tool_call_id: callId,
            content: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      text: assistantText || "Stopped after reaching the tool iteration limit.",
    };
  }
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(args: { apiKey: string; model: string; cwd: string; baseUrl?: string }) {
    super({
      apiKey: args.apiKey,
      model: args.model,
      cwd: args.cwd,
      baseUrl: args.baseUrl ?? "https://openrouter.ai/api/v1",
    });
  }
}

export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(args: { apiKey?: string; model: string; cwd: string; baseUrl?: string }) {
    const baseArgs = {
      model: args.model,
      cwd: args.cwd,
      baseUrl: normalizeOllamaBaseUrl(args.baseUrl ?? "http://127.0.0.1:11434"),
    };

    if (args.apiKey !== undefined) {
      super({
        ...baseArgs,
        apiKey: args.apiKey,
      });
      return;
    }

    super(baseArgs);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function formatOpenAICompatibleProviderError(
  baseUrl: string,
  model: string,
  status: number,
  response: OpenAICompatibleResponse,
): string {
  const detail = response.error?.message?.trim();
  const normalizedBaseUrl = baseUrl.toLowerCase();
  const isOllama = normalizedBaseUrl.includes("127.0.0.1:11434") || normalizedBaseUrl.includes("localhost:11434");

  if (isOllama) {
    if (status === 404 && detail) {
      return `Ollama request failed: ${detail}. Make sure Ollama is running, the base URL is correct, and the model "${model}" is pulled locally.`;
    }

    return detail
      ? `Ollama request failed with status ${status}: ${detail}`
      : `Ollama request failed with status ${status}. Check that Ollama is running and reachable at ${baseUrl}.`;
  }

  return detail
    ? `Provider request failed with status ${status}: ${detail}`
    : `Provider request failed with status ${status}.`;
}
