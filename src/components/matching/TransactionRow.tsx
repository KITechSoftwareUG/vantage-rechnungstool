import { useMemo, useState } from "react";
import { Check, X, Link, Unlink, ChevronDown, Sparkles, Eye, EyeOff, RefreshCw, Maximize2 } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";

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
  const updateMatch = useUpdateTransactionMatch();
  const addRecurringPattern = useAddRecurringPattern();
  const { data: invoices = [] } = useUnmatchedInvoices();

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
    matched: { label: "Vorschlag", color: "bg-primary/10 text-primary border-primary/20" },
    confirmed: { label: "Bestätigt", color: "bg-success/10 text-success border-success/20" },
    no_match: { label: "Keine Rechnung", color: "bg-muted text-muted-foreground border-muted" },
    recurring: { label: "Laufende Kosten", color: "bg-info/10 text-info border-info/20" },
  };

  const status = statusConfig[transaction.matchStatus as keyof typeof statusConfig] || statusConfig.unmatched;

  return (
    <div
      ref={registerRef}
      onClick={() => onFocus?.()}
      className={cn(
        "rounded-lg border border-border/50 bg-card transition-colors hover:bg-muted/20",
        selected && "ring-2 ring-primary/50 bg-primary/5",
        isFocused && "ring-2 ring-primary bg-primary/10 shadow-md"
      )}
    >
    <div className="flex items-center gap-4 p-4">
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
      <div className="w-24 flex-shrink-0 text-sm text-muted-foreground">
        {new Date(transaction.date).toLocaleDateString("de-DE")}
      </div>

      {/* Description */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{transaction.description}</p>
        {transaction.matchedInvoice && (
          <div className="mt-1 flex items-center gap-2">
            <Link className="h-3 w-3 text-primary" />
            <span className="text-xs text-primary">
              {transaction.matchedInvoice.issuer} -{" "}
              {transaction.matchedInvoice.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
            </span>
            {transaction.matchConfidence && transaction.matchStatus === "matched" && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="ml-1 cursor-help text-xs">
                      <Sparkles className="mr-1 h-3 w-3" />
                      {transaction.matchConfidence}%
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs font-semibold">KI-Match-Begründung:</p>
                    <p className="text-xs">
                      {transaction.matchReason || "Keine Begründung gespeichert"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )}
      </div>

      {/* Amount */}
      <div
        className={cn(
          "w-28 flex-shrink-0 text-right font-semibold",
          transaction.transactionType === "credit" ? "text-success" : "text-foreground"
        )}
      >
        {transaction.transactionType === "credit" ? "+" : "-"}
        {Math.abs(transaction.amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
      </div>

      {/* Status */}
      <Badge variant="outline" className={cn("w-28 justify-center", status.color)}>
        {status.label}
      </Badge>

      {/* Actions */}
      <div className="flex w-32 flex-shrink-0 justify-end gap-1">
        {/* View Invoice Buttons - für matched und confirmed */}
        {transaction.matchedInvoice &&
          (transaction.matchStatus === "matched" || transaction.matchStatus === "confirmed") && (
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

        {transaction.matchStatus === "matched" && transaction.matchedInvoiceId && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-success"
              onClick={handleConfirmMatch}
              title="Vorschlag bestätigen"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={handleUnmatch}
              title="Zuordnung ablehnen"
            >
              <X className="h-4 w-4" />
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
    {inlinePreviewOpen && transaction.matchedInvoice?.file_url && (
      <div className="border-t border-border/50 bg-muted/20 p-4">
        <UrlDocumentPreview
          fileUrl={transaction.matchedInvoice.file_url}
          fileName={transaction.matchedInvoice.file_name}
          className="max-h-[500px]"
        />
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
            {transaction.matchedInvoice?.file_url ? (
              <div className="border rounded-lg overflow-hidden bg-muted/20">
                {transaction.matchedInvoice.file_url.toLowerCase().endsWith(".pdf") ? (
                  <iframe
                    src={transaction.matchedInvoice.file_url}
                    className="w-full h-[60vh]"
                    title="Rechnung Vorschau"
                  />
                ) : (
                  <img
                    src={transaction.matchedInvoice.file_url}
                    alt="Rechnung Vorschau"
                    className="w-full max-h-[60vh] object-contain"
                  />
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 border rounded-lg bg-muted/20 text-muted-foreground">
                Keine Vorschau verfügbar
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
