import { LicenseFeatureKey, LicenseMode } from "@/lib/license/types";

export interface LicenseFeatureCatalogEntry {
  key: LicenseFeatureKey;
  name: string;
  description: string;
  includedInMode: LicenseMode;
}

/**
 * 功能目录是“授权模式”和“具体能力”之间的桥梁。
 *
 * 规则：
 * - `includedInMode` 表示该功能默认属于哪个售卖档位。
 * - 运行时真正是否开启，还要再叠加本地/远端的 feature override。
 *
 * 这样以后新增功能时，只需要在这里注册一个新条目，
 * 就能同时服务于：
 * - 用户页展示
 * - 后台授权配置
 * - API 权限判断
 */
export const LICENSE_FEATURE_CATALOG: LicenseFeatureCatalogEntry[] = [
  {
    key: "base.app_access",
    name: "应用基础访问",
    description: "进入应用、查看基础页面和本机授权信息。",
    includedInMode: "basic",
  },
  {
    key: "base.project_management",
    name: "项目管理",
    description: "创建、编辑、删除和切换项目。",
    includedInMode: "basic",
  },
  {
    key: "base.material_management",
    name: "素材管理",
    description: "导入、删除素材并维护剧情简介与字幕文本。",
    includedInMode: "basic",
  },
  {
    key: "base.playback",
    name: "基础播放",
    description: "播放视频、跳转时间点并查看基础高亮信息。",
    includedInMode: "basic",
  },
  {
    key: "base.outline_basic",
    name: "基础剧情大纲",
    description: "执行基础剧情大纲提取并浏览场景列表。",
    includedInMode: "basic",
  },
  {
    key: "base.search_basic",
    name: "基础剧情搜索",
    description: "使用关键词方式搜索项目中的剧情片段。",
    includedInMode: "basic",
  },
  {
    key: "base.settings_basic",
    name: "基础设置",
    description: "维护素材目录和基础 AI 配置。",
    includedInMode: "basic",
  },
  {
    key: "pro.marker",
    name: "标记与审片",
    description: "创建、编辑、删除标记并按标记跳转回看。",
    includedInMode: "pro",
  },
  {
    key: "pro.outline_advanced",
    name: "高级剧情大纲",
    description: "预留更细粒度、更丰富策略的大纲提取能力。",
    includedInMode: "pro",
  },
  {
    key: "pro.search_advanced",
    name: "高级剧情搜索",
    description: "启用语义搜索和大模型搜索等高级检索策略。",
    includedInMode: "pro",
  },
  {
    key: "pro.video_editing",
    name: "视频编辑",
    description: "预留时间线、片段裁切等后续剪辑能力。",
    includedInMode: "pro",
  },
  {
    key: "pro.export",
    name: "导出与切片",
    description: "预留片段导出和结果导出等专业能力。",
    includedInMode: "pro",
  },
  {
    key: "pro.workflow_advanced",
    name: "高级工作流",
    description: "预留批量处理与专业效率增强能力。",
    includedInMode: "pro",
  },
];

export const getLicenseFeatureCatalogEntry = (key: LicenseFeatureKey) =>
  LICENSE_FEATURE_CATALOG.find((entry) => entry.key === key);
