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
const rawArguments = process.argv.slice(2);
const flavorIndex = rawArguments.indexOf("--flavor");
const buildFlavor =
  flavorIndex >= 0 && rawArguments[flavorIndex + 1] ? rawArguments[flavorIndex + 1] : "cpu";
const builderArguments =
  flavorIndex >= 0
    ? rawArguments.filter((_, index) => index !== flavorIndex && index !== flavorIndex + 1)
    : rawArguments;

const builderEnvironment = {
  ...process.env,
  ELECTRON_OVERRIDE_DIST_PATH: join("node_modules", "electron", "dist"),
};

if (process.platform !== "win32") {
  builderEnvironment.ELECTRON_BUILDER_CACHE =
    process.env.ELECTRON_BUILDER_CACHE || "/tmp/electron-builder-cache";
}

if (buildFlavor === "gpu") {
  builderEnvironment.META_PLAYER_BUILD_FLAVOR = "gpu";
}

const builderConfigArguments =
  buildFlavor === "gpu"
    ? [
        "-c.productName=Meta Player GPU",
        "-c.appId=com.renyi.meta-player.gpu",
        "-c.directories.output=release-gpu",
        "-c.nsis.artifactName=Meta-Player-gpu-${version}-${arch}-setup.${ext}",
        "-c.portable.artifactName=Meta-Player-gpu-${version}-${arch}-portable.${ext}",
      ]
    : [
        "-c.nsis.artifactName=Meta-Player-cpu-${version}-${arch}-setup.${ext}",
        "-c.portable.artifactName=Meta-Player-cpu-${version}-${arch}-portable.${ext}",
      ];

const result = spawnSync(
  process.execPath,
  [electronBuilderEntrypoint, ...builderArguments, ...builderConfigArguments],
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
