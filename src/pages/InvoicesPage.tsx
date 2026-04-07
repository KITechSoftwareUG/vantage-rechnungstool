import { useState, useMemo, useRef } from "react";
import { Grid3X3, FolderTree, Search, ArrowDownLeft, ArrowUpRight, Loader2, List, Eye, Trash2, CheckSquare, Square, XSquare, Copy, AlertTriangle, X } from "lucide-react";
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
  const contentRef = useRef<HTMLDivElement>(null);

  const { data: invoices = [], isLoading } = useInvoices();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();
  const bulkDelete = useBulkDeleteInvoices();
  const mergeDuplicate = useMergeDuplicate();

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
    })),
    [invoices]
  );
  const duplicateMap = useDuplicateDetection(duplicateCandidates);
  const duplicateCount = useMemo(() => {
    const seen = new Set<string>();
    for (const [id] of duplicateMap) seen.add(id);
    return seen.size;
  }, [duplicateMap]);

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fade-in">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Rechnungen
          </h1>
          <p className="mt-1 text-muted-foreground">
            {filteredInvoices.length} Rechnungen gefunden
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2">
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
        <div className="glass-card flex items-center justify-between p-3 animate-fade-in border-primary/30 border">
          <div className="flex items-center gap-3">
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
      <div className="grid gap-4 sm:grid-cols-4 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="glass-card p-4">
          <p className="text-sm text-muted-foreground">Gesamt Einnahmen (Ausgang)</p>
          <p className="mt-1 text-2xl font-bold text-success">
            +{totalIncoming.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-sm text-muted-foreground">Gesamt Ausgaben (Eingang)</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            -{totalOutgoing.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-sm text-muted-foreground">Bilanz</p>
          <p className={cn(
            "mt-1 text-2xl font-bold",
            totalIncoming - totalOutgoing >= 0 ? "text-success" : "text-destructive"
          )}>
            {totalIncoming - totalOutgoing >= 0 ? "+" : ""}
            {(totalIncoming - totalOutgoing).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className={cn("glass-card p-4", duplicateCount > 0 && "border-warning/30 border")}>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Copy className="h-3.5 w-3.5" />
            Mögliche Duplikate
          </p>
          <p className={cn("mt-1 text-2xl font-bold", duplicateCount > 0 ? "text-warning" : "text-muted-foreground")}>
            {duplicateCount}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suchen nach Dateiname oder Aussteller..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={filterType === "all" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType("all")}
            >
              Alle
            </Button>
            <Button
              variant={filterType === "outgoing" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType("outgoing")}
              className="gap-1"
            >
              <ArrowDownLeft className="h-3 w-3" />
              Eingang (Ausgaben)
            </Button>
            <Button
              variant={filterType === "incoming" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType("incoming")}
              className="gap-1"
            >
              <ArrowUpRight className="h-3 w-3" />
              Ausgang (Einnahmen)
            </Button>
            {!isSelectMode && filteredInvoices.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectAll()}
                className="ml-2 gap-1"
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
    </div>
  );
}
