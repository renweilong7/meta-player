import { recordAiUsageEvent } from "@/lib/persistence/repository";

export const safeRecordAiUsageEvent = (input: Parameters<typeof recordAiUsageEvent>[0]) => {
  try {
    recordAiUsageEvent(input);
  } catch (error) {
    console.error("Failed to record AI usage event", error);
  }
};
