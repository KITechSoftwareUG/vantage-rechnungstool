import { supabase } from "@/integrations/supabase/client";

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

  for (const path of candidates) {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(path, 3600);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  // Last resort: return the stored URL (may be an internal URL, but UrlDocumentPreview
  // will fall back to supabase.storage.download() if the fetch fails).
  return fileUrl || "";
}
