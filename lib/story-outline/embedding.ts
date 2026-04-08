import { safeRecordAiUsageEvent } from "@/lib/model-usage/service";
import { extractOpenAiTokenUsage } from "@/lib/model-usage/usage";

interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  projectId?: string;
  materialId?: string;
  action?: "story_outline_embedding_index" | "story_outline_embedding_search";
}

interface OpenAiEmbeddingResponse {
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
  error?: {
    message?: string;
  };
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

export const generateEmbeddings = async (
  inputs: string[],
  config: EmbeddingConfig
): Promise<number[][]> => {
  if (inputs.length === 0) {
    return [];
  }

  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${normalizedBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: inputs,
    }),
  });

  const payload = (await response.json()) as OpenAiEmbeddingResponse;
  const tokenUsage = extractOpenAiTokenUsage(payload);
  const action = config.action ?? "story_outline_embedding_index";

  if (!response.ok) {
    safeRecordAiUsageEvent({
      action,
      provider: "openai_compatible",
      model: config.model,
      endpoint: `${normalizedBaseUrl}/embeddings`,
      status: "error",
      errorMessage: payload.error?.message || "Embedding 接口调用失败",
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      inputCount: inputs.length,
      projectId: config.projectId,
      materialId: config.materialId,
    });
    throw new Error(payload.error?.message || "Embedding 接口调用失败");
  }

  const vectors = (payload.data ?? [])
    .slice()
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((item) => item.embedding);

  if (vectors.length !== inputs.length || vectors.some((item) => !Array.isArray(item))) {
    safeRecordAiUsageEvent({
      action,
      provider: "openai_compatible",
      model: config.model,
      endpoint: `${normalizedBaseUrl}/embeddings`,
      status: "error",
      errorMessage: "Embedding 返回内容不完整",
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      inputCount: inputs.length,
      projectId: config.projectId,
      materialId: config.materialId,
    });
    throw new Error("Embedding 返回内容不完整");
  }

  safeRecordAiUsageEvent({
    action,
    provider: "openai_compatible",
    model: config.model,
    endpoint: `${normalizedBaseUrl}/embeddings`,
    status: "success",
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    totalTokens: tokenUsage.totalTokens,
    inputCount: inputs.length,
    projectId: config.projectId,
    materialId: config.materialId,
    metadata: {
      vectorCount: vectors.length,
    },
  });

  return vectors as number[][];
};
