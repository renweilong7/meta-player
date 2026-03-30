"use client";

import { cn } from "@/lib/utils";
import {
  Home,
  Film,
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
  visibleMenuIds?: string[];
}

const menuItems = [
  { id: "home", icon: Home, label: "首页" },
  { id: "videos", icon: Film, label: "视频" },
];

const bottomItems = [
  { id: "user", icon: User, label: "用户" },
  { id: "settings", icon: Settings, label: "设置" },
];

export function SidebarMenu({
  activeMenu,
  onMenuChange,
  visibleMenuIds,
}: SidebarMenuProps) {
  const isVisible = (menuId: string) =>
    !visibleMenuIds || visibleMenuIds.includes(menuId);

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-full w-16 flex-col items-center border-r border-border bg-sidebar py-4">
        {/* Logo */}
        <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
          <Film className="h-5 w-5 text-primary-foreground" />
        </div>

        {/* Top Menu Items */}
        <nav className="flex flex-1 flex-col items-center gap-1">
          {menuItems.filter((item) => isVisible(item.id)).map((item) => (
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
          {bottomItems.filter((item) => isVisible(item.id)).map((item) => (
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
