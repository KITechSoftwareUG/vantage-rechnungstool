import { useState } from "react";
import { Check, X, Link, Unlink, ChevronDown, Sparkles, Building, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useUpdateTransactionMatch, useUnmatchedInvoices } from "@/hooks/useMatching";
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
    } | null;
  };
}

export function TransactionRow({ transaction }: TransactionRowProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const updateMatch = useUpdateTransactionMatch();
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

  const statusConfig = {
    unmatched: { label: "Offen", color: "bg-warning/10 text-warning border-warning/20" },
    matched: { label: "Vorschlag", color: "bg-primary/10 text-primary border-primary/20" },
    confirmed: { label: "Bestätigt", color: "bg-success/10 text-success border-success/20" },
    no_match: { label: "Keine Rechnung", color: "bg-muted text-muted-foreground border-muted" },
  };

  const status = statusConfig[transaction.matchStatus as keyof typeof statusConfig] || statusConfig.unmatched;

  return (
    <div className="flex items-center gap-2 rounded border border-border/40 bg-card px-3 py-2 text-xs transition-colors hover:bg-muted/20">
      {/* Bank Indicator */}
      <div 
        className={cn(
          "h-2 w-2 rounded-full flex-shrink-0",
          isAmex ? "bg-emerald-500" : "bg-blue-500"
        )}
        title={isAmex ? "American Express" : "Volksbank"}
      />

      {/* Date */}
      <div className="w-20 flex-shrink-0 text-muted-foreground">
        {new Date(transaction.date).toLocaleDateString("de-DE")}
      </div>

      {/* Description */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{transaction.description}</p>
        {transaction.matchedInvoice && (
          <div className="flex items-center gap-1 text-primary">
            <Link className="h-2.5 w-2.5" />
            <span className="truncate">
              {transaction.matchedInvoice.issuer} - {transaction.matchedInvoice.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
            </span>
            {transaction.matchConfidence && transaction.matchStatus === "matched" && (
              <span className="text-muted-foreground">({transaction.matchConfidence}%)</span>
            )}
          </div>
        )}
      </div>

      {/* Amount */}
      <div
        className={cn(
          "w-24 flex-shrink-0 text-right font-semibold",
          transaction.transactionType === "credit" ? "text-success" : "text-foreground"
        )}
      >
        {transaction.transactionType === "credit" ? "+" : "-"}
        {Math.abs(transaction.amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
      </div>

      {/* Status */}
      <Badge variant="outline" className={cn("h-5 w-20 justify-center text-[10px]", status.color)}>
        {status.label}
      </Badge>

      {/* Actions */}
      <div className="flex w-24 flex-shrink-0 justify-end gap-0.5">
        {transaction.matchStatus === "matched" && transaction.matchedInvoiceId && (
          <>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-success" onClick={handleConfirmMatch}>
              <Check className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={handleUnmatch}>
              <X className="h-3 w-3" />
            </Button>
          </>
        )}

        {transaction.matchStatus === "confirmed" && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleUnmatch}>
            <Unlink className="h-3 w-3" />
          </Button>
        )}

        {(transaction.matchStatus === "unmatched" || transaction.matchStatus === "no_match") && (
          <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]">
                <Link className="mr-1 h-3 w-3" />
                Zuordnen
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-64 w-72 overflow-y-auto">
              {invoices.length === 0 ? (
                <div className="p-2 text-center text-xs text-muted-foreground">Keine Rechnungen</div>
              ) : (
                invoices.map((invoice: any) => (
                  <DropdownMenuItem
                    key={invoice.id}
                    onClick={() => handleManualMatch(invoice.id)}
                    className="flex flex-col items-start gap-0.5 text-xs"
                  >
                    <span className="font-medium">{invoice.issuer}</span>
                    <span className="text-muted-foreground">
                      {new Date(invoice.date).toLocaleDateString("de-DE")} · {invoice.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                    </span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuItem onClick={handleNoMatch} className="text-xs text-muted-foreground">
                Keine Rechnung
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
