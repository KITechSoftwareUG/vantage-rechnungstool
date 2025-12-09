import { useState } from "react";
import { Grid3X3, FolderTree, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatementCard } from "@/components/documents/StatementCard";
import { YearMonthAccordion } from "@/components/documents/YearMonthAccordion";
import { groupByYearAndMonth, StatementData } from "@/types/documents";
import { useBankStatements, useUpdateBankStatement, createBankTransactions, checkDuplicateTransactions } from "@/hooks/useDocuments";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type ViewMode = "grid" | "timeline";

export default function StatementsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [searchQuery, setSearchQuery] = useState("");
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: statements = [], isLoading } = useBankStatements();
  const updateStatement = useUpdateBankStatement();

  // Fetch transaction counts for each statement
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

  const filteredStatements = statements.filter(stmt =>
    stmt.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    stmt.bank.toLowerCase().includes(searchQuery.toLowerCase()) ||
    stmt.accountNumber.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedStatements = groupByYearAndMonth(filteredStatements);

  const handleSave = (data: typeof statements[0]) => {
    updateStatement.mutate(data);
  };

  const handleReprocess = async (statement: StatementData) => {
    if (!user || !statement.fileUrl) return;
    
    setReprocessingId(statement.id);
    
    try {
      // Fetch the file from storage
      const response = await fetch(statement.fileUrl);
      const blob = await response.blob();
      const file = new File([blob], statement.fileName, { type: blob.type });
      
      // Process with OCR
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "statement");

      const { data, error } = await supabase.functions.invoke("process-document", {
        body: formData,
      });

      if (error) throw error;

      // Extract transactions
      const transactions = data.data?.transactions || [];
      
      if (transactions.length === 0) {
        toast({
          title: "Keine Transaktionen gefunden",
          description: "Die OCR-Erkennung konnte keine Transaktionen im Dokument finden.",
          variant: "destructive",
        });
        return;
      }

      // Check for duplicates
      const { newTransactions, duplicates } = await checkDuplicateTransactions(user.id, transactions);
      
      if (newTransactions.length === 0) {
        toast({
          title: "Alle Transaktionen existieren bereits",
          description: `${duplicates.length} Duplikate übersprungen`,
        });
        return;
      }

      // Save new transactions
      const savedCount = await createBankTransactions(user.id, statement.id, newTransactions);
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transaction_counts"] });
      
      let description = `${savedCount} Transaktionen extrahiert und gespeichert`;
      if (duplicates.length > 0) {
        description += `, ${duplicates.length} Duplikate übersprungen`;
      }
      
      toast({
        title: "Transaktionen extrahiert",
        description,
      });
    } catch (error: any) {
      console.error("Reprocess error:", error);
      toast({
        title: "Fehler beim Verarbeiten",
        description: error.message || "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setReprocessingId(null);
    }
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
              onReprocess={handleReprocess}
              isReprocessing={reprocessingId === statement.id}
              transactionCount={transactionCounts[statement.id] || 0}
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
              onReprocess={handleReprocess}
              isReprocessing={reprocessingId === statement.id}
              transactionCount={transactionCounts[statement.id] || 0}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
}
