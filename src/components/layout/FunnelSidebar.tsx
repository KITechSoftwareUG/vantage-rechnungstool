import { Activity, LayoutGrid, LogOut, MessageCircle, Settings, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "next-themes";
import logoDarkmode from "@/assets/logo_darkmode.png";
import logoLightmode from "@/assets/logo_lightmode.png";

const navItems = [
  { title: "Leads", url: "/funnel", icon: Users },
  { title: "Inbox", url: "/funnel/inbox", icon: MessageCircle },
  { title: "Status", url: "/status", icon: Activity },
  { title: "Konfiguration", url: "/config", icon: Settings },
];

interface FunnelSidebarProps {
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
}

export function FunnelSidebar({ variant = "desktop", onNavigate }: FunnelSidebarProps) {
  const { user, signOut } = useAuth();
  const { resolvedTheme } = useTheme();

  const logoSrc = resolvedTheme === "dark" ? logoDarkmode : logoLightmode;
  const isMobile = variant === "mobile";

  // Mobile-Variante rendert im Sheet als normaler Container; Desktop ist fixed.
  // Kein twMerge-Konflikt zwischen flex/hidden/md:flex, sondern klare Trennung.
  const asideClass = isMobile
    ? "flex h-full w-full flex-col bg-sidebar"
    : "fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar";

  return (
    <aside data-testid="funnel-sidebar" className={asideClass}>
      {/* Logo — klickbar zurück zur Übersicht */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
        <Link
          to="/"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-sidebar-accent"
          title="Zurück zur Übersicht"
        >
          <img src={logoSrc} alt="Logo" className="h-9 w-auto shrink-0" />
          <span className="truncate font-heading text-lg font-semibold text-sidebar-foreground">
            Funnelanalytics
          </span>
        </Link>
        {!isMobile && <ThemeToggle />}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        <NavLink
          to="/"
          end
          onClick={onNavigate}
          className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/60 transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground animate-slide-in-left opacity-0"
          activeClassName="bg-sidebar-accent text-emerald-500 shadow-sm"
          style={{ animationDelay: "0s" }}
        >
          <LayoutGrid className="h-5 w-5 shrink-0 transition-colors group-hover:text-emerald-500" />
          <span>Übersicht</span>
        </NavLink>
        <div className="my-2 h-px bg-sidebar-border/60" />
        {navItems.map((item, index) => (
          <NavLink
            key={item.title}
            to={item.url}
            // `end` fuer Parent-Routes, sonst matcht "/funnel" auch
            // "/funnel/inbox" und beide Eintraege wirken aktiv.
            end={item.url === "/" || item.url === "/funnel"}
            onClick={onNavigate}
            className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground animate-slide-in-left opacity-0"
            activeClassName="bg-sidebar-accent text-emerald-500 shadow-sm"
            style={{ animationDelay: `${(index + 1) * 0.05}s` }}
          >
            <item.icon className="h-5 w-5 shrink-0 transition-colors group-hover:text-emerald-500" />
            <span>{item.title}</span>
          </NavLink>
        ))}
      </nav>

      {/* User Info & Logout */}
      <div className="border-t border-sidebar-border p-2">
        {user && (
          <div className="mb-3 rounded-lg bg-sidebar-accent/50 p-3">
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
        )}
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
          onClick={() => {
            onNavigate?.();
            signOut();
          }}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>Abmelden</span>
        </Button>
      </div>
    </aside>
  );
}
