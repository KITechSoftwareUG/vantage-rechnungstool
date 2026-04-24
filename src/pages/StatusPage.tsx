import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { de as deLocale } from "date-fns/locale";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Settings,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useHealthCheck, type HealthStatus } from "@/hooks/useHealthCheck";
import { cn } from "@/lib/utils";

interface CardDef {
  title: string;
  icon: LucideIcon;
  status: HealthStatus;
  detail: string;
  configAnchor: string;
  extraLine?: string | null;
}

function statusMeta(status: HealthStatus): {
  label: string;
  classes: string;
  icon: LucideIcon;
} {
  switch (status) {
    case "ok":
      return {
        label: "OK",
        classes: "border-success/40 bg-success/10 text-success",
        icon: CheckCircle2,
      };
    case "not_configured":
      return {
        label: "Nicht konfiguriert",
        classes: "border-warning/40 bg-warning/10 text-warning",
        icon: AlertCircle,
      };
    case "error":
      return {
        label: "Fehler",
        classes: "border-destructive/40 bg-destructive/10 text-destructive",
        icon: XCircle,
      };
  }
}

export default function StatusPage() {
  const { data, isLoading, isFetching, refetch, dataUpdatedAt, error } =
    useHealthCheck();

  const cards: CardDef[] = data
    ? [
        {
          title: "Meta / WhatsApp",
          icon: MessageCircle,
          status: data.meta.status,
          detail: data.meta.detail,
          configAnchor: "/config#whatsapp",
          extraLine: data.meta.display_phone_number
            ? `Nummer: +${data.meta.display_phone_number.replace(/[^0-9]/g, "")}`
            : null,
        },
        {
          title: "Anthropic (KI-Antworten)",
          icon: Sparkles,
          status: data.anthropic.status,
          detail: data.anthropic.detail,
          configAnchor: "/config#anthropic",
          extraLine: data.anthropic.model ?? null,
        },
        {
          title: "Gmail (Mail-Fallback)",
          icon: Mail,
          status: data.gmail.status,
          detail: data.gmail.detail,
          configAnchor: "/config#gmail",
          extraLine: data.gmail.email ?? null,
        },
      ]
    : [];

  const lastUpdated = dataUpdatedAt
    ? (() => {
        try {
          return formatDistanceToNow(new Date(dataUpdatedAt), {
            addSuffix: true,
            locale: deLocale,
          });
        } catch {
          return "";
        }
      })()
    : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between animate-fade-in">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground inline-flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            Systemstatus
          </h1>
          <p className="mt-1 text-sm sm:text-base text-muted-foreground">
            Live-Check der externen Integrationen (Meta, Anthropic, Gmail).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Zuletzt: {lastUpdated}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Alle pruefen
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="glass-card p-6">
          <div className="flex items-center gap-3 text-destructive">
            <XCircle className="h-5 w-5" />
            <p className="font-medium">Health-Check konnte nicht ausgefuehrt werden.</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {(error as Error).message}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 gap-2"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-4 w-4" />
            Erneut versuchen
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 animate-fade-in md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <StatusCard
              key={card.title}
              card={card}
              isRefreshing={isFetching}
              onRefresh={() => refetch()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusCard({
  card,
  isRefreshing,
  onRefresh,
}: {
  card: CardDef;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const meta = statusMeta(card.status);
  const StatusIcon = meta.icon;
  const CardIcon = card.icon;

  return (
    <div className="glass-card flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <CardIcon className="h-4 w-4 text-primary" />
          </div>
          <h2 className="font-heading text-base font-semibold text-foreground">
            {card.title}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label={`${card.title} erneut pruefen`}
          className="shrink-0"
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Badge variant="outline" className={cn("w-fit gap-1.5 border", meta.classes)}>
        <StatusIcon className="h-3 w-3" />
        {meta.label}
      </Badge>

      <div className="space-y-1">
        {card.extraLine && (
          <p className="text-sm font-medium text-foreground">
            {card.extraLine}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{card.detail}</p>
      </div>

      {card.status === "not_configured" && (
        <Button
          variant="outline"
          size="sm"
          asChild
          className="mt-auto w-fit gap-2"
        >
          <Link to={card.configAnchor}>
            <Settings className="h-3.5 w-3.5" />
            Zur Konfiguration
          </Link>
        </Button>
      )}
    </div>
  );
}
