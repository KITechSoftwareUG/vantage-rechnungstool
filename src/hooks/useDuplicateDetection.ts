import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface DuplicateCandidate {
  id: string;
  date: string;
  issuer: string;
  amount: number;
  currency?: string;
  fileName: string;
  fileUrl?: string;
  status?: string;
  createdAt?: string;
}

export interface DuplicateGroup {
  key: string;
  items: DuplicateCandidate[];
}

function normalizeIssuer(issuer: string): string {
  return issuer.trim().toLowerCase().replace(/\s+/g, " ");
}

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.02;
}

function buildDuplicateKey(item: DuplicateCandidate): string {
  return `${item.date}|${normalizeIssuer(item.issuer)}|${Math.round(item.amount * 100)}`;
}

/**
 * Finds duplicate groups among a list of invoices.
 * Returns a Map from invoice ID to array of its duplicates (excluding itself).
 */
export function useDuplicateDetection(invoices: DuplicateCandidate[]) {
  const duplicateMap = useMemo(() => {
    const groups = new Map<string, DuplicateCandidate[]>();
    
    for (const inv of invoices) {
      const key = buildDuplicateKey(inv);
      const existing = groups.get(key) || [];
      existing.push(inv);
      groups.set(key, existing);
    }

    // Build a map: invoiceId -> its duplicates (other items in the same group)
    const result = new Map<string, DuplicateCandidate[]>();
    for (const [, items] of groups) {
      if (items.length > 1) {
        for (const item of items) {
          result.set(
            item.id,
            items.filter((other) => other.id !== item.id)
          );
        }
      }
    }
    return result;
  }, [invoices]);

  return duplicateMap;
}

/**
 * Merge duplicates: keep the "keeper" invoice, delete the "duplicate".
 * If the duplicate has a matched transaction, re-assign it to the keeper.
 */
export function useMergeDuplicate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      keeperId,
      duplicateId,
    }: {
      keeperId: string;
      duplicateId: string;
    }) => {
      // Re-assign any bank_transactions that reference the duplicate
      const { data: linkedTransactions } = await supabase
        .from("bank_transactions")
        .select("id")
        .eq("matched_invoice_id", duplicateId);

      if (linkedTransactions && linkedTransactions.length > 0) {
        const { error: reassignError } = await supabase
          .from("bank_transactions")
          .update({ matched_invoice_id: keeperId })
          .eq("matched_invoice_id", duplicateId);
        if (reassignError) throw reassignError;
      }

      // Delete the duplicate invoice
      const { error: deleteError } = await supabase
        .from("invoices")
        .delete()
        .eq("id", duplicateId);
      if (deleteError) throw deleteError;

      // Also remove from ingestion log if present
      await supabase
        .from("document_ingestion_log")
        .delete()
        .eq("document_id", duplicateId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["ingestion_logs"] });
      toast({ title: "Duplikat zusammengeführt", description: "Die doppelte Rechnung wurde entfernt." });
    },
    onError: (error) => {
      toast({ title: "Fehler beim Zusammenführen", description: error.message, variant: "destructive" });
    },
  });
}
