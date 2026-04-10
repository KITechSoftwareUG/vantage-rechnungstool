import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { StatementData, ExtractedTransaction } from "@/types/documents";
import { useToast } from "@/hooks/use-toast";
import { resolveStorageUrl } from "@/lib/resolveStorageUrl";

export function useBankStatements() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bank_statements", user?.id],
    queryFn: async (): Promise<StatementData[]> => {
      if (!user) return [];
      
      const { data, error } = await supabase
        .from("bank_statements")
        .select("*")
        .order("date", { ascending: false });

      if (error) throw error;

      const statements = await Promise.all(
        (data || []).map(async (stmt) => {
          const fileUrl = await resolveStorageUrl(
            user.id, stmt.year, stmt.month, stmt.file_name, stmt.file_url
          );
          return {
            id: stmt.id,
            fileName: stmt.file_name,
            fileUrl,
            bank: stmt.bank,
            bankType: stmt.bank_type as "volksbank" | "amex",
            accountNumber: stmt.account_number,
            date: stmt.date,
            year: stmt.year,
            month: stmt.month,
            openingBalance: Number(stmt.opening_balance),
            closingBalance: Number(stmt.closing_balance),
            status: stmt.status as "processing" | "ready" | "saved",
            createdAt: stmt.created_at,
          } as StatementData;
        })
      );

      return statements;
    },
    enabled: !!user,
  });
}

export function useCreateBankStatement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (statement: Omit<StatementData, "id" | "createdAt">) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("bank_statements")
        .insert({
          user_id: user.id,
          file_name: statement.fileName,
          file_url: statement.fileUrl,
          bank: statement.bank,
          bank_type: statement.bankType,
          account_number: statement.accountNumber,
          date: statement.date,
          year: statement.year,
          month: statement.month,
          opening_balance: statement.openingBalance,
          closing_balance: statement.closingBalance,
          status: statement.status,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_statements"] });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateBankStatement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (statement: StatementData) => {
      const { data, error } = await supabase
        .from("bank_statements")
        .update({
          file_name: statement.fileName,
          bank: statement.bank,
          bank_type: statement.bankType,
          account_number: statement.accountNumber,
          date: statement.date,
          year: statement.year,
          month: statement.month,
          opening_balance: statement.openingBalance,
          closing_balance: statement.closingBalance,
          status: statement.status,
        })
        .eq("id", statement.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_statements"] });
      toast({ title: "Kontoauszug aktualisiert" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Aktualisieren",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteBankStatement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("bank_transactions").delete().eq("bank_statement_id", id);
      const { error } = await supabase.from("bank_statements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_statements"] });
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transaction_counts"] });
      toast({ title: "Kontoauszug gelöscht" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Löschen",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export async function checkDuplicateTransactions(
  userId: string,
  transactions: ExtractedTransaction[],
  bankStatementId?: string
): Promise<{ duplicates: ExtractedTransaction[]; newTransactions: ExtractedTransaction[] }> {
  const { data: existingTransactions, error } = await supabase
    .from("bank_transactions")
    .select("date, description, amount, transaction_type")
    .eq("user_id", userId);

  if (error) throw error;

  const duplicates: ExtractedTransaction[] = [];
  const newTransactions: ExtractedTransaction[] = [];

  for (const tx of transactions) {
    const isDuplicate = (existingTransactions || []).some(
      (existing) =>
        existing.date === tx.date &&
        existing.description === tx.description &&
        Math.abs(Number(existing.amount) - tx.amount) < 0.01 &&
        existing.transaction_type === tx.type
    );

    if (isDuplicate) {
      duplicates.push(tx);
    } else {
      newTransactions.push(tx);
    }
  }

  return { duplicates, newTransactions };
}

export async function createBankTransactions(
  userId: string,
  bankStatementId: string,
  transactions: ExtractedTransaction[]
): Promise<number> {
  if (transactions.length === 0) return 0;

  const transactionsToInsert = transactions.map((tx) => ({
    user_id: userId,
    bank_statement_id: bankStatementId,
    date: tx.date,
    description: tx.description,
    amount: tx.amount,
    transaction_type: tx.type,
    match_status: "unmatched",
    original_currency: tx.originalCurrency || null,
  }));

  const { error } = await supabase
    .from("bank_transactions")
    .insert(transactionsToInsert);

  if (error) throw error;

  return transactions.length;
}
