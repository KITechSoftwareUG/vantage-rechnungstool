// Setzt bestaetigte Matches auf betroffenen bank_transactions zurueck,
// BEVOR die Rechnung geloescht wird. Ohne diesen Schritt blieben
// Transaktionen mit match_status='confirmed' aber matched_invoice_id=NULL
// liegen — ein inkonsistenter Zustand, den weder auto-match noch die UI
// sinnvoll anzeigen koennen.
//
// Best-effort: Fehler werden nur geloggt, der Invoice-Delete-Pfad bleibt
// autoritativ. Wird von allen Invoice-Delete-Pfaden (useInvoices,
// useIngestionLogs, useDuplicateDetection, InvoicesPage Bulk-Dedup)
// aufgerufen.

import { supabase } from "@/integrations/supabase/client";

export async function resetTransactionMatches(invoiceIds: string[]): Promise<void> {
  if (!invoiceIds.length) return;
  const { error } = await supabase
    .from("bank_transactions")
    .update({
      match_status: "unmatched",
      matched_invoice_id: null,
      match_confidence: null,
      match_reason: null,
    })
    .in("matched_invoice_id", invoiceIds);
  if (error) {
    console.error("[matchReset] transaction match reset failed", error);
  }
}
