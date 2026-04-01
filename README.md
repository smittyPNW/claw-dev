# Claw Dev

![Claw Dev cover art](assets/readme/claw-dev-cover.jpg)

Claw Dev is a coding workspace with three real surfaces:

- a browser GUI
- a terminal coding interface
- a Telegram bot

It is built around one shared agent core so model selection, local tools, and provider behavior stay consistent across all three.

## Highlights

- ChatGPT Codex as the preferred OpenAI path when saved auth exists on the machine
- OpenRouter integration with live free-model refresh and strong free-model defaults
- Ollama integration with local runtime detection and installed-model discovery
- Telegram bot integration with token-first setup and managed bot start/stop
- macOS GUI service support through LaunchAgent
- desktop shortcut support on macOS through an explicit setup step
- local update checks against GitHub when the workspace is clean

## Surfaces

### GUI

Use the browser GUI for:

- provider setup
- model selection
- session control
- Ollama runtime status
- Telegram setup
- update checks

Launch it with:

```bash
npm run gui
```

### TUI

Use the terminal interface for focused local coding work.

Launch it with:

```bash
npm run tui
```

You can also run one-shot prompts:

```bash
npm run dev -- "summarize this repo"
```

### Telegram

Use the Telegram bot when you want the same coding engine available remotely.

Launch it with:

```bash
npm run telegram
```

Core commands:

- `/help`
- `/status`
- `/reset`
- `/provider openai`
- `/model gpt-5.2-codex`
- `/cwd /path/to/workspace`

## Providers

Claw Dev currently supports:

- OpenAI / ChatGPT Codex
- OpenRouter
- Ollama
- Anthropic
- Gemini

### OpenAI / ChatGPT Codex

Claw Dev prefers reusable local ChatGPT/Codex auth when available. If that is not present, it can fall back to `OPENAI_API_KEY`.

### OpenRouter

OpenRouter is treated as a first-class path with:

- free-model heartbeat refresh
- provider-qualified model ids
- curated free-model defaults

### Ollama

Ollama is treated as a first-class local path with:

- runtime detection
- installed-model discovery
- GUI setup for base URL
- coding-friendly local model choices

## Install

Requirements:

- Node.js 22+
- npm

Install dependencies:

```bash
npm install
```

## macOS Setup

Claw Dev does not silently install macOS services or Desktop shortcuts during a normal install.

When you want the full local app setup on macOS, run:

```bash
npm run setup:macos
```

That installs:

- the LaunchAgent-backed GUI service
- the Desktop shortcut

## Scripts

```bash
npm run gui
npm run gui:start
npm run gui:stop
npm run gui:status

npm run tui
npm run dev -- --interactive

npm run telegram
npm run telegram:start
npm run telegram:stop
npm run telegram:status

npm run check
npm test
```

## Repository Layout

- `src/`
  - application source
- `scripts/`
  - GUI, Telegram, Desktop, and macOS service helpers
- `shared/`
  - shared auth and provider helpers
- `tests/`
  - regression and integration-oriented tests
- `index.html`
  - browser GUI

## Notes

- The browser GUI is served locally at `http://127.0.0.1:4310` by default.
- Telegram readiness now means both valid bot auth and a live bot process.
- Telegram settings can be updated without re-entering the stored token unless you are rotating it.
