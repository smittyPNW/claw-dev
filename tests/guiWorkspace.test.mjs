import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { preparePythonWorkspaceRun } from "../dist/guiWorkspace.js";

test("preparePythonWorkspaceRun rejects paths that escape the workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "claw-dev-workspace-"));

  try {
    await assert.rejects(
      () => preparePythonWorkspaceRun(workspaceRoot, "../outside.py"),
      /Path escapes workspace/i,
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("preparePythonWorkspaceRun does not treat local modules as pip dependencies", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "claw-dev-workspace-"));

  try {
    await fs.writeFile(path.join(workspaceRoot, "local_helper.py"), "VALUE = 1\n", "utf8");
    await fs.writeFile(
      path.join(workspaceRoot, "app.py"),
      "import local_helper\nimport totally_not_a_real_package_name_123\nprint(local_helper.VALUE)\n",
      "utf8",
    );

    const state = await preparePythonWorkspaceRun(workspaceRoot, "app.py");

    assert.equal(state.createdVenv, false);
    assert.match(state.runCommand, /app\.py/);
    assert.deepEqual(state.missingModules, ["totally_not_a_real_package_name_123"]);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
