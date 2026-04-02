const fs = require("node:fs");
const path = require("node:path");

const cliPath = path.join(__dirname, "package", "cli.js");

if (!fs.existsSync(cliPath)) {
  console.error(`Bundle not found: ${cliPath}`);
  process.exit(1);
}

let source = fs.readFileSync(cliPath, "utf8");
const original = source;

const replacements = [
  ["Welcome to Claude Code", "Welcome to Claw Dev"],
  ["Claude Code", "Claw Dev"],
  ['name("claude")', 'name("claw-dev")'],
  ["name('claude')", "name('claw-dev')"],
  ["Usage: claude [options] [command] [prompt]", "Usage: claw-dev [options] [command] [prompt]"],
  ["`claude`", "`claw-dev`"],
  ["claude --", "claw-dev --"],
  ["claude ssh ", "claw-dev ssh "],
  ["claude --teleport ", "claw-dev --teleport "],
  ["claude --remote ", "claw-dev --remote "],
  ["claude.ai/code", "Claw Dev remote session"],
  ["Claude Desktop", "Claw Dev Desktop"],
  ["Claude mobile app", "Claw Dev mobile app"],
  ["Claude in Chrome", "Claw Dev in Chrome"],
  ["Install the Claude Slack app", "Install the Claw Dev Slack app"],
  ["Manage Claude Code plugins", "Manage Claw Dev plugins"],
  ["Manage Claude Code marketplaces", "Manage Claw Dev marketplaces"],
  ["Install Claude Code native build", "Install Claw Dev native build"],
  ["Claude Code installation completed successfully", "Claw Dev installation completed successfully"],
  ["Claude Code installation failed", "Claw Dev installation failed"],
  ["Installing Claude Code native build", "Installing Claw Dev native build"],
  ["Claude Code successfully installed!", "Claw Dev successfully installed!"],
  ["Diagnose and verify your Claude Code installation and settings", "Diagnose and verify your Claw Dev installation and settings"],
  ["Check the health of your Claude Code auto-updater.", "Check the health of your Claw Dev auto-updater."],
  ["Submit feedback about Claude Code", "Submit feedback about Claw Dev"],
  ["Start a Claude Code MCP server", "Start a Claw Dev MCP server"],
  ["Start a Claude Code session server", "Start a Claw Dev session server"],
  ["Connect to a Claude Code server", "Connect to a Claw Dev server"],
  ["Run Claude Code on a remote host over SSH.", "Run Claw Dev on a remote host over SSH."],
  ["Open in Claude Code on the web", "Open in Claw Dev on the web"],
  ["Review in Claude Code on the web", "Review in Claw Dev on the web"],
  ["Runs in Claude Code on the web.", "Runs in Claw Dev on the web."],
  ["Loading Claude Code sessions…", "Loading Claw Dev sessions…"],
  ["Fetching your Claude Code sessions…", "Fetching your Claw Dev sessions…"],
  ["Error loading Claude Code sessions", "Error loading Claw Dev sessions"],
  ["No Claude Code sessions found", "No Claw Dev sessions found"],
  ["Sorry, Claude Code encountered an error", "Sorry, Claw Dev encountered an error"],
  ["Claude Code needs your approval for the plan", "Claw Dev needs your approval for the plan"],
  ["Claude Code wants to enter plan mode", "Claw Dev wants to enter plan mode"],
  ["Claude Code needs your attention", "Claw Dev needs your attention"],
  ["Claude Code needs your input", "Claw Dev needs your input"],
  ["Claude Code will", "Claw Dev will"],
  ["Claude Code won't", "Claw Dev won't"],
  ["restart Claude Code", "restart Claw Dev"],
  ["Use your existing Claude ", "Use your existing "],
  [" with Claude Code", " with Claw Dev"],
  [
    "Switch between Claude models. Applies to this session and future Claude Code sessions. For other/previous model names, specify with --model.",
    "Switch between available models. Applies to this session and future Claw Dev sessions. For other or custom model names, specify with --model.",
  ],
  ["Claude Opus 4.6", "Claw Dev Opus Slot"],
  ["Claude Sonnet 4.6", "Claw Dev Sonnet Slot"],
  ["Claude Haiku 4.5", "Claw Dev Haiku Slot"],
  [
    "Claude Code has switched from npm to native installer. Run `claude install` or see https://docs.anthropic.com/en/docs/claude-code/getting-started",
    "Claw Dev is running through the local multi-provider launcher.",
  ],
  ["Opus 4.6", "Opus Slot"],
  ["Sonnet 4.6", "Sonnet Slot"],
  ["Haiku 4.5", "Haiku Slot"],
  ["Sonnet 4.5", "Sonnet Slot"],
  ["Sonnet 4", "Sonnet Slot"],
  ["Opus 4.1", "Opus Slot"],

  // Clawd mini mascot in the startup panel.
  ["▛███▜", "CLAWD"],
  ["▟███▟", "CLAWD"],
  ["▙███▙", "CLAWD"],
  ["█████", " DEV "],
  ["▘▘ ▝▝", "     "],

  // Larger welcome art variants.
  [" █████████ ", "  CLAWDEV  "],
  ["██▄█████▄██", " [CLAWDEV] "],
  ["█ █   █ █", " CLAW DEV "],
];

for (const [from, to] of replacements) {
  source = source.split(from).join(to);
}

if (source !== original) {
  fs.writeFileSync(cliPath, source, "utf8");
  console.log("Applied local Claw Dev branding patch.");
} else {
  console.log("Branding patch already applied or no matching strings found.");
}
