import { spawn } from "node:child_process";

import React, { useCallback, useMemo, useState } from "react";
import { Box, Newline, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

import type { CodingAgent } from "./agent.js";
import { toolDefinitions } from "./tools.js";
import type { ProviderName, TurnEvent } from "./providers.js";

const TUI_THEME = {
  shellTint: "#d8f1ff",
  shellText: "#08263d",
  border: "#7bc8f6",
  accent: "#3aa7e3",
  accentSoft: "#9ddcff",
  user: "#4bb8f0",
  assistant: "#7fd7a6",
  system: "#ffd37b",
  muted: "#8bb9d4",
};

const ASCII_BANNER = [
  "   ________                ____            ",
  "  / ____/ /___ __      __ / __ \\___ _   __ ",
  " / /   / / __ `/ | /| / // / / / _ \\ | / / ",
  "/ /___/ / /_/ /| |/ |/ // /_/ /  __/ |/ /  ",
  "\\____/_/\\__,_/ |__/|__/ \\____/\\___/|___/   ",
];

type StartReplOptions = {
  provider: ProviderName;
  model: string;
  cwd: string;
  guiUrl: string;
};

type ChatEntry = {
  role: "system" | "user" | "assistant";
  text: string;
};

function titleForProvider(provider: ProviderName): string {
  switch (provider) {
    case "openai":
      return "Claw Dev for ChatGPT";
    case "gemini":
      return "Claw Dev for Gemini";
    case "openrouter":
      return "Claw Dev for OpenRouter";
    case "ollama":
      return "Claw Dev for Ollama";
    default:
      return "Claw Dev for Anthropic";
  }
}

function subtitleForProvider(provider: ProviderName): string {
  switch (provider) {
    case "openai":
      return "Saved ChatGPT auth or OpenAI API key with local tool execution";
    case "openrouter":
      return "Hosted multi-model routing with local tool execution";
    case "ollama":
      return "Local model runtime with local tool execution";
    case "gemini":
      return "Google Gemini-backed coding loop";
    default:
      return "Anthropic-backed coding loop";
  }
}

function badgeLabelForProvider(provider: ProviderName): string {
  switch (provider) {
    case "openai":
      return "ChatGPT Codex";
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    case "gemini":
      return "Gemini";
    default:
      return "Anthropic";
  }
}

function App({ agent, options }: { agent: CodingAgent; options: StartReplOptions }) {
  const { exit } = useApp();
  const [entries, setEntries] = useState<ChatEntry[]>([
    {
      role: "system",
      text: "Ready. Ask naturally, or use /help, /tools, /clear, /exit.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [liveStatus, setLiveStatus] = useState("Ready to code.");
  const [lastToolNote, setLastToolNote] = useState("No tools used yet.");

  useInput((input, key) => {
    if (key.escape && !isBusy) {
      exit();
    }
    if (key.ctrl && input === "c") {
      exit();
    }
  });

  const sidebarLines = useMemo(
    () => [
      "/help command list",
      "/tools local tool catalog",
      "/status provider, model, cwd",
      "/gui open the browser workspace",
      "/clear reset session memory",
    ],
    [],
  );

  const submit = useCallback(
    async (value: string) => {
      const line = value.trim();
      if (!line || isBusy) {
        return;
      }

      setInput("");

      if (line === "/exit") {
        exit();
        return;
      }

      if (line === "/clear" || line === "/reset") {
        agent.clear();
        setEntries([
          {
            role: "system",
            text: "Conversation cleared.",
          },
        ]);
        return;
      }

      if (line === "/help") {
        setEntries((current) => [
          ...current,
          { role: "user", text: line },
          {
            role: "system",
            text: ["/help", "/tools", "/status", "/gui", "/clear", "/exit"].join("\n"),
          },
        ]);
        return;
      }

      if (line === "/status") {
        setEntries((current) => [
          ...current,
          { role: "user", text: line },
          {
            role: "system",
            text: `Provider: ${options.provider}\nModel: ${options.model}\nCWD: ${options.cwd}`,
          },
        ]);
        return;
      }

      if (line === "/tools") {
        setEntries((current) => [
          ...current,
          { role: "user", text: line },
          {
            role: "system",
            text: toolDefinitions.map((tool) => `${tool.name}: ${tool.description}`).join("\n"),
          },
        ]);
        return;
      }

      if (line === "/gui") {
        openGui(options.guiUrl);
        setEntries((current) => [
          ...current,
          { role: "user", text: line },
          {
            role: "system",
            text: `Opened GUI: ${options.guiUrl}`,
          },
        ]);
        return;
      }

      setEntries((current) => [...current, { role: "user", text: line }]);
      setIsBusy(true);
      setLiveStatus("Thinking...");
      setLastToolNote("Waiting on model response.");

      try {
        const result = await agent.runTurn(line, (event) => {
          handleTurnEvent(event, setLiveStatus, setLastToolNote);
        });
        setEntries((current) => [
          ...current,
          {
            role: "assistant",
            text: result.text || "(empty response)",
          },
        ]);
      } catch (error) {
        setEntries((current) => [
          ...current,
          {
            role: "system",
            text: error instanceof Error ? error.message : String(error),
          },
        ]);
        setLiveStatus("Request failed.");
      } finally {
        setIsBusy(false);
        setLiveStatus((current) => (current === "Request failed." ? current : "Ready for the next turn."));
      }
    },
    [agent, exit, isBusy],
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor={TUI_THEME.border} flexDirection="column" paddingX={1} paddingY={1}>
        <Box justifyContent="space-between">
          <Text color={TUI_THEME.muted}>Esc or Ctrl+C to exit</Text>
          <Text color={TUI_THEME.assistant}>GUI {options.guiUrl}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {ASCII_BANNER.map((line) => (
            <Text key={line} color={TUI_THEME.accent}>
              {line}
            </Text>
          ))}
        </Box>
        <Box justifyContent="space-between" marginTop={1}>
          <Text backgroundColor={TUI_THEME.shellTint} color={TUI_THEME.shellText}>
            {" "}
            {badgeLabelForProvider(options.provider)}
            {" "}
          </Text>
          <Text color={isBusy ? TUI_THEME.system : TUI_THEME.assistant}>{isBusy ? "busy" : "ready"}</Text>
        </Box>
        <Box marginTop={1} justifyContent="space-between">
          <Box flexDirection="column" width="58%">
            <Text color={TUI_THEME.accent}>{titleForProvider(options.provider)} v0.3</Text>
            <Text color={TUI_THEME.muted}>{subtitleForProvider(options.provider)}</Text>
          </Box>
          <Box flexDirection="column" width="42%">
            <Text color={TUI_THEME.accentSoft}>Model {options.model}</Text>
            <Text color={TUI_THEME.accentSoft}>Workspace {options.cwd}</Text>
          </Box>
        </Box>
        <Box marginTop={1} borderStyle="single" borderColor={TUI_THEME.border} paddingX={1} paddingY={0}>
          <Box width="55%" flexDirection="column" paddingRight={2}>
            <Text color={TUI_THEME.system}>Status</Text>
            <Text color={TUI_THEME.accentSoft}>{liveStatus}</Text>
            <Text color={TUI_THEME.muted}>{lastToolNote}</Text>
          </Box>
          <Box width="45%" flexDirection="column" borderLeft borderColor={TUI_THEME.border} paddingLeft={2}>
            <Text color={TUI_THEME.system}>Commands</Text>
            {sidebarLines.map((line, index) => (
              <Text key={`${line}-${index}`} color={TUI_THEME.accentSoft}>
                {line}
              </Text>
            ))}
          </Box>
        </Box>
      </Box>
      <Box marginTop={1} borderStyle="round" borderColor={TUI_THEME.border} flexDirection="column" paddingX={1} paddingY={0}>
        <Text color={TUI_THEME.system}>Transcript</Text>
        {entries.slice(-10).map((entry, index) => (
          <Box key={`${entry.role}-${index}`} marginBottom={1} flexDirection="column">
            <Text
              color={
                entry.role === "user"
                  ? TUI_THEME.user
                  : entry.role === "assistant"
                    ? TUI_THEME.assistant
                    : TUI_THEME.system
              }
            >
              {entry.role === "user" ? ">" : entry.role === "assistant" ? "└" : "i"} {entry.role}
            </Text>
            <Text color={TUI_THEME.accentSoft}>{entry.text}</Text>
          </Box>
        ))}
      </Box>
      {isBusy ? (
        <Text color={TUI_THEME.muted}>
          thinking...
          <Newline />
        </Text>
      ) : null}
      <Box marginTop={1} borderStyle="round" borderColor={TUI_THEME.border} flexDirection="column" paddingX={1} paddingY={0}>
        <Text color={TUI_THEME.system}>Compose</Text>
        <Box>
        <Text color={TUI_THEME.accent}>{"> "}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text backgroundColor={TUI_THEME.shellTint} color={TUI_THEME.shellText}>
          {" Commands: /help /tools /status /gui /clear /exit "}
        </Text>
      </Box>
    </Box>
  );
}

export async function startRepl(agent: CodingAgent, options: StartReplOptions): Promise<void> {
  const instance = render(<App agent={agent} options={options} />);
  await instance.waitUntilExit();
}

function handleTurnEvent(
  event: TurnEvent,
  setLiveStatus: React.Dispatch<React.SetStateAction<string>>,
  setLastToolNote: React.Dispatch<React.SetStateAction<string>>,
): void {
  if (event.type === "status") {
    setLiveStatus(event.message);
    return;
  }

  if (event.type === "tool_start") {
    setLastToolNote(`Tool ${event.toolName} started${event.inputSummary ? ` · ${event.inputSummary}` : ""}`);
    return;
  }

  setLastToolNote(
    `${event.toolName} ${event.isError ? "failed" : "finished"}${event.contentPreview ? ` · ${event.contentPreview}` : ""}`,
  );
}

function openGui(url: string): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
}
