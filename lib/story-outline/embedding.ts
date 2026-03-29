interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface OpenAiEmbeddingResponse {
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
  error?: {
    message?: string;
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

  if (!response.ok) {
    throw new Error(payload.error?.message || "Embedding 接口调用失败");
  }

  const vectors = (payload.data ?? [])
    .slice()
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((item) => item.embedding);

  if (vectors.length !== inputs.length || vectors.some((item) => !Array.isArray(item))) {
    throw new Error("Embedding 返回内容不完整");
  }

  return vectors as number[][];
};
