import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { withRouteLogging } from "@/lib/observability/api-route";
import {
  resolveFfmpegExecutable,
  resolveFfprobeExecutable,
} from "@/lib/runtime/resource-paths";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type MediaToolValidationInput = {
  ffmpegExecutablePath?: string;
  ffprobeExecutablePath?: string;
};

const validateExecutable = async (input: {
  kind: "ffmpeg" | "ffprobe";
  explicitPath?: string;
}) => {
  const resolvedPath =
    input.kind === "ffmpeg"
      ? resolveFfmpegExecutable(input.explicitPath)
      : resolveFfprobeExecutable(input.explicitPath);

  if (!resolvedPath) {
    return {
      ok: false,
      resolvedPath: null,
      version: null,
      message: `未找到 ${input.kind} 可执行文件。`,
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(resolvedPath, ["-version"], {
      encoding: "utf8",
    });
    const firstLine = `${stdout || stderr}`.split(/\r?\n/).find((line) => line.trim()) ?? "";

    return {
      ok: true,
      resolvedPath,
      version: firstLine.trim() || null,
      message: `${input.kind} 可用。`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `${input.kind} 可执行文件检测失败。`;

    return {
      ok: false,
      resolvedPath,
      version: null,
      message,
    };
  }
};

const postHandler = async (request: Request) => {
  const body = (await request.json()) as MediaToolValidationInput;

  const [ffmpeg, ffprobe] = await Promise.all([
    validateExecutable({
      kind: "ffmpeg",
      explicitPath: body.ffmpegExecutablePath,
    }),
    validateExecutable({
      kind: "ffprobe",
      explicitPath: body.ffprobeExecutablePath,
    }),
  ]);

  return NextResponse.json({
    ffmpeg,
    ffprobe,
  });
};

export const POST = withRouteLogging(
  { route: "/api/settings/media-tools" },
  postHandler
);
