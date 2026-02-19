import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { checkDuplicateTransactions, createBankTransactions } from "@/hooks/useBankStatements";
import { StatementData } from "@/types/documents";

export function useReprocessStatement() {
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleReprocess = async (statement: StatementData) => {
    if (!user || !statement.fileUrl) return;

    setReprocessingId(statement.id);

    try {
      const response = await fetch(statement.fileUrl);
      const blob = await response.blob();
      const file = new File([blob], statement.fileName, { type: blob.type });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "statement");

      const { data, error } = await supabase.functions.invoke("process-document", {
        body: formData,
      });

      if (error) throw error;

      const transactions = data.data?.transactions || [];

      if (transactions.length === 0) {
        toast({
          title: "Keine Transaktionen gefunden",
          description: "Die OCR-Erkennung konnte keine Transaktionen im Dokument finden.",
          variant: "destructive",
        });
        return;
      }

      const { newTransactions, duplicates } = await checkDuplicateTransactions(user.id, transactions);

      if (newTransactions.length === 0) {
        toast({
          title: "Alle Transaktionen existieren bereits",
          description: `${duplicates.length} Duplikate übersprungen`,
        });
        return;
      }

      const savedCount = await createBankTransactions(user.id, statement.id, newTransactions);

      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transaction_counts"] });

      let description = `${savedCount} Transaktionen extrahiert und gespeichert`;
      if (duplicates.length > 0) {
        description += `, ${duplicates.length} Duplikate übersprungen`;
      }

      toast({ title: "Transaktionen extrahiert", description });
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

  return { reprocessingId, handleReprocess };
}
