import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const distRoot = join(projectRoot, "dist", "app");
const standaloneRoot = join(projectRoot, ".next", "standalone");
const standaloneStaticRoot = join(standaloneRoot, ".next", "static");
const buildStaticRoot = join(projectRoot, ".next", "static");
const publicRoot = join(projectRoot, "public");
const electronRoot = join(projectRoot, "electron");
const scriptsRoot = join(projectRoot, "scripts");
const sqliteVecRoot = join(projectRoot, "bin", "sqlite-vec");
const pythonRuntimeRoot = resolve(
  process.env.META_PLAYER_PYTHON_RUNTIME_PATH?.trim() || join(projectRoot, ".python-runtime")
);
const packageJsonPath = join(projectRoot, "package.json");

if (!existsSync(standaloneRoot)) {
  throw new Error("Missing .next/standalone. Run `next build` before packaging.");
}

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });

const serverOutputRoot = join(distRoot, "server");
cpSync(standaloneRoot, serverOutputRoot, { recursive: true });
rmSync(join(serverOutputRoot, ".meta-player"), { recursive: true, force: true });

mkdirSync(join(serverOutputRoot, ".next"), { recursive: true });
if (existsSync(buildStaticRoot)) {
  rmSync(standaloneStaticRoot, { recursive: true, force: true });
  cpSync(buildStaticRoot, join(serverOutputRoot, ".next", "static"), {
    recursive: true,
  });
}

if (existsSync(publicRoot)) {
  cpSync(publicRoot, join(serverOutputRoot, "public"), { recursive: true });
}

cpSync(electronRoot, join(distRoot, "electron"), { recursive: true });

if (existsSync(scriptsRoot)) {
  const distScriptsRoot = join(distRoot, "scripts");
  mkdirSync(distScriptsRoot, { recursive: true });

  readdirSync(scriptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
    .forEach((entry) => {
      cpSync(join(scriptsRoot, entry.name), join(distScriptsRoot, entry.name));
    });
}

if (existsSync(sqliteVecRoot)) {
  cpSync(sqliteVecRoot, join(distRoot, "sqlite-vec"), { recursive: true });
}

if (!existsSync(pythonRuntimeRoot)) {
  throw new Error(
    `Missing embedded Python runtime at ${pythonRuntimeRoot}. Run \`npm run prepare:python-runtime\` first.`
  );
}

cpSync(pythonRuntimeRoot, join(distRoot, "python"), {
  recursive: true,
});

const sourcePackageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const packagedManifest = {
  name: sourcePackageJson.name,
  version: sourcePackageJson.version,
  private: true,
  main: "electron/main.js",
};

writeFileSync(
  join(distRoot, "package.json"),
  `${JSON.stringify(packagedManifest, null, 2)}\n`
);

console.log(`Packaged app bundle written to ${distRoot}`);
