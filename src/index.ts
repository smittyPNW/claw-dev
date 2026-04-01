import path from "node:path";

import pc from "picocolors";

import { CodingAgent } from "./agent.js";
import { startRepl } from "./cli.js";
import { loadConfig } from "./config.js";
import { toolDefinitions } from "./tools.js";

type ParsedArgs = {
  cwd: string;
  provider?: "anthropic" | "gemini" | "openai" | "openrouter" | "ollama";
  model?: string;
  prompt?: string;
  showHelp: boolean;
  showTools: boolean;
};

function printHelp(): void {
  process.stdout.write(`Claw Dev\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  npm run dev\n`);
  process.stdout.write(`  npm run dev -- "summarize this project"\n`);
  process.stdout.write(`  npm run dev -- --provider openai --model gpt-5-mini "review this repo"\n`);
  process.stdout.write(`  npm run dev -- --provider openrouter --model anthropic/claude-sonnet-4 "review this repo"\n`);
  process.stdout.write(`  npm run dev -- --provider ollama --model qwen3 --cwd E:\\\\repo "inspect this project"\n\n`);
  process.stdout.write(`Flags:\n`);
  process.stdout.write(`  --help   Show this help text\n`);
  process.stdout.write(`  --tools  List available local tools\n`);
  process.stdout.write(`  --cwd    Set the workspace root\n`);
  process.stdout.write(`  --provider  Choose anthropic, gemini, openai, openrouter, or ollama\n`);
  process.stdout.write(`  --model  Override the model for the chosen provider\n`);
}

function printTools(): void {
  process.stdout.write(`Available tools:\n`);
  for (const tool of toolDefinitions) {
    process.stdout.write(`- ${tool.name}: ${tool.description}\n`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  let cwd = process.cwd();
  let provider: "anthropic" | "gemini" | "openai" | "openrouter" | "ollama" | undefined;
  let model: string | undefined;
  const promptParts: string[] = [];
  let showHelp = false;
  let showTools = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help") {
      showHelp = true;
      continue;
    }
    if (arg === "--tools") {
      showTools = true;
      continue;
    }
    if (arg === "--cwd") {
      cwd = path.resolve(argv[i + 1] ?? cwd);
      i += 1;
      continue;
    }
    if (arg === "--provider") {
      const next = argv[i + 1];
      if (next === "anthropic" || next === "gemini" || next === "openai" || next === "openrouter" || next === "ollama") {
        provider = next;
      }
      i += 1;
      continue;
    }
    if (arg === "--model") {
      model = argv[i + 1];
      i += 1;
      continue;
    }
    promptParts.push(arg);
  }

  const parsed: ParsedArgs = { cwd, showHelp, showTools };
  if (provider !== undefined) {
    parsed.provider = provider;
  }
  if (model !== undefined) {
    parsed.model = model;
  }
  if (promptParts.length > 0) {
    parsed.prompt = promptParts.join(" ");
  }
  return parsed;
}

async function main(): Promise<void> {
  const { cwd, provider, model, prompt, showHelp, showTools } = parseArgs(process.argv.slice(2));
  if (showHelp) {
    printHelp();
    return;
  }
  if (showTools) {
    printTools();
    return;
  }
  const config = loadConfig({
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
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

  if (prompt) {
    const result = await agent.runTurn(prompt);
    process.stdout.write(`${result.text}\n`);
    return;
  }

  await startRepl(agent, {
    provider: config.provider,
    model: config.model,
    cwd,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${pc.red(`Error: ${message}`)}\n`);
  process.exitCode = 1;
});
