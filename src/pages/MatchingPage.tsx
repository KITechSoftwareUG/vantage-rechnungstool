import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, Building, Loader2, CheckCircle, AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBankTransactions } from "@/hooks/useMatching";
import { useBankStatements } from "@/hooks/useDocuments";
import { TransactionRow } from "@/components/matching/TransactionRow";
import { BankType, BANK_TYPE_LABELS } from "@/types/matching";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export default function MatchingPage() {
  const { toast } = useToast();
  const [activeBank, setActiveBank] = useState<BankType>("volksbank");
  const [isAutoMatching, setIsAutoMatching] = useState(false);

  const { data: transactions = [], isLoading, refetch } = useBankTransactions(activeBank);
  const { data: statements = [] } = useBankStatements();

  const unmatchedCount = transactions.filter((t: any) => t.matchStatus === "unmatched").length;
  const matchedCount = transactions.filter((t: any) => t.matchStatus === "matched").length;
  const confirmedCount = transactions.filter((t: any) => t.matchStatus === "confirmed").length;

  const handleAutoMatch = async () => {
    setIsAutoMatching(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-match-transactions", {
        body: { bankType: activeBank },
      });

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

  const filteredStatements = statements.filter((s: any) => 
    activeBank === "amex" 
      ? s.bank.toLowerCase().includes("american") || s.bank.toLowerCase().includes("amex")
      : s.bank.toLowerCase().includes("volksbank") || s.bank.toLowerCase().includes("raiffeisen")
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">Zuordnung</h1>
        <p className="mt-1 text-muted-foreground">
          Ordnen Sie Rechnungen den Kontoauszugstransaktionen zu
        </p>
      </div>

      {/* Bank Tabs */}
      <Tabs value={activeBank} onValueChange={(v) => setActiveBank(v as BankType)} className="animate-fade-in">
        <div className="flex items-center justify-between">
          <TabsList className="glass-card h-auto p-1">
            <TabsTrigger
              value="volksbank"
              className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <Building className="h-4 w-4" />
              Volksbank Raiffeisen
            </TabsTrigger>
            <TabsTrigger
              value="amex"
              className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <CreditCard className="h-4 w-4" />
              American Express
            </TabsTrigger>
          </TabsList>

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

        {/* Stats */}
        <div className="mt-4 flex gap-4">
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

        <TabsContent value="volksbank" className="mt-6">
          <TransactionList transactions={transactions} isLoading={isLoading} bankName="Volksbank Raiffeisen" />
        </TabsContent>

        <TabsContent value="amex" className="mt-6">
          <TransactionList transactions={transactions} isLoading={isLoading} bankName="American Express" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TransactionList({
  transactions,
  isLoading,
  bankName,
}: {
  transactions: any[];
  isLoading: boolean;
  bankName: string;
}) {
  if (isLoading) {
    return (
      <div className="glass-card flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="glass-card flex flex-col items-center justify-center p-12 text-center">
        <Building className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 font-heading text-lg font-semibold text-foreground">
          Keine Transaktionen für {bankName}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Laden Sie Kontoauszüge hoch, um Transaktionen zu sehen
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
        <div className="w-24">Datum</div>
        <div className="flex-1">Beschreibung</div>
        <div className="w-28 text-right">Betrag</div>
        <div className="w-28 text-center">Status</div>
        <div className="w-32 text-right">Aktionen</div>
      </div>

      {/* Transactions */}
      <div className="space-y-2">
        {transactions.map((transaction: any) => (
          <TransactionRow key={transaction.id} transaction={transaction} />
        ))}
      </div>
    </div>
  );
}
