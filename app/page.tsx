"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { StoryOutline } from "@/components/story-outline";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  fetchLibrarySnapshot,
  fetchAuthorizationSnapshot,
  refreshAuthorizationSnapshot,
  importMaterials,
  indexMaterialOutline,
  patchProject,
  patchMaterial,
  patchMaterialMarker,
  postMaterialMarker,
  postProject,
  putSettings,
  removeMaterial,
  removeMaterialMarker,
  removeProject,
  searchProjectStoryOutline,
} from "@/lib/persistence/client";
import { AuthorizationSnapshot } from "@/lib/license/types";
import { hasAuthorizedFeature, isAuthorizedStatus } from "@/lib/license/utils";
import { MaterialImportInput } from "@/lib/persistence/types";
import {
  generateStoryOutline,
  mapStoryOutlineToScenes,
} from "@/lib/story-outline/service";
import { StoryScene } from "@/lib/story-outline/types";
import { StoryOutlineSearchResult } from "@/lib/story-outline/search";

const defaultSettings: AppSettingsValues = {
  materialSavePath: "",
  defaultManagedImport: false,
  aiApiBaseUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModelName: "gpt-4o-mini",
  storySearchProvider: "remote_embedding",
  aiEmbeddingModelName: "text-embedding-3-small",
  localEmbeddingModelName: "bge-small-zh",
  aiSearchModelName: "gpt-4o-mini",
};

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
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isRefreshingAuthorization, setIsRefreshingAuthorization] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<AuthorizationSnapshot | null>(
    null
  );
  const [pendingOutlineSearchResult, setPendingOutlineSearchResult] =
    useState<StoryOutlineSearchResult | null>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);

  const currentProject = projects.find((item) => item.id === currentProjectId) ?? null;
  const visibleMediaItems = currentProject
    ? mediaItems.filter((item) => currentProject.materialIds.includes(item.id))
    : [];
  const selectedMedia = visibleMediaItems.find((item) => item.id === selectedMediaId);
  const selectedStoryScenes: StoryScene[] = mapStoryOutlineToScenes(
    selectedMedia?.storyOutline ?? []
  );
  const selectedMediaHighlight = Object.fromEntries(
    (selectedMedia?.markers ?? []).map((marker) => [marker.time, marker.content])
  ) as Record<number, string>;
  const hasPendingSettingsChanges =
    JSON.stringify(settings) !== JSON.stringify(savedSettings);
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
      ? "高级授权可用：标记与审片功能当前未开通。"
      : null;

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
        const authorizationSnapshot = await fetchAuthorizationSnapshot();
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
        setSettings(snapshot.settings);
        setSavedSettings(snapshot.settings);
        setAuthorization(authorizationSnapshot);
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

  const handleCreateProject = async (input: { name: string; description?: string }) => {
    const nextProject = await postProject(input);
    setProjects((previous) => [nextProject, ...previous]);
    setCurrentProjectId(nextProject.id);
  };

  const handleUpdateProject = (
    id: string,
    updates: { name: string; description?: string }
  ) => {
    void patchProject(id, updates).then((updatedProject) => {
      setProjects((previous) =>
        previous.map((project) =>
          project.id === updatedProject.id ? updatedProject : project
        )
      );
    });
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
    setCurrentProjectId(projectId);
    setActiveMenu("videos");
  };

  const handleSceneSelect = (id: string) => {
    setCurrentSceneId(id);

    const selectedScene = selectedStoryScenes.find((scene) => scene.id === id);
    if (!selectedScene) {
      return;
    }

    playerRef.current?.seekTo(selectedScene.seekTime);
  };

  const handleSelectOutlineSearchResult = (result: StoryOutlineSearchResult) => {
    setSelectedMediaId(result.assetId);
    setCurrentSceneId(result.sceneId);
    setPendingOutlineSearchResult(result);
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

  const handleMarkStart = () => {
    playerRef.current?.pause();
    setPendingMarkerTime(playerRef.current?.getCurrentTime() ?? 0);
  };

  const handleMarkEditStart = (time: number) => {
    playerRef.current?.pause();
    playerRef.current?.seekTo(time);
    setPendingMarkerTime(time);
  };

  const handleAdjustMarkerTime = (nextTime: number) => {
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
    if (selectedStoryScenes.length === 0) {
      return;
    }

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
  };

  const handleSettingsFieldChange = <K extends keyof AppSettingsValues>(
    field: K,
    value: AppSettingsValues[K]
  ) => {
    setSettings((previous) => ({ ...previous, [field]: value }));
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setLibraryError(null);

    try {
      const saved = await putSettings(settings);
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
    console.log("目录选择接口预留");
  };

  const handleRefreshAuthorization = async () => {
    setIsRefreshingAuthorization(true);
    setLibraryError(null);

    try {
      const nextAuthorization = await refreshAuthorizationSnapshot();
      setAuthorization(nextAuthorization);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "刷新授权状态失败。"
      );
    } finally {
      setIsRefreshingAuthorization(false);
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
      !settings.aiApiBaseUrl.trim() ||
      !settings.aiApiKey.trim() ||
      !settings.aiModelName.trim()
    ) {
      const errorMessage =
        "请先在设置页填写 AI API Base URL、API Key 和模型名称。";

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
          baseUrl: settings.aiApiBaseUrl,
          apiKey: settings.aiApiKey,
          model: settings.aiModelName,
        }
      );

      await handleUpdateMediaItem(mediaId, {
        storyOutline: outline,
        outlineExtractionStatus: "success",
        outlineExtractionError: null,
      });

      setCurrentSceneId(outline[0]?.id ?? null);

      try {
        await indexMaterialOutline(mediaId);
      } catch (indexError) {
        setLibraryError(
          indexError instanceof Error
            ? `剧情大纲已生成，但向量索引失败：${indexError.message}`
            : "剧情大纲已生成，但向量索引失败。"
        );
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
    }
  };

  const handleSearchOutline = useCallback(
    async (query: string) => {
      if (!currentProjectId) {
        return {
          mode: "keyword" as const,
          results: [],
        };
      }

      return searchProjectStoryOutline(currentProjectId, query);
    },
    [currentProjectId]
  );

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
    if (!pendingOutlineSearchResult) {
      return;
    }

    if (selectedMedia?.id !== pendingOutlineSearchResult.assetId) {
      return;
    }

    playerRef.current?.seekTo(pendingOutlineSearchResult.startSeconds);
    setPendingOutlineSearchResult(null);
  }, [pendingOutlineSearchResult, selectedMedia?.id]);

  const visibleMenuIds = isAuthorized
    ? [
        "home",
        "videos",
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
          onChangeField={handleSettingsFieldChange}
          onSave={handleSaveSettings}
          onBrowseMaterialDirectory={handleBrowseMaterialDirectory}
        />
      ) : activeMenu === "user" ? (
        <UserPanel
          authorization={authorization}
          isRefreshingAuthorization={isRefreshingAuthorization}
          onRefreshAuthorization={handleRefreshAuthorization}
        />
      ) : activeMenu === "home" ? (
        <div className="flex-1 min-w-0">
          <ProjectView
            items={projects}
            selectedProjectId={currentProjectId}
            canManageProjects={canManageProjects}
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
                  canManageMaterials={canManageMaterials}
                  canUseOutlineBasic={canUseOutlineBasic}
                  canUseOutlineSearch={canUseOutlineSearch}
                  onSelect={setSelectedMediaId}
                  onUpdateItem={handleUpdateMediaItem}
                  onAddMaterials={handleAddMaterials}
                  onDeleteItem={handleDeleteMediaItem}
                  onExtractOutline={handleExtractOutline}
                  onSelectOutlineSearchResult={handleSelectOutlineSearchResult}
                  onSearchOutline={handleSearchOutline}
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
                      title={selectedMedia?.title}
                      src={canUsePlayback ? selectedMedia?.src : undefined}
                      mediaType={canUsePlayback ? selectedMedia?.mediaType : "video"}
                      highlight={selectedMediaHighlight}
                      onTimeChange={(time) => handlePlayerTimeChange(time)}
                    />
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  <ResizablePanel defaultSize={44} minSize={12}>
                    <VideoEditorWorkspace
                      mediaTitle={selectedMedia?.title}
                      disabled={!selectedMedia || !canManageMarkers}
                      disabledReason={markerDisabledReason}
                      pendingMarkerTime={pendingMarkerTime}
                      markers={selectedMedia?.markers ?? []}
                      onMarkStart={handleMarkStart}
                      onMarkEditStart={handleMarkEditStart}
                      onAdjustMarkerTime={handleAdjustMarkerTime}
                      onSeekToTime={(time) => playerRef.current?.seekTo(time)}
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
                  isExtracting={selectedMedia?.outlineExtractionStatus === "loading"}
                  extractionError={selectedMedia?.outlineExtractionError ?? null}
                  onSceneSelect={handleSceneSelect}
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
