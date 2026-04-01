#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const guiPort = Number(process.env.CLAW_GUI_PORT || "4310");
const guiUrl = process.env.CLAW_GUI_URL || `http://127.0.0.1:${guiPort}`;
const logPath = path.join(process.env.TMPDIR || os.tmpdir(), "claw-dev-gui.log");
const serverEntry = path.join(repoRoot, "src", "guiServer.ts");
const tsxEntry = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

const args = new Set(process.argv.slice(2));

const nodePath = resolveNodePath();
if (!nodePath) {
  process.stderr.write("Could not find Node.js to start the Claw Dev GUI.\n");
  process.exit(1);
}

const wasHealthy = await isGuiHealthy();
if (!wasHealthy) {
  await startGuiDetached(nodePath);
  await waitForGui();
}

if (args.has("--open")) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [guiUrl], { detached: true, stdio: "ignore", shell: process.platform === "win32" });
}

process.stdout.write(`${guiUrl}\n`);

function resolveNodePath() {
  if (process.execPath) {
    return process.execPath;
  }

  const candidates = [
    process.env.NODE_BIN,
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/opt/homebrew/bin/nodejs",
    "/usr/bin/node",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return candidate;
    } catch {}
  }

  return "";
}

async function isGuiHealthy() {
  try {
    const response = await fetch(guiUrl, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

async function startGuiDetached(nodeBinary) {
  await mkdir(path.dirname(logPath), { recursive: true }).catch(() => {});
  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`[${new Date().toISOString()}] Ensuring Claw Dev GUI runtime.\n`);

  const child = spawn(nodeBinary, [tsxEntry, serverEntry], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CLAW_GUI_PORT: String(guiPort),
    },
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  child.unref();
}

async function waitForGui() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isGuiHealthy()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  process.stderr.write(`Claw Dev GUI did not respond at ${guiUrl}.\n`);
  process.exit(1);
}
