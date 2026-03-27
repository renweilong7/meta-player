"use client";

import { cn } from "@/lib/utils";
import {
  Home,
  Film,
  FolderOpen,
  Star,
  Clock,
  Download,
  User,
  Settings,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarMenuProps {
  activeMenu: string;
  onMenuChange: (menu: string) => void;
}

const menuItems = [
  { id: "home", icon: Home, label: "首页" },
  { id: "videos", icon: Film, label: "视频" },
  { id: "folder", icon: FolderOpen, label: "文件夹" },
  { id: "favorites", icon: Star, label: "收藏" },
  { id: "recent", icon: Clock, label: "最近" },
  { id: "downloads", icon: Download, label: "下载" },
];

const bottomItems = [
  { id: "user", icon: User, label: "用户" },
  { id: "settings", icon: Settings, label: "设置" },
];

export function SidebarMenu({ activeMenu, onMenuChange }: SidebarMenuProps) {
  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-full w-16 flex-col items-center border-r border-border bg-sidebar py-4">
        {/* Logo */}
        <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
          <Film className="h-5 w-5 text-primary-foreground" />
        </div>

        {/* Top Menu Items */}
        <nav className="flex flex-1 flex-col items-center gap-1">
          {menuItems.map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onMenuChange(item.id)}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                    activeMenu === item.id
                      ? "bg-sidebar-accent text-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-popover text-popover-foreground">
                {item.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </nav>

        {/* Bottom Menu Items */}
        <div className="flex flex-col items-center gap-1">
          {bottomItems.map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onMenuChange(item.id)}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                    activeMenu === item.id
                      ? "bg-sidebar-accent text-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-popover text-popover-foreground">
                {item.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
