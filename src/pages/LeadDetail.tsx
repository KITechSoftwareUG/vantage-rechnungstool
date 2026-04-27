import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { de as deLocale } from "date-fns/locale";
import {
  ArrowLeft,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  Copy,
  ExternalLink,
  Heart,
  Loader2,
  Mail,
  MessageCircleHeart,
  Phone,
  Quote,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLead, useUpdateLeadStatus, useWaMessages } from "@/hooks/useLeads";
import { useSuggestReply } from "@/hooks/useSuggestReply";
import { useMarkManualWaSent } from "@/hooks/useMarkManualWaSent";
import { useToast } from "@/hooks/use-toast";
import type { Lead, LeadMeta, LeadStatus, LeadTracking } from "@/types/leads";
import { WhatsAppThread } from "@/components/funnel/WhatsAppThread";
import { cn } from "@/lib/utils";

const FIRST_CONTACT_MAX_CHARS = 4096;

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

function firstName(name: string | null): string {
  if (!name) return "Lead";
  const f = name.trim().split(/\s+/)[0];
  return f || "Lead";
}

// Liste menschenlesbarer Aussagen aus den meta-Feldern. Wir zeigen NUR was
// der Lead positiv angegeben hat — leere/nein-Antworten werden weggelassen,
// damit die UI kompakt bleibt und der Berater nicht durch "X: nein"-Zeilen
// scrollen muss. Unbekannte Werte fallen auf "Feld: Wert" zurueck.
function asYesNo(v: unknown): "ja" | "nein" | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "ja" || s === "yes" || s === "true") return "ja";
  if (s === "nein" || s === "no" || s === "false") return "nein";
  return null;
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

interface Statement {
  text: string;
  // Icon-Gruppe fuer optische Auflockerung — pro Kategorie ein eigenes
  // Lucide-Icon, damit die Liste nicht uniform aussieht.
  group: "behandlung" | "zaehne" | "vorgeschichte" | "einverstaendnis";
}

function buildStatements(meta: LeadMeta): Statement[] {
  const out: Statement[] = [];

  // --- Behandlungs-Status ---
  if (asYesNo(meta.laufende_behandlungen) === "ja") {
    out.push({ text: "Hat aktuell laufende zahnaerztliche Behandlungen", group: "behandlung" });
  }
  if (asYesNo(meta.geplante_behandlungen) === "ja") {
    out.push({ text: "Hat eine konkrete Behandlung in Aussicht", group: "behandlung" });
  }
  if (asYesNo(meta.hkp_erstellt) === "ja") {
    out.push({ text: "Heil- und Kostenplan wurde bereits erstellt", group: "behandlung" });
  }
  if (asYesNo(meta.behandlung_begonnen) === "ja") {
    out.push({ text: "Eine Behandlung hat bereits begonnen", group: "behandlung" });
  }

  // --- Zahn-Situation ---
  const fehlend = asNonEmptyString(meta.fehlende_zaehne);
  if (fehlend) {
    const yn = asYesNo(fehlend);
    if (yn === "ja") {
      out.push({ text: "Es fehlen Zaehne", group: "zaehne" });
    } else if (yn !== "nein") {
      out.push({ text: `Fehlende Zaehne: ${fehlend}`, group: "zaehne" });
    }
  }
  const ersatz = asNonEmptyString(meta.ersatz_typ);
  if (ersatz) {
    out.push({ text: `Wuenscht als Zahnersatz: ${ersatz}`, group: "zaehne" });
  }
  const fehlendSeit = asNonEmptyString(meta.fehlend_seit);
  if (fehlendSeit) {
    out.push({ text: `Zahnverlust seit: ${fehlendSeit}`, group: "zaehne" });
  }

  // --- Vorgeschichte ---
  if (asYesNo(meta.parodontitis_behandelt) === "ja") {
    out.push({ text: "Parodontitis-Behandlung in der Vorgeschichte", group: "vorgeschichte" });
  }
  if (asYesNo(meta.zahnfleischerkrankung) === "ja") {
    out.push({ text: "Hat eine Zahnfleischerkrankung angegeben", group: "vorgeschichte" });
  }
  if (asYesNo(meta.kieferfehlstellung) === "ja") {
    out.push({ text: "Hat eine Kieferfehlstellung angegeben", group: "vorgeschichte" });
  }
  if (asYesNo(meta.kfo_angeraten) === "ja") {
    out.push({ text: "Eine KFO-Behandlung wurde aerztlich angeraten", group: "vorgeschichte" });
  }

  // --- Einverstaendnis ---
  if (asYesNo(meta.einverstaendnis) === "ja") {
    out.push({ text: "Will per WhatsApp kontaktiert werden", group: "einverstaendnis" });
  }
  if (meta.gesundheitsdaten_einwilligung === true) {
    out.push({ text: "Hat in Verarbeitung von Gesundheitsdaten eingewilligt", group: "einverstaendnis" });
  }

  return out;
}

function statementIcon(group: Statement["group"]) {
  switch (group) {
    case "behandlung":
      return <Stethoscope className="h-4 w-4 shrink-0 text-primary" />;
    case "zaehne":
      return <Heart className="h-4 w-4 shrink-0 text-warning" />;
    case "vorgeschichte":
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />;
    case "einverstaendnis":
      return <ShieldCheck className="h-4 w-4 shrink-0 text-success" />;
  }
}

export default function LeadDetail() {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const { data: lead, isLoading, isError } = useLead(leadId);
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
      return formatDistanceToNow(new Date(lead.created_at), {
        addSuffix: true,
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
              <span className="text-xs sm:text-sm">Eingegangen {created}</span>
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

      {/* Was der Lead angegeben hat — natursprachlich, immer sichtbar */}
      <div className="animate-fade-in" style={{ animationDelay: "0.05s" }}>
        <SaidByLead lead={lead} />
      </div>

      <LeadConversationSection lead={lead} />
    </div>
  );
}

// Entscheidet, was unter den Lead-Daten kommt:
//   - Eingehende WA-Nachrichten gibt's? -> Thread anzeigen.
//   - Wir haben noch nicht geantwortet (kein outbound)? -> FirstContactCard.
// Beides gleichzeitig ist der Direct-WhatsApp-Fall: Lead hat geschrieben,
// wir bereiten unsere erste Antwort vor.
function LeadConversationSection({ lead }: { lead: Lead }) {
  const { data: messages = [] } = useWaMessages(lead.id);
  const hasAnyMessages = messages.length > 0;
  const hasOutbound = messages.some((m) => m.direction === "outbound");

  return (
    <>
      {hasAnyMessages && (
        <div className="glass-card p-4 sm:p-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          <WhatsAppThread leadId={lead.id} />
        </div>
      )}

      {!hasOutbound && (
        <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
          <FirstContactCard lead={lead} />
        </div>
      )}

      {/* Tracking — collapsed, weil technische Detail-Info, nicht primaer */}
      <div className="animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <TrackingCollapsible tracking={lead.meta.tracking} />
      </div>
    </>
  );
}

function SaidByLead({ lead }: { lead: Lead }) {
  const statements = buildStatements(lead.meta);
  const anliegen = asNonEmptyString(lead.meta.anliegen_summary);
  const fName = firstName(lead.name);

  if (!anliegen && statements.length === 0) {
    return (
      <div className="glass-card p-4 sm:p-6">
        <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground">
          Das hat {fName} angegeben
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Keine Anamnese-Daten uebermittelt.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <MessageCircleHeart className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground">
          Das hat {fName} angegeben
        </h2>
      </div>

      {anliegen && (
        <blockquote className="mt-4 rounded-lg border-l-4 border-primary/60 bg-primary/5 px-4 py-3">
          <Quote className="float-left mr-2 h-3.5 w-3.5 text-primary/70" />
          <p className="text-sm italic text-foreground">{anliegen}</p>
        </blockquote>
      )}

      {statements.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {statements.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-foreground">
              {statementIcon(s.group)}
              <span>{s.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FirstContactCard({ lead }: { lead: Lead }) {
  const suggest = useSuggestReply();
  const markSent = useMarkManualWaSent();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [hasOpenedWhatsApp, setHasOpenedWhatsApp] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoFetchedRef = useRef(false);

  // Auto-Grow: Textarea waechst mit Inhalt bis 320px.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [draft]);

  const runSuggest = (replaceConfirm: boolean) => {
    if (suggest.isPending) return;
    if (replaceConfirm && draft.trim().length > 0) {
      const ok = window.confirm("Aktuellen Entwurf durch neuen KI-Vorschlag ersetzen?");
      if (!ok) return;
    }
    suggest.mutate(
      { lead_id: lead.id, mode: "first_contact" },
      {
        onSuccess: ({ suggestion, analysis: a }) => {
          setDraft(suggestion);
          if (a) setAnalysis(a);
          // Bei expliziter Generierung Fokus in die Textarea — bei Auto-Fetch
          // nicht, damit man nicht aus dem aktuellen Scroll-Kontext gerissen
          // wird.
          if (replaceConfirm) {
            requestAnimationFrame(() => textareaRef.current?.focus());
            toast({ title: "Neuer Vorschlag eingefuegt" });
          }
        },
      },
    );
  };

  // Beim ersten Mount einmal automatisch generieren, damit der Berater nicht
  // erst klicken muss. Strict-Mode-Doppel-Mount via Ref-Guard abfangen.
  useEffect(() => {
    if (autoFetchedRef.current) return;
    autoFetchedRef.current = true;
    runSuggest(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const handleCopy = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "In Zwischenablage kopiert" });
    } catch {
      toast({
        title: "Kopieren fehlgeschlagen",
        description: "Bitte manuell markieren und kopieren.",
        variant: "destructive",
      });
    }
  };

  const handleOpenWhatsApp = () => {
    const text = draft.trim();
    // phone in DB ist E.164 ohne fuehrendes '+' — exakt das Format fuer wa.me.
    const url = `https://wa.me/${encodeURIComponent(lead.phone)}${
      text ? `?text=${encodeURIComponent(text)}` : ""
    }`;
    window.open(url, "_blank", "noopener,noreferrer");
    setHasOpenedWhatsApp(true);
  };

  const handleMarkSent = () => {
    const text = draft.trim();
    if (!text || markSent.isPending) return;
    markSent.mutate(
      { lead_id: lead.id, phone: lead.phone, body: text },
      {
        onSuccess: () => {
          setDraft("");
          setHasOpenedWhatsApp(false);
        },
      },
    );
  };

  const canMark = draft.trim().length > 0 && !markSent.isPending;
  const isInitialLoad = suggest.isPending && draft.length === 0;

  return (
    <div className="glass-card p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground">
          Erstkontakt vorbereiten
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Vorschlag aus den Lead-Daten generiert. Anpassen, dann WhatsApp oeffnen
        und absenden — zum Schluss auf "Als gesendet markieren" klicken.
      </p>

      {/* Analyse fuer den Berater */}
      {(analysis || isInitialLoad) && (
        <div className="mt-4 rounded-lg border border-border/60 bg-muted/40 p-3 sm:p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            Kurz-Analyse
          </div>
          {isInitialLoad ? (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Wird generiert…
            </div>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-foreground">{analysis}</p>
          )}
        </div>
      )}

      {/* Erstnachricht-Entwurf */}
      <div className="mt-4 space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Erstnachricht
        </label>
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            isInitialLoad
              ? "Wird generiert…"
              : "Noch leer. Auf 'Neu generieren' klicken oder eigenen Text schreiben."
          }
          maxLength={FIRST_CONTACT_MAX_CHARS}
          className="min-h-[140px] resize-none"
          disabled={markSent.isPending || isInitialLoad}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => runSuggest(true)}
            disabled={suggest.isPending || markSent.isPending}
            className="gap-2"
          >
            {suggest.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Neu generieren
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {draft.length}/{FIRST_CONTACT_MAX_CHARS}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={draft.trim().length === 0}
            className="gap-2"
          >
            <Copy className="h-4 w-4" />
            Kopieren
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleOpenWhatsApp}
            disabled={draft.trim().length === 0}
            className="gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            WhatsApp oeffnen
          </Button>
          <Button
            type="button"
            variant={hasOpenedWhatsApp ? "default" : "outline"}
            size="sm"
            onClick={handleMarkSent}
            disabled={!canMark}
            className="gap-2"
          >
            {markSent.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckSquare className="h-4 w-4" />
            )}
            Als gesendet markieren
          </Button>
        </div>
      </div>
    </div>
  );
}

// user_agent ist lang und wenig hilfreich — nur grobe OS/Browser-Info.
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

function TrackingCollapsible({ tracking }: { tracking: LeadTracking | undefined }) {
  const [open, setOpen] = useState(false);
  const t = tracking ?? {};

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

  type Row = { label: string; value: ReactNode };
  const rows: Row[] = [];

  if (utm.length > 0) {
    rows.push({
      label: "UTM",
      value: (
        <div className="flex flex-wrap justify-end gap-1">
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
      label: "Geraet",
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
    rows.push({ label: "Formular-Dauer", value: `${t.duration_seconds}s` });
  }
  if (t.form_completed_at) {
    try {
      rows.push({
        label: "Abgeschlossen",
        value: format(new Date(t.form_completed_at), "dd.MM.yyyy · HH:mm 'Uhr'", {
          locale: deLocale,
        }),
      });
    } catch {
      /* ignore */
    }
  }

  if (rows.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Tracking-Details ({rows.length})
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <div className="glass-card p-4 sm:p-6">
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div
                key={`${r.label}-${i}`}
                className="flex items-start justify-between gap-3 border-b border-border/50 py-2 last:border-b-0"
              >
                <span className="shrink-0 text-sm text-muted-foreground">{r.label}</span>
                <div className="min-w-0 max-w-[70%] text-right text-sm">{r.value}</div>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
