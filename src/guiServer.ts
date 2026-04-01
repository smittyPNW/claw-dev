import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CodingAgent } from "./agent.js";
import { loadConfig } from "./config.js";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const indexPath = path.join(repoRoot, "index.html");
const sessions = new Map<string, SessionRecord>();

const GUI_PORT = Number(process.env.CLAW_GUI_PORT || "4310");
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/api/meta") {
      return sendJson(res, 200, {
        ok: true,
        defaultCwd: process.cwd(),
        providers: [
          {
            value: "anthropic",
            label: "Anthropic",
            defaultModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
            status: process.env.ANTHROPIC_API_KEY ? "configured" : "missing-key",
            detail: process.env.ANTHROPIC_API_KEY ? "API key available" : "Set ANTHROPIC_API_KEY",
          },
          {
            value: "gemini",
            label: "Gemini",
            defaultModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
            status: process.env.GEMINI_API_KEY ? "configured" : "missing-key",
            detail: process.env.GEMINI_API_KEY ? "API key available" : "Set GEMINI_API_KEY",
          },
          {
            value: "openrouter",
            label: "OpenRouter",
            defaultModel: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4",
            status: process.env.OPENROUTER_API_KEY ? "configured" : "missing-key",
            detail: process.env.OPENROUTER_API_KEY ? "API key available" : "Set OPENROUTER_API_KEY",
          },
          {
            value: "ollama",
            label: "Ollama",
            defaultModel: process.env.OLLAMA_MODEL || "qwen3",
            status: "local",
            detail: process.env.OLLAMA_BASE_URL || "Uses local Ollama runtime",
          },
        ],
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
      const result = await session.agent.runTurn(prompt);
      session.turns += 1;
      session.lastPrompt = prompt;
      session.updatedAt = new Date().toISOString();
      return sendJson(res, 200, {
        ok: true,
        message: result.text,
        session: summarizeSession(session),
      });
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
    if (isPathInsideRepo(assetPath) && existsSync(assetPath)) {
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
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": fileStat.size,
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(res);
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
    case ".js":
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
