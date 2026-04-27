import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { buildStoragePaths } from "@/lib/storagePaths";
import { resetTransactionMatches } from "@/lib/matchReset";
import {
  deleteIngestionLogsBestEffort,
  removeStoragePathsBestEffort,
} from "@/lib/storageCleanup";

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
  invoiceNumber?: string | null;
  fileHash?: string | null;
}

export type DuplicateReason = "hash" | "invoice_number" | "metadata";

// Back-compat: existing callers destructure DuplicateCandidate fields directly
// from map entries. We augment with `duplicateReason` so new UI can surface
// why two invoices were flagged without breaking the old shape.
export type DuplicateMatch = DuplicateCandidate & { duplicateReason: DuplicateReason };

// Strips legal-entity suffixes and noise so „OpenAI, LLC" and „OpenAI Ireland Ltd"
// collapse to the same issuer token bucket. Matches the normalization we use
// backend-side in auto-match-transactions for score consistency.
const LEGAL_SUFFIXES = [
  "gmbh", "ug", "ag", "kg", "ohg", "gbr", "co kg",
  "ltd", "limited", "llc", "llp", "inc", "corp", "corporation",
  "sa", "sl", "srl", "spa", "bv", "nv", "oy", "as", "ab",
  "pte ltd", "co ltd", "plc",
];

function normalizeIssuer(issuer: string): string {
  let s = (issuer || "").toLowerCase().trim();
  // German umlauts
  s = s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  // Strip punctuation
  s = s.replace(/[.,/()&+]/g, " ");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // Strip trailing legal suffixes
  for (const suffix of LEGAL_SUFFIXES) {
    const re = new RegExp(`(^|\\s)${suffix}(\\s|$)`, "g");
    s = s.replace(re, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function normalizeInvoiceNumber(n: string | null | undefined): string | null {
  if (!n) return null;
  const s = n.toLowerCase().replace(/[^a-z0-9]/g, "");
  return s.length >= 3 ? s : null;
}

// Stable cache key for useMemo — avoids O(n²) recompute when unrelated
// refetches return a new array identity but same content.
function invoicesFingerprint(invoices: DuplicateCandidate[]): string {
  const parts: string[] = [];
  for (const inv of invoices) {
    parts.push(
      `${inv.id}|${inv.date}|${inv.issuer}|${Math.round(inv.amount * 100)}|${inv.fileHash || ""}|${inv.invoiceNumber || ""}`,
    );
  }
  return parts.join("#");
}

/**
 * Finds duplicate groups among invoices.
 *
 * Strategy (strongest signal wins):
 *   1. `file_hash` equal → bit-identical re-upload. Highest confidence.
 *   2. Same normalized `invoice_number` (≥ 3 chars) AND amount tolerance.
 *   3. Same `date` + normalized issuer + amount tolerance (legacy key).
 *
 * Returns: Map<invoiceId, DuplicateMatch[]> — each entry lists the OTHER
 * invoices considered duplicates of `invoiceId`, tagged with the reason.
 */
export function useDuplicateDetection(invoices: DuplicateCandidate[]) {
  const fingerprint = useMemo(() => invoicesFingerprint(invoices), [invoices]);

  const duplicateMap = useMemo(() => {
    const hashGroups = new Map<string, DuplicateCandidate[]>();
    const numberGroups = new Map<string, DuplicateCandidate[]>();
    const metadataGroups = new Map<string, DuplicateCandidate[]>();

    for (const inv of invoices) {
      const amountCents = Math.round(inv.amount * 100);

      if (inv.fileHash) {
        const key = `hash:${inv.fileHash}`;
        const g = hashGroups.get(key) || [];
        g.push(inv);
        hashGroups.set(key, g);
      }

      const invNum = normalizeInvoiceNumber(inv.invoiceNumber);
      if (invNum) {
        // Bucket by invoice number + rough amount (±5 cents) so accidental
        // re-issue with identical number/amount collapses.
        const key = `invnum:${invNum}|${amountCents}`;
        const g = numberGroups.get(key) || [];
        g.push(inv);
        numberGroups.set(key, g);
      }

      const metaKey = `meta:${inv.date}|${normalizeIssuer(inv.issuer)}|${amountCents}`;
      const g = metadataGroups.get(metaKey) || [];
      g.push(inv);
      metadataGroups.set(metaKey, g);
    }

    const result = new Map<string, DuplicateMatch[]>();
    const strength: Record<DuplicateReason, number> = { hash: 3, invoice_number: 2, metadata: 1 };

    const addPair = (a: DuplicateCandidate, b: DuplicateCandidate, reason: DuplicateReason) => {
      const aList = result.get(a.id) || [];
      // Keep only the strongest reason per pair: hash > invoice_number > metadata.
      const existingIdx = aList.findIndex((m) => m.id === b.id);
      if (existingIdx >= 0) {
        if (strength[reason] > strength[aList[existingIdx].duplicateReason]) {
          aList[existingIdx] = { ...b, duplicateReason: reason };
        }
      } else {
        aList.push({ ...b, duplicateReason: reason });
      }
      result.set(a.id, aList);
    };

    const emitGroups = (groups: Map<string, DuplicateCandidate[]>, reason: DuplicateReason) => {
      for (const items of groups.values()) {
        if (items.length < 2) continue;
        for (const a of items) {
          for (const b of items) {
            if (a.id === b.id) continue;
            addPair(a, b, reason);
          }
        }
      }
    };

    // Order matters — emit strongest reason first so addPair's upgrade logic
    // keeps the weakest redundant entries out.
    emitGroups(hashGroups, "hash");
    emitGroups(numberGroups, "invoice_number");
    emitGroups(metadataGroups, "metadata");

    return result;
  }, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  return duplicateMap;
}

/**
 * Merge duplicates: keep the "keeper" invoice, delete the "duplicate".
 * Re-assigns matched transactions to the keeper before deletion.
 */
export function useMergeDuplicate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      keeperId: rawKeeperId,
      duplicateId: rawDuplicateId,
    }: {
      keeperId: string;
      duplicateId: string;
    }) => {
      // Bug-Fix: Wenn ein neu eingespieltes (processing) Dokument Duplikat
      // einer bereits bestaetigten (ready/saved) Rechnung ist, wuerde die
      // UI die alte bestaetigte Rechnung loeschen und die neue pending
      // behalten. Vor dem Delete Status pruefen und so swappen, dass immer
      // der bestaetigte Datensatz ueberlebt.
      const { data: statusRows, error: statusErr } = await supabase
        .from("invoices")
        .select("id, status")
        .in("id", [rawKeeperId, rawDuplicateId]);
      if (statusErr) throw statusErr;

      const statusOf = (id: string) =>
        (statusRows || []).find((r: any) => r.id === id)?.status as string | undefined;
      const isConfirmed = (s: string | undefined) => s === "ready" || s === "saved";

      let keeperId = rawKeeperId;
      let duplicateId = rawDuplicateId;
      if (isConfirmed(statusOf(rawDuplicateId)) && !isConfirmed(statusOf(rawKeeperId))) {
        keeperId = rawDuplicateId;
        duplicateId = rawKeeperId;
      }

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

      // Fix B: Ingestion-Log-IDs ZUERST queryen (vor invoice-delete), damit
      // wir nach dem invoice-delete deterministisch per id aufraeumen koennen.
      const { data: logRows } = await supabase
        .from("document_ingestion_log")
        .select("id")
        .eq("document_id", duplicateId);
      const logIds = (logRows || []).map((r: any) => r.id);

      // Fix A: Row-Snapshot der duplicate-Invoice VOR dem delete einsammeln,
      // damit wir danach die Storage-Datei deterministisch entfernen koennen.
      // Sonst bleiben Orphans im Bucket.
      const { data: dupRow } = await supabase
        .from("invoices")
        .select("id, user_id, year, month, file_name, file_url")
        .eq("id", duplicateId)
        .maybeSingle();

      await resetTransactionMatches([duplicateId]);
      const { error: deleteError } = await supabase
        .from("invoices")
        .delete()
        .eq("id", duplicateId);
      if (deleteError) throw deleteError;

      // Fix B: Log-Delete awaiten mit 1 Retry (best-effort).
      await deleteIngestionLogsBestEffort(logIds, "mergeDuplicate");

      // Fix A: Storage-Datei der geloeschten Rechnung entfernen (1 Retry).
      if (dupRow) {
        const paths = buildStoragePaths([
          {
            userId: (dupRow as any).user_id,
            year: (dupRow as any).year,
            month: (dupRow as any).month,
            fileName: (dupRow as any).file_name,
            fileUrl: (dupRow as any).file_url,
          },
        ]);
        await removeStoragePathsBestEffort(paths, "mergeDuplicate");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      toast({ title: "Duplikat zusammengeführt", description: "Die doppelte Rechnung wurde entfernt." });
    },
    onError: (error) => {
      toast({ title: "Fehler beim Zusammenführen", description: error.message, variant: "destructive" });
    },
  });
}
