import { FileText, BarChart3, Sparkles, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import logoDarkmode from "@/assets/logo_darkmode.png";
import logoLightmode from "@/assets/logo_lightmode.png";

type ModuleCard = {
  title: string;
  description: string;
  icon: typeof FileText;
  to: string | null;
  available: boolean;
  gradient: string;
};

const modules: ModuleCard[] = [
  {
    title: "Matching Tool",
    description:
      "Rechnungen, Kontoauszüge, automatische Zuordnung und Steuerberater-Export.",
    icon: FileText,
    to: "/dashboard",
    available: true,
    gradient: "from-primary/25 via-primary/10 to-transparent",
  },
  {
    title: "Funnelanalytics",
    description:
      "Zahnfunnel-Leads, WhatsApp-Konversationen, Tracking und Conversion-Insights.",
    icon: BarChart3,
    to: "/funnel",
    available: true,
    gradient: "from-emerald-500/25 via-emerald-500/10 to-transparent",
  },
  {
    title: "OS",
    description:
      "Personal Operations System — Verträge, Policen, Drive-Dokumente, zentrale Steueroberfläche.",
    icon: Sparkles,
    to: null,
    available: false,
    gradient: "from-purple-500/25 via-purple-500/10 to-transparent",
  },
];

export default function Hub() {
  const { user, signOut } = useAuth();
  const { resolvedTheme } = useTheme();
  const logoSrc = resolvedTheme === "dark" ? logoDarkmode : logoLightmode;

  const firstName = user?.email?.split("@")[0]?.split(".")[0] ?? "";
  const prettyName = firstName
    ? firstName.charAt(0).toUpperCase() + firstName.slice(1)
    : "";
  const greeting = prettyName
    ? `Willkommen zurück, ${prettyName}`
    : "Willkommen zurück";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 right-0 h-[600px] w-[600px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      <header className="relative z-10 flex h-16 items-center justify-between border-b border-border/40 px-6">
        <div className="flex items-center gap-3">
          <img src={logoSrc} alt="Logo" className="h-9 w-auto" />
        </div>
        <div className="flex items-center gap-3">
          {user?.email && (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user.email}
            </span>
          )}
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="gap-2 text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Abmelden</span>
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
        <div className="mb-12 text-center animate-fade-in">
          <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
            {greeting}
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            Wähle ein Modul, um fortzufahren.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod, index) => {
            const Icon = mod.icon;
            const animationDelay = `${index * 0.1}s`;

            const cardBody = (
              <div
                className={cn(
                  "group relative h-full overflow-hidden rounded-2xl border border-border/50 bg-card p-8 transition-all duration-300",
                  mod.available
                    ? "cursor-pointer hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
                    : "cursor-not-allowed"
                )}
              >
                <div
                  className={cn(
                    "absolute inset-0 bg-gradient-to-br opacity-60 transition-opacity group-hover:opacity-100",
                    mod.gradient
                  )}
                />
                <div className="relative">
                  <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-background/80 ring-1 ring-border/60">
                    <Icon className="h-7 w-7" />
                  </div>
                  <h3 className="font-heading text-2xl font-semibold">
                    {mod.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {mod.description}
                  </p>
                  {mod.available ? (
                    <div className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary transition-all group-hover:gap-2">
                      Öffnen →
                    </div>
                  ) : (
                    <div className="mt-6 inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                      Im Aufbau
                    </div>
                  )}
                </div>
                {!mod.available && (
                  <div className="pointer-events-none absolute inset-0 bg-background/30 backdrop-blur-[2px]" />
                )}
              </div>
            );

            if (mod.available && mod.to) {
              return (
                <Link
                  key={mod.title}
                  to={mod.to}
                  className="block animate-fade-in opacity-0"
                  style={{ animationDelay, animationFillMode: "forwards" }}
                >
                  {cardBody}
                </Link>
              );
            }

            return (
              <div
                key={mod.title}
                className="animate-fade-in opacity-0"
                style={{ animationDelay, animationFillMode: "forwards" }}
              >
                {cardBody}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
