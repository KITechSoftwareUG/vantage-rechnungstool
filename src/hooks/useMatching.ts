import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BankTransaction, BankType } from "@/types/matching";
import { fetchAllPaginated } from "@/lib/fetchAllPaginated";

// Fetch all bank transactions (no filtering)
export function useBankTransactions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bank_transactions", user?.id],
    queryFn: async () => {
      const data = await fetchAllPaginated<any>(() =>
        supabase
          .from("bank_transactions")
          .select(`
            *,
            bank_statements(bank, bank_type),
            invoices(id, user_id, year, month, issuer, amount, date, file_name, file_url)
          `)
          .order("date", { ascending: false }),
      );

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
      matchStatus: "unmatched" | "confirmed" | "no_match" | "recurring" | "ignored";
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
    // Optimistisches Update: der Cache-Eintrag fuer die eine TX wird sofort
    // aktualisiert, kein Refetch der gesamten Liste. Ohne das flackert nach
    // jedem Swipe die komplette Seite, weil drei Queries invalidiert werden
    // und alle Rows neu mounten.
    onMutate: async ({ transactionId, invoiceId, matchStatus, matchConfidence }) => {
      await queryClient.cancelQueries({ queryKey: ["bank_transactions"] });
      const prev = queryClient.getQueriesData({ queryKey: ["bank_transactions"] });

      // Wenn eine neue Zuordnung gesetzt wird, das Invoice-Objekt aus dem
      // unmatched-Cache nachschlagen und mit einbetten — sonst bleibt
      // matchedInvoice nach onMutate null und Eye-Icon/Preview erscheinen
      // erst nach dem naechsten Refetch (bis zu staleTime spaeter).
      let embeddedInvoice: any = null;
      if (invoiceId) {
        const unmatched = queryClient.getQueriesData({ queryKey: ["unmatched_invoices"] });
        for (const [, data] of unmatched) {
          if (Array.isArray(data)) {
            const hit = data.find((inv: any) => inv?.id === invoiceId);
            if (hit) {
              embeddedInvoice = hit;
              break;
            }
          }
        }
      }

      queryClient.setQueriesData({ queryKey: ["bank_transactions"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((t: any) =>
          t.id === transactionId
            ? {
                ...t,
                matchStatus,
                matchedInvoiceId: invoiceId,
                matchConfidence: matchConfidence ?? null,
                // Bei neuer Zuordnung: aus Cache embedden (sonst eye/preview
                // unsichtbar bis Refetch). Bei gleicher Zuordnung: vorhandenes
                // Objekt behalten. Beim Aufheben: leeren.
                matchedInvoice: invoiceId
                  ? (embeddedInvoice ?? t.matchedInvoice)
                  : null,
              }
            : t,
        );
      });
      return { prev };
    },
    onError: (_err, _vars, ctx: any) => {
      if (ctx?.prev) {
        for (const [queryKey, data] of ctx.prev) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    // refetchType: 'none' markiert Queries als stale aber loest kein sofortiges
    // Refetch aus. So bleibt die UI ohne Flicker, und die Daten werden beim
    // naechsten regulaeren Fetch (z.B. window focus) synchronisiert.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["invoices"], refetchType: "none" });
      queryClient.invalidateQueries({ queryKey: ["unmatched_invoices"], refetchType: "none" });
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
      // Client-seitiges Filtern statt .not("id", "in", "(uuid,uuid,...)"):
      // PostgREST limitiert die URL auf ~8KB, was bei UUID-Listen schon
      // bei ~150-200 confirmed Matches reisst und den Request lautlos
      // kappt. Beide Listen werden paginiert geholt, dann lokal gefiltert.
      const matchedRows = await fetchAllPaginated<{ matched_invoice_id: string | null }>(() =>
        supabase
          .from("bank_transactions")
          .select("matched_invoice_id")
          .eq("match_status", "confirmed")
          .not("matched_invoice_id", "is", null),
      );

      const matchedIds = new Set(
        matchedRows.map((t) => t.matched_invoice_id).filter(Boolean) as string[],
      );

      const all = await fetchAllPaginated<any>(() =>
        supabase.from("invoices").select("*").order("date", { ascending: false }),
      );

      return all.filter((inv) => !matchedIds.has(inv.id));
    },
    enabled: !!user,
  });
}
