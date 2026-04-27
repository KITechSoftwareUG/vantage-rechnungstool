import { useState, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Grid3X3, FolderTree, Search, ArrowDownLeft, ArrowUpRight, Loader2, List, Eye, Trash2, CheckSquare, Square, XSquare, Copy, AlertTriangle, X, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { DocumentCard } from "@/components/documents/DocumentCard";
import { YearMonthAccordion } from "@/components/documents/YearMonthAccordion";
import { GroupedListView } from "@/components/documents/GroupedListView";
import { groupByYearAndMonth, InvoiceData } from "@/types/documents";
import { useInvoices, useUpdateInvoice, useDeleteInvoice, useBulkDeleteInvoices } from "@/hooks/useDocuments";
import { useDuplicateDetection, useMergeDuplicate } from "@/hooks/useDuplicateDetection";
import { DuplicateBadge } from "@/components/documents/DuplicateBadge";
import { cn } from "@/lib/utils";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { buildStoragePaths } from "@/lib/storagePaths";
import { resetTransactionMatches } from "@/lib/matchReset";
import {
  deleteIngestionLogsBestEffort,
  removeStoragePathsBestEffort,
} from "@/lib/storageCleanup";

type ViewMode = "grid" | "timeline" | "list";

export default function InvoicesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "incoming" | "outgoing">("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<InvoiceData | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false);
  const [bulkDedupDialogOpen, setBulkDedupDialogOpen] = useState(false);
  const [isBulkDeduping, setIsBulkDeduping] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const { data: invoices = [], isLoading } = useInvoices();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const bulkDelete = useBulkDeleteInvoices();
  const mergeDuplicate = useMergeDuplicate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Duplicate detection across all invoices
  const duplicateCandidates = useMemo(() =>
    invoices.map((inv) => ({
      id: inv.id,
      date: inv.date,
      issuer: inv.issuer,
      amount: inv.amount,
      currency: inv.currency,
      fileName: inv.fileName,
      fileUrl: inv.fileUrl,
      status: inv.status,
      createdAt: inv.createdAt,
      invoiceNumber: inv.invoiceNumber,
      fileHash: inv.fileHash,
    })),
    [invoices]
  );
  const duplicateMap = useDuplicateDetection(duplicateCandidates);
  const duplicateCount = useMemo(() => {
    const seen = new Set<string>();
    for (const [id] of duplicateMap) seen.add(id);
    return seen.size;
  }, [duplicateMap]);

  // Build connected components of duplicate groups from duplicateMap.
  // Each group: one keeper (oldest) + N docs to delete. Status-confirmed docs
  // (ready/saved) are preferred as keeper regardless of age — matches the
  // single-merge swap logic in useMergeDuplicate and prevents deleting
  // confirmed rows.
  const bulkDedupPlan = useMemo(() => {
    if (duplicateMap.size === 0) return { pairs: [] as Array<{ keeperId: string; duplicateId: string }>, deleteCount: 0, groupCount: 0 };

    const invById = new Map<string, InvoiceData>();
    for (const inv of invoices) invById.set(inv.id, inv);

    const visited = new Set<string>();
    const groups: string[][] = [];
    for (const startId of duplicateMap.keys()) {
      if (visited.has(startId)) continue;
      const stack = [startId];
      const group: string[] = [];
      while (stack.length) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        group.push(id);
        const neighbors = duplicateMap.get(id) || [];
        for (const n of neighbors) {
          if (!visited.has(n.id)) stack.push(n.id);
        }
      }
      if (group.length > 1) groups.push(group);
    }

    const isConfirmed = (s?: string) => s === "ready" || s === "saved";
    const rank = (inv: InvoiceData | undefined): [number, number, string, string] => {
      if (!inv) return [2, Number.MAX_SAFE_INTEGER, "", ""];
      // Lower is better: confirmed first, then oldest createdAt, then alphabetical fileName, then id
      const confirmedRank = isConfirmed(inv.status) ? 0 : 1;
      const createdRank = inv.createdAt ? new Date(inv.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
      return [confirmedRank, createdRank, (inv.fileName || "").toLowerCase(), inv.id];
    };
    const cmp = (a: [number, number, string, string], b: [number, number, string, string]) => {
      if (a[0] !== b[0]) return a[0] - b[0];
      if (a[1] !== b[1]) return a[1] - b[1];
      if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
      return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
    };

    const pairs: Array<{ keeperId: string; duplicateId: string }> = [];
    for (const group of groups) {
      const sorted = [...group].sort((a, b) => cmp(rank(invById.get(a)), rank(invById.get(b))));
      const keeperId = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        pairs.push({ keeperId, duplicateId: sorted[i] });
      }
    }
    return { pairs, deleteCount: pairs.length, groupCount: groups.length };
  }, [duplicateMap, invoices]);

  const handleBulkDedup = async () => {
    if (bulkDedupPlan.pairs.length === 0) return;
    setBulkDedupDialogOpen(false);
    setIsBulkDeduping(true);
    const total = bulkDedupPlan.pairs.length;
    toast({ title: `Lösche ${total} Duplikate...`, description: "Bitte warten." });

    // Reimplement the merge mutation's core logic inline so we can
    // Promise.allSettled in parallel without hammering the shared mutation
    // state. Keeps the DB-effect identical (reassign transactions → delete
    // invoice → clean ingestion logs) but skips per-op toasts.
    const runOne = async ({ keeperId: rawKeeperId, duplicateId: rawDuplicateId }: { keeperId: string; duplicateId: string }) => {
      const { data: statusRows, error: statusErr } = await supabase
        .from("invoices")
        .select("id, status")
        .in("id", [rawKeeperId, rawDuplicateId]);
      if (statusErr) throw statusErr;
      const statusOf = (id: string) =>
        (statusRows || []).find((r: any) => r.id === id)?.status as string | undefined;
      const isConfirmedStatus = (s: string | undefined) => s === "ready" || s === "saved";

      let keeperId = rawKeeperId;
      let duplicateId = rawDuplicateId;
      if (isConfirmedStatus(statusOf(rawDuplicateId)) && !isConfirmedStatus(statusOf(rawKeeperId))) {
        keeperId = rawDuplicateId;
        duplicateId = rawKeeperId;
      }

      const { error: reassignError } = await supabase
        .from("bank_transactions")
        .update({ matched_invoice_id: keeperId })
        .eq("matched_invoice_id", duplicateId);
      if (reassignError) throw reassignError;

      const { data: logRows } = await supabase
        .from("document_ingestion_log")
        .select("id")
        .eq("document_id", duplicateId);
      const logIds = (logRows || []).map((r: any) => r.id);

      // Fix A: Snapshot der duplicate-Invoice VOR dem delete, damit wir
      // anschliessend die Storage-Datei entfernen koennen. Ohne das bleiben
      // Orphans im Bucket stehen.
      const { data: dupRow } = await supabase
        .from("invoices")
        .select("id, user_id, year, month, file_name, file_url")
        .eq("id", duplicateId)
        .maybeSingle();

      await resetTransactionMatches([duplicateId]);
      const { error: deleteError } = await supabase
        .from("invoices")
        .delete()
        .eq("id", duplicateId);
      if (deleteError) throw deleteError;

      await deleteIngestionLogsBestEffort(logIds, "bulkDedup");

      // Fix A: Storage-Cleanup (best-effort).
      if (dupRow) {
        const paths = buildStoragePaths([
          {
            userId: (dupRow as any).user_id,
            year: (dupRow as any).year,
            month: (dupRow as any).month,
            fileName: (dupRow as any).file_name,
            fileUrl: (dupRow as any).file_url,
          },
        ]);
        await removeStoragePathsBestEffort(paths, "bulkDedup");
      }
    };

    const results = await Promise.allSettled(bulkDedupPlan.pairs.map(runOne));
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - succeeded;

    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
    queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
    queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });

    if (failed === 0) {
      toast({ title: `${succeeded} Duplikate entfernt`, description: "Alle doppelten Rechnungen wurden zusammengeführt." });
    } else {
      toast({
        title: `${succeeded} von ${total} Duplikaten entfernt`,
        description: `${failed} Fehler beim Zusammenführen. Details in der Konsole.`,
        variant: "destructive",
      });
      for (const r of results) {
        if (r.status === "rejected") console.error("Bulk-Dedup-Fehler:", r.reason);
      }
    }

    setIsBulkDeduping(false);
  };

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = inv.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          inv.issuer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === "all" || inv.type === filterType;
    const matchesDuplicateFilter = !showOnlyDuplicates || duplicateMap.has(inv.id);
    return matchesSearch && matchesType && matchesDuplicateFilter;
  });

  const handleShowDuplicates = () => {
    setShowOnlyDuplicates(true);
    setFilterType("all");
    setSearchQuery("");
    setTimeout(() => {
      contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const groupedInvoices = groupByYearAndMonth(filteredInvoices);

  const isSelectMode = selectedIds.size > 0;

  const allFilteredSelected = filteredInvoices.length > 0 && filteredInvoices.every(inv => selectedIds.has(inv.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredInvoices.map(inv => inv.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleSave = (data: typeof invoices[0]) => {
    updateInvoice.mutate(data);
  };

  const handleDelete = (invoice: InvoiceData) => {
    setInvoiceToDelete(invoice);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (invoiceToDelete) {
      deleteInvoice.mutate(invoiceToDelete.id);
      setDeleteDialogOpen(false);
      setInvoiceToDelete(null);
    }
  };

  const confirmBulkDelete = () => {
    bulkDelete.mutate(Array.from(selectedIds), {
      onSuccess: () => {
        setSelectedIds(new Set());
        setBulkDeleteDialogOpen(false);
      },
    });
  };

  const handleView = (fileUrl: string | undefined) => {
    if (!fileUrl) return;
    window.open(fileUrl, "_blank");
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    }).format(amount);
  };

  const totalIncoming = filteredInvoices
    .filter(inv => inv.type === "incoming")
    .reduce((sum, inv) => sum + inv.amount, 0);
  const totalOutgoing = filteredInvoices
    .filter(inv => inv.type === "outgoing")
    .reduce((sum, inv) => sum + inv.amount, 0);

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-fade-in">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground">
            Rechnungen
          </h1>
          <p className="mt-1 text-sm sm:text-base text-muted-foreground">
            {filteredInvoices.length} Rechnungen gefunden
          </p>
        </div>

        {/* Actions + View Toggle */}
        <div className="-mx-1 flex flex-wrap items-center gap-2 overflow-x-auto px-1">
          {bulkDedupPlan.deleteCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkDedupDialogOpen(true)}
              disabled={isBulkDeduping}
              className="gap-1.5 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
              title="Alle erkannten Duplikate auf einmal zusammenführen"
            >
              {isBulkDeduping ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Alle Duplikate entfernen ({bulkDedupPlan.deleteCount})
            </Button>
          )}
          <Button
            variant={viewMode === "timeline" ? "default" : "ghost"}
            size="icon"
            onClick={() => setViewMode("timeline")}
            title="Nach Jahr/Monat"
          >
            <FolderTree className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="icon"
            onClick={() => setViewMode("grid")}
            title="Karten-Ansicht"
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="icon"
            onClick={() => setViewMode("list")}
            title="Listen-Ansicht"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {isSelectMode && (
        <div className="glass-card flex flex-col gap-2 p-3 animate-fade-in border-primary/30 border sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Button variant="outline" size="sm" onClick={selectAll}>
              {allFilteredSelected ? (
                <><XSquare className="mr-1.5 h-4 w-4" /> Alle abwählen</>
              ) : (
                <><CheckSquare className="mr-1.5 h-4 w-4" /> Alle auswählen ({filteredInvoices.length})</>
              )}
            </Button>
            <span className="text-sm text-muted-foreground">
              {selectedIds.size} ausgewählt
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {selectedIds.size} löschen
            </Button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="glass-card p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-muted-foreground">Einnahmen</p>
          <p className="mt-1 truncate text-lg sm:text-2xl font-bold text-success">
            +{totalIncoming.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className="glass-card p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-muted-foreground">Ausgaben</p>
          <p className="mt-1 truncate text-lg sm:text-2xl font-bold text-foreground">
            -{totalOutgoing.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className="glass-card p-3 sm:p-4">
          <p className="text-xs sm:text-sm text-muted-foreground">Bilanz</p>
          <p className={cn(
            "mt-1 truncate text-lg sm:text-2xl font-bold",
            totalIncoming - totalOutgoing >= 0 ? "text-success" : "text-destructive"
          )}>
            {totalIncoming - totalOutgoing >= 0 ? "+" : ""}
            {(totalIncoming - totalOutgoing).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <button
          onClick={duplicateCount > 0 ? handleShowDuplicates : undefined}
          className={cn(
            "glass-card p-3 sm:p-4 text-left transition-colors",
            duplicateCount > 0 && "border-warning/30 border cursor-pointer hover:bg-warning/5"
          )}
        >
          <p className="text-xs sm:text-sm text-muted-foreground flex items-center gap-1.5">
            <Copy className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Duplikate</span>
          </p>
          <p className={cn("mt-1 text-lg sm:text-2xl font-bold", duplicateCount > 0 ? "text-warning" : "text-muted-foreground")}>
            {duplicateCount}
          </p>
        </button>
      </div>

      {/* Duplicate Warning Banner */}
      {duplicateCount > 0 && !showOnlyDuplicates && (
        <button
          onClick={handleShowDuplicates}
          className="w-full flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-left hover:bg-warning/15 transition-colors animate-fade-in"
        >
          <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-warning">
              {duplicateCount} mögliche Duplikat{duplicateCount > 1 ? "e" : ""} gefunden
            </p>
            <p className="text-xs text-muted-foreground">
              Klicke hier, um nur Duplikate anzuzeigen und sie zu überprüfen
            </p>
          </div>
          <span className="text-xs text-warning font-medium shrink-0">Anzeigen →</span>
        </button>
      )}

      {/* Duplicate Filter Active Indicator */}
      {showOnlyDuplicates && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 animate-fade-in">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          <p className="text-sm font-medium text-warning flex-1">
            Zeige nur Duplikate ({filteredInvoices.length} Rechnungen)
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowOnlyDuplicates(false)}
          >
            <X className="h-3 w-3 mr-1" />
            Filter aufheben
          </Button>
        </div>
      )}

      {/* Filters */}
      <div ref={contentRef} className="glass-card p-3 sm:p-4 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suchen nach Dateiname oder Aussteller..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:pb-0">
            <Button
              variant={filterType === "all" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType("all")}
              className="shrink-0"
            >
              Alle
            </Button>
            <Button
              variant={filterType === "outgoing" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType("outgoing")}
              className="shrink-0 gap-1"
            >
              <ArrowDownLeft className="h-3 w-3" />
              <span className="hidden sm:inline">Eingang (Ausgaben)</span>
              <span className="sm:hidden">Eingang</span>
            </Button>
            <Button
              variant={filterType === "incoming" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType("incoming")}
              className="shrink-0 gap-1"
            >
              <ArrowUpRight className="h-3 w-3" />
              <span className="hidden sm:inline">Ausgang (Einnahmen)</span>
              <span className="sm:hidden">Ausgang</span>
            </Button>
            {!isSelectMode && filteredInvoices.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectAll()}
                className="ml-2 shrink-0 gap-1"
              >
                <CheckSquare className="h-3 w-3" />
                Auswählen
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {viewMode === "timeline" ? (
        <YearMonthAccordion
          data={groupedInvoices}
          renderDocument={(invoice, index) => (
            <div
              key={invoice.id}
              className="relative"
              // Native Lazy-Render: Karten au\u00dferhalb des Viewports werden
              // nicht gepainted. Dropt Rendering-Last bei 500+ Rechnungen
              // drastisch, ohne externe Library.
              style={{ contentVisibility: "auto", containIntrinsicSize: "320px" }}
            >
              {isSelectMode && (
                <div className="absolute top-2 left-2 z-10">
                  <Checkbox
                    checked={selectedIds.has(invoice.id)}
                    onCheckedChange={() => toggleSelect(invoice.id)}
                    className="h-5 w-5 bg-background/80 backdrop-blur-sm"
                  />
                </div>
              )}
              <div
                className={cn(
                  isSelectMode && "cursor-pointer",
                  isSelectMode && selectedIds.has(invoice.id) && "ring-2 ring-primary rounded-xl"
                )}
                onClick={isSelectMode ? () => toggleSelect(invoice.id) : undefined}
              >
                <DocumentCard
                  document={invoice}
                  onSave={handleSave}
                  onDelete={!isSelectMode ? (id) => {
                    const inv = invoices.find(i => i.id === id);
                    if (inv) handleDelete(inv);
                  } : undefined}
                  duplicates={duplicateMap.get(invoice.id) || []}
                  onMerge={(keeperId, dupId) => mergeDuplicate.mutate({ keeperId, duplicateId: dupId })}
                  isMerging={mergeDuplicate.isPending}
                  index={index}
                />
              </div>
            </div>
          )}
          emptyMessage="Keine Rechnungen gefunden. Laden Sie Dokumente unter 'Upload' hoch."
        />
      ) : viewMode === "list" ? (
        <GroupedListView
          data={groupedInvoices}
          emptyMessage="Laden Sie Dokumente unter 'Upload' hoch."
          renderHeader={() => (
            <>
              {isSelectMode && (
                <th className="px-4 py-3 w-10">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={selectAll}
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Datum</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Aussteller</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Dateiname</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Typ</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Betrag</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Aktionen</th>
            </>
          )}
          renderRow={(invoice) => {
            const isExpense = invoice.type === "outgoing";
            const handleTypeToggle = (isOutgoing: boolean) => {
              const newType = isOutgoing ? "outgoing" : "incoming";
              updateInvoice.mutate({ ...invoice, type: newType as "incoming" | "outgoing" });
            };
            return (
              <tr 
                key={invoice.id} 
                className={cn(
                  "border-b border-border/50 transition-colors hover:bg-muted/30",
                  isSelectMode && selectedIds.has(invoice.id) && "bg-primary/5"
                )}
                onClick={isSelectMode ? () => toggleSelect(invoice.id) : undefined}
              >
                {isSelectMode && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(invoice.id)}
                      onCheckedChange={() => toggleSelect(invoice.id)}
                    />
                  </td>
                )}
                <td className="px-4 py-3 text-sm">
                  {format(new Date(invoice.date), "dd.MM.yyyy", { locale: de })}
                </td>
                <td className="px-4 py-3 text-sm font-medium">{invoice.issuer}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground max-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{invoice.fileName}</span>
                    {(duplicateMap.get(invoice.id)?.length ?? 0) > 0 && (
                      <DuplicateBadge
                        currentId={invoice.id}
                        currentDoc={{
                          id: invoice.id,
                          fileName: invoice.fileName,
                          date: invoice.date,
                          issuer: invoice.issuer,
                          amount: invoice.amount,
                          currency: invoice.currency,
                          status: invoice.status,
                          fileUrl: invoice.fileUrl,
                        }}
                        duplicates={duplicateMap.get(invoice.id) || []}
                        onMerge={(keeperId, dupId) => mergeDuplicate.mutate({ keeperId, duplicateId: dupId })}
                        isMerging={mergeDuplicate.isPending}
                        compact
                      />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-xs",
                      isExpense ? "text-foreground font-medium" : "text-muted-foreground"
                    )}>
                      Ein
                    </span>
                    <Switch
                      checked={invoice.type === "outgoing"}
                      onCheckedChange={handleTypeToggle}
                      className="data-[state=checked]:bg-success data-[state=unchecked]:bg-destructive/70 scale-75"
                    />
                    <span className={cn(
                      "text-xs",
                      !isExpense ? "text-success font-medium" : "text-muted-foreground"
                    )}>
                      Aus
                    </span>
                  </div>
                </td>
                <td className={cn(
                  "px-4 py-3 text-right text-sm font-semibold",
                  isExpense ? "text-foreground" : "text-success"
                )}>
                  {isExpense ? "-" : "+"}{formatAmount(invoice.amount)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); handleView(invoice.fileUrl); }}
                      disabled={!invoice.fileUrl}
                      title="Anzeigen"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {!isSelectMode && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); handleDelete(invoice); }}
                        className="text-destructive hover:text-destructive"
                        title="Löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredInvoices.map((invoice, index) => (
            <div key={invoice.id} className="relative">
              {isSelectMode && (
                <div className="absolute top-2 left-2 z-10">
                  <Checkbox
                    checked={selectedIds.has(invoice.id)}
                    onCheckedChange={() => toggleSelect(invoice.id)}
                    className="h-5 w-5 bg-background/80 backdrop-blur-sm"
                  />
                </div>
              )}
              <div
                className={cn(
                  isSelectMode && "cursor-pointer",
                  isSelectMode && selectedIds.has(invoice.id) && "ring-2 ring-primary rounded-xl"
                )}
                onClick={isSelectMode ? () => toggleSelect(invoice.id) : undefined}
              >
                <DocumentCard
                  document={invoice}
                  onSave={handleSave}
                  onDelete={!isSelectMode ? (id) => {
                    const inv = invoices.find(i => i.id === id);
                    if (inv) handleDelete(inv);
                  } : undefined}
                  duplicates={duplicateMap.get(invoice.id) || []}
                  onMerge={(keeperId, dupId) => mergeDuplicate.mutate({ keeperId, duplicateId: dupId })}
                  isMerging={mergeDuplicate.isPending}
                  index={index}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title="Rechnung löschen"
        description={invoiceToDelete ? `Möchten Sie die Rechnung "${invoiceToDelete.fileName}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.` : ""}
        isDeleting={deleteInvoice.isPending}
      />

      <DeleteConfirmationDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        onConfirm={confirmBulkDelete}
        title={`${selectedIds.size} Rechnungen löschen`}
        description={`Möchten Sie wirklich ${selectedIds.size} Rechnungen löschen? Diese Aktion kann nicht rückgängig gemacht werden.`}
        isDeleting={bulkDelete.isPending}
      />

      <DeleteConfirmationDialog
        open={bulkDedupDialogOpen}
        onOpenChange={setBulkDedupDialogOpen}
        onConfirm={handleBulkDedup}
        title="Alle Duplikate entfernen"
        description={`Sicher? Entfernt ${bulkDedupPlan.deleteCount} Duplikat${bulkDedupPlan.deleteCount === 1 ? "" : "e"} aus ${bulkDedupPlan.groupCount} Gruppe${bulkDedupPlan.groupCount === 1 ? "" : "n"} und behält jeweils das älteste Dokument (bestätigte Rechnungen haben Vorrang). Verknüpfte Transaktionen werden auf den Keeper übertragen.`}
        isDeleting={isBulkDeduping}
      />
    </div>
  );
}
