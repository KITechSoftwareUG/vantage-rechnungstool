import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Markiert eine ueber WhatsApp-Web/-App MANUELL versendete Nachricht als
// "gesendet": traegt einen outbound-Eintrag in wa_messages ein und setzt
// last_message + status="contacted" auf dem Lead. Solange Meta Cloud API
// noch nicht eingerichtet ist, ist das der einzige Weg, Erstkontakt-
// Konversationen ins System zu bekommen — sobald Meta laeuft, wird dieser
// Pfad durch zahnfunnel-whatsapp-send abgeloest.
//
// Schreibt direkt via Supabase-Client (RLS auf wa_messages erlaubt INSERT
// fuer authenticated, siehe 20260424120000_zahnfunnel_schema.sql).

type AnyClient = {
  from: (table: string) => any;
};
const db = supabase as unknown as AnyClient;

interface Vars {
  lead_id: string;
  phone: string;
  body: string;
}

export function useMarkManualWaSent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ lead_id, phone, body }: Vars) => {
      const trimmed = body.trim();
      if (!trimmed) throw new Error("Nachricht darf nicht leer sein.");

      const { error: insertErr } = await db.from("wa_messages").insert({
        lead_id,
        phone,
        direction: "outbound",
        body: trimmed,
        // sent_via=manual unterscheidet diese Eintraege von API-Sends, falls
        // wir spaeter mal nach Versand-Quelle filtern wollen.
        meta: { sent_via: "manual" },
      });
      if (insertErr) throw insertErr;

      const { error: updateErr } = await db
        .from("leads")
        .update({ last_message: trimmed, status: "contacted" })
        .eq("id", lead_id);
      if (updateErr) throw updateErr;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wa_messages", vars.lead_id] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["leads", vars.lead_id] });
      toast({ title: "Als gesendet markiert" });
    },
    onError: (err: Error) => {
      toast({
        title: "Markieren fehlgeschlagen",
        description: err.message,
        variant: "destructive",
      });
    },
  });
}
