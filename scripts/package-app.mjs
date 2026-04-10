import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
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
const scriptsRoot = join(projectRoot, "scripts");
const sqliteVecRoot = join(projectRoot, "bin", "sqlite-vec");
const pythonRuntimeRoot = resolve(
  process.env.META_PLAYER_PYTHON_RUNTIME_PATH?.trim() || join(projectRoot, ".python-runtime")
);
const packageJsonPath = join(projectRoot, "package.json");

const getPythonRuntimeExecutablePath = () =>
  join(
    pythonRuntimeRoot,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python3"
  );

const patchStandaloneServerForAsar = (serverEntryPath) => {
  if (!existsSync(serverEntryPath)) {
    throw new Error(`Missing standalone server entry at ${serverEntryPath}`);
  }

  const standaloneServerSource = readFileSync(serverEntryPath, "utf8");
  const chdirSnippet = "process.chdir(__dirname)";

  if (!standaloneServerSource.includes(chdirSnippet)) {
    return;
  }

  const patchedStandaloneServerSource = standaloneServerSource.replace(
    chdirSnippet,
    [
      "try {",
      "  process.chdir(__dirname)",
      "} catch (error) {",
      "  console.warn('Skipping process.chdir for packaged standalone server:', error)",
      "}",
    ].join("\n")
  );

  writeFileSync(serverEntryPath, patchedStandaloneServerSource);
};

const compilePythonScriptToBytecode = ({
  sourcePath,
  outputPath,
  pythonExecutablePath,
}) => {
  const result = spawnSync(
    pythonExecutablePath,
    [
      "-c",
      [
        "import py_compile",
        "import sys",
        "py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)",
      ].join("; "),
      sourcePath,
      outputPath,
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
    }
  );

  if (result.status === 0) {
    return;
  }

  if (result.error) {
    throw result.error;
  }

  throw new Error(
    `Failed to compile Python script ${sourcePath} to bytecode.\n${result.stderr || result.stdout || ""}`.trim()
  );
};

if (!existsSync(standaloneRoot)) {
  throw new Error("Missing .next/standalone. Run `next build` before packaging.");
}

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });

const serverOutputRoot = join(distRoot, "server");
cpSync(standaloneRoot, serverOutputRoot, { recursive: true });
rmSync(join(serverOutputRoot, ".meta-player"), { recursive: true, force: true });
patchStandaloneServerForAsar(join(serverOutputRoot, "server.js"));

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

if (!existsSync(pythonRuntimeRoot)) {
  throw new Error(
    `Missing embedded Python runtime at ${pythonRuntimeRoot}. Run \`npm run prepare:python-runtime\` first.`
  );
}

const pythonRuntimeExecutablePath = getPythonRuntimeExecutablePath();
if (!existsSync(pythonRuntimeExecutablePath)) {
  throw new Error(
    `Embedded Python runtime is missing executable: ${pythonRuntimeExecutablePath}`
  );
}

if (existsSync(scriptsRoot)) {
  const distScriptsRoot = join(distRoot, "scripts");
  mkdirSync(distScriptsRoot, { recursive: true });

  readdirSync(scriptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".py"))
    .forEach((entry) => {
      const sourcePath = join(scriptsRoot, entry.name);
      const compiledScriptName = entry.name.replace(/\.py$/i, ".pyc");
      compilePythonScriptToBytecode({
        sourcePath,
        outputPath: join(distScriptsRoot, compiledScriptName),
        pythonExecutablePath: pythonRuntimeExecutablePath,
      });
    });
}

if (existsSync(sqliteVecRoot)) {
  cpSync(sqliteVecRoot, join(distRoot, "sqlite-vec"), { recursive: true });
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
