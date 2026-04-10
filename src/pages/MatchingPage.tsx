import { useState, useCallback, useMemo } from "react";
import { Loader2, CheckCircle, AlertCircle, Sparkles, Building, Search, FileText, RefreshCw, ChevronDown, ChevronRight, Calendar, Check, X, Square, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { useInvoices } from "@/hooks/useInvoices";
import { useFilteredTransactions } from "@/hooks/useFilteredTransactions";
import { TransactionRow } from "@/components/matching/TransactionRow";
import { useBulkConfirmMatches, useBulkUnmatch } from "@/hooks/useBulkMatchActions";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MONTH_NAMES } from "@/types/documents";

export default function MatchingPage() {
  const { toast } = useToast();
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data: invoices = [] } = useInvoices();
  const bulkConfirm = useBulkConfirmMatches();
  const bulkUnmatch = useBulkUnmatch();

  const {
    transactions,
    isLoading,
    refetch,
    searchQuery,
    setSearchQuery,
    filterStatus,
    setFilterStatus,
    openMonths,
    toggleMonth,
    recurringOpen,
    setRecurringOpen,
    groupedByMonth,
    recurringTransactions,
    unmatchedCount,
    matchedCount,
    confirmedCount,
    recurringCount,
  } = useFilteredTransactions();

  const invoiceCount = invoices.length;

  // All visible transaction IDs (for select all)
  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    groupedByMonth.forEach((g) => g.transactions.forEach((t: any) => ids.push(t.id)));
    return ids;
  }, [groupedByMonth]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(visibleIds));
  }, [visibleIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectAllMatched = useCallback(() => {
    const matchedIds = transactions
      .filter((t: any) => t.matchStatus === "matched" && t.matchedInvoiceId)
      .map((t: any) => t.id);
    setSelectedIds(new Set(matchedIds));
  }, [transactions]);

  // Bulk actions
  const selectedTransactions = useMemo(
    () => transactions.filter((t: any) => selectedIds.has(t.id)),
    [transactions, selectedIds]
  );

  const canBulkConfirm = selectedTransactions.some(
    (t: any) => t.matchStatus === "matched" && t.matchedInvoiceId
  );
  const canBulkUnmatch = selectedTransactions.some(
    (t: any) => t.matchStatus === "matched" || t.matchStatus === "confirmed"
  );

  const handleBulkConfirm = async () => {
    const ids = selectedTransactions
      .filter((t: any) => t.matchStatus === "matched" && t.matchedInvoiceId)
      .map((t: any) => t.id);
    if (ids.length === 0) return;
    try {
      await bulkConfirm.mutateAsync(ids);
      toast({ title: `${ids.length} Zuordnungen bestätigt` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    }
  };

  const handleBulkUnmatch = async () => {
    const ids = selectedTransactions
      .filter((t: any) => t.matchStatus === "matched" || t.matchStatus === "confirmed")
      .map((t: any) => t.id);
    if (ids.length === 0) return;
    try {
      await bulkUnmatch.mutateAsync(ids);
      toast({ title: `${ids.length} Zuordnungen aufgehoben` });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    }
  };

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
      toast({ title: "Fehler beim Auto-Matching", description: error.message, variant: "destructive" });
    } finally {
      setIsAutoMatching(false);
    }
  };

  // Select all in a specific month group
  const toggleSelectMonth = useCallback((monthTransactions: any[]) => {
    const monthIds = monthTransactions.map((t: any) => t.id);
    const allSelected = monthIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        monthIds.forEach((id) => next.delete(id));
      } else {
        monthIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [selectedIds]);

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

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="animate-fade-in flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} ausgewählt
          </span>
          <div className="flex gap-2 ml-auto">
            {canBulkConfirm && (
              <Button
                size="sm"
                variant="default"
                className="gap-1"
                onClick={handleBulkConfirm}
                disabled={bulkConfirm.isPending}
              >
                {bulkConfirm.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Alle bestätigen
              </Button>
            )}
            {canBulkUnmatch && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={handleBulkUnmatch}
                disabled={bulkUnmatch.isPending}
              >
                {bulkUnmatch.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Zuordnung aufheben
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Auswahl aufheben
            </Button>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="animate-fade-in">
        <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
          <TabsList className="glass-card h-auto p-1">
            <TabsTrigger value="all" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Alle ({transactions.length})
            </TabsTrigger>
            <TabsTrigger value="matched" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Sparkles className="mr-1 h-4 w-4" />
              Vorschläge ({matchedCount})
            </TabsTrigger>
            <TabsTrigger value="unmatched" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <AlertCircle className="mr-1 h-4 w-4" />
              Offen ({unmatchedCount})
            </TabsTrigger>
            <TabsTrigger value="confirmed" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <CheckCircle className="mr-1 h-4 w-4" />
              Bestätigt ({confirmedCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Search & Quick Select & Legend */}
      <div className="flex flex-col gap-4 animate-fade-in sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suche nach Beschreibung, Betrag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={selectAll} className="text-xs">
              Alle wählen
            </Button>
            {matchedCount > 0 && (
              <Button size="sm" variant="outline" onClick={selectAllMatched} className="text-xs gap-1">
                <Sparkles className="h-3 w-3" />
                Vorschläge wählen
              </Button>
            )}
          </div>
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
                : "Laden Sie Kontoauszüge hoch, um Transaktionen zu sehen"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedByMonth.map(({ year, month, transactions: monthTransactions }) => {
              const key = `${year}-${month}`;
              const isOpen = openMonths.has(key);
              const monthName = MONTH_NAMES[month - 1];
              const monthIds = monthTransactions.map((t: any) => t.id);
              const allMonthSelected = monthIds.length > 0 && monthIds.every((id: string) => selectedIds.has(id));
              const someMonthSelected = monthIds.some((id: string) => selectedIds.has(id));

              return (
                <Collapsible key={key} open={isOpen} onOpenChange={() => toggleMonth(key)}>
                  <CollapsibleTrigger asChild>
                    <button className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-gradient-to-r from-primary/5 to-transparent px-4 py-3 text-left transition-colors hover:bg-primary/10">
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-primary" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectMonth(monthTransactions);
                        }}
                        className="flex-shrink-0"
                      >
                        <Checkbox
                          checked={allMonthSelected}
                          className={someMonthSelected && !allMonthSelected ? "opacity-50" : ""}
                        />
                      </div>
                      <Calendar className="h-4 w-4 text-primary" />
                      <span className="font-heading font-semibold text-foreground">{monthName} {year}</span>
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {monthTransactions.length} Transaktionen
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2 pl-4">
                    <div className="flex items-center gap-4 px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
                      <div className="w-4"></div>
                      <div className="w-6"></div>
                      <div className="w-24">Datum</div>
                      <div className="flex-1">Beschreibung</div>
                      <div className="w-28 text-right">Betrag</div>
                      <div className="w-28 text-center">Status</div>
                      <div className="w-32 text-right">Aktionen</div>
                    </div>
                    {monthTransactions.map((transaction: any) => (
                      <TransactionRow
                        key={transaction.id}
                        transaction={transaction}
                        selected={selectedIds.has(transaction.id)}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

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
