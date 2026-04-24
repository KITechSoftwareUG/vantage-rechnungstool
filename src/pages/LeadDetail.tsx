import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { de as deLocale } from "date-fns/locale";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Smartphone,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useLead,
  useUpdateLeadStatus,
  useWaMessages,
} from "@/hooks/useLeads";
import type { Lead, LeadMeta, LeadStatus, WaMessage } from "@/types/leads";
import { cn } from "@/lib/utils";

function formatPhone(phone: string): string {
  if (!phone) return "";
  const cleaned = phone.replace(/[^0-9+]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function statusLabel(status: LeadStatus): string {
  switch (status) {
    case "new":
      return "Neu";
    case "contacted":
      return "Kontaktiert";
    case "closed":
      return "Geschlossen";
  }
}

// Labels fuer die Anamnese-Felder aus `meta`. Reihenfolge wird fuer das
// UI verwendet. Nur Felder mit Wert werden angezeigt (siehe render).
const ANAMNESE_FIELDS: Array<{
  key: keyof LeadMeta;
  label: string;
}> = [
  { key: "laufende_behandlungen", label: "Laufende Behandlungen" },
  { key: "geplante_behandlungen", label: "Geplante Behandlungen" },
  { key: "hkp_erstellt", label: "HKP erstellt" },
  { key: "behandlung_begonnen", label: "Behandlung begonnen" },
  { key: "fehlende_zaehne", label: "Fehlende Zähne" },
  { key: "ersatz_typ", label: "Ersatz-Typ" },
  { key: "fehlend_seit", label: "Fehlend seit" },
  { key: "parodontitis_behandelt", label: "Parodontitis behandelt" },
  { key: "zahnfleischerkrankung", label: "Zahnfleischerkrankung" },
  { key: "kieferfehlstellung", label: "Kieferfehlstellung" },
  { key: "kfo_angeraten", label: "KFO angeraten" },
];

// user_agent ist lang und wenig hilfreich — wir ziehen nur die grobe
// OS/Browser-Info raus. Fallback: nichts.
function shortUserAgent(ua: string | undefined): string | null {
  if (!ua) return null;
  const os =
    /Windows NT/.test(ua)
      ? "Windows"
      : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
      ? "iOS"
      : /Linux/.test(ua)
      ? "Linux"
      : null;
  const browser =
    /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
      ? "Firefox"
      : /Safari\//.test(ua)
      ? "Safari"
      : null;
  return [os, browser].filter(Boolean).join(" · ") || null;
}

export default function LeadDetail() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { data: lead, isLoading, isError } = useLead(leadId);
  const { data: messages = [], isLoading: messagesLoading } =
    useWaMessages(leadId);
  const updateStatus = useUpdateLeadStatus();

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !lead) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/funnel")} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Liste
        </Button>
        <div className="glass-card p-8 text-center">
          <p className="font-medium text-foreground">Lead nicht gefunden.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Die ID existiert nicht oder wurde geloescht.
          </p>
        </div>
      </div>
    );
  }

  const created = (() => {
    try {
      return format(new Date(lead.created_at), "dd.MM.yyyy · HH:mm 'Uhr'", {
        locale: deLocale,
      });
    } catch {
      return lead.created_at;
    }
  })();

  return (
    <div className="space-y-6">
      {/* Back */}
      <div className="animate-fade-in">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="-ml-2 gap-2 text-muted-foreground"
        >
          <Link to="/funnel">
            <ArrowLeft className="h-4 w-4" />
            Zurück zur Liste
          </Link>
        </Button>
      </div>

      {/* Header-Card */}
      <div className="glass-card p-4 sm:p-6 animate-fade-in">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="font-heading text-xl sm:text-2xl font-bold text-foreground break-words">
              {lead.name || "(ohne Name)"}
            </h1>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{formatPhone(lead.phone)}</span>
              </span>
              {lead.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{lead.email}</span>
                </span>
              )}
              <span className="text-xs sm:text-sm">{created}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">Status</span>
            <div className="flex-1 sm:w-44 sm:flex-none">
              <Select
                value={lead.status}
                onValueChange={(v) =>
                  updateStatus.mutate({ id: lead.id, status: v as LeadStatus })
                }
                disabled={updateStatus.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">{statusLabel("new")}</SelectItem>
                  <SelectItem value="contacted">
                    {statusLabel("contacted")}
                  </SelectItem>
                  <SelectItem value="closed">{statusLabel("closed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* Anamnese + Tracking */}
      <div className="grid gap-4 lg:grid-cols-2 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <AnamnesePanel lead={lead} />
        <TrackingPanel lead={lead} />
      </div>

      {/* WhatsApp-Konversation */}
      <div className="glass-card p-4 sm:p-6 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground inline-flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary shrink-0" />
            <span className="truncate">WhatsApp-Konversation</span>
          </h2>
          <span className="text-xs text-muted-foreground">
            {messages.length} {messages.length === 1 ? "Nachricht" : "Nachrichten"}
          </span>
        </div>

        {messagesLoading ? (
          <div className="flex min-h-[120px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Noch keine WhatsApp-Konversation.
          </p>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnamnesePanel({ lead }: { lead: Lead }) {
  const rows = ANAMNESE_FIELDS.map((f) => {
    const raw = lead.meta[f.key];
    const value =
      typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
    return value.trim().length > 0 ? { label: f.label, value } : null;
  }).filter((r): r is { label: string; value: string } => r !== null);

  const consent = lead.meta.einverstaendnis;
  const healthData = lead.meta.gesundheitsdaten_einwilligung;

  return (
    <div className="glass-card p-4 sm:p-6">
      <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground">
        Anamnese
      </h2>
      {lead.meta.anliegen_summary && (
        <p className="mt-2 text-sm text-muted-foreground">
          {lead.meta.anliegen_summary}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Keine Anamnese-Daten erfasst.
          </p>
        ) : (
          rows.map((r) => (
            <div
              key={r.label}
              className="flex items-start justify-between gap-3 border-b border-border/50 py-2 last:border-b-0"
            >
              <span className="text-sm text-muted-foreground">{r.label}</span>
              <span className="text-right text-sm font-medium text-foreground">
                {r.value}
              </span>
            </div>
          ))
        )}
      </div>

      {(consent !== undefined || healthData !== undefined) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {consent !== undefined && (
            <ConsentBadge
              label="Einverständnis"
              granted={
                typeof consent === "string"
                  ? consent.toLowerCase() === "ja"
                  : !!consent
              }
            />
          )}
          {healthData !== undefined && (
            <ConsentBadge
              label="Gesundheitsdaten"
              granted={!!healthData}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ConsentBadge({
  label,
  granted,
}: {
  label: string;
  granted: boolean;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border",
        granted
          ? "border-success/40 bg-success/10 text-success"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {granted ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <XCircle className="h-3 w-3" />
      )}
      {label}
    </Badge>
  );
}

function TrackingPanel({ lead }: { lead: Lead }) {
  const t = lead.meta.tracking ?? {};

  const utm = [
    t.utm_source && `source: ${t.utm_source}`,
    t.utm_medium && `medium: ${t.utm_medium}`,
    t.utm_campaign && `campaign: ${t.utm_campaign}`,
    t.utm_content && `content: ${t.utm_content}`,
    t.utm_term && `term: ${t.utm_term}`,
  ].filter((s): s is string => !!s);

  const deviceParts = [
    shortUserAgent(t.user_agent),
    t.screen && `Screen ${t.screen}`,
    t.viewport && `Viewport ${t.viewport}`,
  ].filter((s): s is string => !!s);

  const rows: Array<{ label: string; value: ReactNode }> = [];

  if (utm.length > 0) {
    rows.push({
      label: "UTM",
      value: (
        <div className="flex flex-wrap gap-1 justify-end">
          {utm.map((u) => (
            <Badge key={u} variant="outline" className="font-normal">
              {u}
            </Badge>
          ))}
        </div>
      ),
    });
  }
  if (t.page_url) {
    rows.push({
      label: "Landing-URL",
      value: (
        <a
          href={t.page_url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-primary hover:underline"
          title={t.page_url}
        >
          {t.page_url}
        </a>
      ),
    });
  }
  if (t.referrer) {
    rows.push({
      label: "Referrer",
      value: (
        <span className="truncate text-foreground" title={t.referrer}>
          {t.referrer}
        </span>
      ),
    });
  }
  if (deviceParts.length > 0) {
    rows.push({
      label: "Gerät",
      value: (
        <span className="inline-flex items-center gap-1.5 text-foreground">
          <Smartphone className="h-3 w-3 text-muted-foreground" />
          {deviceParts.join(" · ")}
        </span>
      ),
    });
  }
  if (t.language) {
    rows.push({ label: "Sprache", value: t.language });
  }
  if (typeof t.duration_seconds === "number") {
    rows.push({
      label: "Formular-Dauer",
      value: `${t.duration_seconds}s`,
    });
  }
  if (t.form_completed_at) {
    try {
      rows.push({
        label: "Abgeschlossen",
        value: formatDistanceToNow(new Date(t.form_completed_at), {
          addSuffix: true,
          locale: deLocale,
        }),
      });
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="glass-card p-4 sm:p-6">
      <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground">
        Tracking
      </h2>

      <div className="mt-4 space-y-2">
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Keine Tracking-Daten uebermittelt.
          </p>
        ) : (
          rows.map((r, i) => (
            <div
              key={`${r.label}-${i}`}
              className="flex items-start justify-between gap-3 border-b border-border/50 py-2 last:border-b-0"
            >
              <span className="shrink-0 text-sm text-muted-foreground">
                {r.label}
              </span>
              <div className="min-w-0 max-w-[70%] text-right text-sm">
                {r.value}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: WaMessage }) {
  const isOutbound = message.direction === "outbound";
  const timestamp = (() => {
    try {
      return format(new Date(message.created_at), "dd.MM.yyyy · HH:mm", {
        locale: deLocale,
      });
    } catch {
      return message.created_at;
    }
  })();

  const content =
    message.template_name && !message.body ? (
      <span className="inline-flex items-center gap-1 italic">
        <Smartphone className="h-3 w-3" />
        Template: {message.template_name}
      </span>
    ) : (
      <span className="whitespace-pre-wrap break-words">
        {message.body || "(leer)"}
      </span>
    );

  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-4 py-2 text-sm shadow-sm",
          isOutbound
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        <div>{content}</div>
        <div
          className={cn(
            "mt-1 text-[10px]",
            isOutbound
              ? "text-primary-foreground/70"
              : "text-muted-foreground",
          )}
        >
          {timestamp}
        </div>
      </div>
    </div>
  );
}
