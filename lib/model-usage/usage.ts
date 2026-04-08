import { PersistedAiUsageRecord } from "@/lib/persistence/types";

type OpenAiUsagePayload = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
};

const normalizeTokenValue = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;

export const extractOpenAiTokenUsage = (payload: {
  usage?: OpenAiUsagePayload;
}): Pick<
  PersistedAiUsageRecord,
  "inputTokens" | "outputTokens" | "totalTokens"
> => {
  const usage = payload.usage;

  if (!usage) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    };
  }

  const inputTokens = normalizeTokenValue(
    usage.prompt_tokens ?? usage.input_tokens
  );
  const outputTokens = normalizeTokenValue(
    usage.completion_tokens ?? usage.output_tokens
  );
  const totalTokens = normalizeTokenValue(usage.total_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens:
      totalTokens ??
      (inputTokens !== null || outputTokens !== null
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : null),
  };
};
