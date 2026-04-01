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
