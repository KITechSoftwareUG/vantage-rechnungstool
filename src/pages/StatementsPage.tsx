import { useState } from "react";
import { Grid3X3, FolderTree, Search, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatementCard } from "@/components/documents/StatementCard";
import { YearMonthAccordion } from "@/components/documents/YearMonthAccordion";
import { groupByYearAndMonth } from "@/types/documents";
import { useBankStatements, useUpdateBankStatement } from "@/hooks/useDocuments";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "timeline";

export default function StatementsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: statements = [], isLoading } = useBankStatements();
  const updateStatement = useUpdateBankStatement();

  const filteredStatements = statements.filter(stmt =>
    stmt.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    stmt.bank.toLowerCase().includes(searchQuery.toLowerCase()) ||
    stmt.accountNumber.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedStatements = groupByYearAndMonth(filteredStatements);

  const handleSave = (data: typeof statements[0]) => {
    updateStatement.mutate(data);
  };

  // Calculate totals
  const totalClosingBalance = filteredStatements.reduce((sum, stmt) => sum + stmt.closingBalance, 0);
  const totalChange = filteredStatements.reduce((sum, stmt) => sum + (stmt.closingBalance - stmt.openingBalance), 0);

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
            Kontoauszüge
          </h1>
          <p className="mt-1 text-muted-foreground">
            {filteredStatements.length} Kontoauszüge gefunden
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
      <div className="grid gap-4 sm:grid-cols-2 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="glass-card p-4">
          <p className="text-sm text-muted-foreground">Gesamtsaldo aller Konten</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {totalClosingBalance.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">Gesamtveränderung</p>
            {totalChange >= 0 ? (
              <TrendingUp className="h-4 w-4 text-success" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
          </div>
          <p className={cn(
            "mt-1 text-2xl font-bold",
            totalChange >= 0 ? "text-success" : "text-destructive"
          )}>
            {totalChange >= 0 ? "+" : ""}
            {totalChange.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="glass-card p-4 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Suchen nach Bank, Kontonummer oder Dateiname..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Content */}
      {viewMode === "timeline" ? (
        <YearMonthAccordion
          data={groupedStatements}
          renderDocument={(statement, index) => (
            <StatementCard
              key={statement.id}
              statement={statement}
              onSave={handleSave}
              index={index}
            />
          )}
          emptyMessage="Keine Kontoauszüge gefunden. Laden Sie Dokumente unter 'Upload' hoch."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStatements.map((statement, index) => (
            <StatementCard
              key={statement.id}
              statement={statement}
              onSave={handleSave}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
}
