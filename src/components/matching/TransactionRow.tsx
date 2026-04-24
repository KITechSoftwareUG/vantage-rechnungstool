import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X, Link, Unlink, ChevronDown, Sparkles, Eye, EyeOff, RefreshCw, Maximize2, Undo2 } from "lucide-react";
import { UrlDocumentPreview } from "@/components/upload/UrlDocumentPreview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { useUpdateTransactionMatch, useUnmatchedInvoices } from "@/hooks/useMatching";
import { useAddRecurringPattern } from "@/hooks/useRecurringPatterns";
import { useSwipeAction } from "@/hooks/useSwipeAction";
import { useToast } from "@/hooks/use-toast";
import { resolveStorageUrl } from "@/lib/resolveStorageUrl";

interface TransactionRowProps {
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** True wenn diese Zeile per Keyboard-Navigation gerade fokussiert ist */
  isFocused?: boolean;
  /** Callback wenn der User per Maus auf diese Zeile klickt */
  onFocus?: () => void;
  /** Wird aufgerufen mit dem DOM-Node, damit MatchingPage scrollIntoView ausführen kann */
  registerRef?: (node: HTMLDivElement | null) => void;
  transaction: {
    id: string;
    date: string;
    description: string;
    amount: number;
    transactionType: "debit" | "credit";
    matchedInvoiceId: string | null;
    matchConfidence: number | null;
    matchReason?: string | null;
    matchStatus: string;
    bankType?: string;
    bankName?: string;
    matchedInvoice?: {
      id: string;
      user_id?: string;
      year?: number;
      month?: number;
      issuer: string;
      amount: number;
      date: string;
      file_name: string;
      file_url?: string;
    } | null;
  };
}

/**
 * Score, wie gut eine Rechnung zu der Transaktion passt — für die Sortierung
 * der Vorschlagsliste in der Combobox. Höher = besser.
 *
 * - Aussteller im Verwendungszweck → +60
 * - Exakter Betrag → +30, naher Betrag (bis 5%) → +15
 * - Datum-Nähe (≤ 30 Tage) → +10
 */
function scoreInvoiceForTransaction(
  invoice: { issuer: string; amount: number; date: string },
  transaction: { description: string; amount: number; date: string }
): number {
  let score = 0;
  const desc = transaction.description.toLowerCase();
  const issuer = invoice.issuer.toLowerCase();
  const txAmount = Math.abs(transaction.amount);

  // Aussteller in der Beschreibung?
  if (desc.includes(issuer)) {
    score += 60;
  } else {
    const issuerWords = issuer.split(/[\s,.-]+/).filter((w) => w.length > 2);
    const matchedWords = issuerWords.filter((w) => desc.includes(w)).length;
    if (issuerWords.length > 0) {
      score += (matchedWords / issuerWords.length) * 50;
    }
  }

  // Betragsmatch
  const amountDiff = Math.abs(txAmount - invoice.amount);
  if (amountDiff < 0.01) {
    score += 30;
  } else if (amountDiff <= Math.max(txAmount, invoice.amount) * 0.05) {
    score += 15;
  }

  // Datums-Nähe (≤30 Tage)
  const daysDiff = Math.abs(
    (new Date(transaction.date).getTime() - new Date(invoice.date).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysDiff <= 30) {
    score += 10 - Math.min(10, Math.floor(daysDiff / 3));
  }

  return score;
}

export function TransactionRow({
  transaction,
  selected,
  onToggleSelect,
  isFocused,
  onFocus,
  registerRef,
}: TransactionRowProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [inlinePreviewOpen, setInlinePreviewOpen] = useState(false);
  const [resolvedInvoiceUrl, setResolvedInvoiceUrl] = useState<string | null>(null);
  const [isResolvingUrl, setIsResolvingUrl] = useState(false);
  const updateMatch = useUpdateTransactionMatch();
  const addRecurringPattern = useAddRecurringPattern();
  const { data: invoices = [] } = useUnmatchedInvoices();

  // Swipe links → "Laufende Kosten" (nur auf offenen Zeilen).
  // Swipe rechts: auf offenen Zeilen → "Ignorieren", auf Laufende-Kosten/Ignoriert → zurück auf "Offen".
  const canSwipeLeft = transaction.matchStatus === "unmatched" || transaction.matchStatus === "no_match";
  const rightSwipeBringsBack =
    transaction.matchStatus === "recurring" || transaction.matchStatus === "ignored";
  const rightSwipeIgnores =
    transaction.matchStatus === "unmatched" || transaction.matchStatus === "no_match";
  const canSwipeRight = rightSwipeBringsBack || rightSwipeIgnores;
  const {
    offset,
    isSwiping,
    isPastThreshold,
    direction: swipeDirection,
    progress: swipeProgress,
    dismissing,
    confirmDismiss,
    handlers: swipeHandlers,
  } = useSwipeAction({
    threshold: 100,
    disableLeft: !canSwipeLeft,
    disableRight: !canSwipeRight,
  });

  // Löst die Invoice-URL lazy in eine frische Signed URL auf, sobald
  // eine Preview geöffnet wird. Behebt Fälle, in denen file_url eine
  // interne Supabase-URL ist, die vom Browser nicht erreichbar ist.
  const inv = transaction.matchedInvoice;
  useEffect(() => {
    if (!inlinePreviewOpen && !previewOpen) return;
    if (resolvedInvoiceUrl || isResolvingUrl) return;
    if (!inv) return;
    if (!inv.user_id || !inv.year || !inv.month || !inv.file_name) {
      if (inv.file_url) setResolvedInvoiceUrl(inv.file_url);
      return;
    }
    setIsResolvingUrl(true);
    resolveStorageUrl(inv.user_id, inv.year, inv.month, inv.file_name, inv.file_url)
      .then((url) => setResolvedInvoiceUrl(url))
      .catch(() => {
        if (inv.file_url) setResolvedInvoiceUrl(inv.file_url);
      })
      .finally(() => setIsResolvingUrl(false));
  }, [
    inlinePreviewOpen,
    previewOpen,
    inv?.id,
    inv?.user_id,
    inv?.year,
    inv?.month,
    inv?.file_name,
    inv?.file_url,
    resolvedInvoiceUrl,
    isResolvingUrl,
  ]);

  // --- Dismiss-Animation: slide-out → collapse → DB-update ---
  const [animPhase, setAnimPhase] = useState<"idle" | "slide-out" | "collapse">("idle");
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (dismissing && animPhase === "idle") {
      // Phase 1: Höhe messen und Slide-Out starten
      if (rowRef.current) {
        setRowHeight(rowRef.current.offsetHeight);
      }
      setAnimPhase("slide-out");
    }
  }, [dismissing, animPhase]);

  const handleSlideOutEnd = useCallback(() => {
    if (animPhase !== "slide-out") return;
    // Phase 2: Höhe auf 0 kollabieren
    setAnimPhase("collapse");
  }, [animPhase]);

  const handleCollapseEnd = useCallback(async () => {
    if (animPhase !== "collapse") return;
    // Phase 3: DB-Update ausführen
    if (dismissing === "left") {
      await handleRecurring();
    } else if (dismissing === "right") {
      if (rightSwipeBringsBack) {
        await handleUnmatch();
      } else {
        await handleIgnore();
      }
    }
    setAnimPhase("idle");
    setRowHeight(undefined);
    confirmDismiss();
  }, [animPhase, dismissing, confirmDismiss]);

  // Bestimme Bank-Typ basierend auf bankType oder bankName
  const isAmex =
    transaction.bankType === "amex" ||
    transaction.bankName?.toLowerCase().includes("american") ||
    transaction.bankName?.toLowerCase().includes("amex");

  // Sortiere die unmatched Invoices nach Relevanz für DIESE Transaktion.
  // Das ist der "der wahrscheinlichste Treffer steht oben"-Fix.
  const sortedInvoices = useMemo(() => {
    return [...invoices]
      .map((inv: any) => ({
        invoice: inv,
        score: scoreInvoiceForTransaction(inv, transaction),
      }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.invoice);
  }, [invoices, transaction.description, transaction.amount, transaction.date]);

  const handleConfirmMatch = async () => {
    if (!transaction.matchedInvoiceId) return;
    try {
      await updateMatch.mutateAsync({
        transactionId: transaction.id,
        invoiceId: transaction.matchedInvoiceId,
        matchStatus: "confirmed",
        matchConfidence: 100,
      });
      toast({ title: "Zuordnung bestätigt" });
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const handleUnmatch = async () => {
    try {
      await updateMatch.mutateAsync({
        transactionId: transaction.id,
        invoiceId: null,
        matchStatus: "unmatched",
      });
      toast({ title: "Zuordnung aufgehoben" });
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const handleManualMatch = async (invoiceId: string) => {
    try {
      await updateMatch.mutateAsync({
        transactionId: transaction.id,
        invoiceId,
        matchStatus: "confirmed",
        matchConfidence: 100,
      });
      toast({ title: "Rechnung zugeordnet" });
      setIsOpen(false);
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const handleNoMatch = async () => {
    try {
      await updateMatch.mutateAsync({
        transactionId: transaction.id,
        invoiceId: null,
        matchStatus: "no_match",
      });
      toast({ title: "Als 'Keine Rechnung' markiert" });
      setIsOpen(false);
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const handleIgnore = async () => {
    try {
      await updateMatch.mutateAsync({
        transactionId: transaction.id,
        invoiceId: null,
        matchStatus: "ignored",
      });
      toast({
        title: "Transaktion ignoriert",
        description: "Du findest sie weiterhin im Abschnitt 'Ignoriert'.",
      });
      setIsOpen(false);
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const handleRecurring = async () => {
    try {
      await addRecurringPattern.mutateAsync(transaction.description);

      await updateMatch.mutateAsync({
        transactionId: transaction.id,
        invoiceId: null,
        matchStatus: "recurring",
      });
      toast({
        title: "Als 'Laufende Kosten' markiert",
        description: "Ähnliche Transaktionen werden automatisch erkannt",
      });
      setIsOpen(false);
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const statusConfig = {
    unmatched: { label: "Offen", color: "bg-warning/10 text-warning border-warning/20" },
    confirmed: { label: "Bestätigt", color: "bg-success/10 text-success border-success/20" },
    no_match: { label: "Keine Rechnung", color: "bg-muted text-muted-foreground border-muted" },
    recurring: { label: "Laufende Kosten", color: "bg-info/10 text-info border-info/20" },
    ignored: { label: "Ignoriert", color: "bg-muted text-muted-foreground border-muted" },
  };

  const status = statusConfig[transaction.matchStatus as keyof typeof statusConfig] || statusConfig.unmatched;

  // Berechne den effektiven translateX: beim Dismiss gleitet die Zeile komplett raus
  const slideOutTarget = dismissing === "left" ? "-110%" : "110%";
  const isAnimatingDismiss = animPhase === "slide-out" || animPhase === "collapse";
  const effectiveTransform =
    animPhase === "slide-out"
      ? `translateX(${slideOutTarget})`
      : animPhase === "collapse"
        ? `translateX(${slideOutTarget})`
        : offset !== 0
          ? `translateX(${offset}px)`
          : undefined;

  return (
    <div
      ref={(node) => {
        // Kombi-Ref: für registerRef (scroll-into-view) und rowRef (Höhe messen)
        (rowRef as any).current = node;
        registerRef?.(node);
      }}
      onClick={() => onFocus?.()}
      className={cn(
        "overflow-hidden transition-all",
        animPhase === "collapse" && "border-transparent"
      )}
      style={{
        // Collapse-Phase: Höhe von gemessener Höhe auf 0 + margins weg
        height: animPhase === "collapse" ? 0 : rowHeight ?? "auto",
        marginBottom: animPhase === "collapse" ? 0 : undefined,
        opacity: animPhase === "collapse" ? 0 : 1,
        transition:
          animPhase === "collapse"
            ? "height 0.3s ease-out, opacity 0.3s ease-out, margin 0.3s ease-out"
            : undefined,
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "height" && animPhase === "collapse") {
          handleCollapseEnd();
        }
      }}
    >
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border/50 bg-card hover:bg-muted/20",
        selected && "ring-2 ring-primary/50 bg-primary/5",
        isFocused && "ring-2 ring-primary bg-primary/10 shadow-md",
        (canSwipeLeft || canSwipeRight) && "cursor-grab",
        isSwiping && "cursor-grabbing"
      )}
      style={{
        transform: animPhase === "slide-out" ? `translateX(${slideOutTarget})` : undefined,
        transition: animPhase === "slide-out" ? "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)" : undefined,
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "transform" && animPhase === "slide-out") {
          handleSlideOutEnd();
        }
      }}
      {...swipeHandlers}
    >
      {/* Swipe-Hintergrund LINKS → "Laufende Kosten" (info-blau) */}
      {swipeDirection === "left" && (
        <div
          className="absolute inset-y-0 right-0 flex items-center justify-end overflow-hidden rounded-r-lg"
          style={{
            width: Math.abs(offset),
            background: isPastThreshold
              ? "linear-gradient(90deg, rgba(59,130,246,0.7) 0%, rgba(59,130,246,0.95) 100%)"
              : "linear-gradient(90deg, rgba(59,130,246,0.2) 0%, rgba(59,130,246,0.5) 100%)",
          }}
        >
          <div
            className="flex items-center gap-2 px-5 text-white"
            style={{
              opacity: Math.min(1, swipeProgress * 1.5),
              transform: `scale(${0.6 + swipeProgress * 0.4})`,
              transition: isSwiping ? "none" : "all 0.2s ease-out",
            }}
          >
            <RefreshCw
              className={cn("h-5 w-5 shrink-0", isPastThreshold && "animate-spin")}
            />
            {swipeProgress > 0.6 && (
              <span className="text-sm font-semibold whitespace-nowrap">
                Laufende Kosten
              </span>
            )}
          </div>
        </div>
      )}

      {/* Swipe-Hintergrund RECHTS → "Ignorieren" (grau) oder "Zurück auf Offen" (amber) */}
      {swipeDirection === "right" && (
        <div
          className="absolute inset-y-0 left-0 flex items-center justify-start overflow-hidden rounded-l-lg"
          style={{
            width: Math.abs(offset),
            background: rightSwipeBringsBack
              ? isPastThreshold
                ? "linear-gradient(270deg, rgba(245,158,11,0.7) 0%, rgba(245,158,11,0.95) 100%)"
                : "linear-gradient(270deg, rgba(245,158,11,0.2) 0%, rgba(245,158,11,0.5) 100%)"
              : isPastThreshold
                ? "linear-gradient(270deg, rgba(100,116,139,0.75) 0%, rgba(71,85,105,0.95) 100%)"
                : "linear-gradient(270deg, rgba(100,116,139,0.25) 0%, rgba(71,85,105,0.5) 100%)",
          }}
        >
          <div
            className="flex items-center gap-2 px-5 text-white"
            style={{
              opacity: Math.min(1, swipeProgress * 1.5),
              transform: `scale(${0.6 + swipeProgress * 0.4})`,
              transition: isSwiping ? "none" : "all 0.2s ease-out",
            }}
          >
            {swipeProgress > 0.6 && (
              <span className="text-sm font-semibold whitespace-nowrap">
                {rightSwipeBringsBack ? "Zurück auf Offen" : "Ignorieren"}
              </span>
            )}
            {rightSwipeBringsBack ? (
              <Undo2
                className="h-5 w-5 shrink-0"
                style={{
                  transform: isPastThreshold ? "rotate(-45deg)" : "none",
                  transition: "transform 0.2s ease-out",
                }}
              />
            ) : (
              <EyeOff className="h-5 w-5 shrink-0" />
            )}
          </div>
        </div>
      )}

    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:gap-4 sm:p-4 bg-card"
      style={{
        transform: !isAnimatingDismiss && offset !== 0 ? `translateX(${offset}px)` : undefined,
        transition: isSwiping ? "none" : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        opacity: !isAnimatingDismiss && offset !== 0 ? 1 - swipeProgress * 0.15 : 1,
      }}
    >
      {/* Checkbox */}
      {onToggleSelect && (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(transaction.id)}
          className="flex-shrink-0"
        />
      )}

      {/* Bank Indicator */}
      <div
        className={cn(
          "h-3 w-3 rounded-full flex-shrink-0",
          isAmex ? "bg-emerald-500" : "bg-blue-500"
        )}
        title={isAmex ? "American Express" : "Volksbank"}
      />

      {/* Date */}
      <div className="flex-shrink-0 text-xs text-muted-foreground sm:w-24 sm:text-sm">
        {new Date(transaction.date).toLocaleDateString("de-DE")}
      </div>

      {/* Amount (mobile: inline next to date) */}
      <div
        className={cn(
          "ml-auto flex-shrink-0 text-right text-sm font-semibold sm:hidden",
          transaction.transactionType === "credit" ? "text-success" : "text-foreground"
        )}
      >
        {transaction.transactionType === "credit" ? "+" : "-"}
        {Math.abs(transaction.amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
      </div>

      {/* Description */}
      <div className="order-last w-full min-w-0 flex-1 sm:order-none sm:w-auto">
        <p className="truncate text-sm font-medium text-foreground">{transaction.description}</p>
        {transaction.matchedInvoice && (
          <div className="mt-1 flex items-center gap-2">
            <Link className="h-3 w-3 shrink-0 text-primary" />
            <span className="truncate text-xs text-primary">
              {transaction.matchedInvoice.issuer} -{" "}
              {transaction.matchedInvoice.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
            </span>
          </div>
        )}
      </div>

      {/* Amount (desktop) */}
      <div
        className={cn(
          "hidden w-28 flex-shrink-0 text-right font-semibold sm:block",
          transaction.transactionType === "credit" ? "text-success" : "text-foreground"
        )}
      >
        {transaction.transactionType === "credit" ? "+" : "-"}
        {Math.abs(transaction.amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
      </div>

      {/* Status */}
      <Badge variant="outline" className={cn("justify-center sm:w-28", status.color)}>
        {status.label}
      </Badge>

      {/* Actions */}
      <div className="flex flex-shrink-0 justify-end gap-1 sm:w-32">
        {/* View Invoice Buttons - für confirmed */}
        {transaction.matchedInvoice && transaction.matchStatus === "confirmed" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-info"
                onClick={() => setInlinePreviewOpen((v) => !v)}
                title={inlinePreviewOpen ? "Vorschau einklappen" : "Vorschau einblenden"}
              >
                {inlinePreviewOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-info"
                onClick={() => setPreviewOpen(true)}
                title="Vollbild-Vorschau"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </>
          )}

        {transaction.matchStatus === "confirmed" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleUnmatch}
            title="Zuordnung aufheben"
          >
            <Unlink className="h-4 w-4" />
          </Button>
        )}

        {(transaction.matchStatus === "unmatched" || transaction.matchStatus === "no_match") && (
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Link className="mr-1 h-4 w-4" />
                Zuordnen
                <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-0">
              <Command>
                <CommandInput placeholder="Aussteller oder Betrag suchen..." />
                <CommandList>
                  <CommandEmpty>Keine passende Rechnung gefunden.</CommandEmpty>
                  {sortedInvoices.length > 0 && (
                    <CommandGroup heading="Vorgeschlagene Rechnungen (sortiert nach Relevanz)">
                      {sortedInvoices.slice(0, 50).map((invoice: any) => (
                        <CommandItem
                          key={invoice.id}
                          // Searchable terms
                          value={`${invoice.issuer} ${invoice.amount} ${invoice.date} ${invoice.file_name ?? ""}`}
                          onSelect={() => handleManualMatch(invoice.id)}
                          className="flex flex-col items-start gap-0.5"
                        >
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="truncate font-medium">{invoice.issuer}</span>
                            <span className="shrink-0 text-xs font-semibold">
                              {invoice.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })}{" "}
                              {invoice.currency || "€"}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(invoice.date).toLocaleDateString("de-DE")}
                            {invoice.file_name ? ` · ${invoice.file_name}` : ""}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="laufende-kosten"
                      onSelect={handleRecurring}
                      className="text-info"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Laufende Kosten (ohne Rechnung)
                    </CommandItem>
                    <CommandItem
                      value="keine-rechnung"
                      onSelect={handleNoMatch}
                      className="text-muted-foreground"
                    >
                      Keine Rechnung vorhanden
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>

    </div>

    {/* Inline PDF-Preview - nur gerendert wenn aufgeklappt */}
    {inlinePreviewOpen && transaction.matchedInvoice && (
      <div
        className="border-t border-border/50 bg-muted/20 p-4"
        style={{
          transform: !isAnimatingDismiss && offset !== 0 ? `translateX(${offset}px)` : undefined,
          transition: isSwiping ? "none" : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      >
        {resolvedInvoiceUrl ? (
          <UrlDocumentPreview
            fileUrl={resolvedInvoiceUrl}
            fileName={transaction.matchedInvoice.file_name}
            className="max-h-[500px]"
          />
        ) : (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            {isResolvingUrl ? "Vorschau wird geladen…" : "Keine Vorschau verfügbar"}
          </div>
        )}
      </div>
    )}

      {/* Invoice Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Rechnung: {transaction.matchedInvoice?.issuer}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Datum:</span>
                <p className="font-medium">
                  {transaction.matchedInvoice?.date &&
                    new Date(transaction.matchedInvoice.date).toLocaleDateString("de-DE")}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Betrag:</span>
                <p className="font-medium">
                  {transaction.matchedInvoice?.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Datei:</span>
                <p className="font-medium truncate">{transaction.matchedInvoice?.file_name}</p>
              </div>
            </div>
            {resolvedInvoiceUrl ? (
              <div className="border rounded-lg overflow-hidden bg-muted/20">
                {(transaction.matchedInvoice?.file_name ?? resolvedInvoiceUrl)
                  .toLowerCase()
                  .includes(".pdf") ? (
                  <iframe
                    src={resolvedInvoiceUrl}
                    className="w-full h-[60vh]"
                    title="Rechnung Vorschau"
                  />
                ) : (
                  <img
                    src={resolvedInvoiceUrl}
                    alt="Rechnung Vorschau"
                    className="w-full max-h-[60vh] object-contain"
                  />
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 border rounded-lg bg-muted/20 text-muted-foreground">
                {isResolvingUrl ? "Vorschau wird geladen…" : "Keine Vorschau verfügbar"}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}
