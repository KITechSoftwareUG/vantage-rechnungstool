import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useUpdateTransactionMatch, useUnmatchedInvoices } from "@/hooks/useMatching";
import { useAddRecurringPattern } from "@/hooks/useRecurringPatterns";
import { useMatchingAgent, AgentCandidate } from "@/hooks/useMatchingAgent";
import { UrlDocumentPreview } from "@/components/upload/UrlDocumentPreview";
import { resolveStorageUrl } from "@/lib/resolveStorageUrl";

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  transactionType: "debit" | "credit";
  matchStatus: string;
  bankName?: string;
  bankType?: string;
}

interface Invoice {
  id: string;
  user_id: string;
  year: number;
  month: number;
  issuer: string;
  amount: number;
  currency?: string;
  date: string;
  file_name: string;
  file_url?: string | null;
  invoice_number?: string | null;
  type?: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactions: Transaction[];
}

type LocalCandidate = AgentCandidate & {
  invoice?: Invoice;
};

function scoreLocally(tx: Transaction, inv: Invoice): number {
  const desc = tx.description.toLowerCase();
  const issuer = (inv.issuer ?? "").toLowerCase();
  let score = 0;
  const tokens = issuer.split(/[\s,.\-_/]+/).filter((t) => t.length >= 4);
  let hits = 0;
  for (const t of tokens) if (desc.includes(t)) hits++;
  if (tokens.length) score += (hits / tokens.length) * 60;

  const txAmt = Math.abs(tx.amount);
  const invAmt = Math.abs(inv.amount);
  if (invAmt > 0) {
    if (Math.abs(txAmt - invAmt) < 0.01) score += 30;
    else if (Math.abs(txAmt - invAmt) / invAmt < 0.05) score += 15;
  }
  const days = Math.abs(new Date(tx.date).getTime() - new Date(inv.date).getTime()) / 86400000;
  if (days <= 30) score += 10 - Math.min(10, Math.floor(days / 3));
  return score;
}

export function MatchingAgentDialog({ open, onOpenChange, transactions }: Props) {
  const { toast } = useToast();
  const updateMatch = useUpdateTransactionMatch();
  const addRecurring = useAddRecurringPattern();
  const agent = useMatchingAgent();
  const { data: invoices = [] } = useUnmatchedInvoices();

  const [index, setIndex] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [candidateIdx, setCandidateIdx] = useState(0);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentTx = transactions[index];
  const total = transactions.length;
  const done = !currentTx;

  // Lokale Top-Kandidaten pro Transaktion (vorrangige Sortierung, bevor der Agent läuft).
  const localCandidates: LocalCandidate[] = useMemo(() => {
    if (!currentTx) return [];
    const ranked = [...(invoices as Invoice[])]
      .map((inv) => ({ inv, score: scoreLocally(currentTx, inv) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return ranked.map((r, idx) => ({
      nummer: idx + 1,
      invoiceId: r.inv.id,
      issuer: r.inv.issuer,
      amount: Number(r.inv.amount),
      currency: r.inv.currency ?? "EUR",
      date: r.inv.date,
      file: r.inv.file_name,
      invoiceNumber: r.inv.invoice_number ?? null,
      type: r.inv.type ?? null,
      invoice: r.inv,
    }));
  }, [currentTx, invoices]);

  const currentCandidate = localCandidates[candidateIdx];

  // Reset bei Dialog-Öffnung oder Transaktions-Wechsel
  useEffect(() => {
    if (!open) return;
    setMessages([
      {
        role: "assistant",
        content:
          total === 0
            ? "Aktuell sind keine offenen Transaktionen zum Durchgehen da."
            : `${total} offene Transaktion${total === 1 ? "" : "en"}. Ich gehe sie mit dir durch — schreib mir frei, was dazu gehört, oder nutz die Schnellaktionen.`,
      },
    ]);
    setIndex(0);
    setCandidateIdx(0);
    setProcessedCount(0);
  }, [open]);

  useEffect(() => {
    setCandidateIdx(0);
  }, [currentTx?.id]);

  // Invoice-URL auflösen wenn sich Kandidat ändert
  useEffect(() => {
    setResolvedUrl(null);
    const inv = currentCandidate?.invoice;
    if (!inv) return;
    if (!inv.user_id || !inv.year || !inv.month || !inv.file_name) {
      if (inv.file_url) setResolvedUrl(inv.file_url);
      return;
    }
    setUrlLoading(true);
    resolveStorageUrl(inv.user_id, inv.year, inv.month, inv.file_name, inv.file_url ?? undefined)
      .then(setResolvedUrl)
      .catch(() => setResolvedUrl(inv.file_url ?? null))
      .finally(() => setUrlLoading(false));
  }, [currentCandidate?.invoiceId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const pushMessage = (m: ChatMessage) => setMessages((prev) => [...prev, m]);

  const goToNext = useCallback(() => {
    setInput("");
    setProcessedCount((c) => c + 1);
    if (index + 1 >= total) {
      pushMessage({ role: "assistant", content: "Fertig — alle offenen Transaktionen sind durch." });
      setIndex(total);
    } else {
      setIndex((i) => i + 1);
      pushMessage({
        role: "assistant",
        content: `Weiter. Nächste Transaktion (${index + 2} / ${total}).`,
      });
    }
  }, [index, total]);

  const applyAction = useCallback(
    async (action: "match" | "recurring" | "ignored" | "no_match", invoiceId?: string | null) => {
      if (!currentTx) return;
      try {
        if (action === "recurring") {
          await addRecurring.mutateAsync(currentTx.description);
        }
        await updateMatch.mutateAsync({
          transactionId: currentTx.id,
          invoiceId: action === "match" ? invoiceId ?? null : null,
          matchStatus:
            action === "match"
              ? "confirmed"
              : action === "recurring"
                ? "recurring"
                : action === "ignored"
                  ? "ignored"
                  : "no_match",
          matchConfidence: action === "match" ? 100 : undefined,
        });
        const label =
          action === "match"
            ? "Rechnung zugeordnet"
            : action === "recurring"
              ? "Als Laufende Kosten markiert"
              : action === "ignored"
                ? "Ignoriert"
                : "Als Keine Rechnung markiert";
        pushMessage({ role: "assistant", content: `✓ ${label}.` });
        goToNext();
      } catch (error: any) {
        toast({ title: "Fehler", description: error.message, variant: "destructive" });
      }
    },
    [currentTx, addRecurring, updateMatch, goToNext, toast],
  );

  const handleSend = useCallback(async () => {
    if (!currentTx || !input.trim() || agent.isPending) return;
    const userMsg = input.trim();
    pushMessage({ role: "user", content: userMsg });
    setInput("");

    try {
      const res = await agent.mutateAsync({
        transactionId: currentTx.id,
        userMessage: userMsg,
        chatHistory: messages.slice(-8),
      });

      if (res.action === "ask") {
        pushMessage({
          role: "assistant",
          content: `${res.message}${res.followUp ? `\n\n${res.followUp}` : ""}`,
        });
        return;
      }

      pushMessage({ role: "assistant", content: res.message || "Verstanden." });

      if (res.action === "match" && res.invoiceId) {
        // Kandidat im lokalen Panel umschalten, damit die Preview passt
        const matchIdx = localCandidates.findIndex((c) => c.invoiceId === res.invoiceId);
        if (matchIdx >= 0) setCandidateIdx(matchIdx);
        await applyAction("match", res.invoiceId);
      } else if (res.action === "recurring") {
        await applyAction("recurring");
      } else if (res.action === "ignored") {
        await applyAction("ignored");
      } else if (res.action === "no_match") {
        await applyAction("no_match");
      }
    } catch (error: any) {
      pushMessage({
        role: "assistant",
        content: `Fehler beim Agenten: ${error.message ?? error}`,
      });
    }
  }, [currentTx, input, agent, messages, localCandidates, applyAction]);

  const fileLooksLikePdf = useMemo(() => {
    const name = currentCandidate?.invoice?.file_name?.toLowerCase() ?? "";
    const url = (resolvedUrl ?? "").toLowerCase();
    return name.endsWith(".pdf") || url.includes(".pdf");
  }, [currentCandidate, resolvedUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl h-[90vh] p-0 flex flex-col">
        <DialogHeader className="border-b border-border/50 px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            KI-Matching-Assistent
            {!done && (
              <Badge variant="outline" className="ml-2">
                {Math.min(index + 1, total)} / {total}
              </Badge>
            )}
            {done && total > 0 && (
              <Badge variant="outline" className="ml-2 bg-success/10 text-success border-success/20">
                <Check className="mr-1 h-3 w-3" />
                Fertig · {processedCount} bearbeitet
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* LINKS: Transaktion + Chat */}
          <div className="flex flex-col min-h-0 border-r border-border/50">
            {/* Transaktions-Header */}
            {currentTx ? (
              <div className="border-b border-border/50 p-4 bg-muted/20">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>
                    {new Date(currentTx.date).toLocaleDateString("de-DE")}
                    {currentTx.bankName ? ` · ${currentTx.bankName}` : ""}
                  </span>
                  <span
                    className={cn(
                      "font-mono font-semibold text-sm",
                      currentTx.transactionType === "credit" ? "text-success" : "text-foreground",
                    )}
                  >
                    {currentTx.transactionType === "credit" ? "+" : "-"}
                    {Math.abs(currentTx.amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                  </span>
                </div>
                <p className="text-sm font-medium text-foreground">{currentTx.description}</p>
              </div>
            ) : (
              <div className="border-b border-border/50 p-4 bg-muted/20 text-sm text-muted-foreground">
                Keine Transaktion ausgewählt.
              </div>
            )}

            {/* Chat */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-2",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {agent.isPending && (
                <div className="flex gap-2 justify-start">
                  <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Agent denkt nach…
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Quick actions */}
            {currentTx && (
              <div className="border-t border-border/50 p-3 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={!currentCandidate || updateMatch.isPending}
                    onClick={() => currentCandidate && applyAction("match", currentCandidate.invoiceId)}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Passt ({currentCandidate?.issuer ?? "—"})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={updateMatch.isPending}
                    onClick={() => applyAction("recurring")}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Laufende Kosten
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={updateMatch.isPending}
                    onClick={() => applyAction("ignored")}
                  >
                    <EyeOff className="mr-1 h-3 w-3" />
                    Ignorieren
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={updateMatch.isPending}
                    onClick={() => applyAction("no_match")}
                  >
                    <X className="mr-1 h-3 w-3" />
                    Keine Rechnung
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs ml-auto"
                    onClick={goToNext}
                  >
                    Überspringen →
                  </Button>
                </div>

                {/* Input */}
                <div className="flex gap-2">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Was gehört zu dieser Transaktion? (z.B. 'Amazon-Kauf Drucker', 'Miete', 'die dritte Rechnung')"
                    disabled={agent.isPending || updateMatch.isPending}
                  />
                  <Button
                    size="icon"
                    onClick={handleSend}
                    disabled={!input.trim() || agent.isPending || updateMatch.isPending}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {done && total > 0 && (
              <div className="border-t border-border/50 p-3">
                <Button className="w-full" onClick={() => onOpenChange(false)}>
                  Schließen
                </Button>
              </div>
            )}
          </div>

          {/* RECHTS: Invoice Vorschau */}
          <div className="flex flex-col min-h-0 bg-muted/10">
            {currentCandidate ? (
              <>
                <div className="border-b border-border/50 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Sparkles className="h-3 w-3" />
                        Vorschlag {candidateIdx + 1} / {localCandidates.length}
                      </div>
                      <p className="truncate text-sm font-semibold text-foreground mt-0.5">
                        {currentCandidate.issuer}
                      </p>
                      <div className="mt-0.5 text-xs text-muted-foreground flex gap-3">
                        <span>{new Date(currentCandidate.date).toLocaleDateString("de-DE")}</span>
                        <span className="font-mono">
                          {currentCandidate.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })}{" "}
                          {currentCandidate.currency}
                        </span>
                        {currentCandidate.invoiceNumber && (
                          <span>#{currentCandidate.invoiceNumber}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={candidateIdx === 0}
                        onClick={() => setCandidateIdx((v) => Math.max(0, v - 1))}
                        title="Vorheriger Vorschlag"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        disabled={candidateIdx >= localCandidates.length - 1}
                        onClick={() =>
                          setCandidateIdx((v) => Math.min(localCandidates.length - 1, v + 1))
                        }
                        title="Nächster Vorschlag"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-3">
                  {urlLoading ? (
                    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Rechnung wird geladen…
                    </div>
                  ) : resolvedUrl ? (
                    fileLooksLikePdf ? (
                      <UrlDocumentPreview
                        fileUrl={resolvedUrl}
                        fileName={currentCandidate.invoice?.file_name ?? ""}
                        className="max-h-full"
                      />
                    ) : (
                      <img
                        src={resolvedUrl}
                        alt={currentCandidate.issuer}
                        className="mx-auto max-h-full object-contain"
                      />
                    )
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-sm text-muted-foreground gap-2">
                      <FileText className="h-8 w-8" />
                      Keine Vorschau verfügbar.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-sm text-muted-foreground gap-2 p-8 text-center">
                <FileText className="h-8 w-8" />
                {done
                  ? "Alle Transaktionen bearbeitet."
                  : invoices.length === 0
                    ? "Keine offenen Rechnungen vorhanden — Transaktionen können nur ignoriert oder als Laufende Kosten markiert werden."
                    : "Kein Vorschlag für diese Transaktion."}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
