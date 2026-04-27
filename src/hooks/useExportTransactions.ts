import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Single-User-Setup: RLS ist "authenticated sees all", deshalb KEIN
// user_id-Filter mehr. Wenn der eingeloggte Account ein anderer ist als
// der, der die Matches angelegt hat (Dev-Account vs. Owner-Account),
// wuerde ein user_id-Filter false-negativen leeren Export liefern. Login
// reicht aus, um alle confirmed Matches zu sehen.

export interface ExportTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  transactionType: "debit" | "credit";
  matchedInvoice: {
    id: string;
    // user_id des Invoice-Owners — wir brauchen das fuer den Storage-Pfad
    // {userId}/{year}/{month}/{fileName}, weil im Single-User-Setup die
    // Daten unter Alex' UUID liegen, der eingeloggte Dev-Account aber
    // eine andere UUID hat.
    userId: string;
    fileName: string;
    fileUrl: string | null;
    issuer: string;
    amount: number;
    date: string;
    type: "incoming" | "outgoing";
    paymentMethod: "bank" | "cash";
    invoiceNumber: string | null;
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
            user_id,
            file_name,
            file_url,
            issuer,
            amount,
            date,
            type,
            payment_method,
            invoice_number
          ),
          bank_statements!bank_transactions_bank_statement_id_fkey (
            bank,
            bank_type
          )
        `)
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
          userId: t.invoices.user_id,
          fileName: t.invoices.file_name,
          fileUrl: t.invoices.file_url,
          issuer: t.invoices.issuer,
          amount: t.invoices.amount,
          date: t.invoices.date,
          type: t.invoices.type as "incoming" | "outgoing",
          paymentMethod: (t.invoices.payment_method || "bank") as "bank" | "cash",
          invoiceNumber: t.invoices.invoice_number || null,
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
