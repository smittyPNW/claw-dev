import { randomUUID } from "node:crypto";
import { exec, execFile, spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CodingAgent } from "./agent.js";
import { normalizeChatAttachments } from "./chatAttachments.js";
import { loadConfig } from "./config.js";
import { getOpenAIAuthPanelState } from "./guiAuth.js";
import { getOllamaRuntimeState, saveOllamaRuntimeConfig } from "./guiOllama.js";
import { getProviderSecretState, saveProviderSecret, type KeyBackedProvider } from "./guiSecrets.js";
import { getTelegramSetupState, saveTelegramSetup } from "./guiTelegram.js";
import { getUpdateCheckState, installAvailableUpdate } from "./guiUpdate.js";
import { pickWorkspaceFolder, preparePythonWorkspaceRun } from "./guiWorkspace.js";
import { getGuiModelGroups, getOpenRouterCatalogState, startOpenRouterHeartbeat } from "./modelCatalog.js";
import type { ProviderName } from "./providers.js";

type SessionRecord = {
  id: string;
  provider: ProviderName;
  model: string;
  cwd: string;
  agent: CodingAgent;
  createdAt: string;
  updatedAt: string;
  turns: number;
  lastPrompt: string | null;
};

type SessionCreateRequest = {
  provider?: ProviderName;
  model?: string;
  cwd?: string;
};

type SessionMessageRequest = {
  prompt?: string;
  attachments?: unknown[];
};

type PickFolderRequest = {
  initialPath?: string;
};

type WorkspaceFileSaveRequest = {
  cwd?: string;
  path?: string;
  content?: string;
};

type WorkspaceRunRequest = {
  cwd?: string;
  command?: string;
  launchMode?: "panel" | "external";
};

type WorkspacePythonPrepareRequest = {
  cwd?: string;
  path?: string;
};

type WorkspaceTerminalCreateRequest = {
  cwd?: string;
};

type WorkspaceTerminalInputRequest = {
  input?: string;
};

type WorkspaceTerminalResizeRequest = {
  cols?: number;
  rows?: number;
};

type WorkspaceProcessSummary = {
  id: string;
  cwd: string;
  command: string;
  mode: "command" | "external-window" | "terminal-window";
  status: "running" | "completed" | "failed" | "launched";
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type ProviderSecretRequest = {
  provider?: KeyBackedProvider;
  value?: string;
};

type OllamaConfigRequest = {
  baseUrl?: string;
  apiKey?: string;
};

type TelegramConfigRequest = {
  botToken?: string;
  allowedChatIds?: string;
  provider?: string;
  model?: string;
  cwd?: string;
};

type SessionSummary = {
  id: string;
  provider: ProviderName;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  turns: number;
  lastPrompt: string | null;
};

type WorkspaceProcessRecord = {
  id: string;
  cwd: string;
  command: string;
  mode: "command" | "external-window" | "terminal-window";
  status: "running" | "completed" | "failed" | "launched";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  child: ReturnType<typeof spawn>;
};

type WorkspaceTerminalSummary = {
  id: string;
  cwd: string;
  shell: string;
  status: "running" | "exited";
  cursor: number;
  previewUrl: string | null;
};

type WorkspaceTerminalRecord = {
  id: string;
  cwd: string;
  shell: string;
  status: "running" | "exited";
  cursor: number;
  previewUrl: string | null;
  cols: number;
  rows: number;
  terminal: ReturnType<typeof spawn>;
  chunks: Array<{ cursor: number; data: string }>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const indexPath = path.join(repoRoot, "index.html");
const sessions = new Map<string, SessionRecord>();
const workspaceProcesses = new Map<string, WorkspaceProcessRecord>();
const workspaceTerminals = new Map<string, WorkspaceTerminalRecord>();

const GUI_PORT = Number(process.env.CLAW_GUI_PORT || "4310");
const TURN_STREAM_TIMEOUT_MS = Number(process.env.CLAW_TURN_TIMEOUT_MS || "300000");
const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
startOpenRouterHeartbeat();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/api/meta") {
      const openAiAuth = getOpenAIAuthPanelState({ env: process.env });
      const [anthropicModels, geminiModels, openAiModels, openRouterState, huggingFaceModels, ollamaModels, ollamaRuntime] = await Promise.all([
        getGuiModelGroups("anthropic"),
        getGuiModelGroups("gemini"),
        getGuiModelGroups("openai"),
        getOpenRouterCatalogState(),
        getGuiModelGroups("huggingface"),
        getGuiModelGroups("ollama"),
        getOllamaRuntimeState(process.env),
      ]);

      return sendJson(res, 200, {
        ok: true,
        defaultCwd: process.cwd(),
        platform: process.platform,
        providers: [
          {
            value: "anthropic",
            label: "Anthropic",
            defaultModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
            status: process.env.ANTHROPIC_API_KEY ? "configured" : "missing-key",
            detail: process.env.ANTHROPIC_API_KEY ? "API key available" : "Set ANTHROPIC_API_KEY",
            modelGroups: anthropicModels,
          },
          {
            value: "gemini",
            label: "Gemini",
            defaultModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
            status: process.env.GEMINI_API_KEY ? "configured" : "missing-key",
            detail: process.env.GEMINI_API_KEY ? "API key available" : "Set GEMINI_API_KEY",
            modelGroups: geminiModels,
          },
          {
            value: "openai",
            label: "ChatGPT",
            defaultModel: process.env.OPENAI_MODEL || "gpt-5.2-codex",
            status: openAiAuth.status,
            detail: openAiAuth.shortDetail,
            modelGroups: openAiModels,
            auth: openAiAuth,
          },
          {
            value: "openrouter",
            label: "OpenRouter",
            defaultModel: resolveOpenRouterDefaultModel(openRouterState),
            status: process.env.OPENROUTER_API_KEY ? "configured" : "missing-key",
            detail: process.env.OPENROUTER_API_KEY
              ? formatOpenRouterDetail(openRouterState)
              : `Set OPENROUTER_API_KEY. ${formatOpenRouterDetail(openRouterState)}`,
            modelGroups: openRouterState.groups,
            preferredModel: openRouterState.preferredModel.value,
            heartbeat: {
              refreshedAt: openRouterState.refreshedAt,
              nextRefreshAt: openRouterState.nextRefreshAt,
              source: openRouterState.source,
            },
          },
          {
            value: "huggingface",
            label: "Hugging Face",
            defaultModel: process.env.HUGGINGFACE_MODEL || "openai/gpt-oss-120b:fastest",
            status: process.env.HF_TOKEN ? "configured" : "missing-key",
            detail: process.env.HF_TOKEN
              ? "HF token available for Hugging Face Inference Providers."
              : "Set HF_TOKEN to use Hugging Face hosted models.",
            modelGroups: huggingFaceModels,
          },
          {
            value: "ollama",
            label: "Ollama",
            defaultModel: process.env.OLLAMA_MODEL || "qwen3",
            status: "local",
            detail: ollamaRuntime.detail,
            modelGroups: ollamaModels,
            runtime: ollamaRuntime,
          },
        ],
      });
    }

    if (req.method === "GET" && url.pathname === "/api/providers/ollama/status") {
      return sendJson(res, 200, {
        ok: true,
        runtime: await getOllamaRuntimeState(process.env),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/providers/ollama/config") {
      const body = (await readJson(req)) as OllamaConfigRequest;
      return sendJson(res, 200, {
        ok: true,
        runtime: await saveOllamaRuntimeConfig(repoRoot, body, process.env),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/auth/openai/status") {
      return sendJson(res, 200, {
        ok: true,
        auth: getOpenAIAuthPanelState({ env: process.env }),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/integrations/telegram/status") {
      return sendJson(res, 200, {
        ok: true,
        telegram: await getTelegramSetupState(process.env),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/integrations/telegram/config") {
      const body = (await readJson(req)) as TelegramConfigRequest;
      return sendJson(res, 200, {
        ok: true,
        telegram: await saveTelegramSetup(repoRoot, body, process.env),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/integrations/telegram/start") {
      await runRepoScript("telegram-start.sh");
      return sendJson(res, 200, {
        ok: true,
        telegram: await getTelegramSetupState(process.env),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/integrations/telegram/stop") {
      await runRepoScript("telegram-stop.sh");
      return sendJson(res, 200, {
        ok: true,
        telegram: await getTelegramSetupState(process.env),
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/provider-secrets/")) {
      const provider = decodeProviderFromPath(url.pathname);
      return sendJson(res, 200, {
        ok: true,
        secret: getProviderSecretState(provider, process.env),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/provider-secrets") {
      const body = (await readJson(req)) as ProviderSecretRequest;
      if (!body.provider) {
        throw httpError(400, "Provider is required.");
      }
      if (typeof body.value !== "string") {
        throw httpError(400, "API key value is required.");
      }

      return sendJson(res, 200, {
        ok: true,
        secret: await saveProviderSecret(repoRoot, body.provider, body.value, process.env),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/update/status") {
      return sendJson(res, 200, {
        ok: true,
        update: await getUpdateCheckState({ cwd: repoRoot }),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/update/check") {
      return sendJson(res, 200, {
        ok: true,
        update: await getUpdateCheckState({ cwd: repoRoot, forceRefresh: true }),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/update/install") {
      return sendJson(res, 200, {
        ok: true,
        result: await installAvailableUpdate({ cwd: repoRoot }),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/providers/openrouter/refresh") {
      const state = await getOpenRouterCatalogState(process.env, { forceRefresh: true });
      return sendJson(res, 200, {
        ok: true,
        preferredModel: state.preferredModel.value,
        heartbeat: {
          refreshedAt: state.refreshedAt,
          nextRefreshAt: state.nextRefreshAt,
          source: state.source,
        },
      });
    }

    if (req.method === "POST" && url.pathname === "/api/system/pick-folder") {
      const body = (await readJson(req)) as PickFolderRequest;
      const selectedPath = await pickWorkspaceFolder(body.initialPath);
      return sendJson(res, 200, {
        ok: true,
        path: selectedPath,
        cancelled: selectedPath === null,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/workspace/tree") {
      const cwd = resolveWorkspaceRoot(url.searchParams.get("cwd"));
      return sendJson(res, 200, {
        ok: true,
        cwd,
        tree: await buildWorkspaceTree(cwd),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/workspace/file") {
      const cwd = resolveWorkspaceRoot(url.searchParams.get("cwd"));
      const relativeFilePath = url.searchParams.get("path");
      if (!relativeFilePath) {
        throw httpError(400, "File path is required.");
      }

      const filePath = resolveWithinWorkspace(cwd, relativeFilePath);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        throw httpError(400, "Requested path is not a file.");
      }

      return sendJson(res, 200, {
        ok: true,
        cwd,
        path: path.relative(cwd, filePath),
        content: await readFile(filePath, "utf8"),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/file") {
      const body = (await readJson(req)) as WorkspaceFileSaveRequest;
      const cwd = resolveWorkspaceRoot(body.cwd);
      if (!body.path?.trim()) {
        throw httpError(400, "File path is required.");
      }
      if (typeof body.content !== "string") {
        throw httpError(400, "File content is required.");
      }

      const filePath = resolveWithinWorkspace(cwd, body.path);
      await writeFile(filePath, body.content, "utf8");
      return sendJson(res, 200, {
        ok: true,
        cwd,
        path: path.relative(cwd, filePath),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/run") {
      const body = (await readJson(req)) as WorkspaceRunRequest;
      const cwd = resolveWorkspaceRoot(body.cwd);
      const command = body.command?.trim();
      if (!command) {
        throw httpError(400, "Command is required.");
      }

      return sendJson(res, 200, {
        ok: true,
        process: await startWorkspaceProcess(cwd, command, body.launchMode ?? "panel"),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/python/prepare") {
      const body = (await readJson(req)) as WorkspacePythonPrepareRequest;
      const cwd = resolveWorkspaceRoot(body.cwd);
      const relativeFilePath = body.path?.trim();
      if (!relativeFilePath) {
        throw httpError(400, "Python file path is required.");
      }

      const safeFilePath = resolveWithinWorkspace(cwd, relativeFilePath);

      return sendJson(res, 200, {
        ok: true,
        python: await preparePythonWorkspaceRun(cwd, path.relative(cwd, safeFilePath)),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/workspace/terminal/start") {
      const body = (await readJson(req)) as WorkspaceTerminalCreateRequest;
      const cwd = resolveWorkspaceRoot(body.cwd);
      return sendJson(res, 200, {
        ok: true,
        terminal: startWorkspaceTerminal(cwd),
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/workspace/terminal/")) {
      const terminalId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const terminalRecord = requireWorkspaceTerminal(terminalId);
      const since = Number(url.searchParams.get("cursor") ?? "0");
      return sendJson(res, 200, {
        ok: true,
        terminal: summarizeWorkspaceTerminal(terminalRecord),
        output: terminalOutputSince(terminalRecord, Number.isFinite(since) ? since : 0),
      });
    }

    if (req.method === "POST" && url.pathname.endsWith("/input") && url.pathname.startsWith("/api/workspace/terminal/")) {
      const terminalId = decodeURIComponent(url.pathname.split("/")[4] ?? "");
      const body = (await readJson(req)) as WorkspaceTerminalInputRequest;
      const terminalRecord = requireWorkspaceTerminal(terminalId);
      if (!body.input) {
        throw httpError(400, "Terminal input is required.");
      }
      terminalRecord.terminal.stdin?.write(body.input);
      return sendJson(res, 200, {
        ok: true,
        terminal: summarizeWorkspaceTerminal(terminalRecord),
      });
    }

    if (req.method === "POST" && url.pathname.endsWith("/resize") && url.pathname.startsWith("/api/workspace/terminal/")) {
      const terminalId = decodeURIComponent(url.pathname.split("/")[4] ?? "");
      const body = (await readJson(req)) as WorkspaceTerminalResizeRequest;
      const terminalRecord = requireWorkspaceTerminal(terminalId);
      const cols = Math.max(40, Math.min(300, Math.floor(body.cols ?? terminalRecord.cols)));
      const rows = Math.max(12, Math.min(120, Math.floor(body.rows ?? terminalRecord.rows)));
      terminalRecord.cols = cols;
      terminalRecord.rows = rows;
      return sendJson(res, 200, {
        ok: true,
        terminal: summarizeWorkspaceTerminal(terminalRecord),
      });
    }

    if (req.method === "POST" && url.pathname.endsWith("/interrupt") && url.pathname.startsWith("/api/workspace/terminal/")) {
      const terminalId = decodeURIComponent(url.pathname.split("/")[4] ?? "");
      const terminalRecord = requireWorkspaceTerminal(terminalId);
      terminalRecord.terminal.stdin?.write("\u0003");
      return sendJson(res, 200, {
        ok: true,
        terminal: summarizeWorkspaceTerminal(terminalRecord),
      });
    }

    if (req.method === "POST" && url.pathname.endsWith("/stop") && url.pathname.startsWith("/api/workspace/terminal/")) {
      const terminalId = decodeURIComponent(url.pathname.split("/")[4] ?? "");
      const terminalRecord = requireWorkspaceTerminal(terminalId);
      stopWorkspaceTerminal(terminalRecord);
      return sendJson(res, 200, {
        ok: true,
        terminal: summarizeWorkspaceTerminal(terminalRecord),
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/workspace/process/")) {
      const processId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      return sendJson(res, 200, {
        ok: true,
        process: summarizeWorkspaceProcess(requireWorkspaceProcess(processId)),
      });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/workspace/process/") && url.pathname.endsWith("/stop")) {
      const processId = decodeURIComponent(url.pathname.split("/")[4] ?? "");
      const processRecord = requireWorkspaceProcess(processId);
      if (processRecord.status === "running") {
        processRecord.child.kill("SIGTERM");
      }
      return sendJson(res, 200, {
        ok: true,
        process: summarizeWorkspaceProcess(processRecord),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      return sendJson(res, 200, {
        ok: true,
        sessions: listSessions(),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const body = (await readJson(req)) as SessionCreateRequest;
      const session = createSession(body);
      return sendJson(res, 200, {
        ok: true,
        session: {
          id: session.id,
          provider: session.provider,
          model: session.model,
          cwd: session.cwd,
        },
      });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/messages")) {
      const sessionId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      const session = requireSession(sessionId);
      const body = (await readJson(req)) as SessionMessageRequest;
      const prompt = body.prompt?.trim();
      if (!prompt) {
        throw httpError(400, "Prompt is required.");
      }
      const attachments = normalizeChatAttachments(body.attachments);
      const result = await session.agent.runTurn(prompt, attachments);
      session.turns += 1;
      session.lastPrompt = prompt;
      session.updatedAt = new Date().toISOString();
      return sendJson(res, 200, {
        ok: true,
        message: result.text,
        session: summarizeSession(session),
      });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/messages/stream")) {
      const sessionId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      const session = requireSession(sessionId);
      const body = (await readJson(req)) as SessionMessageRequest;
      const prompt = body.prompt?.trim();
      if (!prompt) {
        throw httpError(400, "Prompt is required.");
      }

      const attachments = normalizeChatAttachments(body.attachments);
      return streamTurn(res, session, prompt, attachments);
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/reset")) {
      const sessionId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      const session = requireSession(sessionId);
      session.agent.clear();
      session.updatedAt = new Date().toISOString();
      session.lastPrompt = null;
      session.turns = 0;
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return sendFile(res, indexPath, "text/html; charset=utf-8");
    }

    const assetPath = path.join(repoRoot, decodeURIComponent(url.pathname));
    if (isPathInsideRepo(assetPath) && existsSync(assetPath) && (await stat(assetPath)).isFile()) {
      return sendFile(res, assetPath, contentTypeFor(assetPath));
    }

    return sendJson(res, 404, { ok: false, error: "Not found." });
  } catch (error) {
    const status = isHttpError(error) ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return sendJson(res, status, { ok: false, error: message });
  }
});

server.listen(GUI_PORT, "127.0.0.1", () => {
  process.stdout.write(`Claw Dev GUI running at http://127.0.0.1:${GUI_PORT}\n`);
});

function createSession(body: SessionCreateRequest): SessionRecord {
  const cwd = body.cwd?.trim() ? path.resolve(body.cwd) : process.cwd();
  const config = loadConfig({
    ...(body.provider ? { provider: body.provider } : {}),
    ...(body.model ? { model: body.model } : {}),
  });

  const agent = new CodingAgent(
    config.baseUrl !== undefined
      ? {
          provider: config.provider,
          apiKey: config.apiKey,
          model: config.model,
          cwd,
          baseUrl: config.baseUrl,
        }
      : {
          provider: config.provider,
          apiKey: config.apiKey,
          model: config.model,
          cwd,
        },
  );

  const now = new Date().toISOString();

  const session: SessionRecord = {
    id: randomUUID(),
    provider: config.provider,
    model: config.model,
    cwd,
    agent,
    createdAt: now,
    updatedAt: now,
    turns: 0,
    lastPrompt: null,
  };
  sessions.set(session.id, session);
  return session;
}

function requireSession(id: string): SessionRecord {
  const session = sessions.get(id);
  if (!session) {
    throw httpError(404, "Session not found. Create a new session first.");
  }
  return session;
}

function listSessions(): SessionSummary[] {
  return [...sessions.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((session) => summarizeSession(session));
}

function requireWorkspaceProcess(id: string): WorkspaceProcessRecord {
  const processRecord = workspaceProcesses.get(id);
  if (!processRecord) {
    throw httpError(404, "Workspace process not found.");
  }
  return processRecord;
}

function requireWorkspaceTerminal(id: string): WorkspaceTerminalRecord {
  const terminalRecord = workspaceTerminals.get(id);
  if (!terminalRecord) {
    throw httpError(404, "Workspace terminal not found.");
  }
  return terminalRecord;
}

function summarizeWorkspaceProcess(processRecord: WorkspaceProcessRecord): WorkspaceProcessSummary {
  return {
    id: processRecord.id,
    cwd: processRecord.cwd,
    command: processRecord.command,
    mode: processRecord.mode,
    status: processRecord.status,
    stdout: processRecord.stdout,
    stderr: processRecord.stderr,
    exitCode: processRecord.exitCode,
  };
}

function summarizeWorkspaceTerminal(terminalRecord: WorkspaceTerminalRecord): WorkspaceTerminalSummary {
  return {
    id: terminalRecord.id,
    cwd: terminalRecord.cwd,
    shell: terminalRecord.shell,
    status: terminalRecord.status,
    cursor: terminalRecord.cursor,
    previewUrl: terminalRecord.previewUrl,
  };
}

function summarizeSession(session: SessionRecord): SessionSummary {
  return {
    id: session.id,
    provider: session.provider,
    model: session.model,
    cwd: session.cwd,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turns: session.turns,
    lastPrompt: session.lastPrompt,
  };
}

function resolveOpenRouterDefaultModel(state: Awaited<ReturnType<typeof getOpenRouterCatalogState>>): string {
  const envModel = process.env.OPENROUTER_MODEL?.trim();
  if (envModel && envModel !== "anthropic/claude-sonnet-4") {
    return envModel;
  }

  return state.preferredModel.value;
}

function formatOpenRouterDetail(state: Awaited<ReturnType<typeof getOpenRouterCatalogState>>): string {
  const sourceLabel = state.source === "live" ? "live heartbeat" : "fallback catalog";
  const refreshedLabel = state.refreshedAt
    ? `Refreshed ${relativeHeartbeatTime(state.refreshedAt)}`
    : "Waiting for first live refresh";
  return `${refreshedLabel} from ${sourceLabel}. Default free pick: ${state.preferredModel.label}.`;
}

function relativeHeartbeatTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const deltaMinutes = Math.max(0, Math.round(deltaMs / 60000));
  if (deltaMinutes < 1) {
    return "just now";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  return `${Math.round(deltaHours / 24)}d ago`;
}

function decodeProviderFromPath(pathname: string): KeyBackedProvider {
  const provider = pathname.split("/").at(-1)?.trim();
  if (provider !== "anthropic" && provider !== "gemini" && provider !== "openai" && provider !== "openrouter" && provider !== "huggingface") {
    throw httpError(404, "Provider secret route not found.");
  }
  return provider;
}

async function streamTurn(
  res: ServerResponse,
  session: SessionRecord,
  prompt: string,
  attachments: ReturnType<typeof normalizeChatAttachments>,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: Record<string, unknown>): void => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    session.lastPrompt = prompt;
    session.updatedAt = new Date().toISOString();

    const result = await Promise.race([
      session.agent.runTurn(prompt, attachments, (event) => {
        send(event);
      }),
      delay(TURN_STREAM_TIMEOUT_MS).then(() => {
        throw new Error(
          "Claw Dev cancelled the request because the turn took too long to finish. Please retry, narrow the task, or switch models if this keeps happening.",
        );
      }),
    ]);

    session.turns += 1;
    session.updatedAt = new Date().toISOString();

    await streamText(send, result.text || "(empty response)");
    send({
      type: "session",
      session: summarizeSession(session),
    });
    send({
      type: "done",
    });
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    res.end();
  }
}

async function streamText(send: (event: Record<string, unknown>) => void, text: string): Promise<void> {
  for (const chunk of chunkText(text)) {
    send({
      type: "text_delta",
      text: chunk,
    });
    await delay(18);
  }
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let index = 0;

  while (index < text.length) {
    const remaining = text.slice(index);
    const breakpoint = remaining.match(/^.{1,72}(?:\s|$)/)?.[0].length ?? Math.min(72, remaining.length);
    chunks.push(text.slice(index, index + breakpoint));
    index += breakpoint;
  }

  return chunks.length > 0 ? chunks : [text];
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

async function sendFile(res: ServerResponse, filePath: string, contentType: string): Promise<void> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw httpError(404, "Not found.");
  }
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileStat.size,
    "Cache-Control": "no-cache",
  });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(res);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

function isPathInsideRepo(filePath: string): boolean {
  const relative = path.relative(repoRoot, filePath);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function httpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function isHttpError(error: unknown): error is Error & { status: number } {
  return typeof error === "object" && error !== null && "status" in error;
}

async function runRepoScript(scriptName: string): Promise<void> {
  const scriptPath = path.join(repoRoot, "scripts", scriptName);

  try {
    await execFileAsync("/bin/zsh", [scriptPath], {
      cwd: repoRoot,
      env: process.env,
    });
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error
      ? String(error.stderr || "").trim()
      : "";
    const stdout = typeof error === "object" && error !== null && "stdout" in error
      ? String(error.stdout || "").trim()
      : "";
    throw httpError(500, stderr || stdout || `Failed to run ${scriptName}.`);
  }
}

type WorkspaceTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceTreeNode[];
};

function resolveWorkspaceRoot(rawCwd?: string | null): string {
  return rawCwd?.trim() ? path.resolve(rawCwd.trim()) : process.cwd();
}

function resolveWithinWorkspace(cwd: string, maybeRelative: string): string {
  const resolved = path.resolve(cwd, maybeRelative);
  const relative = path.relative(path.resolve(cwd), resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw httpError(400, `Path escapes workspace: ${maybeRelative}`);
  }
  return resolved;
}

async function buildWorkspaceTree(cwd: string, currentPath = cwd, depth = 0): Promise<WorkspaceTreeNode[]> {
  if (depth > 2) {
    return [];
  }

  const entries = await readdir(currentPath, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => !shouldIgnoreWorkspaceEntry(entry.name))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, depth === 0 ? 80 : 40);

  const nodes: WorkspaceTreeNode[] = [];
  for (const entry of visibleEntries) {
    const fullPath = path.join(currentPath, entry.name);
    const relativePath = path.relative(cwd, fullPath);

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children: await buildWorkspaceTree(cwd, fullPath, depth + 1),
      });
      continue;
    }

    nodes.push({
      name: entry.name,
      path: relativePath,
      type: "file",
    });
  }

  return nodes;
}

function shouldIgnoreWorkspaceEntry(name: string): boolean {
  return [".git", "node_modules", "dist", ".DS_Store", ".venv"].includes(name);
}

async function runWorkspaceCommand(cwd: string, command: string): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  ok: boolean;
}> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      shell: defaultShell(),
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    });
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
      ok: true,
    };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: String(failed.stdout ?? "").trim(),
      stderr: String(failed.stderr ?? "").trim(),
      exitCode: Number.isInteger(failed.code) ? Number(failed.code) : 1,
      ok: false,
    };
  }
}

function defaultShell(): string {
  if (process.platform === "win32") {
    return "powershell.exe";
  }

  return process.env.SHELL || "/bin/sh";
}

function defaultShellArgs(shellPath: string): string[] {
  if (process.platform === "win32") {
    return ["-NoLogo"];
  }

  const shellName = path.basename(shellPath);
  if (shellName === "zsh" || shellName === "bash") {
    return ["-l"];
  }

  return [];
}

function startWorkspaceTerminal(cwd: string): WorkspaceTerminalSummary {
  const existing = [...workspaceTerminals.values()].find((terminalRecord) => terminalRecord.cwd === cwd && terminalRecord.status === "running");
  if (existing) {
    return summarizeWorkspaceTerminal(existing);
  }

  const shell = defaultShell();
  const id = randomUUID();
  const terminal = spawn(shell, defaultShellArgs(shell), {
    cwd,
    env: terminalEnvironment(),
    shell: false,
    stdio: "pipe",
  });

  const record: WorkspaceTerminalRecord = {
    id,
    cwd,
    shell,
    status: "running",
    cursor: 0,
    previewUrl: null,
    cols: 120,
    rows: 28,
    terminal,
    chunks: [],
  };

  workspaceTerminals.set(id, record);

  terminal.stdout?.on("data", (data) => {
    const chunk = String(data);
    record.cursor += chunk.length;
    record.chunks.push({ cursor: record.cursor, data: chunk });
    if (record.chunks.length > 400) {
      record.chunks.splice(0, record.chunks.length - 400);
    }

    const detectedPreviewUrl = detectPreviewUrl(chunk);
    if (detectedPreviewUrl) {
      record.previewUrl = detectedPreviewUrl;
    }
  });

  terminal.stderr?.on("data", (data) => {
    const chunk = String(data);
    record.cursor += chunk.length;
    record.chunks.push({ cursor: record.cursor, data: chunk });
    if (record.chunks.length > 400) {
      record.chunks.splice(0, record.chunks.length - 400);
    }

    const detectedPreviewUrl = detectPreviewUrl(chunk);
    if (detectedPreviewUrl) {
      record.previewUrl = detectedPreviewUrl;
    }
  });

  terminal.on("close", () => {
    record.status = "exited";
  });

  terminal.stdin?.write("printf 'Claw Dev workspace shell ready\\n'\n");

  return summarizeWorkspaceTerminal(record);
}

function stopWorkspaceTerminal(terminalRecord: WorkspaceTerminalRecord): void {
  if (terminalRecord.status === "running") {
    terminalRecord.terminal.kill("SIGTERM");
    terminalRecord.status = "exited";
  }
}

function terminalOutputSince(terminalRecord: WorkspaceTerminalRecord, cursor: number): { chunk: string; cursor: number } {
  const safeCursor = Math.max(0, cursor);
  const chunk = terminalRecord.chunks
    .filter((entry) => entry.cursor > safeCursor)
    .map((entry) => entry.data)
    .join("");

  return {
    chunk,
    cursor: terminalRecord.cursor,
  };
}

function detectPreviewUrl(output: string): string | null {
  const match = output.match(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d{2,5}(?:\/[^\s]*)?/i);
  if (!match) {
    return null;
  }

  return match[0].replace("0.0.0.0", "127.0.0.1");
}

function terminalEnvironment(): Record<string, string> {
  const envEntries = Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return {
    TERM: "xterm-256color",
    CLICOLOR_FORCE: "1",
    ...Object.fromEntries(envEntries),
  };
}

async function startWorkspaceProcess(cwd: string, command: string, launchMode: "panel" | "external"): Promise<WorkspaceProcessSummary> {
  const inferredMode = await inferWorkspaceRunMode(cwd, command);

  if (launchMode === "external" && process.platform === "darwin") {
    await launchInTerminalWindow(cwd, command);
    return {
      id: randomUUID(),
      cwd,
      command,
      mode: inferredMode === "external-window" ? "external-window" : "terminal-window",
      status: "launched",
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  }

  const mode = inferredMode;
  const id = randomUUID();
  const child = spawn(command, {
    cwd,
    shell: defaultShell(),
    windowsHide: true,
    detached: false,
    env: process.env,
  });

  const record: WorkspaceProcessRecord = {
    id,
    cwd,
    command,
    mode,
    status: "running",
    stdout: "",
    stderr: "",
    exitCode: null,
    child,
  };

  workspaceProcesses.set(id, record);

  child.stdout?.on("data", (chunk) => {
    record.stdout = trimProcessLog(`${record.stdout}${String(chunk)}`);
  });

  child.stderr?.on("data", (chunk) => {
    record.stderr = trimProcessLog(`${record.stderr}${String(chunk)}`);
  });

  child.on("error", (error) => {
    record.stderr = trimProcessLog(`${record.stderr}\n${error.message}`.trim());
    record.status = "failed";
    record.exitCode = 1;
  });

  child.on("close", (code) => {
    record.exitCode = Number.isInteger(code) ? Number(code) : 0;
    record.status = record.exitCode === 0 ? "completed" : "failed";
  });

  await delay(120);
  return summarizeWorkspaceProcess(record);
}

async function inferWorkspaceRunMode(cwd: string, command: string): Promise<"command" | "external-window"> {
  const candidatePath = extractRunnableScriptPath(command);
  if (!candidatePath) {
    return "command";
  }

  const fullPath = resolveWithinWorkspace(cwd, candidatePath);
  try {
    const content = await readFile(fullPath, "utf8");
    const lower = content.toLowerCase();
    if (
      lower.includes("import pygame")
      || lower.includes("from pygame")
      || lower.includes("import tkinter")
      || lower.includes("from tkinter")
      || lower.includes("import turtle")
      || lower.includes("from turtle")
      || lower.includes("import pyglet")
      || lower.includes("import arcade")
      || lower.includes("import pyxel")
      || lower.includes("pygame.init(")
      || lower.includes("display.set_mode(")
      || lower.includes("turtle.screen(")
      || lower.includes("screen = turtle.screen(")
      || lower.includes("tk()")
      || lower.includes("mainloop(")
      || lower.includes("arcade.window")
      || lower.includes("pyxel.init(")
    ) {
      return "external-window";
    }
  } catch {
    return "command";
  }

  return "command";
}

function extractRunnableScriptPath(command: string): string | null {
  const trimmed = command.trim();

  const pythonMatch = trimmed.match(/^(?:"[^"]*python[^"]*"|'[^']*python[^']*'|\S*python\S*|\S*python3\S*)\s+(".*?"|'.*?'|\S+)/i);
  if (pythonMatch?.[1]) {
    return stripShellQuotes(pythonMatch[1]);
  }

  const nodeMatch = trimmed.match(/^(?:node|npx\s+tsx)\s+(".*?"|'.*?'|\S+)/i);
  if (nodeMatch?.[1]) {
    return stripShellQuotes(nodeMatch[1]);
  }

  return null;
}

function stripShellQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function trimProcessLog(content: string): string {
  return content.slice(-20000);
}

async function launchInTerminalWindow(cwd: string, command: string): Promise<void> {
  const shellCommand = `cd ${shellSingleQuote(cwd)} && ${command}`;
  await execFileAsync("osascript", [
    "-e",
    'tell application "Terminal"',
    "-e",
    "activate",
    "-e",
    `do script ${appleScriptString(shellCommand)}`,
    "-e",
    "end tell",
  ]);
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
