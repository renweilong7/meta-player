"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectItem, ProjectView } from "@/components/project-view";
import { SidebarMenu } from "@/components/sidebar-menu";
import { MediaLibrary, MediaItem } from "@/components/media-library";
import { VideoEditorWorkspace } from "@/components/video-editor-workspace";
import {
  AppSettingsValues,
  SettingsPanel,
} from "@/components/settings-panel";
import { UserPanel } from "@/components/user-panel";
import { UnauthorizedHome } from "@/components/unauthorized-home";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/video-player";
import {
  StoryOutline,
  StoryOutlineSearchDisplayItem,
} from "@/components/story-outline";
import { UsagePanel } from "@/components/usage-panel";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  fetchLibrarySnapshot,
  fetchAiUsageSnapshot,
  fetchAuthorizationSnapshot,
  refreshAuthorizationSnapshot,
  validateMediaToolExecutables,
  importMaterials,
  indexMaterialOutline,
  combineProjectScriptItems,
  patchProject,
  searchProjectStoryOutline,
  uploadProjectAudio,
  createProjectScriptClip,
  compileProjectClipSequence,
  patchMaterial,
  generateMaterialSceneShotAnalysis,
  patchMaterialMarker,
  postMaterialMarker,
  postProject,
  putSettings,
  removeMaterial,
  removeMaterialMarker,
  removeProject,
} from "@/lib/persistence/client";
import {
  installGlobalClientDiagnostics,
  reportClientDiagnosticEvent,
} from "@/lib/observability/client";
import { AuthorizationSnapshot } from "@/lib/license/types";
import { hasAuthorizedFeature, isAuthorizedStatus } from "@/lib/license/utils";
import {
  MaterialImportInput,
  CrossAssetSwitchMode,
  PersistedAiUsageSnapshot,
  PersistedProjectClip,
  PersistedProjectClipCompilation,
  PersistedProjectScriptMatchResult,
  PersistedProjectScriptAudio,
} from "@/lib/persistence/types";
import { getSelectedProjectClipSequence } from "@/lib/project-clips/sequence";
import { parseProjectScriptBlocks } from "@/lib/project-script/srt";
import { extractSubtitleBlocksInRange } from "@/lib/project-script/srt";
import {
  generateStoryOutline,
  mapStoryOutlineToScenes,
} from "@/lib/story-outline/service";
import { resolveTextModelProviderConfig } from "@/lib/ai/provider-config";
import { SceneShotAnalysis, StoryScene } from "@/lib/story-outline/types";
import { StoryOutlineSearchResult } from "@/lib/story-outline/search";

const defaultSettings: AppSettingsValues = {
  materialSavePath: "",
  defaultManagedImport: false,
  ffmpegExecutablePath: "",
  ffprobeExecutablePath: "",
  aiTextProvider: "openai_compatible",
  openaiApiBaseUrl: "https://api.openai.com/v1",
  openaiApiKey: "",
  grok2apiBaseUrl:
    process.env.NEXT_PUBLIC_META_PLAYER_GROK2API_BASE_URL?.trim() ||
    "http://127.0.0.1:8000/v1",
  grok2apiApiKey: "",
  openaiTextModelName: "gpt-4o-mini",
  grok2apiTextModelName: "grok-2-latest",
  aiVisionBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
  aiVisionApiKey: "",
  aiVisionModelName: "qwen3.6-plus",
  aiVisionFps: "2",
  storySearchProvider: "keyword",
  aiSearchProvider: "openai_compatible",
  aiSearchModelName: "gpt-4o-mini",
  localTtsModelName: "Tingting",
  autoGenerateProjectScriptTts: true,
  crossAssetSwitchMode: "frame_hold",
};

const defaultUsageSnapshot: PersistedAiUsageSnapshot = {
  summary: {
    totalCalls: 0,
    successCalls: 0,
    errorCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
  },
  records: [],
};

const normalizeAppSettingsValues = (
  values: Partial<AppSettingsValues> | AppSettingsValues
): AppSettingsValues => ({
  ...defaultSettings,
  ...values,
});

const LEGACY_PROJECT_STORAGE_KEY = "meta-player-projects";

const loadLegacyProjects = (materials: MediaItem[]) => {
  if (typeof window === "undefined") {
    return [] as ProjectItem[];
  }

  const rawValue = window.localStorage.getItem(LEGACY_PROJECT_STORAGE_KEY);
  if (!rawValue) {
    return [] as ProjectItem[];
  }

  const validMaterialIds = new Set(materials.map((item) => item.id));

  try {
    const parsed = JSON.parse(rawValue) as ProjectItem[];
    if (!Array.isArray(parsed)) {
      return [] as ProjectItem[];
    }

    return parsed
      .filter(
        (item) =>
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          Array.isArray(item.materialIds)
      )
      .map((item) => ({
        ...item,
        materialIds: item.materialIds.filter((id) => validMaterialIds.has(id)),
        scriptItems: Array.isArray(item.scriptItems) ? item.scriptItems : [],
        scriptClips: Array.isArray(item.scriptClips) ? item.scriptClips : [],
      }));
  } catch {
    return [] as ProjectItem[];
  }
};

/**
 * 把服务端返回的素材数组转成当前列表顺序。
 *
 * 新素材和被更新的素材都要顶到前面，这样列表排序与数据库的 updated_at 一致，
 * 用户也能马上看到刚刚编辑过的项。
 */
const mergeMaterialIntoList = (previous: MediaItem[], nextItem: MediaItem) => {
  const withoutCurrent = previous.filter((item) => item.id !== nextItem.id);
  return [nextItem, ...withoutCurrent];
};

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
};

const buildProjectClipSequenceSignature = (clipIds: string[]) => clipIds.join("|");

const buildProjectCompilationFilename = (projectName: string) =>
  `${projectName.replace(/[\\/:*?"<>|]+/g, " ").trim() || "项目成片"} 成片.mp4`;

type DesktopBridge = {
  chooseExportPath?: (defaultPath: string) => Promise<string | null>;
  chooseDirectory?: (defaultPath: string) => Promise<string | null>;
  saveFile?: (targetPath: string, bytes: Uint8Array) => Promise<string>;
  openPath?: (targetPath: string) => Promise<string>;
  exportDiagnostics?: () => Promise<string>;
};

export default function VideoEditorPage() {
  const [activeMenu, setActiveMenu] = useState("home");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(null);
  const [pendingMarkerTime, setPendingMarkerTime] = useState<number | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [settings, setSettings] = useState<AppSettingsValues>(defaultSettings);
  const [savedSettings, setSavedSettings] = useState<AppSettingsValues>(defaultSettings);
  const [usageSnapshot, setUsageSnapshot] =
    useState<PersistedAiUsageSnapshot>(defaultUsageSnapshot);
  const [isRefreshingUsage, setIsRefreshingUsage] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isCheckingMediaTools, setIsCheckingMediaTools] = useState(false);
  const [mediaToolsCheckResult, setMediaToolsCheckResult] = useState<{
    ffmpeg: {
      ok: boolean;
      resolvedPath: string | null;
      version: string | null;
      message: string;
    };
    ffprobe: {
      ok: boolean;
      resolvedPath: string | null;
      version: string | null;
      message: string;
    };
  } | null>(null);
  const [isRefreshingAuthorization, setIsRefreshingAuthorization] = useState(false);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [authorizationError, setAuthorizationError] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<AuthorizationSnapshot | null>(
    null
  );
  const [pendingOutlineSearchResult, setPendingOutlineSearchResult] =
    useState<StoryOutlineSearchResult | null>(null);
  const [outlineSearchQuery, setOutlineSearchQuery] = useState("");
  const [outlineSearchState, setOutlineSearchState] = useState<
    "idle" | "loading" | "keyword" | "llm"
  >("idle");
  const [outlineSearchResults, setOutlineSearchResults] = useState<
    StoryOutlineSearchResult[]
  >([]);
  const [currentOutlineSearchResultId, setCurrentOutlineSearchResultId] = useState<
    string | null
  >(null);
  const [pendingProjectScriptAction, setPendingProjectScriptAction] = useState<{
    mode: "locate" | "play";
    assetId: string;
    startSeconds: number;
    endSeconds: number | null;
    durationSeconds: number;
  } | null>(null);
  const [playerPendingStartTime, setPlayerPendingStartTime] = useState<number | null>(
    null
  );
  const [frameHoldPreviewSrc, setFrameHoldPreviewSrc] = useState<string | null>(null);
  const [preloadTarget, setPreloadTarget] = useState<{
    assetId: string;
    startSeconds: number;
  } | null>(null);
  const [previewProjectClip, setPreviewProjectClip] =
    useState<PersistedProjectClip | null>(null);
  const [previewProjectCompilation, setPreviewProjectCompilation] =
    useState<PersistedProjectClipCompilation | null>(null);
  const [previewProjectCompilationSignature, setPreviewProjectCompilationSignature] =
    useState<string | null>(null);
  const [activeProjectScriptItemId, setActiveProjectScriptItemId] = useState<string | null>(
    null
  );
  const [selectedProjectClipVersionByItemId, setSelectedProjectClipVersionByItemId] =
    useState<Record<string, string>>({});
  const [isProjectScriptPlaybackActive, setIsProjectScriptPlaybackActive] =
    useState(false);
  const [muteVideoDuringScriptPlayback, setMuteVideoDuringScriptPlayback] =
    useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isCompilingProjectClips, setIsCompilingProjectClips] = useState(false);
  const [isExportingProjectClips, setIsExportingProjectClips] = useState(false);
  const [lastExportedCompilationPath, setLastExportedCompilationPath] =
    useState<string | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const projectScriptPlaybackTimerRef = useRef<number | null>(null);

  useEffect(() => installGlobalClientDiagnostics(), []);

  const loadAuthorizationSnapshot = async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") {
      setIsRefreshingAuthorization(true);
    }

    try {
      const snapshot =
        mode === "refresh"
          ? await refreshAuthorizationSnapshot()
          : await fetchAuthorizationSnapshot();
      setAuthorization(snapshot);
      setAuthorizationError(null);
      return snapshot;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "读取授权状态失败。";
      setAuthorizationError(message);
      throw error;
    } finally {
      if (mode === "refresh") {
        setIsRefreshingAuthorization(false);
      }
    }
  };

  const refreshUsageSnapshot = async () => {
    try {
      setIsRefreshingUsage(true);
      const snapshot = await fetchAiUsageSnapshot();
      setUsageSnapshot(snapshot);
    } catch (error) {
      void reportClientDiagnosticEvent({
        level: "warn",
        event: "usage.refresh_failed",
        error,
      });
      setLibraryError(
        error instanceof Error ? error.message : "读取 AI 用量统计失败。"
      );
    } finally {
      setIsRefreshingUsage(false);
    }
  };

  const currentProject = projects.find((item) => item.id === currentProjectId) ?? null;
  const visibleMediaItems = currentProject
    ? mediaItems.filter((item) => currentProject.materialIds.includes(item.id))
    : [];
  const selectedMedia = visibleMediaItems.find((item) => item.id === selectedMediaId);
  const selectedStoryScenes: StoryScene[] = useMemo(() => {
    const baseScenes = mapStoryOutlineToScenes(selectedMedia?.storyOutline ?? []);
    const rawSrtContent = selectedMedia?.srtContent?.trim();

    if (!rawSrtContent) {
      return baseScenes;
    }

    return baseScenes.map((scene) => ({
      ...scene,
      subtitleEntries: extractSubtitleBlocksInRange(rawSrtContent, {
        startSeconds: scene.seekTime,
        endSeconds: scene.seekTime + parseTimeRangeDuration(scene.timestamp),
      }).map((block) => ({
        id: block.id,
        startSeconds: block.startSeconds,
        endSeconds: block.endSeconds,
        timeline: block.timeline,
        content: block.content,
      })),
    }));
  }, [selectedMedia?.storyOutline, selectedMedia?.srtContent]);
  const outlineSearchDisplayItems: StoryOutlineSearchDisplayItem[] = useMemo(
    () =>
      outlineSearchResults.map((result) => {
        const targetMedia = visibleMediaItems.find((item) => item.id === result.assetId);
        const targetSceneRecord = targetMedia?.storyOutline?.find(
          (scene) => scene.id === result.sceneId
        );
        const mappedScene = targetSceneRecord
          ? mapStoryOutlineToScenes([targetSceneRecord])[0]
          : {
              id: result.sceneId,
              title: result.sceneTitle,
              description: result.sceneDescription,
              duration: formatDurationLabel(result.endSeconds - result.startSeconds),
              timestamp: result.timestamp,
              seekTime: result.startSeconds,
            };
        const rawSrtContent = targetMedia?.srtContent?.trim();
        const subtitleEntries = rawSrtContent
          ? extractSubtitleBlocksInRange(rawSrtContent, {
              startSeconds: result.startSeconds,
              endSeconds: result.endSeconds,
            }).map((block) => ({
              id: block.id,
              startSeconds: block.startSeconds,
              endSeconds: block.endSeconds,
              timeline: block.timeline,
              content: block.content,
            }))
          : undefined;

        return {
          id: result.id,
          assetId: result.assetId,
          assetTitle: result.assetTitle,
          score: result.score,
          result,
          scene: {
            ...mappedScene,
            subtitleEntries,
          },
        };
      }),
    [outlineSearchResults, visibleMediaItems]
  );
  const outlineMediaOptions = useMemo(
    () =>
      visibleMediaItems
        .filter((item) => (item.storyOutline?.length ?? 0) > 0)
        .map((item) => ({
          id: item.id,
          title: item.title,
          outlineSceneCount: item.storyOutline?.length ?? 0,
        })),
    [visibleMediaItems]
  );
  const selectedMediaHighlight = Object.fromEntries(
    (selectedMedia?.markers ?? []).map((marker) => [marker.time, marker.content])
  ) as Record<number, string>;
  const preloadMedia = preloadTarget
    ? mediaItems.find((item) => item.id === preloadTarget.assetId)
    : null;
  const projectScriptItemOrder = parseProjectScriptItemOrder(
    currentProject?.scriptSrtContent
  );
  const selectedProjectClipSequence = useMemo(
    () =>
      getSelectedProjectClipSequence(
        currentProject?.scriptClips ?? [],
        projectScriptItemOrder,
        selectedProjectClipVersionByItemId
      ),
    [currentProject?.scriptClips, projectScriptItemOrder, selectedProjectClipVersionByItemId]
  );
  const selectedProjectClipSequenceSignature = useMemo(
    () => buildProjectClipSequenceSignature(selectedProjectClipSequence.map((clip) => clip.id)),
    [selectedProjectClipSequence]
  );
  const isPreviewingCurrentProjectCompilation =
    previewProjectCompilation !== null &&
    previewProjectCompilationSignature === selectedProjectClipSequenceSignature;
  const hasPendingSettingsChanges =
    JSON.stringify(normalizeAppSettingsValues(settings)) !==
    JSON.stringify(normalizeAppSettingsValues(savedSettings));
  const isAuthorized = isAuthorizedStatus(authorization?.status);
  const canManageProjects = hasAuthorizedFeature(
    authorization,
    "base.project_management"
  );
  const canManageMaterials = hasAuthorizedFeature(
    authorization,
    "base.material_management"
  );
  const canUsePlayback = hasAuthorizedFeature(authorization, "base.playback");
  const canUseOutlineBasic = hasAuthorizedFeature(
    authorization,
    "base.outline_basic"
  );
  const canUseOutlineSearch = hasAuthorizedFeature(
    authorization,
    "base.search_basic"
  );
  const canManageSettings = hasAuthorizedFeature(
    authorization,
    "base.settings_basic"
  );
  const canManageMarkers = hasAuthorizedFeature(authorization, "pro.marker");
  const markerDisabledReason =
    selectedMedia && !canManageMarkers
      ? "当前设备未授权，标记与审片功能暂不可用。"
      : null;

  const clearProjectPreviewPlayback = () => {
    setPreviewProjectClip(null);
    setPreviewProjectCompilation(null);
    setPreviewProjectCompilationSignature(null);
  };

  const captureFrameHoldPreview = () => {
    if ((currentProject?.crossAssetSwitchMode ?? "frame_hold") !== "frame_hold") {
      return;
    }

    setFrameHoldPreviewSrc(playerRef.current?.captureCurrentFrame() ?? null);
  };

  /**
   * 首屏统一加载持久化快照。
   *
   * 这里一次性把素材列表和设置拉回来，避免前端在多个接口之间做拼装。
   */
  useEffect(() => {
    let isActive = true;

    const loadSnapshot = async () => {
      setIsBootstrapping(true);
      setLibraryError(null);

      try {
        const snapshot = await fetchLibrarySnapshot();
        const legacyProjects =
          snapshot.projects.length === 0 ? loadLegacyProjects(snapshot.materials) : [];
        const nextProjects =
          legacyProjects.length === 0
            ? snapshot.projects
            : await Promise.all(
                legacyProjects.map(async (project) => {
                  const createdProject = await postProject({
                    name: project.name,
                    description: project.description,
                    storySearchProvider: snapshot.settings.storySearchProvider,
                  });

                  if (project.materialIds.length === 0) {
                    return createdProject;
                  }

                  return patchProject(createdProject.id, {
                    materialIds: project.materialIds,
                  });
                })
              );

        if (!isActive) {
          return;
        }

        setMediaItems(snapshot.materials);
        const normalizedSettings = normalizeAppSettingsValues(snapshot.settings);
        setSettings(normalizedSettings);
        setSavedSettings(normalizedSettings);
        setUsageSnapshot(snapshot.usage ?? defaultUsageSnapshot);
        setProjects(nextProjects);
        setCurrentProjectId((current) => current ?? nextProjects[0]?.id ?? null);

        if (legacyProjects.length > 0 && typeof window !== "undefined") {
          window.localStorage.removeItem(LEGACY_PROJECT_STORAGE_KEY);
        }
      } catch (error) {
        if (!isActive) {
          return;
        }

        setLibraryError(
          error instanceof Error ? error.message : "初始化持久化数据失败。"
        );
      } finally {
        if (isActive) {
          setIsBootstrapping(false);
        }
      }
    };

    void loadSnapshot();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    void loadAuthorizationSnapshot("initial").catch((error) => {
      void reportClientDiagnosticEvent({
        level: "warn",
        event: "authorization.initial_load_failed",
        error,
      });

      if (!isActive) {
        return;
      }
    });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (
      authorization &&
      !isAuthorized &&
      activeMenu !== "home" &&
      activeMenu !== "user"
    ) {
      setActiveMenu("home");
    }
  }, [activeMenu, authorization, isAuthorized]);

  /**
   * 当项目范围内的当前选中素材被删除或切换项目后，自动切到列表第一项。
   */
  useEffect(() => {
    if (visibleMediaItems.length === 0) {
      setSelectedMediaId(null);
      return;
    }

    const stillExists = visibleMediaItems.some((item) => item.id === selectedMediaId);
    if (!stillExists) {
      setSelectedMediaId(visibleMediaItems[0].id);
    }
  }, [selectedMediaId, visibleMediaItems]);

  const applyLocalMediaPatch = (id: string, updates: Partial<MediaItem>) => {
    setMediaItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const replaceMaterialInState = (item: MediaItem) => {
    setMediaItems((previous) => mergeMaterialIntoList(previous, item));
  };

  const handleUpdateMediaItem = async (id: string, updates: Partial<MediaItem>) => {
    setLibraryError(null);

    try {
      const updated = await patchMaterial(id, {
        synopsis: updates.synopsis,
        srtContent: updates.srtContent,
        storyOutline: updates.storyOutline,
        outlineExtractionStatus: updates.outlineExtractionStatus,
        outlineExtractionError: updates.outlineExtractionError,
      });

      replaceMaterialInState(updated);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "更新素材失败。"
      );
      throw error;
    }
  };

  const updateSceneShotAnalysisInOutline = (
    mediaId: string,
    sceneId: string,
    shotAnalysis: SceneShotAnalysis
  ) => {
    const targetMedia = mediaItems.find((item) => item.id === mediaId);
    if (!targetMedia?.storyOutline) {
      return null;
    }

    return targetMedia.storyOutline.map((scene) =>
      scene.id === sceneId
        ? {
            ...scene,
            shotAnalysis,
          }
        : scene
    );
  };

  /**
   * 导入时把文件直接交给服务端：
   * - 服务端负责复制到托管目录。
   * - 服务端负责按内容哈希去重。
   * - 前端只负责更新当前列表顺序。
   */
  const handleAddMaterials = async (files: File[]) => {
    setLibraryError(null);
    try {
      /**
       * Electron 的 File 对象通常会带上非标准 `path` 字段；
       * 这里把它透传给后端，让持久化层优先引用原文件，而不是默认复制到托管目录。
       */
      const importInputs: MaterialImportInput[] = files.map((file) => {
        const fileWithPath = file as File & { path?: string };

        return {
          file,
          originalPath: fileWithPath.path,
        };
      });
      const importedItems = await importMaterials(importInputs, currentProjectId ?? undefined);

      setMediaItems((previous) =>
        importedItems.reduce(
          (accumulator, item) => mergeMaterialIntoList(accumulator, item),
          previous
        )
      );

      if (currentProjectId && importedItems.length > 0) {
        setProjects((previous) =>
          previous.map((project) =>
            project.id === currentProjectId
              ? {
                  ...project,
                  materialIds: [
                    ...new Set([
                      ...importedItems.map((item) => item.id),
                      ...project.materialIds,
                    ]),
                  ],
                }
              : project
          )
        );
      }

      if (importedItems.length > 0) {
        setSelectedMediaId(importedItems[0].id);
      }
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "导入素材失败。"
      );
      throw error;
    }
  };

  const handleDeleteMediaItem = async (id: string) => {
    setLibraryError(null);
    try {
      await removeMaterial(id);
      setMediaItems((previous) => previous.filter((item) => item.id !== id));
      setProjects((previous) =>
        previous.map((project) =>
          project.materialIds.includes(id)
            ? {
                ...project,
                materialIds: project.materialIds.filter((itemId) => itemId !== id),
              }
            : project
        )
      );
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "删除素材失败。"
      );
      throw error;
    }
  };

  const handleCreateProject = async (input: {
    name: string;
    description?: string;
    storySearchProvider: ProjectItem["storySearchProvider"];
  }) => {
    const nextProject = await postProject(input);
    setProjects((previous) => [nextProject, ...previous]);
    setCurrentProjectId(nextProject.id);
  };

  const handleUpdateProject = (
    id: string,
    updates: {
      name?: string;
      description?: string;
      storySearchProvider?: ProjectItem["storySearchProvider"];
      materialIds?: string[];
      crossAssetSwitchMode?: CrossAssetSwitchMode;
      autoTrimIntroOutro?: boolean;
      introTrimSeconds?: number;
      outroTrimSeconds?: number;
      scriptSrtContent?: string;
      scriptAudio?: PersistedProjectScriptAudio | null;
    }
  ) => {
    void patchProject(id, updates).then((updatedProject) => {
      setProjects((previous) =>
        previous.map((project) =>
          project.id === updatedProject.id ? updatedProject : project
        )
      );
    });
  };

  const handleUpdateCurrentProjectScript = async (updates: {
    scriptSrtContent?: string;
    scriptAudio?: PersistedProjectScriptAudio | null;
  }) => {
    if (!currentProjectId) {
      return;
    }

    setLibraryError(null);

    try {
      const updatedProject = await patchProject(currentProjectId, {
        ...updates,
        ...(updates.scriptSrtContent !== undefined ? { scriptMatchResults: {} } : {}),
      });
      setProjects((previous) =>
        previous.map((project) =>
          project.id === updatedProject.id ? updatedProject : project
        )
      );
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "更新项目脚本失败。"
      );
      throw error;
    }
  };

  const handleUploadCurrentProjectAudio = async (file: File) => {
    if (!currentProjectId) {
      return;
    }

    setLibraryError(null);

    try {
      const fileWithPath = file as File & { path?: string };
      const updatedProject = await uploadProjectAudio(currentProjectId, {
        file,
        originalPath: fileWithPath.path,
      });
      setProjects((previous) =>
        previous.map((project) =>
          project.id === updatedProject.id ? updatedProject : project
        )
      );
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "导入项目音频失败。"
      );
      throw error;
    }
  };

  const handleCombineProjectScriptItems = async (input: {
    itemIds: string[];
  }) => {
    if (!currentProjectId) {
      return;
    }

    setLibraryError(null);

    try {
      const updatedProject = await combineProjectScriptItems(currentProjectId, input);
      setProjects((previous) =>
        previous.map((project) =>
          project.id === updatedProject.id ? updatedProject : project
        )
      );
      setActiveProjectScriptItemId(input.itemIds[0] ?? null);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "组合项目文案失败。"
      );
      throw error;
    }
  };

  const handleDeleteProject = async (id: string) => {
    await removeProject(id);
    setProjects((previous) => {
      const nextProjects = previous.filter((project) => project.id !== id);

      if (currentProjectId === id) {
        setCurrentProjectId(nextProjects[0]?.id ?? null);
      }

      if (nextProjects.length === 0) {
        setActiveMenu("home");
      }

      return nextProjects;
    });
  };

  const handleOpenProject = (projectId: string) => {
    clearProjectPreviewPlayback();
    setActiveProjectScriptItemId(null);
    setCurrentProjectId(projectId);
    setActiveMenu("videos");
  };

  const handleSceneSelect = (id: string) => {
    const selectedScene = selectedStoryScenes.find((scene) => scene.id === id);
    if (!selectedScene) {
      return;
    }

    clearProjectPreviewPlayback();
    setCurrentSceneId(id);

    if ((previewProjectClip || previewProjectCompilation) && selectedMedia) {
      setPlayerPendingStartTime(selectedScene.seekTime);
      setPendingProjectScriptAction({
        mode: "locate",
        assetId: selectedMedia.id,
        startSeconds: selectedScene.seekTime,
        endSeconds: null,
        durationSeconds: 0,
      });
      return;
    }

    playerRef.current?.seekTo(selectedScene.seekTime);
    if (activeProjectScriptItemId && selectedMedia?.mediaType === "video" && currentProjectId) {
      void patchProject(currentProjectId, {
        scriptMatchResults: {
          ...(currentProject?.scriptMatchResults ?? {}),
          [activeProjectScriptItemId]: {
            assetId: selectedMedia.id,
            assetTitle: selectedMedia.title,
            startSeconds: selectedScene.seekTime,
          },
        },
      }).then((updatedProject) => {
        setProjects((previous) =>
          previous.map((project) =>
            project.id === updatedProject.id ? updatedProject : project
          )
        );
      }).catch((error) => {
        setLibraryError(
          error instanceof Error ? error.message : "更新剧情匹配时间失败。"
        );
      });
    }
  };

  const handleSceneSubtitleSelect = (
    sceneId: string,
    time: number,
    mediaId?: string
  ) => {
    const targetMediaId = mediaId ?? selectedMediaId;
    if (!targetMediaId) {
      return;
    }

    setCurrentSceneId(sceneId);
    clearProjectPreviewPlayback();

    if (selectedMedia?.id === targetMediaId) {
      playerRef.current?.seekTo(time);
      return;
    }

    captureFrameHoldPreview();
    setPlayerPendingStartTime(time);
    setPendingOutlineSearchResult(null);
    setSelectedMediaId(targetMediaId);
  };

  const handleSelectOutlineSearchResult = (result: StoryOutlineSearchResult) => {
    setCurrentOutlineSearchResultId(result.id);
    clearProjectPreviewPlayback();
    setPlayerPendingStartTime(result.startSeconds);

    if (selectedMedia?.id === result.assetId) {
      setCurrentSceneId(result.sceneId);
      playerRef.current?.seekTo(result.startSeconds);
      setPendingOutlineSearchResult(null);
      return;
    }

    captureFrameHoldPreview();

    setSelectedMediaId(result.assetId);
    setCurrentSceneId(result.sceneId);
    setPendingOutlineSearchResult(result);
  };

  const handleSearchOutline = async () => {
    if (!currentProjectId || !outlineSearchQuery.trim()) {
      setOutlineSearchState("idle");
      setOutlineSearchResults([]);
      setCurrentOutlineSearchResultId(null);
      return;
    }

    setLibraryError(null);
    setOutlineSearchState("loading");
    setCurrentOutlineSearchResultId(null);

    try {
      const result = await searchProjectStoryOutline(
        currentProjectId,
        outlineSearchQuery.trim(),
        20
      );
      setOutlineSearchState(result.mode);
      setOutlineSearchResults(result.results);
    } catch (error) {
      setOutlineSearchState("idle");
      setOutlineSearchResults([]);
      setLibraryError(
        error instanceof Error ? error.message : "剧情大纲搜索失败。"
      );
    } finally {
      void refreshUsageSnapshot();
    }
  };

  const handleClearOutlineSearch = () => {
    setOutlineSearchQuery("");
    setOutlineSearchState("idle");
    setOutlineSearchResults([]);
    setCurrentOutlineSearchResultId(null);
  };

  const clearProjectScriptPlaybackTimer = () => {
    if (projectScriptPlaybackTimerRef.current === null) {
      return;
    }

    window.clearTimeout(projectScriptPlaybackTimerRef.current);
    projectScriptPlaybackTimerRef.current = null;
  };

  const handleMatchProjectScriptItem = async (item: {
    id: string;
    content: string;
  }) => {
    if (!currentProjectId || !item.content.trim()) {
      return null;
    }

    setLibraryError(null);

    try {
      const searchResult = await searchProjectStoryOutline(
        currentProjectId,
        item.content,
        1
      );
      const matchedResult = searchResult.results[0];

      if (!matchedResult) {
        setLibraryError("没有找到足够匹配的画面。");
        return null;
      }

      handleSelectOutlineSearchResult(matchedResult);
      const matchedAsset = mediaItems.find((media) => media.id === matchedResult.assetId);
      const persistedMatchResult: PersistedProjectScriptMatchResult = {
        assetId: matchedResult.assetId,
        assetTitle: matchedAsset?.title ?? "未命名素材",
        startSeconds: matchedResult.startSeconds,
      };

      const updatedProject = await patchProject(currentProjectId, {
        scriptMatchResults: {
          ...(currentProject?.scriptMatchResults ?? {}),
          [item.id]: persistedMatchResult,
        },
      });
      setProjects((previous) =>
        previous.map((project) =>
          project.id === updatedProject.id ? updatedProject : project
        )
      );

      return persistedMatchResult;
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "匹配画面失败。"
      );
      return null;
    } finally {
      void refreshUsageSnapshot();
    }
  };

  const handleOffsetProjectScriptWindow = (input: {
    itemId: string;
    offsetSeconds: number;
    anchorSeconds: number;
  }) => {
    if (!selectedMedia || selectedMedia.mediaType !== "video") {
      return null;
    }

    const currentPlayerTime = Math.max(playerRef.current?.getCurrentTime() ?? 0, 0);
    const nextStartSeconds = Math.max(currentPlayerTime + input.offsetSeconds, 0);
    playerRef.current?.seekTo(nextStartSeconds);

    if (currentProjectId) {
      const nextMatch = {
        assetId: selectedMedia.id,
        assetTitle: selectedMedia.title,
        startSeconds: nextStartSeconds,
      };

      void patchProject(currentProjectId, {
        scriptMatchResults: {
          ...(currentProject?.scriptMatchResults ?? {}),
          [input.itemId]: nextMatch,
        },
      }).then((updatedProject) => {
        setProjects((previous) =>
          previous.map((project) =>
            project.id === updatedProject.id ? updatedProject : project
          )
        );
      }).catch((error) => {
        setLibraryError(
          error instanceof Error ? error.message : "更新剧情匹配时间失败。"
        );
      });
    }

    return {
      assetId: selectedMedia.id,
      assetTitle: selectedMedia.title,
      startSeconds: nextStartSeconds,
    };
  };

  const handleLocateProjectScriptItem = (item: {
    itemId: string;
    assetId: string;
    startSeconds: number;
  }) => {
    setActiveProjectScriptItemId(item.itemId);
    if (previewProjectClip || previewProjectCompilation) {
      clearProjectPreviewPlayback();
      setPlayerPendingStartTime(item.startSeconds);
      setPendingProjectScriptAction({
        mode: "locate",
        assetId: item.assetId,
        startSeconds: item.startSeconds,
        endSeconds: null,
        durationSeconds: 0,
      });
      return;
    }

    if (selectedMedia?.id === item.assetId) {
      playerRef.current?.seekTo(item.startSeconds);
      return;
    }

    captureFrameHoldPreview();

    setSelectedMediaId(item.assetId);
    setCurrentSceneId(null);
    setPlayerPendingStartTime(item.startSeconds);
    setPendingProjectScriptAction({
      mode: "locate",
      assetId: item.assetId,
      startSeconds: item.startSeconds,
      endSeconds: null,
      durationSeconds: 0,
    });
  };

  const handleStopProjectScriptSegment = () => {
    clearProjectScriptPlaybackTimer();
    playerRef.current?.pause();
    setIsProjectScriptPlaybackActive(false);
  };

  const handlePlayProjectScriptSegment = (item: {
    itemId: string;
    videoAssetId: string | null;
    audioStartSeconds: number;
    videoStartSeconds: number;
    audioEndSeconds: number | null;
    durationSeconds: number;
  }) => {
    const targetAssetId = item.videoAssetId ?? selectedMedia?.id ?? null;
    if (!targetAssetId) {
      return;
    }
    const shouldUseCurrentPlayerTime =
      item.itemId === activeProjectScriptItemId &&
      selectedMedia?.id === targetAssetId &&
      !previewProjectClip &&
      !previewProjectCompilation;
    const resolvedVideoStartSeconds = shouldUseCurrentPlayerTime
      ? Math.max(playerRef.current?.getCurrentTime() ?? item.videoStartSeconds, 0)
      : item.videoStartSeconds;

    clearProjectScriptPlaybackTimer();
    if (previewProjectClip || previewProjectCompilation) {
      clearProjectPreviewPlayback();
      setIsProjectScriptPlaybackActive(true);
      playerRef.current?.setMuted(muteVideoDuringScriptPlayback);
      setPlayerPendingStartTime(resolvedVideoStartSeconds);
      setPendingProjectScriptAction({
        mode: "play",
        assetId: targetAssetId,
        startSeconds: resolvedVideoStartSeconds,
        endSeconds: item.audioEndSeconds,
        durationSeconds: item.durationSeconds,
      });
      return;
    }
    if (selectedMedia?.id !== targetAssetId) {
      captureFrameHoldPreview();
      setSelectedMediaId(targetAssetId);
      setCurrentSceneId(null);
      setIsProjectScriptPlaybackActive(true);
      playerRef.current?.setMuted(muteVideoDuringScriptPlayback);
      setPlayerPendingStartTime(resolvedVideoStartSeconds);
      setPendingProjectScriptAction({
        mode: "play",
        assetId: targetAssetId,
        startSeconds: resolvedVideoStartSeconds,
        endSeconds: item.audioEndSeconds,
        durationSeconds: item.durationSeconds,
      });
      return;
    }

    setIsProjectScriptPlaybackActive(true);
    playerRef.current?.setMuted(muteVideoDuringScriptPlayback);
    playerRef.current?.seekTo(resolvedVideoStartSeconds);
    void playerRef.current?.play();

    const clipDurationSeconds =
      item.audioEndSeconds !== null && item.audioEndSeconds > item.audioStartSeconds
        ? item.audioEndSeconds - item.audioStartSeconds
        : item.durationSeconds;

    if (clipDurationSeconds <= 0) {
      return;
    }

    projectScriptPlaybackTimerRef.current = window.setTimeout(() => {
      handleStopProjectScriptSegment();
    }, clipDurationSeconds * 1000);
  };

  const handleCreateMarker = async (content: string) => {
    if (!selectedMediaId || pendingMarkerTime === null) {
      return;
    }

    if (!Number.isFinite(pendingMarkerTime)) {
      return;
    }

    try {
      const updated = await postMaterialMarker(selectedMediaId, {
        time: pendingMarkerTime,
        content,
      });

      replaceMaterialInState(updated);
      setSelectedMediaId(updated.id);
      setPendingMarkerTime(null);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "创建标记失败。"
      );
      throw error;
    }
  };

  const handleCreateProjectScriptClip = async (item: {
    scriptItemId: string;
    scriptContent: string;
    content: string;
    audioStartSeconds: number;
    durationSeconds: number;
  }) => {
    if (!currentProjectId || !selectedMedia || selectedMedia.mediaType !== "video") {
      setLibraryError("请先在播放器中选中一个视频素材。");
      return;
    }

    if (previewProjectClip || previewProjectCompilation) {
      setLibraryError("请先退出片段或成片预览，再生成新的项目片段。");
      return;
    }

    const startSeconds = Math.max(playerRef.current?.getCurrentTime() ?? 0, 0);
    setLibraryError(null);
    setActiveProjectScriptItemId(item.scriptItemId);

    try {
      const updatedProject = await createProjectScriptClip(currentProjectId, {
        scriptItemId: item.scriptItemId,
        scriptContent: item.scriptContent,
        assetId: selectedMedia.id,
        startSeconds,
        audioStartSeconds: item.audioStartSeconds,
        durationSeconds: item.durationSeconds,
        label: item.content,
      });

      setProjects((previous) =>
        previous.map((project) =>
          project.id === updatedProject.id ? updatedProject : project
        )
      );
      const syncedProject = await patchProject(currentProjectId, {
        scriptMatchResults: {
          ...(updatedProject.scriptMatchResults ?? {}),
          [item.scriptItemId]: {
            assetId: selectedMedia.id,
            assetTitle: selectedMedia.title,
            startSeconds,
          },
        },
      });
      setProjects((previous) =>
        previous.map((project) =>
          project.id === syncedProject.id ? syncedProject : project
        )
      );
      const latestClip = syncedProject.scriptClips.find(
        (clip) => clip.scriptItemId === item.scriptItemId
      );

      if (latestClip) {
        setSelectedProjectClipVersionByItemId((previous) => ({
          ...previous,
          [item.scriptItemId]: latestClip.id,
        }));
      }
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "生成片段失败。"
      );
      throw error;
    }
  };

  const handlePreviewProjectClip = (clip: PersistedProjectClip) => {
    setPreviewProjectCompilation(null);
    setPreviewProjectCompilationSignature(null);
    setActiveProjectScriptItemId(clip.scriptItemId);
    setPreviewProjectClip(clip);
  };

  const handleSelectProjectClipVersion = (scriptItemId: string, clipId: string) => {
    setSelectedProjectClipVersionByItemId((previous) => ({
      ...previous,
      [scriptItemId]: clipId,
    }));
  };

  const handlePreviewProjectClipCompilation = async () => {
    if (!currentProjectId || selectedProjectClipSequence.length === 0) {
      setLibraryError("当前没有可合成的项目片段。");
      return;
    }

    setLibraryError(null);
    setIsCompilingProjectClips(true);

    try {
      const compilation = await compileProjectClipSequence(currentProjectId, {
        clipIds: selectedProjectClipSequence.map((clip) => clip.id),
        label: `${currentProject?.name ?? "当前项目"} 成片预览`,
      });

      setPreviewProjectClip(null);
      setPreviewProjectCompilation(compilation);
      setPreviewProjectCompilationSignature(selectedProjectClipSequenceSignature);
      setActiveProjectScriptItemId(null);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "合成预览失败。"
      );
    } finally {
      setIsCompilingProjectClips(false);
    }
  };

  const handleExportProjectClipCompilation = async () => {
    if (!currentProjectId || selectedProjectClipSequence.length === 0) {
      setLibraryError("当前没有可导出的项目片段。");
      return;
    }

    setLibraryError(null);
    setIsExportingProjectClips(true);

    try {
      const compilation =
        previewProjectCompilation &&
        previewProjectCompilationSignature === selectedProjectClipSequenceSignature
          ? previewProjectCompilation
          : await compileProjectClipSequence(currentProjectId, {
              clipIds: selectedProjectClipSequence.map((clip) => clip.id),
              label: `${currentProject?.name ?? "当前项目"} 成片`,
            });

      const response = await fetch(compilation.src);
      if (!response.ok) {
        throw new Error("导出成片文件读取失败。");
      }

      const blob = await response.blob();
      const desktopBridge = (
        window as typeof window & { metaPlayerDesktop?: DesktopBridge }
      ).metaPlayerDesktop;
      const desiredFilename = buildProjectCompilationFilename(
        currentProject?.name ?? "当前项目"
      );

      if (desktopBridge?.chooseExportPath) {
        const selectedPath = await desktopBridge.chooseExportPath(desiredFilename);
        if (!selectedPath) {
          return;
        }
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        if (!desktopBridge.saveFile) {
          throw new Error("当前桌面环境未启用文件写入能力。");
        }

        const savedPath = await desktopBridge.saveFile(selectedPath, uint8Array);
        setLastExportedCompilationPath(savedPath);
        return;
      }

      triggerBlobDownload(blob, desiredFilename);
      setLastExportedCompilationPath(desiredFilename);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "导出成片失败。"
      );
    } finally {
      setIsExportingProjectClips(false);
    }
  };

  const handleOpenExportDirectory = async () => {
    if (!lastExportedCompilationPath) {
      return;
    }

    const desktopBridge = (
      window as typeof window & { metaPlayerDesktop?: DesktopBridge }
    ).metaPlayerDesktop;

    if (!desktopBridge?.openPath) {
      setLibraryError("当前环境暂不支持直接打开导出目录。");
      return;
    }

    try {
      await desktopBridge.openPath(lastExportedCompilationPath);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "打开导出目录失败。"
      );
    }
  };

  const handleMarkStart = () => {
    clearProjectPreviewPlayback();
    playerRef.current?.pause();
    setPendingMarkerTime(playerRef.current?.getCurrentTime() ?? 0);
  };

  const handleMarkEditStart = (time: number) => {
    clearProjectPreviewPlayback();
    playerRef.current?.pause();
    playerRef.current?.seekTo(time);
    setPendingMarkerTime(time);
  };

  const handleAdjustMarkerTime = (nextTime: number) => {
    clearProjectPreviewPlayback();
    setPendingMarkerTime(nextTime);
    playerRef.current?.seekTo(nextTime);
  };

  const handleUpdateMarker = async (markerId: string, content: string) => {
    if (!selectedMediaId || pendingMarkerTime === null) {
      return;
    }

    try {
      const updated = await patchMaterialMarker(selectedMediaId, markerId, {
        time: pendingMarkerTime,
        content,
      });

      replaceMaterialInState(updated);
      setSelectedMediaId(updated.id);
      setPendingMarkerTime(null);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "更新标记失败。"
      );
      throw error;
    }
  };

  const handleDeleteMarker = async (markerId: string) => {
    if (!selectedMediaId) {
      return;
    }

    try {
      await removeMaterialMarker(selectedMediaId, markerId);
      setMediaItems((previous) =>
        previous.map((item) =>
          item.id === selectedMediaId
            ? {
                ...item,
                markers: (item.markers ?? []).filter((marker) => marker.id !== markerId),
              }
            : item
        )
      );
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "删除标记失败。"
      );
      throw error;
    }
  };

  /**
   * 播放器时间轴变化时，反向同步当前剧情大纲项。
   *
   * 这里使用场景的时间区间做命中判断：
   * - 普通场景命中条件为 start <= time < end
   * - 最后一个场景允许命中到 end，避免播放到素材结尾时丢失选中态
   */
  const handlePlayerTimeChange = (time: number) => {
    if (selectedStoryScenes.length !== 0) {
      const matchedScene = selectedStoryScenes.find((scene, index) => {
        const [startTimecode, endTimecode] = scene.timestamp.split(" - ");
        const startSeconds = parseTimecodeToSeconds(startTimecode);
        const endSeconds = parseTimecodeToSeconds(endTimecode);
        const isLastScene = index === selectedStoryScenes.length - 1;

        if (isLastScene) {
          return time >= startSeconds && time <= endSeconds;
        }

        return time >= startSeconds && time < endSeconds;
      });

      if (matchedScene && matchedScene.id !== currentSceneId) {
        setCurrentSceneId(matchedScene.id);
      }
    }
  };

  const handleSettingsFieldChange = <K extends keyof AppSettingsValues>(
    field: K,
    value: AppSettingsValues[K]
  ) => {
    if (field === "ffmpegExecutablePath" || field === "ffprobeExecutablePath") {
      setMediaToolsCheckResult(null);
    }

    setSettings((previous) => ({ ...previous, [field]: value }));
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setLibraryError(null);

    try {
      const saved = normalizeAppSettingsValues(
        await putSettings(normalizeAppSettingsValues(settings))
      );
      setSettings(saved);
      setSavedSettings(saved);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "保存设置失败。"
      );
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleBrowseMaterialDirectory = () => {
    const desktopBridge = (
      window as typeof window & { metaPlayerDesktop?: DesktopBridge }
    ).metaPlayerDesktop;

    if (!desktopBridge?.chooseDirectory) {
      setLibraryError("当前桌面环境未启用目录选择能力。");
      return;
    }

    void desktopBridge
      .chooseDirectory(settings.materialSavePath)
      .then((selectedPath) => {
        if (!selectedPath) {
          return;
        }

        setSettings((previous) => ({
          ...previous,
          materialSavePath: selectedPath,
        }));
      })
      .catch((error) => {
        setLibraryError(
          error instanceof Error ? error.message : "选择素材目录失败。"
        );
      });
  };

  const handleCheckMediaTools = async () => {
    setLibraryError(null);
    setIsCheckingMediaTools(true);

    try {
      const result = await validateMediaToolExecutables({
        ffmpegExecutablePath: settings.ffmpegExecutablePath,
        ffprobeExecutablePath: settings.ffprobeExecutablePath,
      });
      setMediaToolsCheckResult(result);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "检测媒体工具路径失败。"
      );
    } finally {
      setIsCheckingMediaTools(false);
    }
  };

  const handleRefreshAuthorization = async () => {
    setLibraryError(null);

    try {
      await loadAuthorizationSnapshot("refresh");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "刷新授权状态失败。";
      setLibraryError(message);
    }
  };

  const handleExportDiagnostics = async () => {
    const desktopBridge = (
      window as typeof window & { metaPlayerDesktop?: DesktopBridge }
    ).metaPlayerDesktop;

    if (!desktopBridge?.exportDiagnostics) {
      setLibraryError("当前桌面环境未启用诊断导出能力。");
      return;
    }

    setIsExportingDiagnostics(true);
    setLibraryError(null);

    try {
      const bundleDirectory = await desktopBridge.exportDiagnostics();
      void reportClientDiagnosticEvent({
        level: "info",
        event: "diagnostics.exported",
        details: {
          bundleDirectory,
        },
      });

      if (desktopBridge.openPath) {
        await desktopBridge.openPath(bundleDirectory);
      }
    } catch (error) {
      void reportClientDiagnosticEvent({
        level: "error",
        event: "diagnostics.export_failed",
        error,
      });
      setLibraryError(
        error instanceof Error ? error.message : "导出诊断包失败。"
      );
    } finally {
      setIsExportingDiagnostics(false);
    }
  };

  /**
   * 统一处理“提取大纲”动作。
   *
   * 页面层负责：
   * - 检查当前素材和设置项是否完整。
   * - 先把 loading 状态同步到本地和数据库。
   * - 生成完成后把结构化结果写回 SQLite，保证重启后仍可直接显示。
   */
  const handleExtractOutline = async (mediaId: string) => {
    const targetMedia = mediaItems.find((item) => item.id === mediaId);
    if (!targetMedia) {
      return;
    }

    setSelectedMediaId(mediaId);

    const textProviderConfig = resolveTextModelProviderConfig(settings);

    if (!targetMedia.synopsis?.trim()) {
      applyLocalMediaPatch(mediaId, {
        outlineExtractionStatus: "error",
        outlineExtractionError: "请先填写剧情简介，再执行提取。",
      });
      await handleUpdateMediaItem(mediaId, {
        outlineExtractionStatus: "error",
        outlineExtractionError: "请先填写剧情简介，再执行提取。",
      });
      return;
    }

    if (!targetMedia.srtContent?.trim()) {
      applyLocalMediaPatch(mediaId, {
        outlineExtractionStatus: "error",
        outlineExtractionError: "请先导入或粘贴 SRT 字幕，再执行提取。",
      });
      await handleUpdateMediaItem(mediaId, {
        outlineExtractionStatus: "error",
        outlineExtractionError: "请先导入或粘贴 SRT 字幕，再执行提取。",
      });
      return;
    }

    if (
      !textProviderConfig.baseUrl ||
      !textProviderConfig.apiKey ||
      !textProviderConfig.model
    ) {
      const errorMessage =
        "请先在设置页填写文本模型 Provider、Base URL、API Key 和模型名称。";

      applyLocalMediaPatch(mediaId, {
        outlineExtractionStatus: "error",
        outlineExtractionError: errorMessage,
      });
      await handleUpdateMediaItem(mediaId, {
        outlineExtractionStatus: "error",
        outlineExtractionError: errorMessage,
      });
      setActiveMenu("settings");
      return;
    }

    applyLocalMediaPatch(mediaId, {
      outlineExtractionStatus: "loading",
      outlineExtractionError: null,
    });

    await handleUpdateMediaItem(mediaId, {
      outlineExtractionStatus: "loading",
      outlineExtractionError: null,
    });

    try {
      const outline = await generateStoryOutline(
        {
          mediaTitle: targetMedia.title,
          synopsis: targetMedia.synopsis,
          srtContent: targetMedia.srtContent,
        },
        {
          provider: textProviderConfig.provider,
          baseUrl: textProviderConfig.baseUrl,
          apiKey: textProviderConfig.apiKey,
          model: textProviderConfig.model,
          materialId: mediaId,
        }
      );

      await handleUpdateMediaItem(mediaId, {
        storyOutline: outline,
        outlineExtractionStatus: "success",
        outlineExtractionError: null,
      });
      void refreshUsageSnapshot();

      setCurrentSceneId(outline[0]?.id ?? null);

      try {
        await indexMaterialOutline(mediaId);
        void refreshUsageSnapshot();
      } catch (indexError) {
        setLibraryError(
          indexError instanceof Error
            ? `剧情大纲已生成，但搜索索引同步失败：${indexError.message}`
            : "剧情大纲已生成，但搜索索引同步失败。"
        );
        void refreshUsageSnapshot();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "剧情大纲提取失败";

      applyLocalMediaPatch(mediaId, {
        outlineExtractionStatus: "error",
        outlineExtractionError: message,
      });

      await handleUpdateMediaItem(mediaId, {
        outlineExtractionStatus: "error",
        outlineExtractionError: message,
      });
      void refreshUsageSnapshot();
    }
  };

  const handleGenerateSceneShotAnalysis = async (
    sceneId: string,
    mediaId?: string
  ) => {
    const targetMediaId = mediaId ?? selectedMediaId;
    if (!targetMediaId) {
      return;
    }

    if (selectedMediaId !== targetMediaId) {
      setSelectedMediaId(targetMediaId);
      setCurrentSceneId(sceneId);
    }

    const targetMedia = mediaItems.find((item) => item.id === targetMediaId);
    const targetScene = targetMedia?.storyOutline?.find((scene) => scene.id === sceneId);
    if (!targetMedia || !targetScene) {
      return;
    }

    const loadingOutline = updateSceneShotAnalysisInOutline(targetMediaId, sceneId, {
      status: "loading",
      error: null,
      summary: targetScene.shotAnalysis?.summary,
      action: targetScene.shotAnalysis?.action,
      expressionAndGaze: targetScene.shotAnalysis?.expressionAndGaze,
      cinematography: targetScene.shotAnalysis?.cinematography,
      atmosphere: targetScene.shotAnalysis?.atmosphere,
      commentaryHooks: targetScene.shotAnalysis?.commentaryHooks,
      updatedAt: targetScene.shotAnalysis?.updatedAt,
    });

    if (loadingOutline) {
      applyLocalMediaPatch(targetMediaId, {
        storyOutline: loadingOutline,
      });
    }

    try {
      const updatedMaterial = await generateMaterialSceneShotAnalysis(targetMediaId, sceneId);
      replaceMaterialInState(updatedMaterial);
      void refreshUsageSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : "镜头解读生成失败。";
      const errorOutline = updateSceneShotAnalysisInOutline(targetMediaId, sceneId, {
        status: "error",
        error: message,
        summary: targetScene.shotAnalysis?.summary,
        action: targetScene.shotAnalysis?.action,
        expressionAndGaze: targetScene.shotAnalysis?.expressionAndGaze,
        cinematography: targetScene.shotAnalysis?.cinematography,
        atmosphere: targetScene.shotAnalysis?.atmosphere,
        commentaryHooks: targetScene.shotAnalysis?.commentaryHooks,
        updatedAt: targetScene.shotAnalysis?.updatedAt,
      });

      if (errorOutline) {
        applyLocalMediaPatch(targetMediaId, {
          storyOutline: errorOutline,
        });
        await handleUpdateMediaItem(targetMediaId, {
          storyOutline: errorOutline,
        });
      }
      void refreshUsageSnapshot();
    }
  };

  /**
   * 当选中素材变化、或该素材的大纲被新的 AI 结果替换时，
   * 自动把右侧当前场景同步到第一条有效场景，避免出现“当前选中 ID 不存在”的悬空状态。
   */
  useEffect(() => {
    if (selectedStoryScenes.length === 0) {
      setCurrentSceneId(null);
      return;
    }

    const stillExists = selectedStoryScenes.some(
      (scene) => scene.id === currentSceneId
    );
    if (!stillExists) {
      setCurrentSceneId(selectedStoryScenes[0].id);
    }
  }, [currentSceneId, selectedStoryScenes]);

  useEffect(() => {
    const validClipIds = new Set((currentProject?.scriptClips ?? []).map((clip) => clip.id));

    setSelectedProjectClipVersionByItemId((previous) => {
      const next = { ...previous };
      let changed = false;

      Object.keys(next).forEach((scriptItemId) => {
        if (!validClipIds.has(next[scriptItemId])) {
          delete next[scriptItemId];
          changed = true;
        }
      });

      selectedProjectClipSequence.forEach((clip) => {
        if (!next[clip.scriptItemId]) {
          next[clip.scriptItemId] = clip.id;
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [currentProject?.scriptClips, selectedProjectClipSequence]);

  useEffect(() => {
    if (!pendingOutlineSearchResult) {
      return;
    }

    if (selectedMedia?.id !== pendingOutlineSearchResult.assetId) {
      return;
    }

    playerRef.current?.seekTo(pendingOutlineSearchResult.startSeconds);
    setPendingOutlineSearchResult(null);
  }, [pendingOutlineSearchResult, selectedMedia?.id]);

  useEffect(() => {
    setOutlineSearchState("idle");
    setOutlineSearchResults([]);
    setCurrentOutlineSearchResultId(null);
  }, [currentProjectId]);

  const handleVideoReady = () => {
    setPlayerPendingStartTime(null);
    setFrameHoldPreviewSrc(null);

    if (pendingOutlineSearchResult && selectedMedia?.id === pendingOutlineSearchResult.assetId) {
      playerRef.current?.seekTo(pendingOutlineSearchResult.startSeconds);
      setPendingOutlineSearchResult(null);
    }

    if (!pendingProjectScriptAction) {
      return;
    }

    if (selectedMedia?.id !== pendingProjectScriptAction.assetId) {
      return;
    }

    if (pendingProjectScriptAction.mode === "locate") {
      setPendingProjectScriptAction(null);
      return;
    }

    const clipDurationSeconds =
      pendingProjectScriptAction.endSeconds !== null &&
      pendingProjectScriptAction.endSeconds > pendingProjectScriptAction.startSeconds
        ? pendingProjectScriptAction.endSeconds - pendingProjectScriptAction.startSeconds
        : pendingProjectScriptAction.durationSeconds;

    if (clipDurationSeconds > 0) {
      projectScriptPlaybackTimerRef.current = window.setTimeout(() => {
        handleStopProjectScriptSegment();
      }, clipDurationSeconds * 1000);
    }

    setPendingProjectScriptAction(null);
  };

  const handlePrefetchProjectScriptItem = (item: {
    assetId: string;
    startSeconds: number;
  } | null) => {
    if ((currentProject?.crossAssetSwitchMode ?? "frame_hold") !== "preload") {
      return;
    }

    setPreloadTarget(item);
  };

  useEffect(() => () => {
    clearProjectScriptPlaybackTimer();
  }, []);

  const visibleMenuIds = isAuthorized
    ? [
        "home",
        "videos",
        "usage",
        "user",
        ...(canManageSettings ? ["settings"] : []),
      ]
    : ["home", "user"];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* 最左侧菜单栏 */}
      <SidebarMenu
        activeMenu={activeMenu}
        onMenuChange={setActiveMenu}
        visibleMenuIds={visibleMenuIds}
      />

      {!isAuthorized && activeMenu === "home" ? (
        <UnauthorizedHome onOpenUserPage={() => setActiveMenu("user")} />
      ) : activeMenu === "settings" && canManageSettings ? (
        <SettingsPanel
          values={settings}
          hasPendingChanges={hasPendingSettingsChanges}
          isSaving={isSavingSettings}
          isCheckingMediaTools={isCheckingMediaTools}
          mediaToolsCheckResult={mediaToolsCheckResult}
          onChangeField={handleSettingsFieldChange}
          onSave={handleSaveSettings}
          onCheckMediaTools={handleCheckMediaTools}
          onBrowseMaterialDirectory={handleBrowseMaterialDirectory}
        />
      ) : activeMenu === "user" ? (
        <UserPanel
          authorization={authorization}
          authorizationError={authorizationError}
          isRefreshingAuthorization={isRefreshingAuthorization}
          isExportingDiagnostics={isExportingDiagnostics}
          onRefreshAuthorization={handleRefreshAuthorization}
          onExportDiagnostics={handleExportDiagnostics}
        />
      ) : activeMenu === "usage" ? (
        <UsagePanel usage={usageSnapshot} isLoading={isRefreshingUsage} />
      ) : activeMenu === "home" ? (
        <div className="flex-1 min-w-0">
          <ProjectView
            items={projects}
            selectedProjectId={currentProjectId}
            canManageProjects={canManageProjects}
            defaultStorySearchProvider={settings.storySearchProvider}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            onOpenProject={handleOpenProject}
          />
        </div>
      ) : !currentProject ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-8 py-10 text-center">
            <p className="text-base font-medium text-foreground">当前未选择项目</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              请先到项目页选择一个项目，再进入素材、播放器和剧情大纲工作台。
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0">
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={24} minSize={18}>
              <div className="h-full border-r border-border">
                <MediaLibrary
                  items={visibleMediaItems}
                  selectedId={selectedMediaId}
                  projectName={currentProject.name}
                  projectId={currentProject.id}
                  activeProjectScriptItemId={activeProjectScriptItemId}
                  projectScriptSrtContent={currentProject.scriptSrtContent}
                  projectScriptAudio={currentProject.scriptAudio}
                  projectScriptMatchResults={currentProject.scriptMatchResults}
                  canManageMaterials={canManageMaterials}
                  canUseOutlineBasic={canUseOutlineBasic}
                  canUseOutlineSearch={canUseOutlineSearch}
                  onSelect={(id) => {
                    clearProjectPreviewPlayback();
                    setSelectedMediaId(id);
                  }}
                  onUpdateItem={handleUpdateMediaItem}
                  onAddMaterials={handleAddMaterials}
                  onDeleteItem={handleDeleteMediaItem}
                  onExtractOutline={handleExtractOutline}
                  onUpdateProjectScript={handleUpdateCurrentProjectScript}
                  onUploadProjectAudio={handleUploadCurrentProjectAudio}
                  onCombineProjectScriptItems={handleCombineProjectScriptItems}
                  onActivateProjectScriptItem={setActiveProjectScriptItemId}
                  onMatchProjectScriptItem={handleMatchProjectScriptItem}
                  onOffsetProjectScriptWindow={handleOffsetProjectScriptWindow}
                  onLocateProjectScriptItem={handleLocateProjectScriptItem}
                  onPrefetchProjectScriptItem={handlePrefetchProjectScriptItem}
                  onCreateProjectScriptClip={handleCreateProjectScriptClip}
                  onPlayProjectScriptSegment={handlePlayProjectScriptSegment}
                  onStopProjectScriptSegment={handleStopProjectScriptSegment}
                  muteVideoDuringScriptPlayback={muteVideoDuringScriptPlayback}
                  onMuteVideoDuringScriptPlaybackChange={
                    setMuteVideoDuringScriptPlayback
                  }
                />
                {(isBootstrapping || libraryError) && (
                  <div className="border-t border-border px-4 py-3 text-xs">
                    {isBootstrapping ? (
                      <span className="text-muted-foreground">
                        正在加载持久化素材库...
                      </span>
                    ) : (
                      <span className="text-destructive">{libraryError}</span>
                    )}
                  </div>
                )}
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={52} minSize={30}>
              <div className="h-full min-w-0">
                <ResizablePanelGroup direction="vertical">
                  <ResizablePanel defaultSize={56} minSize={20}>
                    <VideoPlayer
                      ref={playerRef}
                      title={
                        previewProjectCompilation?.label ??
                        previewProjectClip?.label ??
                        selectedMedia?.title
                      }
                      src={
                        previewProjectCompilation?.src ??
                        previewProjectClip?.src ??
                        (canUsePlayback ? selectedMedia?.src : undefined)
                      }
                      mediaType={
                        previewProjectCompilation || previewProjectClip
                          ? "video"
                          : canUsePlayback
                            ? selectedMedia?.mediaType
                            : "video"
                      }
                      pendingStartTime={playerPendingStartTime ?? undefined}
                      preloadSrc={
                        (currentProject?.crossAssetSwitchMode ?? "frame_hold") === "preload"
                          ? preloadMedia?.src
                          : undefined
                      }
                      preloadStartTime={
                        (currentProject?.crossAssetSwitchMode ?? "frame_hold") === "preload"
                          ? preloadTarget?.startSeconds
                          : undefined
                      }
                      frameHoldPreviewSrc={frameHoldPreviewSrc}
                      crossAssetSwitchMode={
                        currentProject?.crossAssetSwitchMode ?? "frame_hold"
                      }
                      autoPlay={
                        Boolean(previewProjectCompilation) ||
                        Boolean(previewProjectClip) ||
                        pendingProjectScriptAction?.mode === "play" &&
                        pendingProjectScriptAction.assetId === selectedMedia?.id
                      }
                      muted={
                        isProjectScriptPlaybackActive &&
                        muteVideoDuringScriptPlayback
                      }
                      playbackRate={playbackRate}
                      onPlaybackRateChange={setPlaybackRate}
                      onReady={handleVideoReady}
                      highlight={selectedMediaHighlight}
                      onTimeChange={(time) => handlePlayerTimeChange(time)}
                    />
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  <ResizablePanel defaultSize={44} minSize={12}>
                    <VideoEditorWorkspace
                      projectName={currentProject.name}
                      mediaTitle={selectedMedia?.title}
                      activeProjectClipId={previewProjectClip?.id ?? null}
                      activeProjectScriptItemId={activeProjectScriptItemId}
                      projectScriptItemOrder={projectScriptItemOrder}
                      disabled={!selectedMedia || !canManageMarkers}
                      disabledReason={markerDisabledReason}
                      pendingMarkerTime={pendingMarkerTime}
                      markers={selectedMedia?.markers ?? []}
                      projectClips={currentProject.scriptClips}
                      selectedClipVersionByItemId={selectedProjectClipVersionByItemId}
                      onMarkStart={handleMarkStart}
                      onMarkEditStart={handleMarkEditStart}
                      onAdjustMarkerTime={handleAdjustMarkerTime}
                      onSeekToTime={(time) => playerRef.current?.seekTo(time)}
                      onPreviewProjectClip={handlePreviewProjectClip}
                      onSelectProjectClipVersion={handleSelectProjectClipVersion}
                      onPreviewProjectClipCompilation={handlePreviewProjectClipCompilation}
                      onExportProjectClipCompilation={handleExportProjectClipCompilation}
                      isPreviewingProjectCompilation={isPreviewingCurrentProjectCompilation}
                      isCompilingProjectClips={isCompilingProjectClips}
                      isExportingProjectClips={isExportingProjectClips}
                      lastExportedCompilationPath={lastExportedCompilationPath}
                      onOpenExportDirectory={handleOpenExportDirectory}
                      onCreateMarker={handleCreateMarker}
                      onUpdateMarker={handleUpdateMarker}
                      onDeleteMarker={handleDeleteMarker}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={24} minSize={18}>
              <div className="h-full min-h-0 border-l border-border">
                <StoryOutline
                  scenes={selectedStoryScenes}
                  currentSceneId={currentSceneId}
                  mediaOptions={outlineMediaOptions}
                  selectedMediaId={selectedMediaId}
                  isExtracting={selectedMedia?.outlineExtractionStatus === "loading"}
                  extractionError={selectedMedia?.outlineExtractionError ?? null}
                  onMediaSelect={(mediaId) => {
                    clearProjectPreviewPlayback();
                    setSelectedMediaId(mediaId);
                  }}
                  onSceneSelect={handleSceneSelect}
                  searchQuery={outlineSearchQuery}
                  searchState={outlineSearchState}
                  searchResults={outlineSearchResults}
                  searchDisplayItems={outlineSearchDisplayItems}
                  currentSearchResultId={currentOutlineSearchResultId}
                  onSearchQueryChange={setOutlineSearchQuery}
                  onSearchSubmit={handleSearchOutline}
                  onClearSearch={handleClearOutlineSearch}
                  onSearchResultSelect={handleSelectOutlineSearchResult}
                  onSceneSubtitleSelect={handleSceneSubtitleSelect}
                  onGenerateShotAnalysis={handleGenerateSceneShotAnalysis}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </div>
  );
}

const parseTimecodeToSeconds = (timecode: string): number => {
  const [hours, minutes, seconds] = timecode.split(":").map(Number);

  return hours * 3600 + minutes * 60 + seconds;
};

const formatDurationLabel = (durationSeconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const parseTimeRangeDuration = (timestamp: string) => {
  const [startTimecode, endTimecode] = timestamp.split(" - ").map((value) => value.trim());
  if (!startTimecode || !endTimecode) {
    return 0;
  }

  return Math.max(parseTimecodeToSeconds(endTimecode) - parseTimecodeToSeconds(startTimecode), 0);
};

const parseProjectScriptItemOrder = (raw: string | undefined) => {
  if (!raw?.trim()) {
    return [] as string[];
  }

  return parseProjectScriptBlocks(raw).map((block) => block.id);
};
