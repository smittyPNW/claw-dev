import { execFile } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function pickWorkspaceFolder(initialPath?: string): Promise<string | null> {
  const normalizedInitialPath = normalizeInitialPath(initialPath);

  if (process.platform === "darwin") {
    return pickFolderOnMac(normalizedInitialPath);
  }

  if (process.platform === "win32") {
    return pickFolderOnWindows(normalizedInitialPath);
  }

  return pickFolderOnLinux(normalizedInitialPath);
}

export type PythonDependencyState = {
  pythonPath: string;
  runCommand: string;
  missingModules: string[];
  createdVenv: boolean;
};

export async function preparePythonWorkspaceRun(cwd: string, relativePath: string): Promise<PythonDependencyState> {
  const workspaceRoot = path.resolve(cwd);
  const fullPath = resolvePathWithinWorkspace(workspaceRoot, relativePath);
  const source = await readFile(fullPath, "utf8");
  const importedModules = extractPythonImports(source);
  const stdlibModules = await getPythonStdlibModules();
  const dependencyPlan = await planPythonDependencies(workspaceRoot, importedModules, stdlibModules);

  let createdVenv = false;
  let pythonPath = await preferredWorkspacePython(workspaceRoot);
  const missingKnownModules = await findMissingPythonModules(pythonPath, dependencyPlan.knownImports);
  let missingModules = [
    ...dependencyPlan.unresolvedImports,
    ...missingKnownModules.filter((moduleName) => !dependencyPlan.unresolvedImports.includes(moduleName)),
  ];

  if (missingKnownModules.length > 0) {
    createdVenv = true;
    pythonPath = await ensureWorkspaceVirtualEnv(workspaceRoot);
    if (dependencyPlan.installTargets.length > 0) {
      const installTargets = dependencyPlan.installTargets.filter((target) => missingKnownModules.includes(target.importName));
      if (installTargets.length > 0) {
        await installPythonModules(workspaceRoot, pythonPath, installTargets.map((target) => target.packageName));
      }
    }
    const missingAfterInstall = await findMissingPythonModules(pythonPath, dependencyPlan.knownImports);
    missingModules = [
      ...dependencyPlan.unresolvedImports,
      ...missingAfterInstall.filter((moduleName) => !dependencyPlan.unresolvedImports.includes(moduleName)),
    ];
  }

  return {
    pythonPath,
    runCommand: `${shellQuoteForCommand(pythonPath)} ${shellQuoteForCommand(relativePath)}`,
    missingModules,
    createdVenv,
  };
}

function normalizeInitialPath(initialPath?: string): string | null {
  if (!initialPath?.trim()) {
    return null;
  }

  return path.resolve(initialPath.trim());
}

function resolvePathWithinWorkspace(cwd: string, maybeRelative: string): string {
  const resolved = path.resolve(cwd, maybeRelative);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${maybeRelative}`);
  }
  return resolved;
}

async function pickFolderOnMac(initialPath: string | null): Promise<string | null> {
  const lines = [
    "set chosenFolder to choose folder",
  ];

  if (initialPath) {
    const escapedPath = escapeAppleScript(initialPath);
    lines[0] = `set chosenFolder to choose folder default location (POSIX file \"${escapedPath}\")`;
  }

  lines.push('return POSIX path of chosenFolder');

  try {
    const { stdout } = await execFileAsync("osascript", lines.flatMap((line) => ["-e", line]), {
      timeout: 120000,
    });
    const selected = stdout.trim();
    return selected ? path.resolve(selected) : null;
  } catch (error) {
    if (isUserCancelledDialog(error)) {
      return null;
    }
    throw new Error("Unable to open the macOS folder picker.");
  }
}

async function pickFolderOnWindows(initialPath: string | null): Promise<string | null> {
  const startPath = initialPath ? initialPath.replace(/\\/g, "\\\\").replace(/'/g, "''") : "";
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$dialog.Description = "Choose a Claw Dev workspace"',
    "$dialog.ShowNewFolderButton = $true",
    ...(startPath ? [`$dialog.SelectedPath = '${startPath}'`] : []),
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Output $dialog.SelectedPath",
    "}",
  ].join("; ");

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
      timeout: 120000,
      windowsHide: true,
    });
    const selected = stdout.trim();
    return selected ? path.resolve(selected) : null;
  } catch (error) {
    if (isUserCancelledDialog(error)) {
      return null;
    }
    throw new Error("Unable to open the Windows folder picker.");
  }
}

async function pickFolderOnLinux(initialPath: string | null): Promise<string | null> {
  const args = ["--file-selection", "--directory", "--title=Choose a Claw Dev workspace"];
  if (initialPath) {
    args.push(`--filename=${ensureTrailingSlash(initialPath)}`);
  }

  try {
    const { stdout } = await execFileAsync("zenity", args, {
      timeout: 120000,
    });
    const selected = stdout.trim();
    return selected ? path.resolve(selected) : null;
  } catch (error) {
    if (isUserCancelledDialog(error)) {
      return null;
    }
  }

  const kdialogArgs = ["--getexistingdirectory", initialPath ?? path.resolve(".")];
  try {
    const { stdout } = await execFileAsync("kdialog", kdialogArgs, {
      timeout: 120000,
    });
    const selected = stdout.trim();
    return selected ? path.resolve(selected) : null;
  } catch (error) {
    if (isUserCancelledDialog(error)) {
      return null;
    }
    throw new Error("Unable to open a folder picker on this system.");
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isUserCancelledDialog(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: number | string; stderr?: string; message?: string };
  const text = `${maybeError.stderr ?? ""} ${maybeError.message ?? ""}`.toLowerCase();
  return maybeError.code === 1 || text.includes("user canceled") || text.includes("cancelled");
}

async function preferredWorkspacePython(cwd: string): Promise<string> {
  const venvPython = workspacePythonPath(cwd);
  if (await pathExists(venvPython)) {
    return venvPython;
  }

  try {
    const { stdout } = await execFileAsync("python3", ["-c", "import sys; print(sys.executable)"], {
      cwd,
      timeout: 120000,
    });
    const pythonPath = stdout.trim();
    if (pythonPath) {
      return pythonPath;
    }
  } catch {}

  return process.platform === "win32" ? "python" : "python3";
}

function workspacePythonPath(cwd: string): string {
  return process.platform === "win32"
    ? path.join(cwd, ".venv", "Scripts", "python.exe")
    : path.join(cwd, ".venv", "bin", "python");
}

async function ensureWorkspaceVirtualEnv(cwd: string): Promise<string> {
  const pythonPath = workspacePythonPath(cwd);
  if (await pathExists(pythonPath)) {
    return pythonPath;
  }

  await mkdir(path.join(cwd, ".venv"), { recursive: true });
  await execFileAsync(process.platform === "win32" ? "python" : "python3", ["-m", "venv", ".venv"], {
    cwd,
    timeout: 120000,
  });
  return pythonPath;
}

async function installPythonModules(cwd: string, pythonPath: string, modules: string[]): Promise<void> {
  if (!modules.length) {
    return;
  }

  await execFileAsync(pythonPath, ["-m", "pip", "install", ...modules], {
    cwd,
    timeout: 600000,
    maxBuffer: 1024 * 1024 * 8,
  });
}

async function findMissingPythonModules(pythonPath: string, modules: string[]): Promise<string[]> {
  if (!modules.length) {
    return [];
  }

  const missing: string[] = [];
  for (const moduleName of modules) {
    try {
      await execFileAsync(pythonPath, ["-c", `import ${moduleName}`], {
        timeout: 120000,
      });
    } catch {
      missing.push(moduleName);
    }
  }
  return missing;
}

function extractPythonImports(source: string): string[] {
  const modules = new Set<string>();
  const importRegex = /^\s*import\s+([^\n#]+)/gm;
  const fromRegex = /^\s*from\s+([a-zA-Z0-9_.]+)\s+import\s+/gm;

  for (const match of source.matchAll(importRegex)) {
    const clause = match[1] ?? "";
    for (const part of clause.split(",")) {
      const cleaned = part.trim().split(/\s+as\s+/i)[0]?.split(".")[0]?.trim();
      if (cleaned) {
        modules.add(cleaned);
      }
    }
  }

  for (const match of source.matchAll(fromRegex)) {
    const cleaned = match[1]?.split(".")[0]?.trim();
    if (cleaned) {
      modules.add(cleaned);
    }
  }

  return [...modules];
}

type PythonInstallTarget = {
  importName: string;
  packageName: string;
};

type PythonDependencyPlan = {
  knownImports: string[];
  unresolvedImports: string[];
  installTargets: PythonInstallTarget[];
};

const SAFE_PYTHON_PACKAGE_MAP: Record<string, string> = {
  PIL: "Pillow",
  arcade: "arcade",
  cv2: "opencv-python",
  fastapi: "fastapi",
  flask: "flask",
  numpy: "numpy",
  OpenGL: "PyOpenGL",
  pandas: "pandas",
  pygame: "pygame",
  pyglet: "pyglet",
  pyxel: "pyxel",
  requests: "requests",
  streamlit: "streamlit",
  yaml: "PyYAML",
};

async function planPythonDependencies(
  workspaceRoot: string,
  importedModules: string[],
  stdlibModules: Set<string>,
): Promise<PythonDependencyPlan> {
  const knownImports: string[] = [];
  const unresolvedImports: string[] = [];
  const installTargets: PythonInstallTarget[] = [];

  for (const moduleName of importedModules) {
    if (stdlibModules.has(moduleName) || moduleName === "tkinter") {
      continue;
    }

    if (await isWorkspaceLocalPythonModule(workspaceRoot, moduleName)) {
      continue;
    }

    const packageName = SAFE_PYTHON_PACKAGE_MAP[moduleName];
    if (!packageName) {
      unresolvedImports.push(moduleName);
      continue;
    }

    knownImports.push(moduleName);
    installTargets.push({ importName: moduleName, packageName });
  }

  return {
    knownImports,
    unresolvedImports,
    installTargets,
  };
}

async function isWorkspaceLocalPythonModule(workspaceRoot: string, moduleName: string): Promise<boolean> {
  const candidateFile = path.join(workspaceRoot, `${moduleName}.py`);
  const candidatePackage = path.join(workspaceRoot, moduleName, "__init__.py");
  return (await pathExists(candidateFile)) || (await pathExists(candidatePackage));
}

let cachedStdlibModules: Set<string> | null = null;

async function getPythonStdlibModules(): Promise<Set<string>> {
  if (cachedStdlibModules) {
    return cachedStdlibModules;
  }

  try {
    const { stdout } = await execFileAsync(process.platform === "win32" ? "python" : "python3", [
      "-c",
      "import json,sys; print(json.dumps(sorted(sys.stdlib_module_names)))",
    ], {
      timeout: 120000,
    });
    cachedStdlibModules = new Set(JSON.parse(stdout.trim()));
    return cachedStdlibModules;
  } catch {
    cachedStdlibModules = new Set(["sys", "os", "pathlib", "math", "random", "time", "json", "typing", "collections", "itertools", "functools", "re", "tkinter", "turtle"]);
    return cachedStdlibModules;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function shellQuoteForCommand(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
