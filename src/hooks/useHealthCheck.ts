import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type HealthStatus = "ok" | "not_configured" | "error";

export interface MetaHealth {
  status: HealthStatus;
  detail: string;
  display_phone_number?: string;
  verified_name?: string;
}

export interface AnthropicHealth {
  status: HealthStatus;
  detail: string;
  model?: string;
}

export interface GmailHealth {
  status: HealthStatus;
  detail: string;
  email?: string;
}

export interface HealthCheckResult {
  meta: MetaHealth;
  anthropic: AnthropicHealth;
  gmail: GmailHealth;
}

export function useHealthCheck() {
  return useQuery<HealthCheckResult>({
    queryKey: ["health_check"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<HealthCheckResult>(
        "zahnfunnel-health-check",
        { body: {} },
      );
      if (error) throw error;
      if (!data) throw new Error("Leere Antwort vom Health-Check.");
      return data;
    },
    // 30s stale window: wir cachen den letzten Check, lassen Window-Focus
    // und manuelle Refetches den Check aber durchgehen.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
