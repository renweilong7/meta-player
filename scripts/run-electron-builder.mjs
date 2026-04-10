import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const electronBuilderEntrypoint = join(
  projectRoot,
  "node_modules",
  "electron-builder",
  "cli.js"
);

const builderEnvironment = {
  ...process.env,
  ELECTRON_OVERRIDE_DIST_PATH: join("node_modules", "electron", "dist"),
};

if (process.platform !== "win32") {
  builderEnvironment.ELECTRON_BUILDER_CACHE =
    process.env.ELECTRON_BUILDER_CACHE || "/tmp/electron-builder-cache";
}

const result = spawnSync(
  process.execPath,
  [electronBuilderEntrypoint, ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    env: builderEnvironment,
    stdio: "inherit",
  }
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}

process.exit(1);
