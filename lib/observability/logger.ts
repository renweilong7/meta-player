import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAppDataDirectory } from "@/lib/runtime/resource-paths";

export type LogLevel = "debug" | "info" | "warn" | "error";

type LogContextValue = string | number | boolean | null | undefined;
type LogContext = Record<string, unknown>;

type RequestLogContext = {
  requestId: string;
  route: string;
  method: string;
};

type StructuredLogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  runtime: "server";
  context: Record<string, unknown>;
};

const requestContextStorage = new AsyncLocalStorage<RequestLogContext>();
const SENSITIVE_KEY_PATTERN =
  /(authorization|token|api[-_]?key|password|secret|cookie|license)/i;

const truncateString = (value: string, maxLength = 2000) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}…[truncated]` : value;

const sanitizeUnknown = (value: unknown, key?: string): unknown => {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value as LogContextValue;
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? truncateString(value.stack, 4000) : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeUnknown(item));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50);
    return Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeUnknown(entryValue, entryKey),
      ])
    );
  }

  return String(value);
};

const getLogDirectory = () => {
  const directory = join(getAppDataDirectory(), "logs");
  mkdirSync(directory, { recursive: true });
  return directory;
};

const getLogFilePath = (scope: string) => {
  const date = new Date().toISOString().slice(0, 10);
  return join(getLogDirectory(), `${scope}-${date}.log`);
};

const appendStructuredLog = (scope: string, entry: StructuredLogEntry) => {
  appendFileSync(getLogFilePath(scope), `${JSON.stringify(entry)}\n`, "utf8");
};

const getRequestContext = () => requestContextStorage.getStore();

const mergeContexts = (baseContext: LogContext, extraContext: LogContext) => {
  const requestContext = getRequestContext();

  return sanitizeUnknown({
    ...baseContext,
    ...(requestContext ?? {}),
    ...extraContext,
  }) as Record<string, unknown>;
};

export const runWithRequestLogContext = async <T>(
  context: RequestLogContext,
  callback: () => Promise<T> | T
) => requestContextStorage.run(context, callback);

export const formatErrorForLog = (error: unknown) => sanitizeUnknown(error);

export const createServerLogger = (scope: string, baseContext: LogContext = {}) => {
  const write = (level: LogLevel, message: string, context: LogContext = {}) => {
    appendStructuredLog(scope, {
      timestamp: new Date().toISOString(),
      level,
      message,
      runtime: "server",
      context: mergeContexts(baseContext, context),
    });
  };

  return {
    debug: (message: string, context?: LogContext) => write("debug", message, context),
    info: (message: string, context?: LogContext) => write("info", message, context),
    warn: (message: string, context?: LogContext) => write("warn", message, context),
    error: (message: string, context?: LogContext) => write("error", message, context),
  };
};

export const getDiagnosticsLogDirectory = () => getLogDirectory();
