import { useState } from "react";
import { Grid3X3, List, Search, Filter, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentCard, InvoiceData } from "@/components/documents/DocumentCard";
import { DocumentsTable } from "@/components/documents/DocumentsTable";
import { cn } from "@/lib/utils";

// Mock data
const mockInvoices: InvoiceData[] = [
  {
    id: "1",
    fileName: "Rechnung_2024_001.pdf",
    date: "2024-01-15",
    issuer: "ABC Software GmbH",
    amount: 1250.00,
    type: "incoming",
    status: "saved",
  },
  {
    id: "2",
    fileName: "Stromrechnung_Jan.pdf",
    date: "2024-01-14",
    issuer: "Stadtwerke München",
    amount: 189.50,
    type: "outgoing",
    status: "saved",
  },
  {
    id: "3",
    fileName: "Kundenrechnung_XYZ.pdf",
    date: "2024-01-12",
    issuer: "XYZ Industries",
    amount: 3400.00,
    type: "incoming",
    status: "saved",
  },
  {
    id: "4",
    fileName: "Büromaterial.pdf",
    date: "2024-01-10",
    issuer: "Office Depot",
    amount: 245.80,
    type: "outgoing",
    status: "saved",
  },
  {
    id: "5",
    fileName: "Beratungshonorar.pdf",
    date: "2024-01-08",
    issuer: "Consulting Pro AG",
    amount: 5600.00,
    type: "incoming",
    status: "saved",
  },
  {
    id: "6",
    fileName: "Telefonrechnung.pdf",
    date: "2024-01-05",
    issuer: "Telekom",
    amount: 89.99,
    type: "outgoing",
    status: "saved",
  },
];

export default function InvoicesPage() {
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "incoming" | "outgoing">("all");
  const [invoices, setInvoices] = useState(mockInvoices);

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = inv.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          inv.issuer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === "all" || inv.type === filterType;
    return matchesSearch && matchesType;
  });

  const handleSave = (data: InvoiceData) => {
    setInvoices(prev => prev.map(inv => inv.id === data.id ? data : inv));
  };

  const handleDelete = (id: string) => {
    setInvoices(prev => prev.filter(inv => inv.id !== id));
  };

  // Calculate totals
  const totalIncoming = filteredInvoices
    .filter(inv => inv.type === "incoming")
    .reduce((sum, inv) => sum + inv.amount, 0);
  const totalOutgoing = filteredInvoices
    .filter(inv => inv.type === "outgoing")
    .reduce((sum, inv) => sum + inv.amount, 0);

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
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="icon"
            onClick={() => setViewMode("grid")}
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "ghost"}
            size="icon"
            onClick={() => setViewMode("table")}
          >
            <List className="h-4 w-4" />
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
      {viewMode === "grid" ? (
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
      ) : (
        <DocumentsTable
          documents={filteredInvoices}
          onDelete={handleDelete}
        />
      )}

      {filteredInvoices.length === 0 && (
        <div className="glass-card flex flex-col items-center justify-center p-12 text-center">
          <Filter className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 font-heading text-lg font-semibold text-foreground">
            Keine Rechnungen gefunden
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Passen Sie Ihre Suchkriterien an oder laden Sie neue Dokumente hoch
          </p>
        </div>
      )}
    </div>
  );
}
