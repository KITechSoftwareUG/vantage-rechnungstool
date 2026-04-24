import { useState } from "react";
import { Grid3X3, FolderTree, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatementCard } from "@/components/documents/StatementCard";
import { YearAccordion } from "@/components/documents/YearAccordion";
import { groupByYear } from "@/types/documents";
import { useBankStatements, useUpdateBankStatement, useDeleteBankStatement } from "@/hooks/useDocuments";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useReprocessStatement } from "@/hooks/useReprocessStatement";

type ViewMode = "grid" | "timeline";

export default function StatementsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [searchQuery, setSearchQuery] = useState("");
  const { user } = useAuth();

  const { data: statements = [], isLoading } = useBankStatements();
  const updateStatement = useUpdateBankStatement();
  const deleteStatement = useDeleteBankStatement();
  const { reprocessingId, handleReprocess } = useReprocessStatement();

  const { data: transactionCounts = {} } = useQuery({
    queryKey: ["transaction_counts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_transactions")
        .select("bank_statement_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((t) => {
        if (t.bank_statement_id) {
          counts[t.bank_statement_id] = (counts[t.bank_statement_id] || 0) + 1;
        }
      });
      return counts;
    },
    enabled: !!user,
  });

  const trimmedQuery = searchQuery.trim();
  const { data: transactionMatchIds = new Set<string>() } = useQuery({
    queryKey: ["bank_transactions_search", user?.id, trimmedQuery],
    queryFn: async (): Promise<Set<string>> => {
      if (!trimmedQuery) return new Set();

      const ors: string[] = [`description.ilike.%${trimmedQuery}%`];
      const numeric = parseFloat(trimmedQuery.replace(",", "."));
      if (!isNaN(numeric)) {
        ors.push(`amount.eq.${numeric}`);
        ors.push(`amount.eq.${-numeric}`);
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedQuery)) {
        ors.push(`date.eq.${trimmedQuery}`);
      }

      const { data, error } = await supabase
        .from("bank_transactions")
        .select("bank_statement_id")
        .or(ors.join(","));
      if (error) throw error;
      return new Set(
        (data || [])
          .map((t: any) => t.bank_statement_id)
          .filter((id): id is string => !!id)
      );
    },
    enabled: !!user && !!trimmedQuery,
  });

  const q = trimmedQuery.toLowerCase();
  const filteredStatements = statements.filter(stmt => {
    if (!trimmedQuery) return true;
    return (
      stmt.fileName.toLowerCase().includes(q) ||
      stmt.bank.toLowerCase().includes(q) ||
      stmt.accountNumber.toLowerCase().includes(q) ||
      transactionMatchIds.has(stmt.id)
    );
  });

  const groupedStatements = groupByYear(filteredStatements);

  const handleSave = (data: typeof statements[0]) => {
    updateStatement.mutate(data);
  };

  const handleDelete = (id: string) => {
    deleteStatement.mutate(id);
  };

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
            Kontoauszüge
          </h1>
          <p className="mt-1 text-sm sm:text-base text-muted-foreground">
            {filteredStatements.length} Kontoauszüge gefunden
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "timeline" ? "default" : "ghost"}
            size="icon"
            onClick={() => setViewMode("timeline")}
            title="Nach Jahr"
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

      {/* Search */}
      <div className="glass-card p-3 sm:p-4 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Suchen nach Bank, Konto, Datei..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Content */}
      {viewMode === "timeline" ? (
        <YearAccordion
          data={groupedStatements}
          renderDocument={(statement, index) => (
            <StatementCard
              key={statement.id}
              statement={statement}
              onSave={handleSave}
              onDelete={handleDelete}
              onReprocess={handleReprocess}
              isReprocessing={reprocessingId === statement.id}
              transactionCount={transactionCounts[statement.id] || 0}
              index={index}
              transactionSearch={
                trimmedQuery && transactionMatchIds.has(statement.id) ? trimmedQuery : undefined
              }
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
              onDelete={handleDelete}
              onReprocess={handleReprocess}
              isReprocessing={reprocessingId === statement.id}
              transactionCount={transactionCounts[statement.id] || 0}
              index={index}
              transactionSearch={
                trimmedQuery && transactionMatchIds.has(statement.id) ? trimmedQuery : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
