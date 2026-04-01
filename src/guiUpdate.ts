import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const UPDATE_CHECK_TTL_MS = 5 * 60 * 1000;

type ExecResult = {
  stdout: string;
  stderr: string;
};

type ExecLike = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<ExecResult>;

type PackageMeta = {
  version: string | null;
};

export type UpdateStatus =
  | "checking"
  | "up-to-date"
  | "update-available"
  | "dirty"
  | "ahead"
  | "diverged"
  | "detached"
  | "error";

export type UpdateCheckState = {
  status: UpdateStatus;
  repoUrl: string | null;
  repoLabel: string | null;
  branch: string | null;
  currentSha: string | null;
  remoteSha: string | null;
  currentVersion: string | null;
  remoteVersion: string | null;
  behindCount: number;
  aheadCount: number;
  hasUncommittedChanges: boolean;
  canInstall: boolean;
  detail: string;
  nextAction: string;
  checkedAt: string;
};

export type InstallUpdateResult = {
  ok: true;
  installed: boolean;
  requiresRestart: boolean;
  beforeSha: string;
  afterSha: string;
  currentVersion: string | null;
  previousVersion: string | null;
  ranNpmInstall: boolean;
  changedFiles: string[];
  detail: string;
};

type UpdateCheckOptions = {
  cwd?: string;
  exec?: ExecLike;
  now?: () => number;
  forceRefresh?: boolean;
};

type InstallUpdateOptions = {
  cwd?: string;
  exec?: ExecLike;
};

type CachedUpdateState = {
  checkedAtMs: number;
  state: UpdateCheckState;
};

let cachedUpdateState: CachedUpdateState | null = null;

export async function getUpdateCheckState(options: UpdateCheckOptions = {}): Promise<UpdateCheckState> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? Date.now;

  if (!options.forceRefresh && cachedUpdateState && now() - cachedUpdateState.checkedAtMs < UPDATE_CHECK_TTL_MS) {
    return cachedUpdateState.state;
  }

  const state = await computeUpdateCheckState({
    cwd,
    exec: options.exec ?? runExecFile,
  });

  cachedUpdateState = {
    checkedAtMs: now(),
    state,
  };

  return state;
}

export async function installAvailableUpdate(options: InstallUpdateOptions = {}): Promise<InstallUpdateResult> {
  const cwd = options.cwd ?? process.cwd();
  const exec = options.exec ?? runExecFile;
  const status = await computeUpdateCheckState({ cwd, exec });

  if (!status.canInstall) {
    throw new Error(status.nextAction);
  }

  const branch = status.branch ?? "main";
  const beforeSha = status.currentSha ?? await git(cwd, ["rev-parse", "HEAD"], exec);
  const previousVersion = status.currentVersion;

  await git(cwd, ["pull", "--ff-only", "origin", branch], exec);

  const afterSha = await git(cwd, ["rev-parse", "HEAD"], exec);
  const changedFilesOutput = beforeSha === afterSha
    ? ""
    : await git(cwd, ["diff", "--name-only", `${beforeSha}..${afterSha}`], exec);
  const changedFiles = changedFilesOutput.split("\n").map((line) => line.trim()).filter(Boolean);
  const ranNpmInstall = changedFiles.some((file) => file === "package.json" || file === "package-lock.json");

  if (ranNpmInstall) {
    await exec(npmCommand(), ["install", "--no-fund", "--no-audit"], { cwd });
  }

  const currentVersion = await getPackageVersionAtRef(cwd, exec, afterSha);
  const detail = afterSha === beforeSha
    ? "No new commit was installed. This workspace is already up to date."
    : ranNpmInstall
      ? "Update installed and dependencies refreshed. Restart the GUI to load the new code."
      : "Update installed. Restart the GUI to load the new code.";

  cachedUpdateState = null;

  return {
    ok: true,
    installed: afterSha !== beforeSha,
    requiresRestart: afterSha !== beforeSha,
    beforeSha,
    afterSha,
    currentVersion,
    previousVersion,
    ranNpmInstall,
    changedFiles,
    detail,
  };
}

async function computeUpdateCheckState(options: { cwd: string; exec: ExecLike }): Promise<UpdateCheckState> {
  const { cwd, exec } = options;
  const checkedAt = new Date().toISOString();

  try {
    const repoUrl = await git(cwd, ["remote", "get-url", "origin"], exec);
    const branch = await git(cwd, ["branch", "--show-current"], exec);
    const currentSha = await git(cwd, ["rev-parse", "HEAD"], exec);
    const dirtyOutput = await git(cwd, ["status", "--porcelain"], exec);
    const hasUncommittedChanges = dirtyOutput.trim().length > 0;
    const currentVersion = await getPackageVersionAtRef(cwd, exec);

    if (!branch) {
      return {
        status: "detached",
        repoUrl,
        repoLabel: formatRepoLabel(repoUrl),
        branch: null,
        currentSha,
        remoteSha: null,
        currentVersion,
        remoteVersion: null,
        behindCount: 0,
        aheadCount: 0,
        hasUncommittedChanges,
        canInstall: false,
        detail: "This workspace is in detached HEAD state, so the updater cannot safely track a branch tip.",
        nextAction: "Check out the main branch before using in-app updates.",
        checkedAt,
      };
    }

    await git(cwd, ["fetch", "origin", branch, "--quiet"], exec);
    const remoteRef = `origin/${branch}`;
    const remoteSha = await git(cwd, ["rev-parse", remoteRef], exec);
    const counts = await git(cwd, ["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`], exec);
    const [aheadRaw = "0", behindRaw = "0"] = counts.trim().split(/\s+/);
    const aheadCount = Number.parseInt(aheadRaw, 10) || 0;
    const behindCount = Number.parseInt(behindRaw, 10) || 0;
    const remoteVersion = await getPackageVersionAtRef(cwd, exec, remoteRef);

    if (hasUncommittedChanges) {
      return {
        status: behindCount > 0 ? "dirty" : "dirty",
        repoUrl,
        repoLabel: formatRepoLabel(repoUrl),
        branch,
        currentSha,
        remoteSha,
        currentVersion,
        remoteVersion,
        behindCount,
        aheadCount,
        hasUncommittedChanges,
        canInstall: false,
        detail: behindCount > 0
          ? "GitHub has a newer version, but this repo has local uncommitted changes. Auto-install is paused to avoid overwriting work."
          : "This repo has local uncommitted changes, so safe in-app update installs are paused until the workspace is clean.",
        nextAction: "Commit or stash local changes before installing updates from GitHub.",
        checkedAt,
      };
    }

    if (aheadCount > 0 && behindCount > 0) {
      return {
        status: "diverged",
        repoUrl,
        repoLabel: formatRepoLabel(repoUrl),
        branch,
        currentSha,
        remoteSha,
        currentVersion,
        remoteVersion,
        behindCount,
        aheadCount,
        hasUncommittedChanges,
        canInstall: false,
        detail: "This workspace has diverged from GitHub, so a fast-forward update is not possible.",
        nextAction: "Reconcile local and remote history manually before using install update here.",
        checkedAt,
      };
    }

    if (aheadCount > 0) {
      return {
        status: "ahead",
        repoUrl,
        repoLabel: formatRepoLabel(repoUrl),
        branch,
        currentSha,
        remoteSha,
        currentVersion,
        remoteVersion,
        behindCount,
        aheadCount,
        hasUncommittedChanges,
        canInstall: false,
        detail: "This workspace is ahead of GitHub, so there is no remote update to install right now.",
        nextAction: "Push local commits first if you want GitHub to become the update source again.",
        checkedAt,
      };
    }

    if (behindCount > 0) {
      return {
        status: "update-available",
        repoUrl,
        repoLabel: formatRepoLabel(repoUrl),
        branch,
        currentSha,
        remoteSha,
        currentVersion,
        remoteVersion,
        behindCount,
        aheadCount,
        hasUncommittedChanges,
        canInstall: true,
        detail: `GitHub has ${behindCount} newer commit${behindCount === 1 ? "" : "s"} ready on ${branch}.`,
        nextAction: "Install update to fast-forward this workspace to the latest GitHub commit.",
        checkedAt,
      };
    }

    return {
      status: "up-to-date",
      repoUrl,
      repoLabel: formatRepoLabel(repoUrl),
      branch,
      currentSha,
      remoteSha,
      currentVersion,
      remoteVersion,
      behindCount,
      aheadCount,
      hasUncommittedChanges,
      canInstall: false,
      detail: "This workspace already matches the latest commit on GitHub.",
      nextAction: "No update action is needed right now.",
      checkedAt,
    };
  } catch (error) {
    return {
      status: "error",
      repoUrl: null,
      repoLabel: null,
      branch: null,
      currentSha: null,
      remoteSha: null,
      currentVersion: null,
      remoteVersion: null,
      behindCount: 0,
      aheadCount: 0,
      hasUncommittedChanges: false,
      canInstall: false,
      detail: error instanceof Error ? error.message : String(error),
      nextAction: "Check the local git remote and make sure this workspace can reach GitHub.",
      checkedAt,
    };
  }
}

function formatRepoLabel(repoUrl: string): string {
  const normalized = repoUrl.replace(/\.git$/, "");
  const match = normalized.match(/github\.com[:/](.+\/.+)$/i);
  return match?.[1] ?? normalized;
}

async function getPackageVersionAtRef(cwd: string, exec: ExecLike, ref = "HEAD"): Promise<string | null> {
  try {
    const packageJson = await git(cwd, ["show", `${ref}:package.json`], exec);
    const parsed = JSON.parse(packageJson) as PackageMeta;
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

async function git(cwd: string, args: string[], exec: ExecLike): Promise<string> {
  const result = await exec("git", args, { cwd });
  return result.stdout.trim();
}

async function runExecFile(file: string, args: string[], options: { cwd: string }): Promise<ExecResult> {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    encoding: "utf8",
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function __resetUpdateCacheForTests(): void {
  cachedUpdateState = null;
}
