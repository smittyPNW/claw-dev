import React, { useCallback, useMemo, useState } from "react";
import { Box, Newline, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

import type { CodingAgent } from "./agent.js";
import { toolDefinitions } from "./tools.js";
import type { ProviderName } from "./providers.js";

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
  "  ______ _                    ____             ",
  " / ____/| |                  / __ \\___ _   __ ",
  "/ /     | |    __ ___      _/ / / / _ \\ | / / ",
  "\\ \\___  | |___/ //_/ |/|/ / /_/ /  __/ |/ /  ",
  " \\____/ |_____/_,_/|__,__/_____/\\___/|___/   ",
  "            ChatGPT, OpenRouter, Ollama      ",
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
      "Ask naturally to inspect, search, and edit the workspace.",
      "Use /tools to inspect the available local capabilities.",
      "Use /clear to reset the conversation state.",
      "Use /status to reprint the current backend details.",
      "Use /exit or Esc to quit.",
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

      if (line === "/clear") {
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
            text: ["/help", "/tools", "/status", "/clear", "/exit"].join("\n"),
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

      setEntries((current) => [...current, { role: "user", text: line }]);
      setIsBusy(true);

      try {
        const result = await agent.runTurn(line);
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
      } finally {
        setIsBusy(false);
      }
    },
    [agent, exit, isBusy],
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={TUI_THEME.muted} italic>
        Esc or Ctrl+C to exit
      </Text>
      <Box marginTop={1} borderStyle="round" borderColor={TUI_THEME.border} flexDirection="column" paddingX={1} paddingY={1}>
        <Box flexDirection="column">
          {ASCII_BANNER.map((line) => (
            <Text key={line} color={TUI_THEME.accent}>
              {line}
            </Text>
          ))}
        </Box>
        <Box>
          <Text backgroundColor={TUI_THEME.shellTint} color={TUI_THEME.shellText}>
            {" "}
            {badgeLabelForProvider(options.provider)}
            {" "}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={TUI_THEME.accent}>
            {titleForProvider(options.provider)} v0.2
          </Text>
          <Text color={TUI_THEME.muted}>{subtitleForProvider(options.provider)}</Text>
        </Box>
        <Box marginTop={1}>
          <Box width="52%" flexDirection="column" paddingRight={2}>
            <Text backgroundColor={TUI_THEME.shellTint} color={TUI_THEME.shellText}>
              {" Session Ready "}
            </Text>
            <Text color={TUI_THEME.accentSoft}>
              Backend: {options.provider} · Model: {options.model}
            </Text>
            <Text color={TUI_THEME.accentSoft}>CWD: {options.cwd}</Text>
            <Text color={TUI_THEME.assistant}>GUI: {options.guiUrl}</Text>
            <Text color={TUI_THEME.accent}>
              {"      /\\_/\\\\\n .--. ( o.o )\n(____/  > ^ <"}
            </Text>
          </Box>
          <Box width="48%" flexDirection="column" borderLeft borderColor={TUI_THEME.border} paddingLeft={2}>
            <Text backgroundColor={TUI_THEME.shellTint} color={TUI_THEME.shellText}>
              {" Workflow "}
            </Text>
            {sidebarLines.map((line, index) => (
              <Text key={`${line}-${index}`} color={TUI_THEME.accentSoft}>
                {line}
              </Text>
            ))}
          </Box>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={TUI_THEME.muted}>Interactive coding session with local tools. Use /help for commands.</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
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
      <Box borderStyle="single" borderColor={TUI_THEME.border} paddingX={1}>
        <Text color={TUI_THEME.accent}>{"> "}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} />
      </Box>
      <Box marginTop={1}>
        <Text backgroundColor={TUI_THEME.shellTint} color={TUI_THEME.shellText}>
          {" Commands: /help /tools /status /clear /exit "}
        </Text>
      </Box>
    </Box>
  );
}

export async function startRepl(agent: CodingAgent, options: StartReplOptions): Promise<void> {
  const instance = render(<App agent={agent} options={options} />);
  await instance.waitUntilExit();
}
