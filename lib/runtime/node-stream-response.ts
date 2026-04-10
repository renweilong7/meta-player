import { createReadStream, type ReadStream } from "node:fs";

const createAbortSafeReadableStream = (
  stream: ReadStream,
  signal?: AbortSignal
) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      let isClosed = false;

      const cleanup = () => {
        stream.off("data", handleData);
        stream.off("end", handleEnd);
        stream.off("error", handleError);
        signal?.removeEventListener("abort", handleAbort);
      };

      const handleData = (chunk: string | Buffer) => {
        if (isClosed) {
          return;
        }

        controller.enqueue(
          typeof chunk === "string" ? Buffer.from(chunk) : chunk
        );
      };

      const handleEnd = () => {
        cleanup();
        if (isClosed) {
          return;
        }

        isClosed = true;
        controller.close();
      };

      const handleError = (error: Error) => {
        cleanup();
        if (isClosed) {
          return;
        }

        isClosed = true;
        controller.error(error);
      };

      const handleAbort = () => {
        cleanup();
        isClosed = true;
        if (!stream.destroyed) {
          stream.destroy();
        }
      };

      stream.on("data", handleData);
      stream.once("end", handleEnd);
      stream.once("error", handleError);
      signal?.addEventListener("abort", handleAbort, { once: true });
    },
    cancel() {
      if (!stream.destroyed) {
        stream.destroy();
      }
    },
  });

export const createFileStreamResponse = (input: {
  absolutePath: string;
  headers: HeadersInit;
  signal?: AbortSignal;
  start?: number;
  end?: number;
  status?: number;
}) => {
  const stream = createReadStream(input.absolutePath, {
    start: input.start,
    end: input.end,
  });

  return new Response(createAbortSafeReadableStream(stream, input.signal), {
    status: input.status ?? 200,
    headers: input.headers,
  });
};
