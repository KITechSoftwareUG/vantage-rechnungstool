import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
