import { Loader2 } from "lucide-react";
import { useIngestionLogs, getSourceBreadcrumb } from "@/hooks/useIngestionLogs";

// Prominente Loading-Anzeige für Drive-Uploads, die gerade durch die
// OCR-Pipeline laufen. Hängt sich an `document_ingestion_log` (Status
// "processing") und wird automatisch leer, sobald der Webhook die Einträge
// auf "completed" / "error" / "duplicate" setzt.
export function ProcessingBanner() {
  const { logs } = useIngestionLogs();

  const processing = (logs ?? []).filter((l) => l.status === "processing");
  if (processing.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/40">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-amber-600 dark:text-amber-400" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {processing.length === 1
              ? "1 Dokument wird gerade verarbeitet"
              : `${processing.length} Dokumente werden gerade verarbeitet`}
          </p>
          <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
            Upload → OCR → Extraktion läuft. Das dauert meist 5-15 Sekunden pro Dokument.
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1">
        {processing.slice(0, 8).map((log) => {
          const crumbs = getSourceBreadcrumb(log).join(" / ");
          return (
            <li
              key={log.id}
              className="flex items-center gap-2 text-xs text-amber-900/90 dark:text-amber-100/90"
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              <span className="truncate font-medium">{log.file_name}</span>
              <span className="truncate text-amber-700/70 dark:text-amber-300/60">· {crumbs}</span>
            </li>
          );
        })}
        {processing.length > 8 && (
          <li className="text-xs text-amber-800/70 dark:text-amber-200/60">
            … und {processing.length - 8} weitere
          </li>
        )}
      </ul>
    </div>
  );
}
