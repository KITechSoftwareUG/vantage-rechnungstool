import { useState, useCallback, useMemo } from "react";
import { Loader2, CheckCircle, AlertCircle, Sparkles, Building, Search, FileText, RefreshCw, ChevronDown, ChevronRight, Calendar, X, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { useInvoices } from "@/hooks/useInvoices";
import { useFilteredTransactions } from "@/hooks/useFilteredTransactions";
import { TransactionRow } from "@/components/matching/TransactionRow";
import {
  useBulkUnmatch,
  useRestoreMatchSnapshots,
  type TransactionMatchSnapshot,
} from "@/hooks/useBulkMatchActions";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MONTH_NAMES } from "@/types/documents";
import { MatchingAgentDialog } from "@/components/matching/MatchingAgentDialog";
import { Bot } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AutoMatchResult = {
  transactionId: string;
  transactionDescription: string;
  transactionAmount: number;
  transactionDate: string;
  invoiceId: string;
  invoiceIssuer: string;
  invoiceAmount: number;
  invoiceDate: string;
  confidence: number;
  reason: string;
  source: "deterministic" | "ai";
  status: "confirmed";
};

export default function MatchingPage() {
  const { toast } = useToast();
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoMatchResults, setAutoMatchResults] = useState<AutoMatchResult[] | null>(null);
  const [autoMatchSummary, setAutoMatchSummary] = useState<{
    processed: number;
    confirmed: number;
    deterministic: number;
    aiAttempted: number;
    aiSucceeded: number;
    aiReturnedNull: number;
    aiRejectedInvalidId: number;
    aiRejectedLowConfidence: number;
    dbErrors: number;
    edgeVersion: string | null;
    aiModel: string | null;
    earlyReturnReason: string | null;
    rawCounts: {
      unmatchedTransactions?: number;
      allInvoices?: number;
      unmatchedInvoices?: number;
      invoicesAfterDedup?: number;
    } | null;
  } | null>(null);
  const { data: invoices = [] } = useInvoices();
  const bulkUnmatch = useBulkUnmatch();
  const restoreSnapshots = useRestoreMatchSnapshots();

  // Helper: nimmt einen Snapshot der Match-Felder einer Transaktion
  // (vor einer destruktiven Bulk-Aktion). Wird vom Undo-Toast genutzt.
  const snapshotTransactions = useCallback(
    (txs: any[]): TransactionMatchSnapshot[] =>
      txs.map((t) => ({
        id: t.id,
        match_status: t.matchStatus,
        matched_invoice_id: t.matchedInvoiceId,
        match_confidence: t.matchConfidence,
      })),
    []
  );

  const handleUndo = useCallback(
    async (snapshots: TransactionMatchSnapshot[]) => {
      try {
        await restoreSnapshots.mutateAsync(snapshots);
        toast({ title: "Aktion rückgängig gemacht", description: `${snapshots.length} Zuordnungen wiederhergestellt` });
      } catch (e: any) {
        toast({ title: "Undo fehlgeschlagen", description: e.message, variant: "destructive" });
      }
    },
    [restoreSnapshots, toast]
  );

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
    ignoredOpen,
    setIgnoredOpen,
    groupedByMonth,
    recurringTransactions,
    ignoredTransactions,
    unmatchedCount,
    confirmedCount,
    recurringCount,
    ignoredCount,
  } = useFilteredTransactions();

  const invoiceCount = invoices.length;

  // All visible transaction IDs (for select all)
  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    groupedByMonth.forEach((g: any) => g.transactions.forEach((t: any) => ids.push(t.id)));
    if (filterStatus === "all") {
      recurringTransactions.forEach((t: any) => ids.push(t.id));
      ignoredTransactions.forEach((t: any) => ids.push(t.id));
    }
    return ids;
  }, [groupedByMonth, recurringTransactions, ignoredTransactions, filterStatus]);

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

  // Bulk actions
  const selectedTransactions = useMemo(
    () => transactions.filter((t: any) => selectedIds.has(t.id)),
    [transactions, selectedIds]
  );

  const canBulkUnmatch = selectedTransactions.some(
    (t: any) => t.matchStatus === "confirmed"
  );

  const handleBulkUnmatch = async () => {
    const targets = selectedTransactions.filter(
      (t: any) => t.matchStatus === "confirmed"
    );
    if (targets.length === 0) return;
    const snapshots = snapshotTransactions(targets);
    const ids = targets.map((t: any) => t.id);
    try {
      await bulkUnmatch.mutateAsync(ids);
      toast({
        title: `${ids.length} Zuordnungen aufgehoben`,
        action: (
          <ToastAction altText="Rückgängig machen" onClick={() => handleUndo(snapshots)}>
            Rückgängig
          </ToastAction>
        ),
      });
      clearSelection();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    }
  };

  const handleAutoMatch = async () => {
    setIsAutoMatching(true);
    // Edge Function verarbeitet aus Wall-Clock-Gründen nur N Transaktionen
    // pro Aufruf. Wir loopen, bis sie `remaining: 0` meldet. Safety-Cap
    // verhindert eine Endlosschleife bei einem fehlerhaften Backend.
    const MAX_BATCHES = 50;
    let totalMatched = 0;
    let totalAutoConfirmed = 0;
    let totalProcessed = 0;
    let initialBacklog: number | null = null;
    let aiAttempted = 0;
    let aiSucceeded = 0;
    let aiTimeouts = 0;
    let aiHttpErrors = 0;
    let aiParseErrors = 0;
    let lastAiError: string | null = null;
    let aiModel: string | null = null;
    let edgeVersion: string | null = null;
    let deterministicMatched = 0;
    let aiReturnedNull = 0;
    let aiRejectedInvalidId = 0;
    let aiRejectedLowConfidence = 0;
    let dbUpdateErrors = 0;
    let earlyReturnReason: string | null = null;
    let rawCounts: {
      unmatchedTransactions?: number;
      allInvoices?: number;
      unmatchedInvoices?: number;
      invoicesAfterDedup?: number;
    } | null = null;
    const allResults: AutoMatchResult[] = [];

    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const { data, error } = await supabase.functions.invoke("auto-match-transactions");
        if (error) throw error;
        if (data?.aiKeyMissing) {
          toast({
            title: "KI-Matching nicht konfiguriert",
            description: "OPENAI_API_KEY fehlt in den Supabase-Edge-Function-Secrets. In Supabase Dashboard setzen und Function redeployen.",
            variant: "destructive",
          });
          return;
        }

        totalMatched += data?.matchedCount ?? 0;
        totalAutoConfirmed += data?.autoConfirmedCount ?? 0;
        totalProcessed += data?.processedCount ?? 0;

        if (data?.ai) {
          aiAttempted += data.ai.attempted ?? 0;
          aiSucceeded += data.ai.succeeded ?? 0;
          aiTimeouts += data.ai.timeouts ?? 0;
          aiHttpErrors += data.ai.httpErrors ?? 0;
          aiParseErrors += data.ai.parseErrors ?? 0;
          if (data.ai.lastError) lastAiError = data.ai.lastError;
          if (data.ai.model) aiModel = data.ai.model;
        }
        if (data?.version) edgeVersion = data.version;
        if (data?.decisions) {
          deterministicMatched += data.decisions.deterministicMatched ?? 0;
          aiReturnedNull += data.decisions.aiReturnedNull ?? 0;
          aiRejectedInvalidId += data.decisions.aiRejectedInvalidId ?? 0;
          aiRejectedLowConfidence += data.decisions.aiRejectedLowConfidence ?? 0;
          dbUpdateErrors += data.decisions.dbUpdateErrors ?? 0;
        }
        if (Array.isArray(data?.matchedTransactions)) {
          allResults.push(...(data.matchedTransactions as AutoMatchResult[]));
        }
        if (data?.earlyReturnReason) earlyReturnReason = data.earlyReturnReason;
        if (data?.rawCounts) rawCounts = data.rawCounts;

        const remaining: number = data?.remaining ?? 0;
        if (initialBacklog === null) {
          initialBacklog = (data?.totalUnmatched ?? 0) as number;
        }

        // KEIN Zwischenstand-Refetch mehr: die Liste darf waehrend des
        // Matching-Laufs nicht mitten im Scrollen aktualisiert werden.
        // Refetch passiert erst, wenn der User das Ergebnis-Modal schliesst.

        if (remaining === 0 || (data?.processedCount ?? 0) === 0) break;
      }

      const aiErrorsTotal = aiTimeouts + aiHttpErrors + aiParseErrors;
      // Wenn die KI zwar aufgerufen wurde, aber nie erfolgreich geantwortet hat,
      // ist das ein Konfig-/Model-Problem — nicht einfach "keine Treffer".
      if (aiAttempted > 0 && aiSucceeded === 0) {
        toast({
          title: "KI-Matching fehlgeschlagen",
          description: `Modell ${aiModel ?? "?"}: ${aiAttempted} Anfragen, 0 erfolgreich (${aiTimeouts} Timeouts, ${aiHttpErrors} HTTP-Fehler). Letzter Fehler: ${lastAiError ?? "unbekannt"}`,
          variant: "destructive",
        });
      } else {
        // Result-Modal: zeigt jede einzelne neu zugeordnete TX. Damit sieht der
        // User auf einen Blick was passiert ist, statt nur eine abstrakte Zahl.
        setAutoMatchResults(allResults);
        setAutoMatchSummary({
          processed: totalProcessed,
          confirmed: totalAutoConfirmed,
          deterministic: deterministicMatched,
          aiAttempted,
          aiSucceeded,
          aiReturnedNull,
          aiRejectedInvalidId,
          aiRejectedLowConfidence,
          dbErrors: dbUpdateErrors,
          edgeVersion,
          aiModel,
          earlyReturnReason,
          rawCounts,
        });
        // Kurzer Toast als Bestaetigung, das Modal hat die Details.
        toast({
          title:
            totalAutoConfirmed === 0
              ? "Keine automatischen Treffer"
              : `${totalAutoConfirmed} automatisch zugeordnet`,
          description: `${totalProcessed} TX geprüft`,
        });
      }
      // Refetch passiert erst wenn User das Modal schliesst — so sieht er
      // die neuen Status-Badges nicht schon waehrend er das Modal anschaut.
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
            <CheckCircle className="h-5 w-5 text-success" />
            <div>
              <p className="text-2xl font-bold text-foreground">{confirmedCount}</p>
              <p className="text-xs text-muted-foreground">Bestätigt</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setAgentOpen(true)}
            disabled={unmatchedCount === 0}
            className="gap-2"
            title="Offene Transaktionen zusammen mit dem KI-Agenten durchgehen"
          >
            <Bot className="h-4 w-4" />
            KI-Assistent ({unmatchedCount})
          </Button>
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
      </div>

      <MatchingAgentDialog
        open={agentOpen}
        onOpenChange={setAgentOpen}
        transactions={transactions.filter((t: any) => t.matchStatus === "unmatched")}
      />

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="animate-fade-in flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} ausgewählt
          </span>
          <div className="flex gap-2 ml-auto">
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
              Alle Transaktionen ({transactions.length})
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
              placeholder="Suche..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={selectAll} className="text-xs">
              Alle wählen
            </Button>
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

            {filterStatus === "all" && ignoredCount > 0 && (
              <Collapsible open={ignoredOpen} onOpenChange={setIgnoredOpen} className="mt-6">
                <CollapsibleTrigger asChild>
                  <button className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50">
                    {ignoredOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground">Ignoriert</span>
                    <span className="text-sm text-muted-foreground">({ignoredCount} Transaktionen)</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {ignoredTransactions.map((transaction: any) => (
                    <TransactionRow key={transaction.id} transaction={transaction} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

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
                    <TransactionRow key={transaction.id} transaction={transaction} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={autoMatchResults !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAutoMatchResults(null);
            setAutoMatchSummary(null);
            // Erst jetzt, beim Schliessen des Ergebnis-Modals, wird die Liste
            // mit den neuen Zuordnungen synchronisiert. Vorher: Modal zeigt
            // was gemacht wurde, Liste zeigt noch den alten Stand.
            refetch();
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              KI-Matching Ergebnis
            </DialogTitle>
            {autoMatchSummary && (
              <DialogDescription asChild>
                <div className="space-y-1 text-xs">
                  <div>
                    <span className="text-success font-medium">{autoMatchSummary.confirmed} automatisch bestätigt</span>
                    {" · "}
                    {autoMatchSummary.processed} TX geprüft
                  </div>
                  <div className="text-muted-foreground">
                    Pfade: deterministisch={autoMatchSummary.deterministic}
                    {autoMatchSummary.aiAttempted > 0 && ` · KI ${autoMatchSummary.aiSucceeded}/${autoMatchSummary.aiAttempted} (${autoMatchSummary.aiModel ?? "?"})`}
                    {(autoMatchSummary.aiReturnedNull + autoMatchSummary.aiRejectedInvalidId + autoMatchSummary.aiRejectedLowConfidence) > 0 &&
                      ` · KI-Ablehnungen: null=${autoMatchSummary.aiReturnedNull}, bad-id=${autoMatchSummary.aiRejectedInvalidId}, low-conf=${autoMatchSummary.aiRejectedLowConfidence}`}
                    {autoMatchSummary.dbErrors > 0 && ` · ⚠️ DB-Fehler: ${autoMatchSummary.dbErrors}`}
                  </div>
                  <div className="text-muted-foreground">
                    Edge-Function:{" "}
                    {autoMatchSummary.edgeVersion ? (
                      <span className="font-mono">{autoMatchSummary.edgeVersion}</span>
                    ) : (
                      <span className="font-medium text-warning">⚠️ alte Version (Lovable redeploy nötig)</span>
                    )}
                  </div>
                </div>
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="overflow-y-auto" style={{ maxHeight: "60vh" }}>
            {(() => {
              // Auto-Match schreibt seit v8 nur noch confirmed; der Filter ist
              // defensiv falls Legacy-Daten oder ein anderer Pfad mal etwas
              // anderes liefert.
              const confirmedOnly = (autoMatchResults ?? []).filter((r) => r.status === "confirmed");
              return confirmedOnly.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Keine neuen Zuordnungen in diesem Lauf.
                {autoMatchSummary?.earlyReturnReason && (
                  <div className="mx-auto mt-4 max-w-md rounded-md border border-warning/40 bg-warning/5 p-3 text-left text-xs">
                    <div className="font-medium text-warning">Function konnte nichts verarbeiten:</div>
                    <div className="mt-1 text-foreground">{autoMatchSummary.earlyReturnReason}</div>
                    {autoMatchSummary.rawCounts && (
                      <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                        TX-unmatched={autoMatchSummary.rawCounts.unmatchedTransactions ?? "?"} ·
                        Invoices-total={autoMatchSummary.rawCounts.allInvoices ?? "?"} ·
                        Invoices-unmatched={autoMatchSummary.rawCounts.unmatchedInvoices ?? "?"} ·
                        nach-Dedup={autoMatchSummary.rawCounts.invoicesAfterDedup ?? "?"}
                      </div>
                    )}
                  </div>
                )}
                {autoMatchSummary && autoMatchSummary.processed > 0 && (
                  <div className="mt-2 text-xs">
                    Mögliche Gründe siehst du oben in den Pfad-Zählern.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {confirmedOnly.map((r) => (
                  <div
                    key={r.transactionId}
                    className="rounded-lg border border-border/60 bg-card p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">
                        Bestätigt · {r.confidence}%
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          r.source === "deterministic"
                            ? "bg-info/10 text-info"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.source === "deterministic" ? "Deterministisch" : "KI"}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">{r.transactionDate}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-muted-foreground">Transaktion</div>
                        <div className="font-medium">{r.transactionDescription}</div>
                        <div className="text-xs">{r.transactionAmount.toFixed(2)} €</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Rechnung</div>
                        <div className="font-medium">{r.invoiceIssuer}</div>
                        <div className="text-xs">
                          {r.invoiceAmount.toFixed(2)} € · {r.invoiceDate}
                        </div>
                      </div>
                    </div>
                    {r.reason && (
                      <div className="mt-2 text-xs italic text-muted-foreground">{r.reason}</div>
                    )}
                  </div>
                ))}
              </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
