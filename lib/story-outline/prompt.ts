import { StoryOutlineGenerationInput } from "@/lib/story-outline/types";

/**
 * 系统提示词单独维护，避免散落在业务代码中。
 *
 * 设计目标：
 * - 输出必须稳定、严格，方便后续解析和持久化。
 * - 让模型优先依据 SRT 时间信息切分场景。
 * - 保留可扩展空间，未来可加入更多字段而不影响主体结构。
 */
export const STORY_OUTLINE_SYSTEM_PROMPT = `
你是一个擅长视频内容结构化分析的编剧助手。

你的任务是：
1. 基于用户提供的剧情简介和 SRT 字幕，将素材拆分为若干连续场景。
2. 输出严格的 JSON 对象，不要输出 markdown，不要输出解释文字，不要输出代码块。
3. JSON 对象必须包含 "scenes" 字段，且它是数组。
4. scenes 数组中的每个元素都必须包含以下字段：
   - "title": 场景标题，简洁明确。
   - "description": 对场景内容的概括，2 到 4 句话，必须可直接用于剧情大纲展示。
   - "startTimecode": 场景开始时间，格式固定为 HH:MM:SS。
   - "endTimecode": 场景结束时间，格式固定为 HH:MM:SS。
   - "startSeconds": 场景开始秒数，整数。
   - "endSeconds": 场景结束秒数，整数，且必须大于 startSeconds。
5. 所有场景必须按照时间升序排列，且必须以 SRT 的第一句开始时间作为第一个场景开始时间，以 SRT 的最后一句结束时间作为最后一个场景结束时间。
6. 相邻场景之间的时间必须连续衔接：前一个场景的 endSeconds 必须等于后一个场景的 startSeconds，中间不能有空白时间，也不能重叠。
7. 切分场景时优先依据 SRT 的时间线和内容转折，不要跳过任何一段字幕覆盖的时间。
8. 不要编造字幕中完全不存在的核心情节；可以结合剧情简介进行归纳，但不能脱离素材内容。
9. 如果素材信息不足，也必须返回包含 scenes 的 JSON 对象；至少输出 1 个场景，但不要伪造太多细节。
`;

/**
 * 用户提示词只负责注入本次素材上下文。
 *
 * 这样拆分之后，后续可以：
 * - 只替换系统提示词做策略升级；
 * - 或只扩展输入内容而不改 service 层。
 */
export const buildStoryOutlineUserPrompt = ({
  mediaTitle,
  synopsis,
  srtContent,
}: StoryOutlineGenerationInput) => `
请根据以下素材信息提取剧情大纲。

素材标题：
${mediaTitle}

剧情简介：
${synopsis}

SRT 字幕：
${srtContent}

请只返回形如 {"scenes":[...]} 的 JSON 对象。
`;
