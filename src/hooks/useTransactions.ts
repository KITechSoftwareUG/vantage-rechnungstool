import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  transactionType: "credit" | "debit";
  matchStatus: "unmatched" | "matched" | "confirmed";
  matchedInvoiceId: string | null;
  matchConfidence: number | null;
  bankStatementId: string | null;
  bankStatementFileName?: string;
  createdAt: string;
}

export function useTransactions(bankStatementId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bank_transactions", user?.id, bankStatementId],
    queryFn: async (): Promise<BankTransaction[]> => {
      if (!user) return [];

      let query = supabase
        .from("bank_transactions")
        .select(`
          *,
          bank_statements (file_name)
        `)
        .order("date", { ascending: false });

      if (bankStatementId) {
        query = query.eq("bank_statement_id", bankStatementId);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((tx) => ({
        id: tx.id,
        date: tx.date,
        description: tx.description,
        amount: Number(tx.amount),
        transactionType: tx.transaction_type as "credit" | "debit",
        matchStatus: tx.match_status as "unmatched" | "matched" | "confirmed",
        matchedInvoiceId: tx.matched_invoice_id,
        matchConfidence: tx.match_confidence,
        bankStatementId: tx.bank_statement_id,
        bankStatementFileName: tx.bank_statements?.file_name,
        createdAt: tx.created_at,
      }));
    },
    enabled: !!user,
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (transaction: {
      date: string;
      description: string;
      amount: number;
      transactionType: "credit" | "debit";
      bankStatementId?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("bank_transactions")
        .insert({
          user_id: user.id,
          date: transaction.date,
          description: transaction.description,
          amount: transaction.amount,
          transaction_type: transaction.transactionType,
          bank_statement_id: transaction.bankStatementId || null,
          match_status: "unmatched",
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transaction_counts"] });
      toast({ title: "Transaktion hinzugefügt" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Hinzufügen",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bank_transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transaction_counts"] });
      toast({ title: "Transaktion gelöscht" });
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

export function useBulkCreateTransactions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (transactions: {
      date: string;
      description: string;
      amount: number;
      transactionType: "credit" | "debit";
      bankStatementId?: string;
    }[]) => {
      if (!user) throw new Error("Not authenticated");
      if (transactions.length === 0) return 0;

      const toInsert = transactions.map((tx) => ({
        user_id: user.id,
        date: tx.date,
        description: tx.description,
        amount: tx.amount,
        transaction_type: tx.transactionType,
        bank_statement_id: tx.bankStatementId || null,
        match_status: "unmatched",
      }));

      const { error } = await supabase
        .from("bank_transactions")
        .insert(toInsert);

      if (error) throw error;
      return transactions.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transaction_counts"] });
      if (count > 0) {
        toast({ title: `${count} Transaktionen hinzugefügt` });
      }
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Hinzufügen",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
