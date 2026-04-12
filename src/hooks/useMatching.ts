import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BankTransaction, BankType } from "@/types/matching";

// Fetch all bank transactions (no filtering)
export function useBankTransactions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bank_transactions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_transactions")
        .select(`
          *,
          bank_statements(bank, bank_type),
          invoices(id, issuer, amount, date, file_name, file_url)
        `)
        .order("date", { ascending: false });

      if (error) throw error;

      return data.map((t: any) => ({
        id: t.id,
        userId: t.user_id,
        bankStatementId: t.bank_statement_id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        transactionType: t.transaction_type,
        matchedInvoiceId: t.matched_invoice_id,
        matchConfidence: t.match_confidence,
        matchReason: t.match_reason ?? null,
        matchStatus: t.match_status,
        bankName: t.bank_statements?.bank,
        bankType: t.bank_statements?.bank_type,
        matchedInvoice: t.invoices,
      }));
    },
    enabled: !!user,
  });
}

// Update transaction match
export function useUpdateTransactionMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      transactionId,
      invoiceId,
      matchStatus,
      matchConfidence,
    }: {
      transactionId: string;
      invoiceId: string | null;
      matchStatus: "unmatched" | "matched" | "confirmed" | "no_match" | "recurring";
      matchConfidence?: number;
    }) => {
      const { data, error } = await supabase
        .from("bank_transactions")
        .update({
          matched_invoice_id: invoiceId,
          match_status: matchStatus,
          match_confidence: matchConfidence ?? null,
        })
        .eq("id", transactionId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched_invoices"] });
    },
  });
}

// Create bank transaction
export function useCreateBankTransaction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (transaction: Omit<BankTransaction, "id" | "userId" | "createdAt" | "updatedAt">) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("bank_transactions")
        .insert({
          user_id: user.id,
          bank_statement_id: transaction.bankStatementId,
          date: transaction.date,
          description: transaction.description,
          amount: transaction.amount,
          transaction_type: transaction.transactionType,
          matched_invoice_id: transaction.matchedInvoiceId,
          match_confidence: transaction.matchConfidence,
          match_status: transaction.matchStatus,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
    },
  });
}

// Fetch unmatched invoices for matching dropdown
export function useUnmatchedInvoices() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["unmatched_invoices", user?.id],
    queryFn: async () => {
      // Get all invoices that are already matched or confirmed to any transaction
      const { data: matchedIds } = await supabase
        .from("bank_transactions")
        .select("matched_invoice_id")
        .in("match_status", ["confirmed", "matched"])
        .not("matched_invoice_id", "is", null);

      const matchedInvoiceIds = matchedIds?.map((t) => t.matched_invoice_id).filter(Boolean) || [];

      let query = supabase.from("invoices").select("*").order("date", { ascending: false });

      if (matchedInvoiceIds.length > 0) {
        query = query.not("id", "in", `(${matchedInvoiceIds.join(",")})`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}
