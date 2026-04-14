// Shared helpers for content-based duplicate detection across ingestion paths
// (direct UI upload via process-document, Drive ingest via n8n-webhook).
//
// A re-upload of a bit-identical PDF must be detected no matter which endpoint
// the user hits and regardless of filename / Drive file ID.

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export interface ExistingInvoiceRef {
  id: string;
  file_name: string;
  date: string;
  issuer: string;
  amount: number;
}

// Look up an already-stored invoice by (user_id, file_hash). Uses .limit(1)
// instead of .maybeSingle() because duplicates may legitimately pre-date the
// hash column and still live in the table.
export async function findInvoiceByHash(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  fileHash: string,
): Promise<ExistingInvoiceRef | null> {
  const { data } = await supabase
    .from("invoices")
    .select("id, file_name, date, issuer, amount")
    .eq("user_id", userId)
    .eq("file_hash", fileHash)
    .limit(1);
  return (data?.[0] as ExistingInvoiceRef | undefined) ?? null;
}

// Same for bank statements — we don't block re-ingest (monthly statements may
// legitimately be reprocessed), but the caller can log it for visibility.
export async function findStatementByHash(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  fileHash: string,
): Promise<{ id: string; file_name: string } | null> {
  const { data } = await supabase
    .from("bank_statements")
    .select("id, file_name")
    .eq("user_id", userId)
    .eq("file_hash", fileHash)
    .limit(1);
  return (data?.[0] as { id: string; file_name: string } | undefined) ?? null;
}
