import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ProviderName } from "./providers.js";
import { toolDefinitions } from "./tools.js";

const execFileAsync = promisify(execFile);

const BASE_SYSTEM_PROMPT = `
You are Claw Dev, an expert software engineering and coding agent.
You are not a generic chatbot. You are expected to inspect code, reason about the workspace, make edits, run commands when helpful, and move implementation tasks forward.
Default to action when the user's request is concrete.
Prefer inspecting the relevant files before editing when repository context matters.
Use the workspace as the source of truth and stay within it.
When you use tools, keep inputs precise and minimal.
When you create or modify code, choose sensible file paths if the user does not specify one.
After writing code, validate it with an appropriate command when that is practical and low-risk.
When tools are available and the user asks for code, prefer creating or updating real workspace files with write_file instead of only pasting code into chat.
If you produce runnable code, prefer writing the file and then validating or running it rather than stopping at an explanation.
Do not ask broad follow-up questions when the intent is already clear.
Only ask for clarification if a missing detail would materially risk doing the wrong work.
When reporting back, be concise and clearly mention any files you created or changed.
`.trim();

export async function buildClawDevSystemPrompt(args: {
  cwd: string;
  provider: ProviderName;
  model: string;
}): Promise<string> {
  const workspace = await summarizeWorkspace(args.cwd);
  const tools = toolDefinitions
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  return [
    BASE_SYSTEM_PROMPT,
    "",
    "Claw Dev runtime:",
    `- Provider: ${args.provider}`,
    `- Model: ${args.model}`,
    `- Platform: ${process.platform}`,
    `- Shell: ${process.env.SHELL || defaultShellLabel()}`,
    `- Workspace root: ${args.cwd}`,
    "",
    "Workspace snapshot:",
    ...workspace,
    "",
    "Available tools:",
    tools,
    "",
    "Coding behavior rules:",
    "- Read the workspace before changing it when there is any existing code to build on.",
    "- For new programs or features, write the file directly instead of stopping at a description.",
    "- When the user asks you to create code, use write_file to create a real file in the workspace unless the user explicitly asked for a chat-only sketch.",
    "- Do not leave the implementation stranded in markdown when tools are available. Create the file, then explain what you did.",
    "- Use search_text to find implementation paths, list_files to orient, read_file to inspect, write_file to create/update, and run_shell to validate.",
    "- Treat the environment as real and local: files you write and commands you run affect the selected workspace.",
    "- If the user asks for code, prefer producing working code over discussion.",
  ].join("\n");
}

async function summarizeWorkspace(cwd: string): Promise<string[]> {
  const lines: string[] = [];
  const markers = await detectProjectMarkers(cwd);
  const topLevel = await listTopLevelEntries(cwd);
  const git = await detectGitState(cwd);

  if (markers.length > 0) {
    lines.push(`- Project markers: ${markers.join(", ")}`);
  }

  if (git) {
    lines.push(`- Git: ${git}`);
  }

  if (topLevel.length > 0) {
    lines.push(`- Top-level entries: ${topLevel.join(", ")}`);
  }

  if (lines.length === 0) {
    lines.push("- Workspace looks empty or could not be summarized.");
  }

  return lines;
}

async function detectProjectMarkers(cwd: string): Promise<string[]> {
  const candidates = [
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "README.md",
    "tests",
    "src",
    ".claude",
    "Leonxlnx-claude-code",
  ];

  const found: string[] = [];

  for (const candidate of candidates) {
    try {
      await fs.stat(path.join(cwd, candidate));
      found.push(candidate);
    } catch {
      continue;
    }
  }

  return found;
}

async function listTopLevelEntries(cwd: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith(".git"))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 14)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  } catch {
    return [];
  }
}

async function detectGitState(cwd: string): Promise<string | null> {
  try {
    const branch = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const status = await runGit(cwd, ["status", "--porcelain"]);
    const dirty = status.trim().length > 0 ? "dirty" : "clean";
    return `${branch.trim()} (${dirty})`;
  } catch {
    return null;
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 256 * 1024 });
  return stdout;
}

function defaultShellLabel(): string {
  if (process.platform === "win32") {
    return "powershell.exe";
  }

  return os.platform() === "darwin" ? "/bin/zsh" : "/bin/sh";
}
