import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Lead, LeadMeta, LeadStatus, WaMessage } from "@/types/leads";

// Die generierten Supabase-Types kennen `leads` und `wa_messages` noch
// nicht — Lovable regeneriert `types.ts` erst nach der Migration. Bis dahin
// greifen wir bewusst untyped auf den Client zu und casten die Rows in
// unsere Interfaces. Kein `any`-Leak nach aussen.
type AnyClient = {
  from: (table: string) => any;
};
const db = supabase as unknown as AnyClient;

// `meta` kommt als JSONB und kann `null`, `{}` oder eine Liste sein. Wir
// erzwingen hier ein Objekt, damit das UI einfach Feldzugriffe machen kann.
function normalizeMeta(raw: unknown): LeadMeta {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as LeadMeta;
  }
  return {};
}

function normalizeLead(row: Record<string, unknown>): Lead {
  return {
    id: String(row.id),
    phone: String(row.phone ?? ""),
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    source: String(row.source ?? "website"),
    meta: normalizeMeta(row.meta),
    status: (row.status as LeadStatus) ?? "new",
    message_count: Number(row.message_count ?? 0),
    last_message: (row.last_message as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeWaMessage(row: Record<string, unknown>): WaMessage {
  return {
    id: String(row.id),
    lead_id: (row.lead_id as string | null) ?? null,
    phone: String(row.phone ?? ""),
    direction: (row.direction as WaMessage["direction"]) ?? "outbound",
    body: (row.body as string | null) ?? null,
    template_name: (row.template_name as string | null) ?? null,
    wa_message_id: (row.wa_message_id as string | null) ?? null,
    meta:
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {},
    created_at: String(row.created_at),
  };
}

export function useLeads() {
  return useQuery({
    queryKey: ["leads"],
    queryFn: async (): Promise<Lead[]> => {
      const { data, error } = await db
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(normalizeLead);
    },
  });
}

export function useLead(leadId: string | undefined) {
  return useQuery({
    queryKey: ["leads", leadId],
    enabled: !!leadId,
    queryFn: async (): Promise<Lead | null> => {
      if (!leadId) return null;
      const { data, error } = await db
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return normalizeLead(data as Record<string, unknown>);
    },
  });
}

export function useWaMessages(leadId: string | undefined) {
  return useQuery({
    queryKey: ["wa_messages", leadId],
    enabled: !!leadId,
    queryFn: async (): Promise<WaMessage[]> => {
      if (!leadId) return [];
      const { data, error } = await db
        .from("wa_messages")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(normalizeWaMessage);
    },
  });
}

export function useUpdateLeadStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: LeadStatus }) => {
      const { error } = await db
        .from("leads")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
      return { id, status };
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["leads", id] });
      toast({ title: "Status aktualisiert" });
    },
    onError: (error: Error) => {
      toast({
        title: "Status konnte nicht aktualisiert werden",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
