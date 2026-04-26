import { supabase } from "@/integrations/supabase/client";

// Session-Cache für Signed URLs. Ohne Cache löst jeder React-Query-Refetch
// (alle 3-10s) für N Rechnungen N neue createSignedUrl-Calls aus. Signed URLs
// gelten 1h; wir refreshen 5min vor Ablauf, um Race-Conditions zu vermeiden.
const SIGNED_URL_TTL_MS = 3600 * 1000;
const SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function extractStoragePath(fileUrl: string): string | null {
  try {
    const parsed = new URL(fileUrl);
    const markers = [
      "/storage/v1/object/public/documents/",
      "/storage/v1/object/sign/documents/",
      "/storage/v1/object/authenticated/documents/",
    ];
    for (const marker of markers) {
      const idx = parsed.pathname.indexOf(marker);
      if (idx !== -1) {
        return decodeURIComponent(parsed.pathname.slice(idx + marker.length));
      }
    }
  } catch {}
  return null;
}

/**
 * Resolves a Supabase Storage document to a fresh signed URL.
 * Always generates a signed URL rather than relying on the stored file_url,
 * because file_url may have been generated using an internal/unreachable base URL
 * (e.g. from an edge function using SUPABASE_URL = http://supabase-kong:8000).
 */
export async function resolveStorageUrl(
  userId: string,
  year: number,
  month: number,
  fileName: string,
  fileUrl?: string | null
): Promise<string> {
  // Build candidate storage paths. Prefer the path extracted from the stored URL
  // because it reflects the actual location (may differ after renaming).
  const fromUrl = fileUrl ? extractStoragePath(fileUrl) : null;
  const candidates = [
    fromUrl,
    `${userId}/${year}/${month}/${fileName}`,
    `${userId}/${year}/${String(month).padStart(2, "0")}/${fileName}`,
  ].filter(Boolean) as string[];

  const now = Date.now();
  const attempts: { path: string; error: string }[] = [];
  for (const path of candidates) {
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt - SIGNED_URL_REFRESH_MARGIN_MS > now) {
      return cached.url;
    }
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(path, 3600);
    if (!error && data?.signedUrl) {
      signedUrlCache.set(path, { url: data.signedUrl, expiresAt: now + SIGNED_URL_TTL_MS });
      return data.signedUrl;
    }
    attempts.push({ path, error: error?.message ?? "unknown" });
  }

  // Alle Kandidaten haben gefehlt — typischerweise weil die Datei im Storage
  // geloescht/nie hochgeladen wurde, oder weil RLS das Lesen verweigert.
  // Loggen, damit man im Devtool den Grund sieht statt nur "PDF konnte nicht
  // geladen werden".
  console.warn(
    `[resolveStorageUrl] kein signed URL fuer ${userId}/${year}/${month}/${fileName} - alle Kandidaten gescheitert:`,
    attempts,
  );

  return fileUrl || "";
}
