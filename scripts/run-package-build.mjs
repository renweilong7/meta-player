import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const rawArguments = process.argv.slice(2);
const flavorIndex = rawArguments.indexOf("--flavor");
const buildFlavor =
  flavorIndex >= 0 && rawArguments[flavorIndex + 1] ? rawArguments[flavorIndex + 1] : "cpu";

const getNpmCommand = () => (process.platform === "win32" ? "npm.cmd" : "npm");

const buildEnvironment = {
  ...process.env,
};

if (buildFlavor === "gpu") {
  buildEnvironment.META_PLAYER_PYTHON_FLAVOR = "gpu";
  buildEnvironment.META_PLAYER_PYTHON_RUNTIME_PATH = join(projectRoot, ".python-runtime-gpu");
  buildEnvironment.META_PLAYER_PYTHON_REQUIREMENTS_PATH = join(
    projectRoot,
    "requirements-local-embedding-gpu-cu124.txt"
  );
}

const runOrThrow = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: buildEnvironment,
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

runOrThrow(process.execPath, [join(projectRoot, "scripts", "prepare-python-runtime.mjs")]);
runOrThrow(process.execPath, [join(projectRoot, "scripts", "generate-icons.mjs")]);
runOrThrow(getNpmCommand(), ["run", "build"]);
runOrThrow(process.execPath, [join(projectRoot, "scripts", "package-app.mjs")]);
