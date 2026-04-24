import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { de as deLocale } from "date-fns/locale";
import {
  ArrowRight,
  Inbox,
  Loader2,
  MessageCircle,
  Phone,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLeads } from "@/hooks/useLeads";
import { useSendWaMessage } from "@/hooks/useSendWaMessage";
import { WhatsAppThread } from "@/components/funnel/WhatsAppThread";
import type { Lead, LeadStatus } from "@/types/leads";
import { cn } from "@/lib/utils";

const BODY_MAX_CHARS = 4096;

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

function statusBadgeClass(status: LeadStatus): string {
  switch (status) {
    case "new":
      return "bg-primary/15 text-primary border-primary/30";
    case "contacted":
      return "bg-warning/15 text-warning border-warning/30";
    case "closed":
      return "bg-muted text-muted-foreground border-border";
  }
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), {
      addSuffix: true,
      locale: deLocale,
    });
  } catch {
    return iso;
  }
}

export default function InboxPage() {
  const { data: leads = [], isLoading } = useLeads();

  // Nur Leads mit tatsaechlicher Konversation. Sortierung nach updated_at
  // desc, damit frisch eingehende Nachrichten oben stehen.
  const conversationLeads = useMemo<Lead[]>(() => {
    return leads
      .filter((l) => (l.message_count ?? 0) > 0)
      .slice()
      .sort((a, b) => {
        const ta = new Date(a.updated_at).getTime();
        const tb = new Date(b.updated_at).getTime();
        return tb - ta;
      });
  }, [leads]);

  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // Auto-Select: beim ersten Laden / wenn der bisher selektierte Lead nicht
  // mehr in der Liste ist, den ersten Eintrag auswaehlen.
  useEffect(() => {
    if (conversationLeads.length === 0) {
      setSelectedLeadId(null);
      return;
    }
    const stillThere = conversationLeads.some((l) => l.id === selectedLeadId);
    if (!stillThere) {
      setSelectedLeadId(conversationLeads[0].id);
    }
  }, [conversationLeads, selectedLeadId]);

  const selectedLead = useMemo(
    () => conversationLeads.find((l) => l.id === selectedLeadId) ?? null,
    [conversationLeads, selectedLeadId],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground inline-flex items-center gap-2">
          <MessageCircle className="h-6 w-6 text-primary" />
          Inbox
        </h1>
        <p className="mt-1 text-sm sm:text-base text-muted-foreground">
          WhatsApp-Konversationen mit Leads. Freitext-Antworten nur innerhalb
          des 24-Stunden-Fensters.
        </p>
      </div>

      {conversationLeads.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          className="grid animate-fade-in gap-4 lg:grid-cols-3"
          style={{ animationDelay: "0.05s" }}
        >
          {/* Linke Spalte: Lead-Liste */}
          <div
            className={cn(
              "glass-card overflow-hidden p-0 lg:col-span-1",
              // Auf Mobile: ausblenden, sobald ein Lead gewaehlt ist, damit
              // der Thread die volle Breite kriegt. Klick auf "Zurueck" im
              // Thread-Header setzt selectedLeadId=null.
              selectedLead ? "hidden lg:block" : "block",
            )}
          >
            <div className="border-b border-border/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {conversationLeads.length}{" "}
                {conversationLeads.length === 1 ? "Konversation" : "Konversationen"}
              </p>
            </div>
            <ul className="max-h-[70vh] divide-y divide-border/60 overflow-y-auto">
              {conversationLeads.map((lead) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedLeadId(lead.id)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-muted/40",
                      selectedLeadId === lead.id && "bg-muted/60",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {lead.name || (
                            <span className="text-muted-foreground">
                              (ohne Name)
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {formatPhone(lead.phone)}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 border text-[10px]",
                          statusBadgeClass(lead.status),
                        )}
                      >
                        {statusLabel(lead.status)}
                      </Badge>
                    </div>
                    {lead.last_message && (
                      <p className="mt-1.5 truncate text-xs text-muted-foreground">
                        {lead.last_message}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {relativeTime(lead.updated_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Rechte Spalte: Thread + Compose */}
          <div
            className={cn(
              "glass-card flex flex-col overflow-hidden p-0 lg:col-span-2",
              selectedLead ? "block" : "hidden lg:block",
            )}
          >
            {selectedLead ? (
              <ThreadPanel
                lead={selectedLead}
                onBack={() => setSelectedLeadId(null)}
              />
            ) : (
              <div className="flex min-h-[300px] items-center justify-center p-6 text-sm text-muted-foreground">
                Konversation aus der Liste auswaehlen.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadPanel({
  lead,
  onBack,
}: {
  lead: Lead;
  onBack: () => void;
}) {
  const send = useSendWaMessage();
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-Grow: Textarea waechst mit Inhalt bis max 200px.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  // Lead-Wechsel: Draft leeren.
  useEffect(() => {
    setDraft("");
  }, [lead.id]);

  const canSend =
    draft.trim().length > 0 &&
    draft.length <= BODY_MAX_CHARS &&
    !send.isPending;

  const handleSend = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate(
      { lead_id: lead.id, body },
      {
        onSuccess: () => {
          setDraft("");
          // Focus behalten fuer flottes Weiterschreiben.
          requestAnimationFrame(() => textareaRef.current?.focus());
        },
      },
    );
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full min-h-[400px] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-background/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Mobile: Zurueck-Button, auf Desktop ausgeblendet */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="lg:hidden"
            aria-label="Zurueck zur Liste"
          >
            <ArrowRight className="h-4 w-4 rotate-180" />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {lead.name || "(ohne Name)"}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {formatPhone(lead.phone)}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "border text-[10px]",
                  statusBadgeClass(lead.status),
                )}
              >
                {statusLabel(lead.status)}
              </Badge>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" asChild className="shrink-0">
          <Link to={`/funnel/${lead.id}`}>
            <span className="hidden sm:inline">Zum Lead-Detail</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <WhatsAppThread leadId={lead.id} heading={null} />
      </div>

      {/* Compose-Bar */}
      <div className="border-t border-border/60 bg-background/50 p-3 sm:p-4">
        <p className="mb-2 text-[11px] text-muted-foreground">
          Freitext-Antworten nur innerhalb des 24-Stunden-Fensters nach der
          letzten Inbound-Nachricht. Ausserhalb: nur Template erlaubt.
        </p>
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Antwort schreiben… (Enter sendet, Shift+Enter = Zeilenumbruch)"
            rows={1}
            maxLength={BODY_MAX_CHARS}
            className="min-h-[40px] resize-none"
            disabled={send.isPending}
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="shrink-0 gap-2"
          >
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Senden</span>
          </Button>
        </div>
        <div className="mt-1 text-right text-[10px] text-muted-foreground">
          {draft.length}/{BODY_MAX_CHARS}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass-card flex flex-col items-center justify-center gap-4 p-10 text-center animate-fade-in">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Inbox className="h-6 w-6 text-primary" />
      </div>
      <div>
        <p className="font-medium text-foreground">
          Noch keine WhatsApp-Konversationen.
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Sobald ein Lead antwortet oder du einen Template-Versand startest,
          erscheint die Konversation hier.
        </p>
      </div>
    </div>
  );
}
