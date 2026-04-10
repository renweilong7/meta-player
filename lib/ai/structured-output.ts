const buildJsonSchemaResponseFormat = (
  name: string,
  schema: Record<string, unknown>
) => ({
  type: "json_schema" as const,
  json_schema: {
    name,
    strict: true,
    schema,
  },
});

export const storyOutlineResponseFormat = buildJsonSchemaResponseFormat(
  "story_outline_scenes",
  {
    type: "object",
    additionalProperties: false,
    required: ["scenes"],
    properties: {
      scenes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "description",
            "startTimecode",
            "endTimecode",
            "startSeconds",
            "endSeconds",
          ],
          properties: {
            title: {
              type: "string",
            },
            description: {
              type: "string",
            },
            startTimecode: {
              type: "string",
            },
            endTimecode: {
              type: "string",
            },
            startSeconds: {
              type: "integer",
            },
            endSeconds: {
              type: "integer",
            },
          },
        },
      },
    },
  }
);

export const storySearchResponseFormat = buildJsonSchemaResponseFormat(
  "story_search_results",
  {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["segmentId", "score"],
          properties: {
            segmentId: {
              type: "string",
            },
            score: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
        },
      },
    },
  }
);

export const sceneShotAnalysisResponseFormat = buildJsonSchemaResponseFormat(
  "scene_shot_analysis",
  {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "action",
      "expressionAndGaze",
      "cinematography",
      "atmosphere",
      "commentaryHooks",
    ],
    properties: {
      summary: {
        type: "string",
      },
      action: {
        type: "string",
      },
      expressionAndGaze: {
        type: "string",
      },
      cinematography: {
        type: "string",
      },
      atmosphere: {
        type: "string",
      },
      commentaryHooks: {
        type: "string",
      },
    },
  }
);
