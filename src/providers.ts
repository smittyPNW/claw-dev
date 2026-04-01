import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";

import { formatOpenAIAuthHint, resolveOpenAIAuth } from "../shared/openaiAuth.js";
import {
  openAICompatibleMessagesToResponsesInput,
  openAICompatibleToolsToResponsesTools,
  parseResponsesSseToResult,
  sliceResponsesInputToLatestToolTurn,
} from "../shared/openaiResponsesCompat.js";
import { toolDefinitions, toolHandlers } from "./tools.js";

export type AgentTurnResult = {
  text: string;
};

export type TurnEvent =
  | {
      type: "status";
      stage: "queued" | "requesting" | "tooling" | "complete";
      message: string;
    }
  | {
      type: "tool_start";
      toolName: string;
      callId: string;
      inputSummary: string;
    }
  | {
      type: "tool_result";
      toolName: string;
      callId: string;
      isError: boolean;
      contentPreview: string;
    };

export type TurnEventHandler = (event: TurnEvent) => void;

export type ProviderName = "anthropic" | "gemini" | "openai" | "openrouter" | "ollama";

const SYSTEM_PROMPT = `
You are Claw Dev, a terminal coding assistant.
Work step by step, prefer inspecting files before editing, and use tools when needed.
When you use tools, keep tool inputs minimal and precise.
Assume the workspace root is the allowed boundary and do not request paths outside it.
`.trim();

export interface LlmProvider {
  runTurn(prompt: string, onEvent?: TurnEventHandler): Promise<AgentTurnResult>;
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

  async runTurn(prompt: string, onEvent?: TurnEventHandler): Promise<AgentTurnResult> {
    this.messages.push({
      role: "user",
      content: prompt,
    });
    emitTurnEvent(onEvent, {
      type: "status",
      stage: "queued",
      message: "Prompt queued for Anthropic.",
    });

    let assistantText = "";

    for (let i = 0; i < 8; i += 1) {
      emitTurnEvent(onEvent, {
        type: "status",
        stage: "requesting",
        message: `Requesting Anthropic response${i > 0 ? ` (pass ${i + 1})` : ""}.`,
      });
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
        emitTurnEvent(onEvent, {
          type: "status",
          stage: "complete",
          message: "Anthropic response complete.",
        });
        return { text: assistantText };
      }

      emitTurnEvent(onEvent, {
        type: "status",
        stage: "tooling",
        message: `Running ${toolUses.length} tool${toolUses.length === 1 ? "" : "s"}.`,
      });

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const handler = toolHandlers[toolUse.name];
        if (!handler) {
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: toolUse.name,
            callId: toolUse.id,
            isError: true,
            contentPreview: `Unknown tool: ${toolUse.name}`,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: `Unknown tool: ${toolUse.name}`,
          });
          continue;
        }

        try {
          emitTurnEvent(onEvent, {
            type: "tool_start",
            toolName: toolUse.name,
            callId: toolUse.id,
            inputSummary: summarizeToolInput(toolUse.input as Record<string, unknown>),
          });
          const result = await handler(toolUse.input as Record<string, unknown>, this.cwd);
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: toolUse.name,
            callId: toolUse.id,
            isError: result.isError ?? false,
            contentPreview: summarizeToolContent(result.content),
          });
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
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: toolUse.name,
            callId: toolUse.id,
            isError: true,
            contentPreview: summarizeToolContent(error instanceof Error ? error.message : String(error)),
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

  async runTurn(prompt: string, onEvent?: TurnEventHandler): Promise<AgentTurnResult> {
    this.contents.push({
      role: "user",
      parts: [{ text: prompt }],
    });
    emitTurnEvent(onEvent, {
      type: "status",
      stage: "queued",
      message: "Prompt queued for Gemini.",
    });

    let assistantText = "";

    for (let i = 0; i < 8; i += 1) {
      emitTurnEvent(onEvent, {
        type: "status",
        stage: "requesting",
        message: `Requesting Gemini response${i > 0 ? ` (pass ${i + 1})` : ""}.`,
      });
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
        emitTurnEvent(onEvent, {
          type: "status",
          stage: "complete",
          message: "Gemini response complete.",
        });
        return { text: assistantText || response.text || "" };
      }

      emitTurnEvent(onEvent, {
        type: "status",
        stage: "tooling",
        message: `Running ${functionCalls.length} tool${functionCalls.length === 1 ? "" : "s"}.`,
      });

      const functionResponses: Array<Record<string, unknown>> = [];

      for (const functionCall of functionCalls) {
        const name = typeof functionCall.name === "string" ? functionCall.name : "";
        const callId = typeof functionCall.id === "string" ? functionCall.id : name;
        const handler = toolHandlers[name];

        if (!handler) {
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: name,
            callId,
            isError: true,
            contentPreview: `Unknown tool: ${name}`,
          });
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
          emitTurnEvent(onEvent, {
            type: "tool_start",
            toolName: name,
            callId,
            inputSummary: summarizeToolInput(input),
          });
          const result = await handler(input, this.cwd);
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: name,
            callId,
            isError: result.isError ?? false,
            contentPreview: summarizeToolContent(result.content),
          });
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
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: name,
            callId,
            isError: true,
            contentPreview: summarizeToolContent(error instanceof Error ? error.message : String(error)),
          });
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

type ProviderToolCall = NonNullable<OpenAICompatibleMessage["tool_calls"]>[number];

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

  async runTurn(prompt: string, onEvent?: TurnEventHandler): Promise<AgentTurnResult> {
    this.messages.push({
      role: "user",
      content: prompt,
    });
    emitTurnEvent(onEvent, {
      type: "status",
      stage: "queued",
      message: "Prompt queued for provider.",
    });

    let assistantText = "";

    for (let i = 0; i < 8; i += 1) {
      emitTurnEvent(onEvent, {
        type: "status",
        stage: "requesting",
        message: `Requesting provider response${i > 0 ? ` (pass ${i + 1})` : ""}.`,
      });
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
        emitTurnEvent(onEvent, {
          type: "status",
          stage: "complete",
          message: "Provider response complete.",
        });
        return { text: assistantText };
      }

      emitTurnEvent(onEvent, {
        type: "status",
        stage: "tooling",
        message: `Running ${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}.`,
      });

      for (const [index, call] of toolCalls.entries()) {
        const name = call.function?.name?.trim() || "";
        const callId = call.id?.trim() || `tool-call-${index + 1}`;
        const handler = toolHandlers[name];

        if (!handler) {
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: name,
            callId,
            isError: true,
            contentPreview: `Unknown tool: ${name}`,
          });
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
          emitTurnEvent(onEvent, {
            type: "tool_start",
            toolName: name,
            callId,
            inputSummary: summarizeToolInput(input),
          });
          const result = await handler(input, this.cwd);
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: name,
            callId,
            isError: result.isError ?? false,
            contentPreview: summarizeToolContent(result.content),
          });
          this.messages.push({
            role: "tool",
            tool_call_id: callId,
            content: result.content,
          });
        } catch (error) {
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: name,
            callId,
            isError: true,
            contentPreview: summarizeToolContent(error instanceof Error ? error.message : String(error)),
          });
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

export class OpenAIProvider implements LlmProvider {
  private readonly model: string;
  private readonly cwd: string;
  private readonly messages: OpenAICompatibleMessage[] = [];
  private readonly auth = resolveOpenAIAuth({ env: process.env });

  constructor(args: { model: string; cwd: string }) {
    this.model = args.model;
    this.cwd = args.cwd;
  }

  clear(): void {
    this.messages.length = 0;
  }

  async runTurn(prompt: string, onEvent?: TurnEventHandler): Promise<AgentTurnResult> {
    if (this.auth.status !== "ok") {
      throw new Error(formatOpenAIAuthHint(this.auth));
    }
    const auth = this.auth;

    this.messages.push({
      role: "user",
      content: prompt,
    });
    emitTurnEvent(onEvent, {
      type: "status",
      stage: "queued",
      message: this.auth.authType === "oauth" ? "Prompt queued for ChatGPT session." : "Prompt queued for OpenAI API.",
    });

    let assistantText = "";

    for (let i = 0; i < 8; i += 1) {
      emitTurnEvent(onEvent, {
        type: "status",
        stage: "requesting",
        message: `${this.auth.authType === "oauth" ? "Requesting ChatGPT" : "Requesting OpenAI"} response${i > 0 ? ` (pass ${i + 1})` : ""}.`,
      });

      const turnResult: { assistantText: string; toolCalls: ProviderToolCall[] } =
        auth.authType === "oauth"
          ? await this.requestChatGptResponses()
          : await this.requestOpenAIApi();

      assistantText = turnResult.assistantText || assistantText;

      this.messages.push({
        role: "assistant",
        content: turnResult.assistantText,
        ...(turnResult.toolCalls.length > 0 ? { tool_calls: turnResult.toolCalls } : {}),
      });

      if (turnResult.toolCalls.length === 0) {
        emitTurnEvent(onEvent, {
          type: "status",
          stage: "complete",
          message: auth.authType === "oauth" ? "ChatGPT response complete." : "OpenAI response complete.",
        });
        return { text: assistantText };
      }

      emitTurnEvent(onEvent, {
        type: "status",
        stage: "tooling",
        message: `Running ${turnResult.toolCalls.length} tool${turnResult.toolCalls.length === 1 ? "" : "s"}.`,
      });

      for (const [index, call] of turnResult.toolCalls.entries()) {
        const name = call.function?.name?.trim() || "";
        const callId = call.id?.trim() || `tool-call-${index + 1}`;
        const handler = toolHandlers[name];

        if (!handler) {
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: name,
            callId,
            isError: true,
            contentPreview: `Unknown tool: ${name}`,
          });
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
          emitTurnEvent(onEvent, {
            type: "tool_start",
            toolName: name,
            callId,
            inputSummary: summarizeToolInput(input),
          });
          const resultContent = await handler(input, this.cwd);
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: name,
            callId,
            isError: resultContent.isError ?? false,
            contentPreview: summarizeToolContent(resultContent.content),
          });
          this.messages.push({
            role: "tool",
            tool_call_id: callId,
            content: resultContent.content,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emitTurnEvent(onEvent, {
            type: "tool_result",
            toolName: name,
            callId,
            isError: true,
            contentPreview: summarizeToolContent(message),
          });
          this.messages.push({
            role: "tool",
            tool_call_id: callId,
            content: message,
          });
        }
      }
    }

    return {
      text: assistantText || "Stopped after reaching the tool iteration limit.",
    };
  }

  private async requestChatGptResponses(): Promise<{
    assistantText: string;
    toolCalls: ProviderToolCall[];
  }> {
    if (this.auth.status !== "ok") {
      throw new Error(formatOpenAIAuthHint(this.auth));
    }
    const auth = this.auth;
    const responseTools = openAICompatibleToolsToResponsesTools(
      toolDefinitions.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      })),
    );
    const rawInput = sliceResponsesInputToLatestToolTurn(openAICompatibleMessagesToResponsesInput(this.messages));
    const compactRequest = compactOpenAIResponsesRequest(SYSTEM_PROMPT, rawInput, responseTools);

    const response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${auth.bearerToken}`,
        ...("accountId" in auth && auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
        "User-Agent": "codex-cli/0.117.0",
        originator: "codex_cli_rs",
        "x-client-request-id": randomUUID(),
      },
      body: JSON.stringify({
        model: this.model,
        instructions: compactRequest.instructions,
        input: compactRequest.input,
        tools: compactRequest.tools,
        tool_choice: compactRequest.tools.length > 0 ? "auto" : "none",
        parallel_tool_calls: true,
        reasoning: { effort: resolveOpenAIReasoningEffort(this.model) },
        store: false,
        stream: true,
        include: [],
        text: {
          format: { type: "text" },
          verbosity: "medium",
        },
      }),
    });

    const sseText = await response.text();
    if (!response.ok) {
      throw new Error(`ChatGPT request failed with status ${response.status}. ${sseText.slice(0, 400)}`);
    }

    const parsed = parseResponsesSseToResult(sseText);
    return {
      assistantText: parsed.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      toolCalls: parsed.content
        .filter(
          (
            block,
          ): block is {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
          } => block.type === "tool_use",
        )
        .map((block): ProviderToolCall => ({
          id: block.id,
          type: "function" as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        })),
    };
  }

  private async requestOpenAIApi(): Promise<{
    assistantText: string;
    toolCalls: ProviderToolCall[];
  }> {
    if (this.auth.status !== "ok") {
      throw new Error(formatOpenAIAuthHint(this.auth));
    }
    const auth = this.auth;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.bearerToken}`,
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
      throw new Error(formatOpenAICompatibleProviderError("https://api.openai.com/v1", this.model, response.status, json));
    }

    const message = json.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? [])
      .map((call, index): ProviderToolCall | null => {
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
      .filter((call): call is NonNullable<typeof call> => call !== null);

    return {
      assistantText: typeof message?.content === "string" ? message.content : "",
      toolCalls,
    };
  }
}

function resolveOpenAIReasoningEffort(model: string): "low" | "medium" | "high" | "xhigh" {
  const normalized = model.trim().toLowerCase();

  if (normalized.includes("codex")) {
    return "medium";
  }

  if (normalized.startsWith("gpt-5") || normalized.startsWith("o3") || normalized.startsWith("o4")) {
    return "medium";
  }

  return "low";
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

function compactOpenAIResponsesRequest(
  instructions: string,
  input: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
) {
  const budget = 12000;
  let compactInput = [...input];
  let compactTools = [...tools];

  while (estimateOpenAIResponsesPayload(instructions, compactInput, compactTools) > budget && compactInput.length > 4) {
    compactInput = compactInput.slice(1);
  }

  if (estimateOpenAIResponsesPayload(instructions, compactInput, compactTools) > budget && compactTools.length > 12) {
    compactTools = compactTools.slice(0, 12);
  }

  if (estimateOpenAIResponsesPayload(instructions, compactInput, compactTools) > budget && compactTools.length > 6) {
    compactTools = compactTools.slice(0, 6);
  }

  return {
    instructions,
    input: compactInput,
    tools: compactTools,
  };
}

function estimateOpenAIResponsesPayload(
  instructions: string,
  input: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
): number {
  return Math.ceil((instructions.length + JSON.stringify(input).length + JSON.stringify(tools).length) / 4);
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

function emitTurnEvent(onEvent: TurnEventHandler | undefined, event: TurnEvent): void {
  onEvent?.(event);
}

function summarizeToolInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) {
    return "No arguments";
  }

  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${summarizeUnknown(value)}`)
    .join(" · ");
}

function summarizeToolContent(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(no output)";
  }
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function summarizeUnknown(value: unknown): string {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.length} items]`;
  }

  if (isRecord(value)) {
    return "{...}";
  }

  return String(value);
}
