import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const pythonRuntimeRoot = resolve(
  process.env.META_PLAYER_PYTHON_RUNTIME_PATH?.trim() || join(projectRoot, ".python-runtime")
);
const requirementsPath = resolve(
  process.env.META_PLAYER_PYTHON_REQUIREMENTS_PATH?.trim() ||
    join(projectRoot, "requirements-local-embedding.txt")
);

const getPythonBootstrapCommand = () => {
  if (process.platform === "win32") {
    return { command: "py", args: ["-3", "-m", "venv", pythonRuntimeRoot] };
  }

  return { command: "python3", args: ["-m", "venv", pythonRuntimeRoot] };
};

const getRuntimeExecutablePath = () =>
  process.platform === "win32"
    ? join(pythonRuntimeRoot, "Scripts", "python.exe")
    : join(pythonRuntimeRoot, "bin", "python3");

const getPipInstallArgs = () =>
  process.platform === "win32"
    ? ["-m", "pip", "install", "-r", requirementsPath]
    : ["-m", "pip", "install", "-r", requirementsPath];

const runOrThrow = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.status === 0) {
    return;
  }

  if (result.error) {
    throw result.error;
  }

  throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
};

if (!existsSync(pythonRuntimeRoot)) {
  const bootstrap = getPythonBootstrapCommand();
  console.log(`Creating embedded Python runtime at ${pythonRuntimeRoot}`);
  runOrThrow(bootstrap.command, bootstrap.args);
}

const runtimeExecutablePath = getRuntimeExecutablePath();
if (!existsSync(runtimeExecutablePath)) {
  throw new Error(`Embedded Python runtime is missing executable: ${runtimeExecutablePath}`);
}

console.log(`Installing Python dependencies from ${requirementsPath} into ${pythonRuntimeRoot}`);
runOrThrow(runtimeExecutablePath, getPipInstallArgs());
console.log(`Embedded Python runtime ready at ${pythonRuntimeRoot}`);
