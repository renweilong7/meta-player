import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const getElectronResourcesPath = () =>
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? null;

const dedupePaths = (paths: Array<string | null | undefined>) => {
  const uniquePaths = new Set<string>();

  paths.forEach((candidate) => {
    if (!candidate || !candidate.trim()) {
      return;
    }

    uniquePaths.add(resolve(candidate));
  });

  return [...uniquePaths];
};

const isExistingPath = (candidate: string | null | undefined): candidate is string =>
  typeof candidate === "string" && candidate.trim().length > 0 && existsSync(candidate);

const getDefaultAppDataDirectory = () => join(process.cwd(), ".meta-player");

export const getAppDataDirectory = () =>
  process.env.META_PLAYER_DATA_DIR?.trim() || getDefaultAppDataDirectory();

const getBundledAppRootCandidates = () => {
  const electronResourcesPath = getElectronResourcesPath();

  return dedupePaths([
    process.cwd(),
    join(process.cwd(), ".."),
    join(process.cwd(), "..", ".."),
    electronResourcesPath ? join(electronResourcesPath, "app") : null,
  ]);
};

export const resolveBundledScriptPath = (scriptName: string) => {
  const electronResourcesPath = getElectronResourcesPath();
  const candidates = [
    ...getBundledAppRootCandidates().map((rootPath) => join(rootPath, "scripts", scriptName)),
    electronResourcesPath ? join(electronResourcesPath, "python-scripts", scriptName) : null,
  ];

  return candidates.find(isExistingPath) ?? null;
};

export const resolveBundledPythonScriptPath = (scriptBaseName: string) => {
  const normalizedScriptBaseName = scriptBaseName.trim().replace(/\.pyc?$/i, "");
  const candidates = [
    `${normalizedScriptBaseName}.pyc`,
    `${normalizedScriptBaseName}.py`,
  ];

  return (
    candidates
      .map((candidate) => resolveBundledScriptPath(candidate))
      .find((candidate): candidate is string => candidate !== null) ?? null
  );
};

export const resolveBundledPythonExecutable = () => {
  const explicitExecutable = process.env.META_PLAYER_PYTHON_EXECUTABLE?.trim();
  const electronResourcesPath = getElectronResourcesPath();
  const executableName = process.platform === "win32" ? "python.exe" : "python3";
  const fallbackExecutable = process.platform === "win32" ? "python" : "python3";
  const bundledExecutablePaths = [
    ...getBundledAppRootCandidates().map((rootPath) =>
      join(
        rootPath,
        "python",
        process.platform === "win32" ? "Scripts" : "bin",
        executableName
      )
    ),
    electronResourcesPath
      ? join(
          electronResourcesPath,
          "python",
          process.platform === "win32" ? "Scripts" : "bin",
          executableName
        )
      : null,
  ];

  const resolvedExecutable =
    [explicitExecutable, ...bundledExecutablePaths].find(isExistingPath) ?? null;

  if (resolvedExecutable) {
    return resolvedExecutable;
  }

  return process.env.NODE_ENV === "production" ? null : fallbackExecutable;
};

const resolveBinaryCandidate = (input: {
  explicitPath?: string | null;
  executableName: string;
  fallbackAbsolutePaths?: string[];
}) => {
  const explicitPath = input.explicitPath?.trim();
  const bundledCandidates = getBundledAppRootCandidates().map((rootPath) =>
    join(rootPath, "bin", input.executableName)
  );
  const electronResourcesPath = getElectronResourcesPath();
  const candidates = [
    explicitPath,
    ...bundledCandidates,
    electronResourcesPath ? join(electronResourcesPath, "bin", input.executableName) : null,
    ...(input.fallbackAbsolutePaths ?? []),
  ];

  const resolvedAbsolutePath = candidates.find(isExistingPath) ?? null;
  if (resolvedAbsolutePath) {
    return resolvedAbsolutePath;
  }

  return process.env.NODE_ENV === "production" ? null : input.executableName;
};

export const resolveFfmpegExecutable = (explicitPath?: string | null) =>
  resolveBinaryCandidate({
    explicitPath,
    executableName: process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    fallbackAbsolutePaths:
      process.platform === "darwin"
        ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
        : process.platform === "win32"
          ? []
          : ["/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"],
  });

export const resolveFfprobeExecutable = (explicitPath?: string | null) =>
  resolveBinaryCandidate({
    explicitPath,
    executableName: process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    fallbackAbsolutePaths:
      process.platform === "darwin"
        ? ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"]
        : process.platform === "win32"
          ? []
          : ["/usr/local/bin/ffprobe", "/usr/bin/ffprobe"],
  });
