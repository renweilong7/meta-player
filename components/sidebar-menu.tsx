"use client";

import { cn } from "@/lib/utils";
import {
  Home,
  Film,
  User,
  Settings,
  ChartColumn,
  LifeBuoy,
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

type DesktopBridge = {
  openExternal?: (targetUrl: string) => Promise<void>;
};

const CONTACT_LABEL = "联系客服";
const CONTACT_URL =
  "https://my.feishu.cn/wiki/Ok18w9sHFipj78kmDpucQWlUnfb?from=from_copylink";

const menuItems = [
  { id: "home", icon: Home, label: "首页" },
  { id: "videos", icon: Film, label: "视频" },
];

const bottomItems = [
  { id: "usage", icon: ChartColumn, label: "用量" },
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

  const openContactLink = async () => {
    const desktopBridge = (
      window as typeof window & { metaPlayerDesktop?: DesktopBridge }
    ).metaPlayerDesktop;

    if (desktopBridge?.openExternal) {
      await desktopBridge.openExternal(CONTACT_URL);
      return;
    }

    window.open(CONTACT_URL, "_blank", "noopener,noreferrer");
  };

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
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  void openContactLink();
                }}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <LifeBuoy className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-popover text-popover-foreground">
              {CONTACT_LABEL}
            </TooltipContent>
          </Tooltip>

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
