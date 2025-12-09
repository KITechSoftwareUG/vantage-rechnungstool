import { useState } from "react";
import { Grid3X3, FolderTree, Search, ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentCard } from "@/components/documents/DocumentCard";
import { YearMonthAccordion } from "@/components/documents/YearMonthAccordion";
import { groupByYearAndMonth } from "@/types/documents";
import { useInvoices, useUpdateInvoice, useDeleteInvoice } from "@/hooks/useDocuments";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "timeline";

export default function InvoicesPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "incoming" | "outgoing">("all");

  const { data: invoices = [], isLoading } = useInvoices();
  const updateInvoice = useUpdateInvoice();

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

  // Calculate totals
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
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="glass-card p-4">
          <p className="text-sm text-muted-foreground">Gesamt Einnahmen</p>
          <p className="mt-1 text-2xl font-bold text-success">
            +{totalIncoming.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="text-sm text-muted-foreground">Gesamt Ausgaben</p>
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
              Eingang
            </Button>
            <Button
              variant={filterType === "outgoing" ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilterType("outgoing")}
              className="gap-1"
            >
              <ArrowUpRight className="h-3 w-3" />
              Ausgang
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
              index={index}
            />
          )}
          emptyMessage="Keine Rechnungen gefunden. Laden Sie Dokumente unter 'Upload' hoch."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredInvoices.map((invoice, index) => (
            <DocumentCard
              key={invoice.id}
              document={invoice}
              onSave={handleSave}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
}
