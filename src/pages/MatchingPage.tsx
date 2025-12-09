import { useState, useMemo } from "react";
import { Loader2, CheckCircle, AlertCircle, Sparkles, Building, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBankTransactions } from "@/hooks/useMatching";
import { TransactionRow } from "@/components/matching/TransactionRow";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function MatchingPage() {
  const { toast } = useToast();
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Alle Transaktionen ohne Filter laden
  const { data: transactions = [], isLoading, refetch } = useBankTransactions();

  // Filtern nach Suchbegriff
  const filteredTransactions = useMemo(() => {
    if (!searchQuery.trim()) return transactions;
    
    const query = searchQuery.toLowerCase().trim();
    return transactions.filter((t: any) => {
      const description = (t.description || "").toLowerCase();
      const amount = Math.abs(t.amount).toString();
      const date = t.date || "";
      const invoiceIssuer = (t.matchedInvoice?.issuer || "").toLowerCase();
      
      return (
        description.includes(query) ||
        amount.includes(query) ||
        date.includes(query) ||
        invoiceIssuer.includes(query)
      );
    });
  }, [transactions, searchQuery]);

  const unmatchedCount = transactions.filter((t: any) => t.matchStatus === "unmatched").length;
  const matchedCount = transactions.filter((t: any) => t.matchStatus === "matched").length;
  const confirmedCount = transactions.filter((t: any) => t.matchStatus === "confirmed").length;

  const handleAutoMatch = async () => {
    setIsAutoMatching(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-match-transactions");

      if (error) throw error;

      toast({
        title: "KI-Matching abgeschlossen",
        description: `${data.matchedCount} Transaktionen wurden zugeordnet`,
      });

      refetch();
    } catch (error: any) {
      toast({
        title: "Fehler beim Auto-Matching",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsAutoMatching(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">Zuordnung</h1>
        <p className="mt-1 text-muted-foreground">
          Ordnen Sie Rechnungen den Kontoauszugstransaktionen zu
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4 animate-fade-in sm:flex-row sm:items-center sm:justify-between">
        {/* Stats */}
        <div className="flex gap-4">
          <div className="glass-card flex items-center gap-3 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-warning" />
            <div>
              <p className="text-2xl font-bold text-foreground">{unmatchedCount}</p>
              <p className="text-xs text-muted-foreground">Offen</p>
            </div>
          </div>
          <div className="glass-card flex items-center gap-3 px-4 py-3">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <p className="text-2xl font-bold text-foreground">{matchedCount}</p>
              <p className="text-xs text-muted-foreground">Vorschläge</p>
            </div>
          </div>
          <div className="glass-card flex items-center gap-3 px-4 py-3">
            <CheckCircle className="h-5 w-5 text-success" />
            <div>
              <p className="text-2xl font-bold text-foreground">{confirmedCount}</p>
              <p className="text-xs text-muted-foreground">Bestätigt</p>
            </div>
          </div>
        </div>

        <Button
          variant="gradient"
          onClick={handleAutoMatch}
          disabled={isAutoMatching || unmatchedCount === 0}
          className="gap-2"
        >
          {isAutoMatching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          KI Auto-Matching
        </Button>
      </div>

      {/* Search & Legend */}
      <div className="flex flex-col gap-4 animate-fade-in sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Suche nach Beschreibung, Betrag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-blue-500" />
            <span>Volksbank</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-emerald-500" />
            <span>American Express</span>
          </div>
        </div>
      </div>

      {/* Transaction List */}
      <div className="animate-fade-in">
        {isLoading ? (
          <div className="glass-card flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="glass-card flex flex-col items-center justify-center p-12 text-center">
            <Building className="h-12 w-12 text-muted-foreground/50" />
            <h3 className="mt-4 font-heading text-lg font-semibold text-foreground">
              {searchQuery ? "Keine Treffer gefunden" : "Keine Transaktionen vorhanden"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {searchQuery 
                ? "Versuchen Sie einen anderen Suchbegriff"
                : "Laden Sie Kontoauszüge hoch, um Transaktionen zu sehen"
              }
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Header */}
            <div className="flex items-center gap-4 px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
              <div className="w-6"></div>
              <div className="w-24">Datum</div>
              <div className="flex-1">Beschreibung</div>
              <div className="w-28 text-right">Betrag</div>
              <div className="w-28 text-center">Status</div>
              <div className="w-32 text-right">Aktionen</div>
            </div>

            {/* Transactions */}
            <div className="space-y-2">
              {filteredTransactions.map((transaction: any) => (
                <TransactionRow key={transaction.id} transaction={transaction} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
