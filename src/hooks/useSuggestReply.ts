import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Response-Shape der Edge Function `zahnfunnel-suggest-reply`.
interface SuggestResponse {
  ok: boolean;
  suggestion?: string;
  error?: string;
  detail?: string;
}

interface SuggestVariables {
  lead_id: string;
}

interface SuggestResult {
  suggestion: string;
}

// Mappt Edge-Function-Errors auf Klartext fuer den Toast.
function humanizeSuggestError(data: SuggestResponse, fallback: string): string {
  if (data.error === "anthropic_not_configured") {
    return "Anthropic-API-Key fehlt in der Konfiguration (siehe /config).";
  }
  if (data.error === "lead_not_found") {
    return "Lead nicht gefunden.";
  }
  if (data.error === "lead_id_invalid") {
    return "Ungueltige Lead-ID.";
  }
  if (data.error === "anthropic_empty_response") {
    return "Anthropic hat eine leere Antwort geliefert. Bitte erneut versuchen.";
  }
  if (data.error?.startsWith("anthropic_failed_")) {
    return `Anthropic-API-Fehler (${data.error.replace("anthropic_failed_", "HTTP ")}). ${data.detail ?? ""}`.trim();
  }
  if (data.error === "anthropic_network") {
    return "Netzwerk-Fehler beim Anthropic-Call.";
  }
  if (data.detail) return data.detail;
  if (data.error) return data.error;
  return fallback;
}

// Spiegelt die Logik aus useSendWaMessage.extractErrorResponse — Body aus
// FunctionsHttpError ziehen, damit wir error-Codes lesen koennen.
async function extractErrorResponse(err: unknown): Promise<SuggestResponse | null> {
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
    const json = (await cloned.json()) as SuggestResponse;
    if (json && typeof json === "object") return json;
  } catch {
    // body war kein JSON
  }
  return null;
}

export function useSuggestReply() {
  const { toast } = useToast();

  return useMutation<SuggestResult, Error, SuggestVariables>({
    mutationFn: async ({ lead_id }): Promise<SuggestResult> => {
      const { data, error } = await supabase.functions.invoke<SuggestResponse>(
        "zahnfunnel-suggest-reply",
        { body: { lead_id } },
      );

      if (error) {
        const parsed = await extractErrorResponse(error);
        if (parsed) {
          throw Object.assign(
            new Error(humanizeSuggestError(parsed, "Vorschlag konnte nicht erzeugt werden.")),
            { response: parsed },
          );
        }
        throw new Error(error.message || "Vorschlag konnte nicht erzeugt werden.");
      }
      if (!data) {
        throw new Error("Leere Antwort vom Server.");
      }
      if (data.ok === false || !data.suggestion) {
        throw Object.assign(
          new Error(humanizeSuggestError(data, "Vorschlag konnte nicht erzeugt werden.")),
          { response: data },
        );
      }
      return { suggestion: data.suggestion };
    },
    // Erfolgs-Toast macht der UI-Caller — er hat den Kontext, ob ein Draft
    // ueberschrieben wurde und ob das ein "Ersetzt"- oder "Eingefuegt"-Toast
    // werden soll.
    onError: (err: Error) => {
      toast({
        title: "KI-Vorschlag fehlgeschlagen",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}
