import { setTimeout as delay } from "node:timers/promises";

import { CodingAgent } from "./agent.js";
import { loadConfig, type AppConfig } from "./config.js";
import type { ProviderName, TurnEvent } from "./providers.js";
import {
  formatTelegramHelp,
  formatTelegramStatus,
  parseTelegramInput,
  splitTelegramMessage,
  type TelegramSessionSnapshot,
} from "./telegramShared.js";

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramMessage = {
  message_id: number;
  chat: {
    id: number;
    type: string;
  };
  from?: {
    id: number;
    username?: string;
  };
  text?: string;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

type TelegramSession = {
  agent: CodingAgent;
  provider: ProviderName;
  model: string;
  cwd: string;
  turns: number;
  updatedAt: string;
};

type TelegramDefaults = {
  provider?: ProviderName | undefined;
  model?: string | undefined;
  cwd: string;
};

const TELEGRAM_API_BASE = "https://api.telegram.org";
const RETRY_DELAY_MS = 2_500;
const ALLOWED_CHAT_IDS = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS);
const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();

const sessions = new Map<number, TelegramSession>();

async function main(): Promise<void> {
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required to start the Telegram bot.");
  }

  const me = await telegramRequest<{ username?: string }>("getMe");
  const username = me.username ? `@${me.username}` : "your Telegram bot";
  process.stdout.write(`Claw Dev Telegram is live as ${username}.\n`);

  let offset = 0;

  while (true) {
    try {
      const updates = await telegramRequest<TelegramUpdate[]>("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message"],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Telegram polling error: ${message}\n`);
      await delay(RETRY_DELAY_MS);
    }
  }
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  const text = message?.text?.trim();
  const chatId = message?.chat.id;
  if (!text || chatId === undefined) {
    return;
  }
  const resolvedChatId = chatId;

  if (!isAllowedChat(resolvedChatId)) {
    await sendMessage(resolvedChatId, "This bot is not enabled for this chat.");
    return;
  }

  const command = parseTelegramInput(text);

  if (command.type === "help") {
    await sendMessage(resolvedChatId, formatTelegramHelp(snapshotSession(resolveSession(resolvedChatId))));
    return;
  }

  if (command.type === "status") {
    await sendMessage(resolvedChatId, formatTelegramStatus(snapshotSession(resolveSession(resolvedChatId))));
    return;
  }

  if (command.type === "reset") {
    const session = resolveSession(resolvedChatId);
    session.agent.clear();
    session.turns = 0;
    session.updatedAt = new Date().toISOString();
    await sendMessage(resolvedChatId, "Session cleared. You can keep coding with a fresh context.");
    return;
  }

  if (command.type === "provider") {
    const session = resolveSession(resolvedChatId);
    if (!command.provider) {
      await sendMessage(resolvedChatId, `Current provider: ${session.provider}`);
      return;
    }
    const next = buildSession({
      provider: command.provider,
      cwd: session.cwd,
    });
    sessions.set(resolvedChatId, next);
    await sendMessage(resolvedChatId, `Provider switched to ${next.provider}.\nModel: ${next.model}`);
    return;
  }

  if (command.type === "model") {
    const session = resolveSession(resolvedChatId);
    if (!command.model) {
      await sendMessage(resolvedChatId, `Current model: ${session.model}`);
      return;
    }
    const next = buildSession({
      provider: session.provider,
      model: command.model,
      cwd: session.cwd,
    });
    sessions.set(resolvedChatId, next);
    await sendMessage(resolvedChatId, `Model switched to ${next.model}.`);
    return;
  }

  if (command.type === "cwd") {
    const session = resolveSession(resolvedChatId);
    if (!command.cwd) {
      await sendMessage(resolvedChatId, `Current workspace: ${session.cwd}`);
      return;
    }
    const next = buildSession({
      provider: session.provider,
      model: session.model,
      cwd: command.cwd,
    });
    sessions.set(resolvedChatId, next);
    await sendMessage(resolvedChatId, `Workspace set to:\n${next.cwd}`);
    return;
  }

  const session = resolveSession(resolvedChatId);
  await sendChatAction(resolvedChatId, "typing");

  let announcedTooling = false;
  let announcedToolStart = false;
  const pendingNotifications: Array<Promise<void>> = [];

  const result = await session.agent.runTurn(command.prompt, (event) => {
    pendingNotifications.push(
      handleTurnEvent(event).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Telegram event notification failed: ${message}\n`);
      }),
    );
  });

  session.turns += 1;
  session.updatedAt = new Date().toISOString();

  await Promise.allSettled(pendingNotifications);

  for (const chunk of splitTelegramMessage(result.text)) {
    await sendMessage(chatId, chunk);
  }

  async function handleTurnEvent(event: TurnEvent): Promise<void> {
    if (event.type === "status" && event.stage === "requesting") {
      await sendChatAction(resolvedChatId, "typing");
      return;
    }

    if (event.type === "status" && event.stage === "tooling" && !announcedTooling) {
      announcedTooling = true;
      await sendMessage(resolvedChatId, "Working through tools for this request.");
      return;
    }

    if (event.type === "tool_start" && !announcedToolStart) {
      announcedToolStart = true;
      await sendMessage(resolvedChatId, formatToolStartMessage(event));
    }
  }
}

function resolveSession(chatId: number): TelegramSession {
  const existing = sessions.get(chatId);
  if (existing) {
    return existing;
  }

  const created = buildSession({
    provider: normalizeProvider(process.env.TELEGRAM_PROVIDER),
    model: process.env.TELEGRAM_MODEL?.trim() || undefined,
    cwd: process.env.TELEGRAM_CWD?.trim() || process.cwd(),
  });
  sessions.set(chatId, created);
  return created;
}

function buildSession(defaults: TelegramDefaults): TelegramSession {
  const config = loadConfig({
    ...(defaults.provider ? { provider: defaults.provider } : {}),
    ...(defaults.model ? { model: defaults.model } : {}),
  });
  const cwd = defaults.cwd;
  return {
    agent: createAgent(config, cwd),
    provider: config.provider,
    model: config.model,
    cwd,
    turns: 0,
    updatedAt: new Date().toISOString(),
  };
}

function createAgent(config: AppConfig, cwd: string): CodingAgent {
  if (config.baseUrl !== undefined) {
    return new CodingAgent({
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      cwd,
      baseUrl: config.baseUrl,
    });
  }

  return new CodingAgent({
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.model,
    cwd,
  });
}

function snapshotSession(session: TelegramSession): TelegramSessionSnapshot {
  return {
    provider: session.provider,
    model: session.model,
    cwd: session.cwd,
    turns: session.turns,
  };
}

function isAllowedChat(chatId: number): boolean {
  if (ALLOWED_CHAT_IDS.size === 0) {
    return true;
  }
  return ALLOWED_CHAT_IDS.has(chatId);
}

function parseAllowedChatIds(raw?: string): Set<number> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value)),
  );
}

function normalizeProvider(value?: string): ProviderName | undefined {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "anthropic" ||
    normalized === "gemini" ||
    normalized === "openai" ||
    normalized === "openrouter" ||
    normalized === "ollama"
  ) {
    return normalized;
  }
  return undefined;
}

function formatToolStartMessage(event: Extract<TurnEvent, { type: "tool_start" }>): string {
  const details = event.inputSummary ? `\nInput: ${event.inputSummary}` : "";
  return `Using tool: ${event.toolName}${details}`;
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

async function sendChatAction(chatId: number, action: "typing"): Promise<void> {
  await telegramRequest("sendChatAction", {
    chat_id: chatId,
    action,
  });
}

async function telegramRequest<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const init: RequestInit = {
    method: body ? "POST" : "GET",
  };
  if (body) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, init);

  if (!response.ok) {
    throw new Error(`Telegram API ${method} failed with status ${response.status}.`);
  }

  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} returned ok=false.`);
  }

  return data.result;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
