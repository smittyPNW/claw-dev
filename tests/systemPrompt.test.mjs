import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildClawDevSystemPrompt } from "../dist/systemPrompt.js";

test("buildClawDevSystemPrompt includes workspace, tooling, and Claw Dev identity", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "claw-dev-prompt-"));

  try {
    await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "demo" }), "utf8");
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "README.md"), "# Demo\n", "utf8");

    const prompt = await buildClawDevSystemPrompt({
      cwd: workspace,
      provider: "openai",
      model: "gpt-5.2-codex",
    });

    assert.match(prompt, /You are Claw Dev, an expert software engineering and coding agent/i);
    assert.match(prompt, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(prompt, /Provider: openai/);
    assert.match(prompt, /Model: gpt-5\.2-codex/);
    assert.match(prompt, /Available tools:/);
    assert.match(prompt, /write_file: Create or fully replace a UTF-8 text file/i);
    assert.match(prompt, /Project markers: .*package\.json.*README\.md.*src/i);
    assert.match(prompt, /use write_file to create a real file in the workspace/i);
    assert.match(prompt, /Do not leave the implementation stranded in markdown/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
