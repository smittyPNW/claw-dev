import path from "node:path";

import type { ProviderName } from "./providers.js";

export type TelegramBotCommand =
  | { type: "help" }
  | { type: "status" }
  | { type: "reset" }
  | { type: "provider"; provider?: ProviderName }
  | { type: "model"; model?: string }
  | { type: "cwd"; cwd?: string }
  | { type: "prompt"; prompt: string };

export type TelegramSessionSnapshot = {
  provider: ProviderName;
  model: string;
  cwd: string;
  turns: number;
};

const PROVIDERS = new Set<ProviderName>(["anthropic", "gemini", "openai", "openrouter", "ollama"]);
const TELEGRAM_MESSAGE_LIMIT = 4096;

export function parseTelegramInput(input: string): TelegramBotCommand {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: "help" };
  }

  if (!trimmed.startsWith("/")) {
    return { type: "prompt", prompt: trimmed };
  }

  const [rawCommand = "", ...rawArgs] = trimmed.split(/\s+/);
  const command = rawCommand.replace(/^\/+/, "").split("@")[0]?.toLowerCase() ?? "";
  const rest = rawArgs.join(" ").trim();

  if (command === "start" || command === "help") {
    return { type: "help" };
  }

  if (command === "status") {
    return { type: "status" };
  }

  if (command === "reset" || command === "clear") {
    return { type: "reset" };
  }

  if (command === "provider") {
    const provider = normalizeProvider(rest);
    return provider ? { type: "provider", provider } : { type: "provider" };
  }

  if (command === "model") {
    return rest ? { type: "model", model: rest } : { type: "model" };
  }

  if (command === "cwd" || command === "workspace") {
    return rest ? { type: "cwd", cwd: path.resolve(rest) } : { type: "cwd" };
  }

  return { type: "prompt", prompt: trimmed };
}

export function formatTelegramHelp(snapshot: TelegramSessionSnapshot): string {
  return [
    "Claw Dev Telegram",
    "",
    "Send any plain message to chat with the coding agent.",
    "",
    "Commands:",
    "/status - show current provider, model, workspace, and turn count",
    "/reset - clear the current chat session memory",
    "/provider <name> - switch provider (openai, openrouter, ollama, anthropic, gemini)",
    "/model <id> - override the current model",
    "/cwd <path> - change the working directory for this chat",
    "/help - show this guide",
    "",
    `Current provider: ${snapshot.provider}`,
    `Current model: ${snapshot.model}`,
    `Current workspace: ${snapshot.cwd}`,
  ].join("\n");
}

export function formatTelegramStatus(snapshot: TelegramSessionSnapshot): string {
  return [
    "Claw Dev session",
    `Provider: ${snapshot.provider}`,
    `Model: ${snapshot.model}`,
    `Workspace: ${snapshot.cwd}`,
    `Turns: ${snapshot.turns}`,
  ].join("\n");
}

export function splitTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return ["No content returned."];
  }

  if (normalized.length <= limit) {
    return [normalized];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n\n", limit);
    if (splitAt < Math.floor(limit * 0.5)) {
      splitAt = remaining.lastIndexOf("\n", limit);
    }
    if (splitAt < Math.floor(limit * 0.5)) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt <= 0) {
      splitAt = limit;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function normalizeProvider(value: string): ProviderName | undefined {
  const normalized = value.trim().toLowerCase();
  if (!PROVIDERS.has(normalized as ProviderName)) {
    return undefined;
  }
  return normalized as ProviderName;
}
