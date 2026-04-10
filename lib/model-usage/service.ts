import { recordAiUsageEvent } from "@/lib/persistence/repository";
import { createServerLogger, formatErrorForLog } from "@/lib/observability/logger";

const logger = createServerLogger("server", {
  component: "ai-usage",
});

export const safeRecordAiUsageEvent = (input: Parameters<typeof recordAiUsageEvent>[0]) => {
  try {
    recordAiUsageEvent(input);
  } catch (error) {
    logger.error("ai_usage.persist_failed", {
      input,
      error: formatErrorForLog(error),
    });
  }
};
