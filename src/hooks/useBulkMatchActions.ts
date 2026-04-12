import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Snapshot eines Matching-relevanten Zustands einer Transaktion.
 * Wird vor einer Bulk-Aktion erfasst, um sie via Undo zurückspielen zu können.
 */
export interface TransactionMatchSnapshot {
  id: string;
  match_status: string;
  matched_invoice_id: string | null;
  match_confidence: number | null;
}

export function useBulkConfirmMatches() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (transactionIds: string[]) => {
      const { error } = await supabase
        .from("bank_transactions")
        .update({ match_status: "confirmed", match_confidence: 100 })
        .in("id", transactionIds);

      if (error) throw error;
      return transactionIds.length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched_invoices"] });
    },
  });
}

export function useBulkUnmatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (transactionIds: string[]) => {
      const { error } = await supabase
        .from("bank_transactions")
        .update({
          match_status: "unmatched",
          matched_invoice_id: null,
          match_confidence: null,
        })
        .in("id", transactionIds);

      if (error) throw error;
      return transactionIds.length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched_invoices"] });
    },
  });
}

/**
 * Stellt einen Snapshot von Transaktions-Matches wieder her.
 * Wird vom Undo-Toast aufgerufen.
 */
export function useRestoreMatchSnapshots() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (snapshots: TransactionMatchSnapshot[]) => {
      // Es gibt keinen "bulk update mit unterschiedlichen Werten" in supabase-js,
      // also einzelne Updates parallel. Bei kleinen Mengen (Bulk-Auswahl) ist das ok.
      const updates = snapshots.map((snap) =>
        supabase
          .from("bank_transactions")
          .update({
            match_status: snap.match_status,
            matched_invoice_id: snap.matched_invoice_id,
            match_confidence: snap.match_confidence,
          })
          .eq("id", snap.id)
      );

      const results = await Promise.all(updates);
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
      return snapshots.length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["unmatched_invoices"] });
    },
  });
}
