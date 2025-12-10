import { useState } from "react";
import { Grid3X3, FolderTree, Search, ArrowDownLeft, ArrowUpRight, Loader2, List, Eye, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DocumentCard } from "@/components/documents/DocumentCard";
import { YearMonthAccordion } from "@/components/documents/YearMonthAccordion";
import { GroupedListView } from "@/components/documents/GroupedListView";
import { groupByYearAndMonth, InvoiceData } from "@/types/documents";
import { useInvoices, useUpdateInvoice, useDeleteInvoice } from "@/hooks/useDocuments";
import { cn } from "@/lib/utils";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";

type ViewMode = "grid" | "timeline" | "list";

export default function InvoicesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "incoming" | "outgoing">("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<InvoiceData | null>(null);

  const { data: invoices = [], isLoading } = useInvoices();
  const updateInvoice = useUpdateInvoice();
  const deleteInvoice = useDeleteInvoice();

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = inv.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          inv.issuer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === "all" || inv.type === filterType;
    return matchesSearch && matchesType;
  });

  const groupedInvoices = groupByYearAndMonth(filteredInvoices);

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

  const handleView = (fileUrl: string | undefined) => {
    if (!fileUrl) return;
    // fileUrl is already a full URL, open directly
    window.open(fileUrl, "_blank");
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    }).format(amount);
  };

  // Eingang = ich erhalte eine Rechnung und bezahle (Ausgabe)
  // Ausgang = ich stelle eine Rechnung und erhalte Geld (Einnahme)
  const totalIncoming = filteredInvoices
    .filter(inv => inv.type === "outgoing")
    .reduce((sum, inv) => sum + inv.amount, 0);
  const totalOutgoing = filteredInvoices
    .filter(inv => inv.type === "incoming")
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

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
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
              variant={filterType === "incoming" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType("incoming")}
              className="gap-1"
            >
              <ArrowDownLeft className="h-3 w-3" />
              Eingang (Ausgaben)
            </Button>
            <Button
              variant={filterType === "outgoing" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType("outgoing")}
              className="gap-1"
            >
              <ArrowUpRight className="h-3 w-3" />
              Ausgang (Einnahmen)
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      {viewMode === "timeline" ? (
        <YearMonthAccordion
          data={groupedInvoices}
          renderDocument={(invoice, index) => (
            <DocumentCard
              key={invoice.id}
              document={invoice}
              onSave={handleSave}
              onDelete={(id) => {
                const inv = invoices.find(i => i.id === id);
                if (inv) handleDelete(inv);
              }}
              index={index}
            />
          )}
          emptyMessage="Keine Rechnungen gefunden. Laden Sie Dokumente unter 'Upload' hoch."
        />
      ) : viewMode === "list" ? (
        <GroupedListView
          data={groupedInvoices}
          emptyMessage="Laden Sie Dokumente unter 'Upload' hoch."
          renderHeader={() => (
            <>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Datum</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Aussteller</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Dateiname</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Typ</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Betrag</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Aktionen</th>
            </>
          )}
          renderRow={(invoice) => {
            const isExpense = invoice.type === "incoming";
            return (
              <tr 
                key={invoice.id} 
                className="border-b border-border/50 transition-colors hover:bg-muted/30"
              >
                <td className="px-4 py-3 text-sm">
                  {format(new Date(invoice.date), "dd.MM.yyyy", { locale: de })}
                </td>
                <td className="px-4 py-3 text-sm font-medium">{invoice.issuer}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground max-w-[200px] truncate">
                  {invoice.fileName}
                </td>
                <td className="px-4 py-3">
                  <Badge 
                    variant={isExpense ? "secondary" : "default"}
                    className="text-xs"
                  >
                    {isExpense ? "Eingang" : "Ausgang"}
                  </Badge>
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
                      onClick={() => handleView(invoice.fileUrl)}
                      disabled={!invoice.fileUrl}
                      title="Anzeigen"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(invoice)}
                      className="text-destructive hover:text-destructive"
                      title="Löschen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredInvoices.map((invoice, index) => (
            <DocumentCard
              key={invoice.id}
              document={invoice}
              onSave={handleSave}
              onDelete={(id) => {
                const inv = invoices.find(i => i.id === id);
                if (inv) handleDelete(inv);
              }}
              index={index}
            />
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
    </div>
  );
}