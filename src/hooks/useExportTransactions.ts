import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface ExportTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  transactionType: "debit" | "credit";
  matchedInvoice: {
    id: string;
    fileName: string;
    fileUrl: string | null;
    issuer: string;
    amount: number;
    date: string;
    type: "incoming" | "outgoing";
    paymentMethod: "bank" | "cash";
  } | null;
  bankStatement: {
    bank: string;
    bankType: string;
  } | null;
  isCashPayment: boolean;
}

export function useExportTransactions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["export-transactions", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("bank_transactions")
        .select(`
          id,
          date,
          description,
          amount,
          transaction_type,
          matched_invoice_id,
          bank_statement_id,
          invoices!bank_transactions_matched_invoice_id_fkey (
            id,
            file_name,
            file_url,
            issuer,
            amount,
            date,
            type,
            payment_method
          ),
          bank_statements!bank_transactions_bank_statement_id_fkey (
            bank,
            bank_type
          )
        `)
        .eq("user_id", user.id)
        .eq("match_status", "confirmed")
        .not("matched_invoice_id", "is", null)
        .order("date", { ascending: false });

      if (error) throw error;

      return (data || []).map((t: any) => ({
        id: t.id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        transactionType: t.transaction_type as "debit" | "credit",
        matchedInvoice: t.invoices ? {
          id: t.invoices.id,
          fileName: t.invoices.file_name,
          fileUrl: t.invoices.file_url,
          issuer: t.invoices.issuer,
          amount: t.invoices.amount,
          date: t.invoices.date,
          type: t.invoices.type as "incoming" | "outgoing",
          paymentMethod: (t.invoices.payment_method || "bank") as "bank" | "cash",
        } : null,
        bankStatement: t.bank_statements ? {
          bank: t.bank_statements.bank,
          bankType: t.bank_statements.bank_type,
        } : null,
        isCashPayment: !t.bank_statement_id,
      })) as ExportTransaction[];
    },
    enabled: !!user?.id,
  });
}
