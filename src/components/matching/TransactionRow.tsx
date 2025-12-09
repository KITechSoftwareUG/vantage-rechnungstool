import { useState } from "react";
import { Check, X, Link, Unlink, ChevronDown, Sparkles } from "lucide-react";
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
    <div className="flex items-center gap-4 rounded-lg border border-border/50 bg-card p-4 transition-colors hover:bg-muted/20">
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
              <DropdownMenuItem onClick={handleNoMatch} className="text-muted-foreground">
                Keine Rechnung vorhanden
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
