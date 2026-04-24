import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { MatchingSidebar } from "./MatchingSidebar";
import { FunnelSidebar } from "./FunnelSidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isFunnel =
    pathname.startsWith("/funnel") ||
    pathname === "/config" ||
    pathname.startsWith("/config/");
  const Sidebar = isFunnel ? FunnelSidebar : MatchingSidebar;
  const title = isFunnel ? "Funnelanalytics" : "Matching Tool";

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop sidebar (hidden on mobile via its own classes) */}
      <Sidebar variant="desktop" />

      <main className="flex-1 overflow-x-hidden md:ml-64">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Navigation öffnen"
                className="shrink-0"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 max-w-[85vw] p-0">
              <Sidebar variant="mobile" onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="flex-1 truncate text-center font-heading text-sm font-semibold text-foreground">
            {title}
          </span>
          <ThemeToggle />
        </div>

        <div className="relative min-h-screen">
          {/* Background gradient effects — hidden on small screens to avoid perf/visual clutter */}
          <div className="pointer-events-none fixed inset-0 hidden overflow-hidden md:block">
            <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl dark:bg-primary/5" />
            <div className="absolute -bottom-40 left-1/4 h-[400px] w-[400px] rounded-full bg-primary/3 blur-3xl dark:bg-primary/3" />
          </div>

          {/* Content */}
          <div className="relative z-10 p-4 sm:p-6 md:p-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
