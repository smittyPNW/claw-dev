import test from "node:test";
import assert from "node:assert/strict";

import { __resetUpdateCacheForTests, getUpdateCheckState, installAvailableUpdate } from "../dist/guiUpdate.js";

test("getUpdateCheckState reports a fast-forward update from GitHub", async () => {
  __resetUpdateCacheForTests();

  const exec = async (_file, args) => {
    const key = args.join(" ");
    const outputs = {
      "remote get-url origin": "https://github.com/smittyPNW/claw-dev.git\n",
      "branch --show-current": "main\n",
      "rev-parse HEAD": "1111111\n",
      "status --porcelain": "",
      "show HEAD:package.json": '{"version":"0.1.0"}\n',
      "fetch origin main --quiet": "",
      "rev-parse origin/main": "2222222\n",
      "rev-list --left-right --count HEAD...origin/main": "0 3\n",
      "show origin/main:package.json": '{"version":"0.2.0"}\n',
    };

    if (!(key in outputs)) {
      throw new Error(`unexpected command: ${key}`);
    }

    return { stdout: outputs[key], stderr: "" };
  };

  const result = await getUpdateCheckState({
    cwd: "/mock/repo",
    exec,
    forceRefresh: true,
  });

  assert.equal(result.status, "update-available");
  assert.equal(result.canInstall, true);
  assert.equal(result.behindCount, 3);
  assert.equal(result.currentVersion, "0.1.0");
  assert.equal(result.remoteVersion, "0.2.0");
});

test("getUpdateCheckState blocks install when the repo is dirty", async () => {
  __resetUpdateCacheForTests();

  const exec = async (_file, args) => {
    const key = args.join(" ");
    const outputs = {
      "remote get-url origin": "https://github.com/smittyPNW/claw-dev.git\n",
      "branch --show-current": "main\n",
      "rev-parse HEAD": "1111111\n",
      "status --porcelain": " M index.html\n",
      "show HEAD:package.json": '{"version":"0.1.0"}\n',
      "fetch origin main --quiet": "",
      "rev-parse origin/main": "2222222\n",
      "rev-list --left-right --count HEAD...origin/main": "0 1\n",
      "show origin/main:package.json": '{"version":"0.2.0"}\n',
    };

    if (!(key in outputs)) {
      throw new Error(`unexpected command: ${key}`);
    }

    return { stdout: outputs[key], stderr: "" };
  };

  const result = await getUpdateCheckState({
    cwd: "/mock/repo",
    exec,
    forceRefresh: true,
  });

  assert.equal(result.status, "dirty");
  assert.equal(result.canInstall, false);
  assert.match(result.nextAction, /Commit or stash local changes/i);
});

test("installAvailableUpdate fast-forwards and refreshes dependencies when package files changed", async () => {
  __resetUpdateCacheForTests();
  let head = "1111111";

  const exec = async (file, args) => {
    const key = `${file} ${args.join(" ")}`;

    if (key === "git remote get-url origin") return { stdout: "https://github.com/smittyPNW/claw-dev.git\n", stderr: "" };
    if (key === "git branch --show-current") return { stdout: "main\n", stderr: "" };
    if (key === "git rev-parse HEAD") return { stdout: `${head}\n`, stderr: "" };
    if (key === "git status --porcelain") return { stdout: "", stderr: "" };
    if (key === "git show HEAD:package.json") return { stdout: '{"version":"0.1.0"}\n', stderr: "" };
    if (key === "git fetch origin main --quiet") return { stdout: "", stderr: "" };
    if (key === "git rev-parse origin/main") return { stdout: "2222222\n", stderr: "" };
    if (key === "git rev-list --left-right --count HEAD...origin/main") return { stdout: "0 1\n", stderr: "" };
    if (key === "git show origin/main:package.json") return { stdout: '{"version":"0.2.0"}\n', stderr: "" };
    if (key === "git pull --ff-only origin main") {
      head = "2222222";
      return { stdout: "Updating 1111111..2222222\n", stderr: "" };
    }
    if (key === "git diff --name-only 1111111..2222222") {
      return { stdout: "package.json\npackage-lock.json\nsrc/guiServer.ts\n", stderr: "" };
    }
    if (key === "git show 2222222:package.json") return { stdout: '{"version":"0.2.0"}\n', stderr: "" };
    if (key === "npm install --no-fund --no-audit") return { stdout: "installed\n", stderr: "" };

    throw new Error(`unexpected command: ${key}`);
  };

  const result = await installAvailableUpdate({
    cwd: "/mock/repo",
    exec,
  });

  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.equal(result.beforeSha, "1111111");
  assert.equal(result.afterSha, "2222222");
  assert.equal(result.currentVersion, "0.2.0");
  assert.equal(result.previousVersion, "0.1.0");
  assert.equal(result.ranNpmInstall, true);
  assert.equal(result.requiresRestart, true);
});
