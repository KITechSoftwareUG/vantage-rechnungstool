import { Upload, FileText, Building2, LayoutDashboard, LogOut, Link2, FileDown, LayoutGrid } from "lucide-react";
import { Link } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "next-themes";
import logoDarkmode from "@/assets/logo_darkmode.png";
import logoLightmode from "@/assets/logo_lightmode.png";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Upload", url: "/upload", icon: Upload },
  { title: "Rechnungen", url: "/invoices", icon: FileText },
  { title: "Kontoauszüge", url: "/statements", icon: Building2 },
  { title: "Zuordnung", url: "/matching", icon: Link2 },
  { title: "Steuerberater Export", url: "/export", icon: FileDown },
];

interface MatchingSidebarProps {
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
}

export function MatchingSidebar({ variant = "desktop", onNavigate }: MatchingSidebarProps) {
  const { user, signOut } = useAuth();
  const { resolvedTheme } = useTheme();

  const logoSrc = resolvedTheme === "dark" ? logoDarkmode : logoLightmode;
  const isMobile = variant === "mobile";

  // Mobile-Variante: rendert innerhalb eines Sheet als normaler Flex-Container.
  // Desktop-Variante: fixed links, w-64, full-height.
  const asideClass = isMobile
    ? "flex h-full w-full flex-col bg-sidebar"
    : "fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar";

  return (
    <aside data-testid="matching-sidebar" className={asideClass}>
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
            Matching Tool
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
          activeClassName="bg-sidebar-accent text-sidebar-primary shadow-sm"
          style={{ animationDelay: "0s" }}
        >
          <LayoutGrid className="h-5 w-5 shrink-0 transition-colors group-hover:text-sidebar-primary" />
          <span>Übersicht</span>
        </NavLink>
        <div className="my-2 h-px bg-sidebar-border/60" />
        {navItems.map((item, index) => (
          <NavLink
            key={item.title}
            to={item.url}
            end={item.url === "/"}
            onClick={onNavigate}
            className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground animate-slide-in-left opacity-0"
            activeClassName="bg-sidebar-accent text-sidebar-primary shadow-sm"
            style={{ animationDelay: `${(index + 1) * 0.05}s` }}
          >
            <item.icon className="h-5 w-5 shrink-0 transition-colors group-hover:text-sidebar-primary" />
            <span>{item.title}</span>
          </NavLink>
        ))}
      </nav>

      {/* User Info & Logout */}
      <div className="shrink-0 border-t border-sidebar-border p-2">
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
