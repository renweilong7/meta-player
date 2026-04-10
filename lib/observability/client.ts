"use client";

const CLIENT_SESSION_STORAGE_KEY = "meta-player-client-session-id";
const CLIENT_LOG_ENDPOINT = "/api/diagnostics/client-logs";

type ClientLogLevel = "info" | "warn" | "error";

let globalDiagnosticsInstalled = false;

const createClientId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const getClientSessionId = () => {
  if (typeof window === "undefined") {
    return "server-render";
  }

  try {
    const current = window.sessionStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
    if (current) {
      return current;
    }

    const created = createClientId();
    window.sessionStorage.setItem(CLIENT_SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return "session-storage-unavailable";
  }
};

const serializeClientError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return typeof error === "string" ? error : String(error);
};

export const reportClientDiagnosticEvent = async (input: {
  level?: ClientLogLevel;
  event: string;
  details?: Record<string, unknown>;
  error?: unknown;
}) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    await fetch(CLIENT_LOG_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
      body: JSON.stringify({
        level: input.level ?? "info",
        event: input.event,
        clientSessionId: getClientSessionId(),
        href: window.location.href,
        details: input.details,
        error: input.error ? serializeClientError(input.error) : undefined,
      }),
    });
  } catch {
    // 客户端诊断本身不能影响主流程。
  }
};

export const buildClientDiagnosticHeaders = (headers?: HeadersInit) => {
  const mergedHeaders = new Headers(headers);
  mergedHeaders.set("x-meta-player-client-session-id", getClientSessionId());
  mergedHeaders.set("x-meta-player-client-request-id", createClientId());
  return mergedHeaders;
};

export const installGlobalClientDiagnostics = () => {
  if (typeof window === "undefined" || globalDiagnosticsInstalled) {
    return () => undefined;
  }

  globalDiagnosticsInstalled = true;

  const onWindowError = (event: ErrorEvent) => {
    void reportClientDiagnosticEvent({
      level: "error",
      event: "window.error",
      details: {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      },
      error: event.error,
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    void reportClientDiagnosticEvent({
      level: "error",
      event: "window.unhandledrejection",
      details: {
        reason:
          event.reason instanceof Error
            ? event.reason.message
            : String(event.reason),
      },
      error: event.reason,
    });
  };

  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  void reportClientDiagnosticEvent({
    level: "info",
    event: "session.started",
    details: {
      userAgent: navigator.userAgent,
      language: navigator.language,
    },
  });

  return () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    globalDiagnosticsInstalled = false;
  };
};
