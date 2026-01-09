import { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const isMobile = useIsMobile();

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <main
        className={cn(
          "flex-1 overflow-auto transition-all duration-300",
          // On mobile: always expanded sidebar (ml-64), on desktop: always collapsed (ml-16)
          isMobile ? "ml-64" : "ml-16"
        )}
      >
        <div className="relative min-h-screen">
          {/* Background gradient effects */}
          <div className="pointer-events-none fixed inset-0 overflow-hidden">
            <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl dark:bg-primary/5" />
            <div className="absolute -bottom-40 left-1/4 h-[400px] w-[400px] rounded-full bg-primary/3 blur-3xl dark:bg-primary/3" />
          </div>

          {/* Content */}
          <div className="relative z-10 p-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
