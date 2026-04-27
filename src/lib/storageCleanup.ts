// Best-effort Cleanup-Helfer fuer Storage-Files und Ingestion-Logs nach
// einem Invoice-/Statement-Delete. Pattern ist ueberall identisch: einmal
// versuchen, bei Fehler einmal retryen, bei finalem Fehler nur loggen —
// der eigentliche Delete (Invoice-Row) ist autoritativ und schon gelaufen,
// hier wuerde Werfen den User-Flow nur kippen.
//
// Vorher lebte das Muster in vier Dateien (useInvoices, useIngestionLogs,
// useDuplicateDetection, InvoicesPage Bulk-Dedup). Hier zentralisiert,
// damit Aenderungen am Retry-/Log-Format an einer Stelle passieren.

import { supabase } from "@/integrations/supabase/client";

// Supabase query/storage builders sind PromiseLike, kein echtes Promise —
// deshalb keine Promise<>-Constraint, sondern einfach `await`-bar.
async function withRetryOnce(
  op: () => PromiseLike<{ error: unknown }>,
): Promise<unknown> {
  const first = await op();
  if (!first.error) return null;
  const retry = await op();
  return retry.error ?? null;
}

export async function removeStoragePathsBestEffort(
  paths: string[],
  context: string,
): Promise<void> {
  if (!paths.length) return;
  const error = await withRetryOnce(() =>
    supabase.storage.from("documents").remove(paths),
  );
  if (error) {
    console.error(`[storageCleanup:${context}] storage remove failed`, error, paths);
  }
}

export async function deleteIngestionLogsBestEffort(
  logIds: string[],
  context: string,
): Promise<void> {
  if (!logIds.length) return;
  const error = await withRetryOnce(() =>
    supabase.from("document_ingestion_log").delete().in("id", logIds),
  );
  if (error) {
    console.error(`[storageCleanup:${context}] ingestion log delete failed`, error);
  }
}
