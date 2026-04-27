import { useState, useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  // Cancel-Flag + AbortController. Der Controller bricht den laufenden
  // Edge-Function-HTTP-Request sofort ab, das Flag verhindert den naechsten
  // Batch. So reagiert "Abbrechen" sofort, nicht erst nach dem aktuellen Batch.
  const autoMatchCancelRef = useRef(false);
  const autoMatchAbortRef = useRef<AbortController | null>(null);
  // Resolve-Funktion des Cancel-Promise. Bei Klick auf "Abbrechen" wird sie
  // synchron aufgerufen — die laufende Welle verliert dadurch sofort das
  // Promise.race, und die UI reagiert ohne auf supabase.functions.invoke zu
  // warten (das honoriert den AbortSignal nicht zuverlaessig).
  const autoMatchCancelResolveRef = useRef<(() => void) | null>(null);
  const [autoMatchProgress, setAutoMatchProgress] = useState<{
    batch: number;
    processed: number;
    confirmed: number;
  } | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoMatchResults, setAutoMatchResults] = useState<AutoMatchResult[] | null>(null);
  const [autoMatchSummary, setAutoMatchSummary] = useState<{
    processed: number;
    confirmed: number;
    deterministic: number;
    deterministicTier1: number;
    deterministicTier2: number;
    cooldownSkipped: number;
    aiAttempted: number;
    aiSucceeded: number;
    aiReturnedNull: number;
    aiRejectedInvalidId: number;
    aiRejectedLowConfidence: number;
    aiRejectedSanity: number;
    aiRejectedSanityHardGateAmount: number;
    aiRejectedSanityInsufficientSignals: number;
    aiAvgLatencyMs: number | null;
    aiP95LatencyMs: number | null;
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
  const queryClient = useQueryClient();

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
    autoMatchCancelRef.current = false;
    autoMatchAbortRef.current = new AbortController();
    setAutoMatchProgress({ batch: 0, processed: 0, confirmed: 0 });
    setIsAutoMatching(true);

    // UI-Freeze: Snapshot der bank_transactions-Queries. Irgendwas
    // (Realtime, Window-Focus, staleTime:0, ...) sorgt dafuer, dass die
    // Liste waehrend des Laufs gruen "durchtropft". Das wollten wir in
    // Commit 5e3f77d verhindern — hier erzwingen wir es explizit:
    // laufende Refetches werden gecancelt, und die Cache-Daten werden
    // nach jeder Welle aus dem Snapshot zurueckgeschrieben. Erst wenn der
    // User das Result-Modal schliesst, wird wieder echt nachgeladen.
    const txSnapshots = queryClient.getQueriesData({ queryKey: ["bank_transactions"] }) as [readonly unknown[], unknown][];
    await queryClient.cancelQueries({ queryKey: ["bank_transactions"] });
    const restoreTxSnapshots = () => {
      for (const [key, data] of txSnapshots) {
        if (data !== undefined) queryClient.setQueryData(key, data);
      }
    };
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
    let deterministicTier1 = 0;
    let deterministicTier2 = 0;
    let cooldownSkipped = 0;
    let aiReturnedNull = 0;
    let aiRejectedInvalidId = 0;
    let aiRejectedLowConfidence = 0;
    let aiRejectedSanity = 0;
    let aiRejectedSanityHardGateAmount = 0;
    let aiRejectedSanityInsufficientSignals = 0;
    let aiAvgLatencyAccum = 0;
    let aiAvgLatencySamples = 0;
    let aiP95LatencyMax = 0;
    let dbUpdateErrors = 0;
    let earlyReturnReason: string | null = null;
    let rawCounts: {
      unmatchedTransactions?: number;
      allInvoices?: number;
      unmatchedInvoices?: number;
      invoicesAfterDedup?: number;
    } | null = null;
    const allResults: AutoMatchResult[] = [];

    // 4-fach Parallelitaet: die Edge Function claimt pro Call atomisch bis zu
    // 50 TX (match_status: unmatched → ai_processing). Parallele Calls sehen
    // disjunkte Sets, dadurch ~4x Speedup. Details siehe Edge Function v9.
    const CONCURRENCY = 4;

    let wasCancelled = false;
    try {
      waveLoop: for (let wave = 0; wave < MAX_BATCHES; wave++) {
        if (autoMatchCancelRef.current) {
          wasCancelled = true;
          break;
        }
        const signal = autoMatchAbortRef.current?.signal;

        // Welle von CONCURRENCY parallelen Calls. Alle teilen sich denselben
        // AbortController → ein Cancel bricht alle 4 gleichzeitig ab.
        const wavePromises = Array.from({ length: CONCURRENCY }, async () => {
          try {
            const res = await supabase.functions.invoke("auto-match-transactions", { signal });
            return { data: res.data, error: res.error, aborted: false };
          } catch (invokeErr: any) {
            if (signal?.aborted || invokeErr?.name === "AbortError") {
              return { data: null, error: null, aborted: true };
            }
            return { data: null, error: invokeErr, aborted: false };
          }
        });

        // Race: entweder alle 4 Calls antworten, oder der User klickt Abbrechen.
        // Das Cancel-Promise wird im onClick-Handler synchron resolved, damit
        // die UI nicht auf die laufenden Edge-Function-Calls wartet.
        const cancelPromise = new Promise<"cancelled">((resolve) => {
          autoMatchCancelResolveRef.current = () => resolve("cancelled");
        });
        const raceResult = await Promise.race([
          Promise.all(wavePromises).then((r) => ({ kind: "done" as const, results: r })),
          cancelPromise.then(() => ({ kind: "cancelled" as const })),
        ]);
        autoMatchCancelResolveRef.current = null;
        if (raceResult.kind === "cancelled") {
          wasCancelled = true;
          // In-flight Calls laufen im Hintergrund weiter; ihre Claims werden
          // entweder normal commited (confirmed) oder nach 3min via Stale-
          // Recovery freigegeben. Wir warten NICHT auf sie.
          break waveLoop;
        }
        const results = raceResult.results;

        let waveProcessed = 0;
        let lastRemaining = 0;
        for (const r of results) {
          if (r.aborted) {
            wasCancelled = true;
            continue;
          }
          if (r.error) throw r.error;
          const data = r.data;
          if (!data) continue;

          if (data.aiKeyMissing) {
            toast({
              title: "KI-Matching nicht konfiguriert",
              description:
                "OPENAI_API_KEY fehlt in den Supabase-Edge-Function-Secrets. In Supabase Dashboard setzen und Function redeployen.",
              variant: "destructive",
            });
            return;
          }

          totalMatched += data.matchedCount ?? 0;
          totalAutoConfirmed += data.autoConfirmedCount ?? 0;
          totalProcessed += data.processedCount ?? 0;
          waveProcessed += data.processedCount ?? 0;

          if (data.ai) {
            aiAttempted += data.ai.attempted ?? 0;
            aiSucceeded += data.ai.succeeded ?? 0;
            aiTimeouts += data.ai.timeouts ?? 0;
            aiHttpErrors += data.ai.httpErrors ?? 0;
            aiParseErrors += data.ai.parseErrors ?? 0;
            if (data.ai.lastError) lastAiError = data.ai.lastError;
            if (data.ai.model) aiModel = data.ai.model;
            // Latenz aggregieren: gewichteter Avg ueber alle Calls einer Welle,
            // p95 als Max ueber die einzelnen p95-Werte (grobe Naeherung — wir
            // haben nicht die einzelnen Sample-Werte pro Welle).
            const callCount = data.ai.attempted ?? 0;
            if (callCount > 0 && typeof data.ai.avgLatencyMs === "number") {
              aiAvgLatencyAccum += data.ai.avgLatencyMs * callCount;
              aiAvgLatencySamples += callCount;
            }
            if (typeof data.ai.p95LatencyMs === "number") {
              aiP95LatencyMax = Math.max(aiP95LatencyMax, data.ai.p95LatencyMs);
            }
          }
          if (data.version) edgeVersion = data.version;
          if (data.decisions) {
            deterministicMatched += data.decisions.deterministicMatched ?? 0;
            deterministicTier1 += data.decisions.deterministicTier1 ?? 0;
            deterministicTier2 += data.decisions.deterministicTier2 ?? 0;
            cooldownSkipped += data.decisions.cooldownSkipped ?? 0;
            aiReturnedNull += data.decisions.aiReturnedNull ?? 0;
            aiRejectedInvalidId += data.decisions.aiRejectedInvalidId ?? 0;
            aiRejectedLowConfidence += data.decisions.aiRejectedLowConfidence ?? 0;
            aiRejectedSanity += data.decisions.aiRejectedSanity ?? 0;
            if (data.decisions.aiRejectedSanityBreakdown) {
              aiRejectedSanityHardGateAmount +=
                data.decisions.aiRejectedSanityBreakdown.hardGateAmount ?? 0;
              aiRejectedSanityInsufficientSignals +=
                data.decisions.aiRejectedSanityBreakdown.insufficientSignals ?? 0;
            }
            dbUpdateErrors += data.decisions.dbUpdateErrors ?? 0;
          }
          if (Array.isArray(data.matchedTransactions)) {
            allResults.push(...(data.matchedTransactions as AutoMatchResult[]));
          }
          // earlyReturnReason / rawCounts nur uebernehmen, wenn dieser konkrete
          // Call NICHT gearbeitet hat. Bei 4-fach-Parallelitaet claimed oft
          // ein Call alle TX, die anderen 3 sehen dann legitim 0 — deren
          // earlyReturnReason wuerde sonst die produktive Arbeit "uebermalen".
          if (data.earlyReturnReason && (data.processedCount ?? 0) === 0) {
            earlyReturnReason = data.earlyReturnReason;
          }
          if (data.rawCounts && (data.processedCount ?? 0) === 0) {
            rawCounts = data.rawCounts;
          }

          lastRemaining = data.remaining ?? 0;
          if (initialBacklog === null) {
            initialBacklog = (data.totalUnmatched ?? 0) as number;
          }
        }

        setAutoMatchProgress({
          batch: wave + 1,
          processed: totalProcessed,
          confirmed: totalAutoConfirmed,
        });

        // Cache auf Snapshot zurueckrollen: falls irgendein Mechanismus
        // (Realtime/Focus-Refetch/etc.) zwischenzeitlich frischere DB-Daten
        // eingespielt hat, ueberschreiben wir sie wieder mit dem Start-Stand.
        // Sichtbar wird der neue Stand erst beim Refetch nach Modal-Close.
        restoreTxSnapshots();

        if (wasCancelled) break waveLoop;

        // Terminierung: keine offene Arbeit mehr. `remaining` ist der globale
        // DB-Backlog — nicht pro Call. Wenn alle Calls 0 verarbeitet haben UND
        // noch was uebrig ist, liegt ein Problem vor (z.B. alle TX stecken in
        // ai_processing durch einen parallelen Run eines anderen Tabs). Safety-
        // Cap MAX_BATCHES faengt das ab; Stale-Recovery (3min) loest es dauerhaft.
        if (lastRemaining === 0) break;
        if (waveProcessed === 0) break;
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
        // Wenn irgendein Call produktiv war, ist die Gesamt-Run-Diagnose nicht
        // "Function konnte nichts verarbeiten" — egal was parallele Idle-Calls
        // berichtet haben. Nur wenn der gesamte Run 0 TX angefasst hat, bleibt
        // die Diagnose-Meldung aussagekraeftig.
        const displayEarlyReturnReason = totalProcessed > 0 ? null : earlyReturnReason;
        const displayRawCounts = totalProcessed > 0 ? null : rawCounts;

        // Result-Modal: zeigt jede einzelne neu zugeordnete TX. Damit sieht der
        // User auf einen Blick was passiert ist, statt nur eine abstrakte Zahl.
        setAutoMatchResults(allResults);
        setAutoMatchSummary({
          processed: totalProcessed,
          confirmed: totalAutoConfirmed,
          deterministic: deterministicMatched,
          deterministicTier1,
          deterministicTier2,
          cooldownSkipped,
          aiAttempted,
          aiSucceeded,
          aiReturnedNull,
          aiRejectedInvalidId,
          aiRejectedLowConfidence,
          aiRejectedSanity,
          aiRejectedSanityHardGateAmount,
          aiRejectedSanityInsufficientSignals,
          aiAvgLatencyMs:
            aiAvgLatencySamples > 0 ? Math.round(aiAvgLatencyAccum / aiAvgLatencySamples) : null,
          aiP95LatencyMs: aiP95LatencyMax > 0 ? aiP95LatencyMax : null,
          dbErrors: dbUpdateErrors,
          edgeVersion,
          aiModel,
          earlyReturnReason: displayEarlyReturnReason,
          rawCounts: displayRawCounts,
        });
        // Kurzer Toast als Bestaetigung, das Modal hat die Details.
        const cancelNote = wasCancelled ? " (abgebrochen)" : "";
        toast({
          title:
            totalAutoConfirmed === 0
              ? `Keine automatischen Treffer${cancelNote}`
              : `${totalAutoConfirmed} automatisch zugeordnet${cancelNote}`,
          description: `${totalProcessed} TX geprüft`,
        });
      }
      // Refetch passiert erst wenn User das Modal schliesst — so sieht er
      // die neuen Status-Badges nicht schon waehrend er das Modal anschaut.
    } catch (error: any) {
      toast({ title: "Fehler beim Auto-Matching", description: error.message, variant: "destructive" });
    } finally {
      // Letzter Restore bevor der Modal aufgeht — garantiert keinen Flash
      // zwischen Ende des Runs und User-Interaktion mit dem Modal.
      restoreTxSnapshots();
      setIsAutoMatching(false);
      setAutoMatchProgress(null);
      autoMatchAbortRef.current = null;
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
      {/* Blockierendes Overlay waehrend des Auto-Match-Laufs. Verhindert jede
          Interaktion (Klicks, Scrollen, Swipe) und macht sichtbar, was laeuft.
          Nur der Abbrechen-Button ist bedienbar. */}
      {isAutoMatching && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
          // Scroll-Lock: Mausrad/Touch im Hintergrund ignorieren.
          onWheel={(e) => e.preventDefault()}
          onTouchMove={(e) => e.preventDefault()}
        >
          <div className="glass-card mx-4 flex max-w-md flex-col items-center gap-5 rounded-2xl px-8 py-8 text-center shadow-2xl">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <Loader2 className="h-16 w-16 animate-spin text-primary" />
              <Sparkles className="absolute h-6 w-6 text-primary" />
            </div>
            <div className="space-y-1">
              <h2 className="font-heading text-xl font-bold text-foreground">
                KI-Matching läuft
              </h2>
              <p className="text-sm text-muted-foreground">
                Bitte warten — die Transaktionen werden zugeordnet.
              </p>
            </div>
            {autoMatchProgress && (
              <div className="flex w-full flex-col gap-2 rounded-lg border border-border/50 bg-muted/30 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Welle</span>
                  <span className="font-semibold text-foreground">
                    {autoMatchProgress.batch}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Geprüft</span>
                  <span className="font-semibold text-foreground">
                    {autoMatchProgress.processed}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Zugeordnet</span>
                  <span className="font-semibold text-success">
                    {autoMatchProgress.confirmed}
                  </span>
                </div>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => {
                autoMatchCancelRef.current = true;
                autoMatchAbortRef.current?.abort();
                autoMatchCancelResolveRef.current?.();
              }}
              disabled={autoMatchCancelRef.current}
              className="w-full gap-2"
            >
              <X className="h-4 w-4" />
              {autoMatchCancelRef.current ? "Wird abgebrochen..." : "Abbrechen"}
            </Button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground">Zuordnung</h1>
        <p className="mt-1 text-sm sm:text-base text-muted-foreground">
          Ordnen Sie Rechnungen den Kontoauszugstransaktionen zu
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 animate-fade-in lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="glass-card flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
            <FileText className="h-4 w-4 shrink-0 text-info sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-lg font-bold text-foreground sm:text-2xl">{invoiceCount}</p>
              <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Rechnungen</p>
            </div>
          </div>
          <div className="glass-card flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-warning sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-lg font-bold text-foreground sm:text-2xl">{unmatchedCount}</p>
              <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Offen</p>
            </div>
          </div>
          <div className="glass-card flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
            <CheckCircle className="h-4 w-4 shrink-0 text-success sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="text-lg font-bold text-foreground sm:text-2xl">{confirmedCount}</p>
              <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Bestätigt</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setAgentOpen(true)}
            disabled={unmatchedCount === 0}
            className="flex-1 gap-2 sm:flex-none"
            title="Offene Transaktionen zusammen mit dem KI-Agenten durchgehen"
          >
            <Bot className="h-4 w-4" />
            KI-Assistent ({unmatchedCount})
          </Button>
          {isAutoMatching ? null : (
            <Button
              variant="gradient"
              onClick={handleAutoMatch}
              disabled={unmatchedCount === 0}
              className="flex-1 gap-2 sm:flex-none"
            >
              <Sparkles className="h-4 w-4" />
              <span className="sm:inline">KI Auto-Matching</span>
            </Button>
          )}
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
      <div className="animate-fade-in -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
          <TabsList className="glass-card h-auto w-max p-1">
            <TabsTrigger value="all" className="whitespace-nowrap data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <span className="hidden sm:inline">Alle Transaktionen</span>
              <span className="sm:hidden">Alle</span>
              {" "}({transactions.length})
            </TabsTrigger>
            <TabsTrigger value="unmatched" className="whitespace-nowrap data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <AlertCircle className="mr-1 h-4 w-4" />
              Offen ({unmatchedCount})
            </TabsTrigger>
            <TabsTrigger value="confirmed" className="whitespace-nowrap data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <CheckCircle className="mr-1 h-4 w-4" />
              Bestätigt ({confirmedCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Search & Quick Select & Legend */}
      <div className="flex flex-col gap-3 animate-fade-in lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative flex-1 lg:w-64 lg:flex-none">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suche..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={selectAll} className="whitespace-nowrap text-xs">
              Alle wählen
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground sm:gap-4 sm:text-sm">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 shrink-0 rounded-full bg-blue-500" />
            <span>Volksbank</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 shrink-0 rounded-full bg-emerald-500" />
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
                  <CollapsibleContent className="mt-2 space-y-2 pl-2 sm:pl-4">
                    <div className="hidden items-center gap-4 px-4 py-2 text-xs font-medium uppercase text-muted-foreground sm:flex">
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
                    Pfade: deterministisch t1={autoMatchSummary.deterministicTier1}, t2={autoMatchSummary.deterministicTier2}
                    {autoMatchSummary.cooldownSkipped > 0 && ` · Cooldown übersprungen: ${autoMatchSummary.cooldownSkipped}`}
                    {autoMatchSummary.aiAttempted > 0 && ` · KI ${autoMatchSummary.aiSucceeded}/${autoMatchSummary.aiAttempted} (${autoMatchSummary.aiModel ?? "?"})`}
                    {autoMatchSummary.aiAvgLatencyMs !== null &&
                      ` · ⌀${autoMatchSummary.aiAvgLatencyMs}ms${autoMatchSummary.aiP95LatencyMs ? ` p95 ${autoMatchSummary.aiP95LatencyMs}ms` : ""}`}
                    {(autoMatchSummary.aiReturnedNull + autoMatchSummary.aiRejectedInvalidId + autoMatchSummary.aiRejectedLowConfidence + autoMatchSummary.aiRejectedSanity) > 0 &&
                      ` · KI-Ablehnungen: null=${autoMatchSummary.aiReturnedNull}, bad-id=${autoMatchSummary.aiRejectedInvalidId}, low-conf=${autoMatchSummary.aiRejectedLowConfidence}, sanity=${autoMatchSummary.aiRejectedSanity} (Betrag/Signale: ${autoMatchSummary.aiRejectedSanityHardGateAmount}/${autoMatchSummary.aiRejectedSanityInsufficientSignals})`}
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
