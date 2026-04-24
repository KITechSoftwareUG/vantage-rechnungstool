import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Response-Shape der Edge Function `zahnfunnel-whatsapp-send`.
interface SendResponse {
  ok: boolean;
  wa_message_id?: string | null;
  error?: string;
  detail?: string;
  meta_code?: number | null;
}

interface SendVariables {
  lead_id: string;
  body: string;
}

// Liest einen Error-Toast-Text aus dem Meta-Error. 131047 = 24h-Fenster
// abgelaufen, das kommt in der Praxis am haeufigsten. Alles andere faellt
// auf die generische Detail-Message zurueck.
function humanizeSendError(data: SendResponse, fallback: string): string {
  if (data.meta_code === 131047) {
    return "24h-Fenster abgelaufen. Meta erlaubt Freitext nur innerhalb von 24h nach der letzten eingehenden Nachricht — hier geht nur noch ein Template.";
  }
  if (data.error === "whatsapp_not_configured") {
    return "WhatsApp ist nicht konfiguriert (siehe /config).";
  }
  if (data.error === "lead_not_found") {
    return "Lead nicht gefunden.";
  }
  if (data.error === "body_required") {
    return "Nachricht darf nicht leer sein.";
  }
  if (data.error === "body_too_long") {
    return "Nachricht ist zu lang (max. 4096 Zeichen).";
  }
  if (data.detail) return data.detail;
  if (data.error) return data.error;
  return fallback;
}

// supabase.functions.invoke() wirft bei 4xx/5xx einen FunctionsHttpError, der
// die Original-Response im `.context` oder direkt als `response`-Prop tragen
// kann (SDK-Version abhaengig). Wir versuchen, das Body-JSON rauszuziehen —
// sonst fallen wir auf die Error-Message zurueck.
async function extractErrorResponse(err: unknown): Promise<SendResponse | null> {
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
    const json = (await cloned.json()) as SendResponse;
    if (json && typeof json === "object") return json;
  } catch {
    // body war kein JSON
  }
  return null;
}

export function useSendWaMessage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ lead_id, body }: SendVariables): Promise<SendResponse> => {
      const { data, error } = await supabase.functions.invoke<SendResponse>(
        "zahnfunnel-whatsapp-send",
        { body: { lead_id, body } },
      );

      if (error) {
        // Bei non-2xx: versuchen, die strukturierte Response zu lesen, damit
        // wir Meta-Error-Codes (z.B. 131047) erkennen koennen.
        const parsed = await extractErrorResponse(error);
        if (parsed) {
          throw Object.assign(
            new Error(humanizeSendError(parsed, "Senden fehlgeschlagen.")),
            { response: parsed },
          );
        }
        throw new Error(error.message || "Senden fehlgeschlagen.");
      }
      if (!data) {
        throw new Error("Leere Antwort vom Server.");
      }
      if (data.ok === false) {
        throw Object.assign(
          new Error(humanizeSendError(data, "Senden fehlgeschlagen.")),
          { response: data },
        );
      }
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wa_messages", vars.lead_id] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["leads", vars.lead_id] });
      toast({ title: "Nachricht gesendet" });
    },
    onError: (err: Error) => {
      toast({
        title: "Senden fehlgeschlagen",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}
