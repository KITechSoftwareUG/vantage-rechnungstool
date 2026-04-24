import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { ConfigEntry } from "@/types/config";

// Die generierten Supabase-Types kennen `app_config` noch nicht — Lovable
// regeneriert `types.ts` erst nach der Migration. Bis dahin greifen wir
// bewusst untyped auf den Client zu und casten die Rows in unser Interface.
// Gleiches Pattern wie in useLeads.ts.
type AnyClient = {
  from: (table: string) => any;
};
const db = supabase as unknown as AnyClient;

function normalizeEntry(row: Record<string, unknown>): ConfigEntry {
  return {
    key: String(row.key ?? ""),
    value: (row.value as string | null) ?? null,
    is_secret: Boolean(row.is_secret),
    description: (row.description as string | null) ?? null,
    updated_at: String(row.updated_at ?? ""),
  };
}

export function useAppConfig() {
  return useQuery({
    queryKey: ["app_config"],
    queryFn: async (): Promise<ConfigEntry[]> => {
      const { data, error } = await db
        .from("app_config")
        .select("*")
        .order("key", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(normalizeEntry);
    },
  });
}

export function useUpsertAppConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      // Bewusst nur `value` + `updated_at` schreiben. `is_secret` und
      // `description` bleiben wie vom Seed gesetzt — das UI darf diese
      // Strukturdaten nicht versehentlich ueberschreiben.
      const { error } = await db
        .from("app_config")
        .upsert(
          { key, value, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );
      if (error) throw error;
      return { key };
    },
    onSuccess: ({ key }) => {
      queryClient.invalidateQueries({ queryKey: ["app_config"] });
      toast({ title: `${key} gespeichert` });
    },
    onError: (error: Error) => {
      toast({
        title: "Speichern fehlgeschlagen",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
