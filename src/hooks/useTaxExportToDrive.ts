import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface DriveExportResult {
  ok: boolean;
  uploaded: Array<{
    year: number;
    fileName: string;
    webViewLink: string;
    rowCount: number;
  }>;
  failed?: Array<{ year: number; reason: string }>;
  error?: string;
  detail?: string;
  message?: string;
}

function humanizeError(data: DriveExportResult, fallback: string): string {
  if (data.error === "drive_not_connected") {
    return data.detail ?? "Google Drive ist nicht verbunden. Bitte in den Einstellungen verbinden.";
  }
  if (data.error === "missing_auth" || data.error === "invalid_auth") {
    return "Du bist nicht angemeldet.";
  }
  if (data.error === "db_error") {
    return "Daten konnten nicht geladen werden.";
  }
  if (data.detail) return data.detail;
  if (data.error) return data.error;
  return fallback;
}

async function extractErrorResponse(err: unknown): Promise<DriveExportResult | null> {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as {
    context?: { response?: Response } | Response;
    response?: Response;
  };
  const candidate =
    (anyErr.context as { response?: Response } | undefined)?.response ??
    (anyErr.context instanceof Response ? anyErr.context : undefined) ??
    anyErr.response;
  if (!candidate || typeof candidate.clone !== "function") return null;
  try {
    const cloned = candidate.clone();
    const json = (await cloned.json()) as DriveExportResult;
    if (json && typeof json === "object") return json;
  } catch {
    // body war kein JSON
  }
  return null;
}

export function useTaxExportToDrive() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (): Promise<DriveExportResult> => {
      const { data, error } = await supabase.functions.invoke<DriveExportResult>(
        "tax-export-to-drive",
        { body: {} },
      );

      if (error) {
        const parsed = await extractErrorResponse(error);
        if (parsed) {
          throw Object.assign(
            new Error(humanizeError(parsed, "Drive-Export fehlgeschlagen.")),
            { response: parsed },
          );
        }
        throw new Error(error.message || "Drive-Export fehlgeschlagen.");
      }
      if (!data || data.ok === false) {
        throw Object.assign(
          new Error(humanizeError(data ?? { ok: false, uploaded: [] }, "Drive-Export fehlgeschlagen.")),
          { response: data },
        );
      }
      return data;
    },
    onError: (err: Error) => {
      toast({
        title: "Drive-Export fehlgeschlagen",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}
