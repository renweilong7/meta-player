"use client";

import { useState } from "react";
import { SidebarMenu } from "@/components/sidebar-menu";
import { MediaLibrary, MediaItem } from "@/components/media-library";
import { VideoPlayer } from "@/components/video-player";
import { StoryOutline, StoryScene } from "@/components/story-outline";
import { FolderView, FolderItem } from "@/components/folder-view";

// 示例素材数据
const mockMediaItems: MediaItem[] = [
  {
    id: "1",
    title: "开场白 - 主角独白",
    thumbnail: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=200&h=120&fit=crop",
    duration: "02:35",
    addedAt: "今天 14:30",
  },
  {
    id: "2",
    title: "城市航拍 - 黄昏场景",
    thumbnail: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=200&h=120&fit=crop",
    duration: "01:48",
    addedAt: "今天 13:15",
  },
  {
    id: "3",
    title: "对话场景 - 咖啡馆",
    thumbnail: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=200&h=120&fit=crop",
    duration: "04:22",
    addedAt: "昨天 18:45",
  },
  {
    id: "4",
    title: "追逐戏 - 街道奔跑",
    thumbnail: "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=200&h=120&fit=crop",
    duration: "03:15",
    addedAt: "昨天 16:20",
  },
  {
    id: "5",
    title: "结尾场景 - 海边日落",
    thumbnail: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=200&h=120&fit=crop",
    duration: "02:10",
    addedAt: "3天前",
  },
  {
    id: "6",
    title: "幕后花絮 - 拍摄现场",
    thumbnail: "https://images.unsplash.com/photo-1493863641943-9b68992a8d07?w=200&h=120&fit=crop",
    duration: "05:45",
    addedAt: "3天前",
  },
  {
    id: "7",
    title: "配乐测试 - 情感段落",
    thumbnail: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&h=120&fit=crop",
    duration: "01:30",
    addedAt: "上周",
  },
  {
    id: "8",
    title: "特效素材 - 光效叠加",
    thumbnail: "https://images.unsplash.com/photo-1550684376-efcbd6e3f031?w=200&h=120&fit=crop",
    duration: "00:45",
    addedAt: "上周",
  },
];

// 示例文件夹数据
const mockFolderItems: FolderItem[] = [
  {
    id: "folder-1",
    name: "项目A - 城市纪录片",
    type: "folder",
    itemCount: 3,
    updatedAt: "今天 10:30",
    parentId: null,
  },
  {
    id: "folder-2",
    name: "项目B - 商业广告",
    type: "folder",
    itemCount: 2,
    updatedAt: "昨天 15:20",
    parentId: null,
  },
  {
    id: "folder-3",
    name: "素材库",
    type: "folder",
    itemCount: 5,
    updatedAt: "3天前",
    parentId: null,
  },
  {
    id: "video-f1",
    name: "城市航拍素材",
    type: "video",
    thumbnail: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=200&h=120&fit=crop",
    duration: "05:32",
    updatedAt: "今天 09:15",
    parentId: "folder-1",
  },
  {
    id: "video-f2",
    name: "街道采访片段",
    type: "video",
    thumbnail: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=200&h=120&fit=crop",
    duration: "12:45",
    updatedAt: "今天 08:30",
    parentId: "folder-1",
  },
  {
    id: "video-f3",
    name: "夜景延时摄影",
    type: "video",
    thumbnail: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=200&h=120&fit=crop",
    duration: "03:18",
    updatedAt: "昨天 22:00",
    parentId: "folder-1",
  },
  {
    id: "video-f4",
    name: "产品展示主视频",
    type: "video",
    thumbnail: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=200&h=120&fit=crop",
    duration: "01:30",
    updatedAt: "昨天 14:00",
    parentId: "folder-2",
  },
  {
    id: "video-f5",
    name: "幕后花絮",
    type: "video",
    thumbnail: "https://images.unsplash.com/photo-1493863641943-9b68992a8d07?w=200&h=120&fit=crop",
    duration: "08:22",
    updatedAt: "昨天 11:30",
    parentId: "folder-2",
  },
];

// 示例剧情大纲数据
const mockScenes: StoryScene[] = [
  {
    id: "s1",
    title: "序幕：城市黎明",
    description: "主角在城市天际线的背景下醒来，展示日常生活的一天开始。用广角镜头捕捉城市苏醒的氛围。",
    duration: "2分钟",
    timestamp: "00:00",
    status: "completed",
  },
  {
    id: "s2",
    title: "第一幕：邂逅",
    description: "主角在咖啡馆偶遇女主角，两人因为一本书展开对话。场景需要温馨自然的光线。",
    duration: "5分钟",
    timestamp: "02:00",
    status: "completed",
  },
  {
    id: "s3",
    title: "第二幕：冲突升级",
    description: "误会产生，主角追赶离去的女主角穿过繁忙的街道。需要动态镜头和紧张的配乐。",
    duration: "4分钟",
    timestamp: "07:00",
    status: "current",
  },
  {
    id: "s4",
    title: "第三幕：和解",
    description: "在海边，主角找到女主角，两人坦诚相对。日落作为背景，象征新的开始。",
    duration: "6分钟",
    timestamp: "11:00",
    status: "upcoming",
  },
  {
    id: "s5",
    title: "尾声：新生活",
    description: "一年后，两人在同一个咖啡馆，但角色互换。形成首尾呼应，暗示生活的循环与成长。",
    duration: "3分钟",
    timestamp: "17:00",
    status: "upcoming",
  },
];

export default function VideoEditorPage() {
  const [activeMenu, setActiveMenu] = useState("videos");
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>("1");
  const [currentSceneId, setCurrentSceneId] = useState<string | null>("s3");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>(mockMediaItems);
  const [folderItems, setFolderItems] = useState<FolderItem[]>(mockFolderItems);

  const selectedMedia = mediaItems.find((item) => item.id === selectedMediaId);

  const handleUpdateMediaItem = (id: string, updates: Partial<MediaItem>) => {
    setMediaItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleAddMaterials = (files: File[]) => {
    const newItems: MediaItem[] = files.map(file => {
      return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: file.name,
        thumbnail: URL.createObjectURL(file),
        duration: "00:00",
        addedAt: "刚刚",
      };
    });
    setMediaItems(prev => [...newItems, ...prev]);
  };

  const handleDeleteMediaItem = (id: string) => {
    setMediaItems(prev => prev.filter(item => item.id !== id));
    if (selectedMediaId === id) {
      setSelectedMediaId(null);
    }
  };

  // 文件夹页面选择视频时切换到视频页
  const handleFolderVideoSelect = (videoId: string) => {
    setActiveMenu("videos");
    // 可以进一步实现跳转到对应视频
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* 最左侧菜单栏 */}
      <SidebarMenu activeMenu={activeMenu} onMenuChange={setActiveMenu} />

      {activeMenu === "folder" ? (
        // 文件夹页面
        <div className="flex-1 min-w-0">
          <FolderView
            items={folderItems}
            onUpdateItems={setFolderItems}
            onSelectVideo={handleFolderVideoSelect}
          />
        </div>
      ) : (
        // 视频编辑页面
        <>
          {/* 素材栏 */}
          <MediaLibrary
            items={mediaItems}
            selectedId={selectedMediaId}
            onSelect={setSelectedMediaId}
            onUpdateItem={handleUpdateMediaItem}
            onAddMaterials={handleAddMaterials}
            onDeleteItem={handleDeleteMediaItem}
          />

          {/* 中间视频播放器 */}
          <div className="flex-1 min-w-0">
            <VideoPlayer
              title={selectedMedia?.title}
              poster={selectedMedia?.thumbnail}
            />
          </div>

          {/* 右侧剧情大纲 */}
          <StoryOutline
            scenes={mockScenes}
            currentSceneId={currentSceneId}
            onSceneSelect={setCurrentSceneId}
          />
        </>
      )}
    </div>
  );
}
