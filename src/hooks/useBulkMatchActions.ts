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

// Optimistisches Patch-Helper: ein Cache-Update ohne Refetch-Flicker.
function optimisticPatch(
  queryClient: ReturnType<typeof useQueryClient>,
  transactionIds: string[],
  patch: (t: any) => any,
) {
  const prev = queryClient.getQueriesData({ queryKey: ["bank_transactions"] });
  const idSet = new Set(transactionIds);
  queryClient.setQueriesData({ queryKey: ["bank_transactions"] }, (old: any) => {
    if (!Array.isArray(old)) return old;
    return old.map((t: any) => (idSet.has(t.id) ? patch(t) : t));
  });
  return prev;
}

function rollback(
  queryClient: ReturnType<typeof useQueryClient>,
  prev: ReturnType<typeof optimisticPatch>,
) {
  for (const [queryKey, data] of prev) {
    queryClient.setQueryData(queryKey, data);
  }
}

function settleWithoutRefetch(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["bank_transactions"], refetchType: "none" });
  queryClient.invalidateQueries({ queryKey: ["invoices"], refetchType: "none" });
  queryClient.invalidateQueries({ queryKey: ["unmatched_invoices"], refetchType: "none" });
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
    onMutate: async (transactionIds) => {
      await queryClient.cancelQueries({ queryKey: ["bank_transactions"] });
      const prev = optimisticPatch(queryClient, transactionIds, (t) => ({
        ...t,
        matchStatus: "confirmed",
        matchConfidence: 100,
      }));
      return { prev };
    },
    onError: (_e, _v, ctx: any) => ctx?.prev && rollback(queryClient, ctx.prev),
    onSettled: () => settleWithoutRefetch(queryClient),
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
    onMutate: async (transactionIds) => {
      await queryClient.cancelQueries({ queryKey: ["bank_transactions"] });
      const prev = optimisticPatch(queryClient, transactionIds, (t) => ({
        ...t,
        matchStatus: "unmatched",
        matchedInvoiceId: null,
        matchConfidence: null,
        matchedInvoice: null,
      }));
      return { prev };
    },
    onError: (_e, _v, ctx: any) => ctx?.prev && rollback(queryClient, ctx.prev),
    onSettled: () => settleWithoutRefetch(queryClient),
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
    onMutate: async (snapshots) => {
      await queryClient.cancelQueries({ queryKey: ["bank_transactions"] });
      const prev = queryClient.getQueriesData({ queryKey: ["bank_transactions"] });
      const snapMap = new Map(snapshots.map((s) => [s.id, s]));
      queryClient.setQueriesData({ queryKey: ["bank_transactions"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((t: any) => {
          const s = snapMap.get(t.id);
          if (!s) return t;
          return {
            ...t,
            matchStatus: s.match_status,
            matchedInvoiceId: s.matched_invoice_id,
            matchConfidence: s.match_confidence,
            // Wenn die Zuordnung wiederhergestellt wird, aber der eingebettete
            // Invoice-Record im Cache fehlt, bleibt er null — der naechste
            // Refetch bei Focus liefert die vollen Daten nach.
            matchedInvoice: s.matched_invoice_id ? t.matchedInvoice : null,
          };
        });
      });
      return { prev };
    },
    onError: (_e, _v, ctx: any) => ctx?.prev && rollback(queryClient, ctx.prev),
    onSettled: () => settleWithoutRefetch(queryClient),
  });
}
