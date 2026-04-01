import React, { useCallback, useMemo, useState } from "react";
import { Box, Newline, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

import type { CodingAgent } from "./agent.js";
import { toolDefinitions } from "./tools.js";
import type { ProviderName } from "./providers.js";

type StartReplOptions = {
  provider: ProviderName;
  model: string;
  cwd: string;
};

type ChatEntry = {
  role: "system" | "user" | "assistant";
  text: string;
};

function titleForProvider(provider: ProviderName): string {
  switch (provider) {
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
      "Workflow",
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
      <Text color="gray" italic>
        Esc or Ctrl+C to exit
      </Text>
      <Box marginTop={1} borderStyle="round" borderColor="#d97757" flexDirection="column" paddingX={1} paddingY={1}>
        <Text color="#ff9c73">
          {titleForProvider(options.provider)} v0.2
        </Text>
        <Text color="gray">{subtitleForProvider(options.provider)}</Text>
        <Box marginTop={1}>
          <Box width="50%" flexDirection="column" paddingRight={2}>
            <Text bold>Session Ready</Text>
            <Text>
              Backend: {options.provider} · Model: {options.model}
            </Text>
            <Text>CWD: {options.cwd}</Text>
            <Text color="#ff9c73">
              {"  /\\_/\\\\\n ( o.o )\n  > ^ <"}
            </Text>
          </Box>
          <Box width="50%" flexDirection="column" borderLeft paddingLeft={2}>
            {sidebarLines.map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </Box>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Interactive coding session with local tools. Use /help for commands.</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {entries.slice(-10).map((entry, index) => (
          <Box key={`${entry.role}-${index}`} marginBottom={1} flexDirection="column">
            <Text color={entry.role === "user" ? "cyan" : entry.role === "assistant" ? "green" : "yellow"}>
              {entry.role === "user" ? ">" : entry.role === "assistant" ? "└" : "i"} {entry.role}
            </Text>
            <Text>{entry.text}</Text>
          </Box>
        ))}
      </Box>
      {isBusy ? (
        <Text color="gray">
          thinking...
          <Newline />
        </Text>
      ) : null}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">{"> "}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Commands: /help /tools /status /clear /exit</Text>
      </Box>
    </Box>
  );
}

export async function startRepl(agent: CodingAgent, options: StartReplOptions): Promise<void> {
  const instance = render(<App agent={agent} options={options} />);
  await instance.waitUntilExit();
}
