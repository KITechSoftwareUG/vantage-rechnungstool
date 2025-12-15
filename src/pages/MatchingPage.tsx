import { useState, useMemo } from "react";
import { Loader2, CheckCircle, AlertCircle, Sparkles, Building, Search, FileText, RefreshCw, ChevronDown, ChevronRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useBankTransactions } from "@/hooks/useMatching";
import { useInvoices } from "@/hooks/useDocuments";
import { TransactionRow } from "@/components/matching/TransactionRow";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MONTH_NAMES } from "@/types/documents";

type FilterStatus = "all" | "unmatched" | "matched" | "confirmed";

interface MonthGroup {
  year: number;
  month: number;
  transactions: any[];
}

export default function MatchingPage() {
  const { toast } = useToast();
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());

  // Alle Transaktionen ohne Filter laden
  const { data: transactions = [], isLoading, refetch } = useBankTransactions();
  const { data: invoices = [] } = useInvoices();

  // Laufende Kosten separat halten
  const recurringTransactions = useMemo(() => {
    return transactions.filter((t: any) => t.matchStatus === "recurring");
  }, [transactions]);

  // Normale Transaktionen (ohne recurring) sortieren: Vorschläge zuerst
  const sortedTransactions = useMemo(() => {
    return [...transactions]
      .filter((t: any) => t.matchStatus !== "recurring")
      .sort((a: any, b: any) => {
        const statusOrder: Record<string, number> = {
          matched: 0,    // Vorschläge zuerst
          unmatched: 1,  // Dann offen
          no_match: 2,   // Dann keine Rechnung
          confirmed: 3,  // Dann bestätigt
        };
        const orderA = statusOrder[a.matchStatus] ?? 4;
        const orderB = statusOrder[b.matchStatus] ?? 4;
        if (orderA !== orderB) return orderA - orderB;
        // Bei gleichem Status nach Datum sortieren
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
  }, [transactions]);

  // Filtern nach Status und Suchbegriff
  const filteredTransactions = useMemo(() => {
    let filtered = sortedTransactions;

    // Status-Filter
    if (filterStatus !== "all") {
      filtered = filtered.filter((t: any) => t.matchStatus === filterStatus);
    }

    // Such-Filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((t: any) => {
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
    }

    return filtered;
  }, [sortedTransactions, filterStatus, searchQuery]);

  // Gruppiere nach Jahr und Monat
  const groupedByMonth = useMemo(() => {
    const groups: MonthGroup[] = [];
    const groupMap = new Map<string, any[]>();

    filteredTransactions.forEach((t: any) => {
      const date = new Date(t.date);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;
      
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(t);
    });

    groupMap.forEach((transactions, key) => {
      const [year, month] = key.split("-").map(Number);
      groups.push({ year, month, transactions });
    });

    // Sortiere nach Jahr und Monat absteigend
    return groups.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  }, [filteredTransactions]);

  const toggleMonth = (key: string) => {
    setOpenMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Automatisch erste Gruppe öffnen wenn noch keine offen
  useMemo(() => {
    if (groupedByMonth.length > 0 && openMonths.size === 0) {
      const firstKey = `${groupedByMonth[0].year}-${groupedByMonth[0].month}`;
      setOpenMonths(new Set([firstKey]));
    }
  }, [groupedByMonth.length]);

  const unmatchedCount = transactions.filter((t: any) => t.matchStatus === "unmatched").length;
  const matchedCount = transactions.filter((t: any) => t.matchStatus === "matched").length;
  const confirmedCount = transactions.filter((t: any) => t.matchStatus === "confirmed").length;
  const recurringCount = recurringTransactions.length;
  const invoiceCount = invoices.length;

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
            <FileText className="h-5 w-5 text-info" />
            <div>
              <p className="text-2xl font-bold text-foreground">{invoiceCount}</p>
              <p className="text-xs text-muted-foreground">Rechnungen</p>
            </div>
          </div>
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

      {/* Filter Tabs */}
      <div className="animate-fade-in">
        <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
          <TabsList className="glass-card h-auto p-1">
            <TabsTrigger 
              value="all" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              Alle ({transactions.length})
            </TabsTrigger>
            <TabsTrigger 
              value="matched" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <Sparkles className="mr-1 h-4 w-4" />
              Vorschläge ({matchedCount})
            </TabsTrigger>
            <TabsTrigger 
              value="unmatched" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <AlertCircle className="mr-1 h-4 w-4" />
              Offen ({unmatchedCount})
            </TabsTrigger>
            <TabsTrigger 
              value="confirmed" 
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <CheckCircle className="mr-1 h-4 w-4" />
              Bestätigt ({confirmedCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>
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
        ) : groupedByMonth.length === 0 ? (
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
          <div className="space-y-4">
            {/* Monatsgruppen */}
            {groupedByMonth.map(({ year, month, transactions: monthTransactions }) => {
              const key = `${year}-${month}`;
              const isOpen = openMonths.has(key);
              const monthName = MONTH_NAMES[month - 1];
              
              return (
                <Collapsible key={key} open={isOpen} onOpenChange={() => toggleMonth(key)}>
                  <CollapsibleTrigger asChild>
                    <button className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-gradient-to-r from-primary/5 to-transparent px-4 py-3 text-left transition-colors hover:bg-primary/10">
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-primary" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <Calendar className="h-4 w-4 text-primary" />
                      <span className="font-heading font-semibold text-foreground">{monthName} {year}</span>
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {monthTransactions.length} Transaktionen
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2 pl-4">
                    {/* Header */}
                    <div className="flex items-center gap-4 px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
                      <div className="w-6"></div>
                      <div className="w-24">Datum</div>
                      <div className="flex-1">Beschreibung</div>
                      <div className="w-28 text-right">Betrag</div>
                      <div className="w-28 text-center">Status</div>
                      <div className="w-32 text-right">Aktionen</div>
                    </div>
                    {monthTransactions.map((transaction: any) => (
                      <TransactionRow key={transaction.id} transaction={transaction} />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

            {/* Laufende Kosten - eingeklappt am Ende */}
            {filterStatus === "all" && recurringCount > 0 && (
              <Collapsible open={recurringOpen} onOpenChange={setRecurringOpen} className="mt-6">
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50">
                    {recurringOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <RefreshCw className="h-4 w-4 text-info" />
                    <span className="font-medium text-foreground">Laufende Kosten</span>
                    <span className="text-sm text-muted-foreground">({recurringCount} Transaktionen ohne Rechnung)</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {recurringTransactions.map((transaction: any) => (
                    <div key={transaction.id} className="opacity-60">
                      <TransactionRow transaction={transaction} />
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
