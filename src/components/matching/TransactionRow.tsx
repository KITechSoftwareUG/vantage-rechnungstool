import { useState } from "react";
import { Check, X, Link, Unlink, ChevronDown, Sparkles, Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useUpdateTransactionMatch, useUnmatchedInvoices } from "@/hooks/useMatching";
import { useAddRecurringPattern } from "@/hooks/useRecurringPatterns";
import { useToast } from "@/hooks/use-toast";

interface TransactionRowProps {
  transaction: {
    id: string;
    date: string;
    description: string;
    amount: number;
    transactionType: "debit" | "credit";
    matchedInvoiceId: string | null;
    matchConfidence: number | null;
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

export function TransactionRow({ transaction }: TransactionRowProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const updateMatch = useUpdateTransactionMatch();
  const addRecurringPattern = useAddRecurringPattern();
  const { data: invoices = [] } = useUnmatchedInvoices();

  // Bestimme Bank-Typ basierend auf bankType oder bankName
  const isAmex = 
    transaction.bankType === "amex" || 
    transaction.bankName?.toLowerCase().includes("american") || 
    transaction.bankName?.toLowerCase().includes("amex");

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
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const handleRecurring = async () => {
    try {
      // Save pattern for future recognition
      await addRecurringPattern.mutateAsync(transaction.description);
      
      await updateMatch.mutateAsync({
        transactionId: transaction.id,
        invoiceId: null,
        matchStatus: "recurring",
      });
      toast({ 
        title: "Als 'Laufende Kosten' markiert",
        description: "Ähnliche Transaktionen werden automatisch erkannt"
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
    <div className="flex items-center gap-4 rounded-lg border border-border/50 bg-card p-4 transition-colors hover:bg-muted/20">
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
              {transaction.matchedInvoice.issuer} - {transaction.matchedInvoice.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
            </span>
            {transaction.matchConfidence && transaction.matchStatus === "matched" && (
              <Badge variant="outline" className="ml-1 text-xs">
                <Sparkles className="mr-1 h-3 w-3" />
                {transaction.matchConfidence}%
              </Badge>
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
        {/* View Invoice Button - für matched und confirmed */}
        {transaction.matchedInvoice && (transaction.matchStatus === "matched" || transaction.matchStatus === "confirmed") && (
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-info" 
            onClick={() => setPreviewOpen(true)}
            title="Rechnung ansehen"
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}

        {transaction.matchStatus === "matched" && transaction.matchedInvoiceId && (
          <>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-success" onClick={handleConfirmMatch}>
              <Check className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={handleUnmatch}>
              <X className="h-4 w-4" />
            </Button>
          </>
        )}

        {transaction.matchStatus === "confirmed" && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleUnmatch}>
            <Unlink className="h-4 w-4" />
          </Button>
        )}

        {(transaction.matchStatus === "unmatched" || transaction.matchStatus === "no_match") && (
          <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Link className="mr-1 h-4 w-4" />
                Zuordnen
                <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-64 w-80 overflow-y-auto">
              {invoices.length === 0 ? (
                <div className="p-2 text-center text-sm text-muted-foreground">Keine Rechnungen verfügbar</div>
              ) : (
                invoices.map((invoice: any) => (
                  <DropdownMenuItem
                    key={invoice.id}
                    onClick={() => handleManualMatch(invoice.id)}
                    className="flex flex-col items-start gap-1"
                  >
                    <span className="font-medium">{invoice.issuer}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(invoice.date).toLocaleDateString("de-DE")} · {invoice.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                    </span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuItem onClick={handleRecurring} className="text-info">
                <RefreshCw className="mr-2 h-4 w-4" />
                Laufende Kosten (ohne Rechnung)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleNoMatch} className="text-muted-foreground">
                Keine Rechnung vorhanden
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

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
                  {transaction.matchedInvoice?.date && new Date(transaction.matchedInvoice.date).toLocaleDateString("de-DE")}
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
                {transaction.matchedInvoice.file_url.toLowerCase().endsWith('.pdf') ? (
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
