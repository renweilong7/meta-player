import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createServerLogger,
  formatErrorForLog,
  runWithRequestLogContext,
} from "@/lib/observability/logger";

type RouteHandler<TContext> = (
  request: Request,
  context: TContext
) => Promise<Response> | Response;

type RouteLoggingOptions<TContext> = {
  route: string;
  onError?: (
    error: unknown,
    request: Request,
    context: TContext
  ) => Promise<Response> | Response;
};

const routeLogger = createServerLogger("server", {
  component: "api",
});

const attachRequestIdHeader = (response: Response, requestId: string) => {
  const headers = new Headers(response.headers);
  headers.set("x-meta-player-request-id", requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const logRequestCompleted = (input: {
  route: string;
  method: string;
  durationMs: number;
  status: number;
}) => {
  const context = {
    route: input.route,
    method: input.method,
    durationMs: input.durationMs,
    status: input.status,
  };

  if (input.status >= 500) {
    routeLogger.error("api.request.completed", context);
    return;
  }

  if (input.status >= 400) {
    routeLogger.warn("api.request.completed", context);
    return;
  }

  routeLogger.info("api.request.completed", context);
};

export const withRouteLogging = <TContext = unknown>(
  options: RouteLoggingOptions<TContext>,
  handler: RouteHandler<TContext>
) => {
  return async (request: Request, context: TContext) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const url = new URL(request.url);

    return runWithRequestLogContext(
      {
        requestId,
        route: options.route,
        method: request.method,
      },
      async () => {
        routeLogger.info("api.request.started", {
          route: options.route,
          method: request.method,
          pathname: url.pathname,
          search: url.search || undefined,
        });

        try {
          const response = await handler(request, context);
          const finalizedResponse = attachRequestIdHeader(response, requestId);

          logRequestCompleted({
            route: options.route,
            method: request.method,
            durationMs: Date.now() - startedAt,
            status: finalizedResponse.status,
          });

          return finalizedResponse;
        } catch (error) {
          routeLogger.error("api.request.failed", {
            route: options.route,
            method: request.method,
            durationMs: Date.now() - startedAt,
            error: formatErrorForLog(error),
          });

          const response = options.onError
            ? await options.onError(error, request, context)
            : NextResponse.json({ message: "服务器内部错误。" }, { status: 500 });
          const finalizedResponse = attachRequestIdHeader(response, requestId);

          logRequestCompleted({
            route: options.route,
            method: request.method,
            durationMs: Date.now() - startedAt,
            status: finalizedResponse.status,
          });

          return finalizedResponse;
        }
      }
    );
  };
};
