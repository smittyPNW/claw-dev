import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { toolHandlers } from "../dist/tools.js";

test("write_file rejects sibling-prefix paths outside the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "claw-dev-tools-"));
  const workspace = join(root, "app");
  const sibling = join(root, "app-evil");

  await mkdir(workspace, { recursive: true });
  await mkdir(sibling, { recursive: true });

  try {
    await assert.rejects(
      () => toolHandlers.write_file({ path: "../app-evil/payload.txt", content: "bad" }, workspace),
      /Path escapes working directory/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read_file allows normal in-workspace paths", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "claw-dev-tools-read-"));

  try {
    await writeFile(join(workspace, "hello.txt"), "hello world", "utf8");
    const result = await toolHandlers.read_file({ path: "hello.txt" }, workspace);
    assert.equal(result.content, "hello world");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
