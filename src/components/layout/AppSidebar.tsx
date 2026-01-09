import { Upload, FileText, Building2, LayoutDashboard, LogOut, Link2, FileDown } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSidebar } from "@/contexts/SidebarContext";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Upload", url: "/upload", icon: Upload },
  { title: "Rechnungen", url: "/invoices", icon: FileText },
  { title: "Kontoauszüge", url: "/statements", icon: Building2 },
  { title: "Zuordnung", url: "/matching", icon: Link2 },
  { title: "Steuerberater Export", url: "/export", icon: FileDown },
];

export function AppSidebar() {
  const { user, signOut } = useAuth();
  const { isHovered, setHovered } = useSidebar();
  const isMobile = useIsMobile();

  // On mobile: always expanded, on desktop: collapsed unless hovered
  const isExpanded = isMobile || isHovered;

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300",
        isExpanded ? "w-64" : "w-16"
      )}
      onMouseEnter={() => !isMobile && setHovered(true)}
      onMouseLeave={() => !isMobile && setHovered(false)}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-blue-500">
            <FileText className="h-5 w-5 text-primary-foreground" />
          </div>
          {isExpanded && (
            <span className="font-heading text-lg font-semibold text-sidebar-foreground whitespace-nowrap">
              Platzhalter
            </span>
          )}
        </div>
        {isExpanded && <ThemeToggle />}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item, index) => (
          <Tooltip key={item.title} delayDuration={0}>
            <TooltipTrigger asChild>
              <NavLink
                to={item.url}
                end={item.url === "/"}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  "animate-slide-in-left opacity-0",
                  !isExpanded && "justify-center px-0"
                )}
                activeClassName="bg-sidebar-accent text-sidebar-primary shadow-sm"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <item.icon className="h-5 w-5 shrink-0 transition-colors group-hover:text-sidebar-primary" />
                {isExpanded && <span>{item.title}</span>}
              </NavLink>
            </TooltipTrigger>
            {!isExpanded && (
              <TooltipContent side="right" className="font-medium">
                {item.title}
              </TooltipContent>
            )}
          </Tooltip>
        ))}
      </nav>

      {/* User Info & Logout */}
      <div className="border-t border-sidebar-border p-2">
        {user && isExpanded && (
          <div className="mb-3 rounded-lg bg-sidebar-accent/50 p-3">
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        )}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "w-full gap-2 text-muted-foreground hover:text-destructive",
                isExpanded ? "justify-start" : "justify-center px-0"
              )}
              onClick={signOut}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {isExpanded && <span>Abmelden</span>}
            </Button>
          </TooltipTrigger>
          {!isExpanded && (
            <TooltipContent side="right" className="font-medium">
              Abmelden
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </aside>
  );
}
