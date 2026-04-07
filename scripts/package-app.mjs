import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const sqliteVecRoot = join(projectRoot, "bin", "sqlite-vec");
const embeddingModelsRoot = join(projectRoot, "models", "embeddings");
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

if (existsSync(sqliteVecRoot)) {
  cpSync(sqliteVecRoot, join(distRoot, "sqlite-vec"), { recursive: true });
}

if (existsSync(embeddingModelsRoot)) {
  cpSync(embeddingModelsRoot, join(distRoot, "models", "embeddings"), {
    recursive: true,
  });
}

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
