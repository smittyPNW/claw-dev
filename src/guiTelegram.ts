import { access, chmod, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { resolvePreferredProvider } from "../shared/tuiDefaults.js";

type TelegramGetMeResponse = {
  ok: boolean;
  result?: {
    username?: string;
    first_name?: string;
  };
  description?: string;
};

export type TelegramSetupState = {
  status: "configured" | "missing-auth" | "error";
  hasToken: boolean;
  maskedToken: string;
  botUsername: string;
  runtimeStatus: "running" | "stopped";
  allowedChatIds: string;
  provider: string;
  model: string;
  cwd: string;
  detail: string;
  nextAction: string;
  launchCommand: string;
};

export type SaveTelegramSetupInput = {
  botToken?: string;
  allowedChatIds?: string;
  provider?: string;
  model?: string;
  cwd?: string;
};

type TelegramSetupDeps = {
  fetchImpl?: typeof fetch;
  isBotRunning?: () => Promise<boolean>;
};

export async function getTelegramSetupState(
  env: NodeJS.ProcessEnv = process.env,
  deps: TelegramSetupDeps = {},
): Promise<TelegramSetupState> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const allowedChatIds = env.TELEGRAM_ALLOWED_CHAT_IDS?.trim() || "";
  const provider = env.TELEGRAM_PROVIDER?.trim() || resolvePreferredProvider(env);
  const model = env.TELEGRAM_MODEL?.trim() || env.OPENAI_MODEL?.trim() || "gpt-5.2-codex";
  const cwd = env.TELEGRAM_CWD?.trim() || process.cwd();
  const isBotRunning = deps.isBotRunning ?? detectTelegramBotRuntime;

  if (!token) {
    return {
      status: "missing-auth",
      hasToken: false,
      maskedToken: "",
      botUsername: "Not connected",
      runtimeStatus: "stopped",
      allowedChatIds,
      provider,
      model,
      cwd,
      detail: "Telegram is not configured yet. Paste the bot token from BotFather to connect this workspace.",
      nextAction: "Paste the bot token, save it here, then start the bot. After that, open Telegram and send /start to your bot.",
      launchCommand: "npm run telegram",
    };
  }

  try {
    const response = await (deps.fetchImpl ?? fetch)(`https://api.telegram.org/bot${token}/getMe`);
    const payload = (await response.json()) as TelegramGetMeResponse;
    if (!response.ok || !payload.ok || !payload.result) {
      throw new Error(payload.description || "Telegram rejected the bot token.");
    }

    const username = payload.result.username ? `@${payload.result.username}` : payload.result.first_name || "Connected bot";
    const running = await isBotRunning();

    return {
      status: running ? "configured" : "error",
      hasToken: true,
      maskedToken: maskSecret(token),
      botUsername: username,
      runtimeStatus: running ? "running" : "stopped",
      allowedChatIds,
      provider,
      model,
      cwd,
      detail: running
        ? `Telegram bot ${username} is connected and actively serving this workspace.`
        : `Telegram bot ${username} is authenticated, but the local bot service is not running yet.`,
      nextAction: running
        ? allowedChatIds
          ? "The bot is live. Keep the chat allowlist if you want it limited to specific chats."
          : "The bot is live. Open Telegram and send /start to begin chatting."
        : "Start the Telegram bot service from this panel, then open Telegram and send /start to it.",
      launchCommand: "npm run telegram",
    };
  } catch (error) {
    return {
      status: "error",
      hasToken: true,
      maskedToken: maskSecret(token),
      botUsername: "Token check failed",
      runtimeStatus: "stopped",
      allowedChatIds,
      provider,
      model,
      cwd,
      detail: error instanceof Error ? error.message : String(error),
      nextAction: "Double-check the bot token from BotFather, save again, and retry the connection check.",
      launchCommand: "npm run telegram",
    };
  }
}

export async function saveTelegramSetup(
  repoRoot: string,
  input: SaveTelegramSetupInput,
  env: NodeJS.ProcessEnv = process.env,
  deps: TelegramSetupDeps = {},
): Promise<TelegramSetupState> {
  const envPath = path.join(repoRoot, ".env");
  let contents = await readEnvFileIfPresent(envPath);
  const storedToken = input.botToken?.trim() || env.TELEGRAM_BOT_TOKEN?.trim() || readEnvValue(contents, "TELEGRAM_BOT_TOKEN");
  const token = storedToken?.trim() || "";
  if (!token) {
    throw new Error("Telegram bot token is required the first time you connect a Telegram bot.");
  }

  const nextValues = {
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_ALLOWED_CHAT_IDS: input.allowedChatIds?.trim() || "",
    TELEGRAM_PROVIDER: input.provider?.trim() || resolvePreferredProvider(env),
    TELEGRAM_MODEL: input.model?.trim() || env.OPENAI_MODEL?.trim() || "gpt-5.2-codex",
    TELEGRAM_CWD: input.cwd?.trim() || process.cwd(),
  };

  for (const [key, value] of Object.entries(nextValues)) {
    contents = upsertEnvLine(contents, key, value);
    env[key] = value;
  }

  await writeFile(envPath, contents, "utf8");
  await chmod(envPath, 0o600).catch(() => {});

  return getTelegramSetupState(env, deps);
}

async function readEnvFileIfPresent(envPath: string): Promise<string> {
  try {
    return await readFile(envPath, "utf8");
  } catch {
    return "";
  }
}

function upsertEnvLine(contents: string, envKey: string, value: string): string {
  const lines = contents.length > 0 ? contents.split(/\r?\n/) : [];
  let updated = false;

  const nextLines = lines.map((line) => {
    if (line.startsWith(`${envKey}=`)) {
      updated = true;
      return `${envKey}=${value}`;
    }
    return line;
  });

  if (!updated) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(`${envKey}=${value}`);
  }

  return `${nextLines.join("\n").replace(/\n+$/u, "")}\n`;
}

function readEnvValue(contents: string, envKey: string): string {
  const match = contents.match(new RegExp(`^${envKey}=(.*)$`, "m"));
  return match?.[1]?.trim() || "";
}

async function detectTelegramBotRuntime(): Promise<boolean> {
  const pidFile = path.join(os.homedir(), ".claw-dev", "telegram.pid");
  const pid = await readPidFile(pidFile);
  if (pid && isProcessAlive(pid)) {
    return true;
  }

  return await hasTelegramProcess();
}

async function readPidFile(pidFile: string): Promise<number | null> {
  try {
    const raw = await readFile(pidFile, "utf8");
    const pid = Number(raw.trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }

    return (await isTelegramProcess(pid)) ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function hasTelegramProcess(): Promise<boolean> {
  try {
    await access("/usr/bin/pgrep");
  } catch {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    const child = spawn("/usr/bin/pgrep", ["-f", "telegramBot\\.(js|ts)"], {
      stdio: "ignore",
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });
    child.on("error", () => {
      resolve(false);
    });
  });
}

async function isTelegramProcess(pid: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn("/bin/ps", ["-o", "command=", "-p", String(pid)], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", (code) => {
      resolve(code === 0 && /telegramBot\.(js|ts)/.test(output));
    });
    child.on("error", () => {
      resolve(false);
    });
  });
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "••••••••";
  }

  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
