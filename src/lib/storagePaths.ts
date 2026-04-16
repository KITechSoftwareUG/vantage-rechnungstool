// Helpers fuer Supabase-Storage-Pfade. Wird sowohl von der Review-Queue
// (Verwerfen) als auch von den Rechnungs-/Kontoauszug-Delete-Hooks genutzt,
// damit Cascade-Deletes ueberall konsistent laufen.

export function extractStoragePath(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
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
  } catch {
    // Ungueltige URL — fallthrough auf null
  }
  return null;
}

export interface StorageRef {
  userId?: string | null;
  year?: number | null;
  month?: number | null;
  fileName?: string | null;
  fileUrl?: string | null;
}

export function buildStoragePaths(refs: StorageRef[]): string[] {
  const paths = new Set<string>();
  for (const ref of refs) {
    const fromUrl = extractStoragePath(ref.fileUrl);
    if (fromUrl) paths.add(fromUrl);
    if (ref.userId && ref.year != null && ref.month != null && ref.fileName) {
      paths.add(`${ref.userId}/${ref.year}/${ref.month}/${ref.fileName}`);
      paths.add(`${ref.userId}/${ref.year}/${String(ref.month).padStart(2, "0")}/${ref.fileName}`);
    }
  }
  return Array.from(paths);
}
