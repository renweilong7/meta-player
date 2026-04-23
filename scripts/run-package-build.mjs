import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

const buildEnvironment = {
  ...process.env,
};
const buildNodeOptions = [
  process.env.NODE_OPTIONS?.trim(),
  "--max-old-space-size=8192",
]
  .filter((entry) => entry && entry.length > 0)
  .join(" ");

const runOrThrow = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: buildEnvironment,
    stdio: "inherit",
    ...options,
  });

  if (result.status === 0) {
    return;
  }

  if (result.error) {
    throw result.error;
  }

  throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`);
};

const runNpmScriptOrThrow = (scriptName) => {
  if (process.platform === "win32") {
    runOrThrow(
      "cmd.exe",
      ["/d", "/s", "/c", "npm", "run", scriptName],
      {
        env: {
          ...buildEnvironment,
          NODE_OPTIONS: buildNodeOptions,
        },
      }
    );
    return;
  }

  runOrThrow("npm", ["run", scriptName], {
    env: {
      ...buildEnvironment,
      NODE_OPTIONS: buildNodeOptions,
    },
  });
};

runOrThrow(process.execPath, [join(projectRoot, "scripts", "prepare-python-runtime.mjs")]);
runOrThrow(process.execPath, [join(projectRoot, "scripts", "generate-icons.mjs")]);
runNpmScriptOrThrow("build");
runOrThrow(process.execPath, [join(projectRoot, "scripts", "package-app.mjs")]);
