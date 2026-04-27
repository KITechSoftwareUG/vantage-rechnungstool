import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface RecurringPattern {
  id: string;
  userId: string;
  descriptionPattern: string;
  createdAt: string;
}

export function useRecurringPatterns() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["recurring_patterns", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_patterns")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return data.map((p: any) => ({
        id: p.id,
        userId: p.user_id,
        descriptionPattern: p.description_pattern,
        createdAt: p.created_at,
      }));
    },
    enabled: !!user,
  });
}

export function useAddRecurringPattern() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (descriptionPattern: string) => {
      if (!user) throw new Error("Not authenticated");

      // Check if pattern already exists
      const { data: existing } = await supabase
        .from("recurring_patterns")
        .select("id")
        .eq("description_pattern", descriptionPattern)
        .single();

      if (existing) {
        return existing; // Pattern already exists
      }

      const { data, error } = await supabase
        .from("recurring_patterns")
        .insert({
          user_id: user.id,
          description_pattern: descriptionPattern,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring_patterns"] });
    },
  });
}

export function useDeleteRecurringPattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patternId: string) => {
      const { error } = await supabase
        .from("recurring_patterns")
        .delete()
        .eq("id", patternId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring_patterns"] });
    },
  });
}

// Mindest-Pattern-Laenge gegen Greedy-Matches: ein Pattern unter 4 Zeichen
// (z.B. "AG", "abc") triggert auf zu vielen unverwandten Buchungen. Wenn jemand
// das wirklich braucht, soll er ein laengeres Pattern speichern.
const MIN_PATTERN_LENGTH = 4;

// Helper function to check if a description matches any recurring pattern.
//
// Frueher: `desc.includes(pattern) || pattern.includes(desc)`. Die zweite
// Klausel war greedy — wenn der User ein langes Pattern (z.B. eine ganze
// Buchungszeile) gespeichert hatte, matched jede kurze Buchung, deren ganzer
// Description-Text irgendwo im Pattern als Substring auftauchte. Folge: ganze
// Monate (z.B. Maerz 2026) verschwanden aus "Offen", weil eine "Gehalt"-
// Buchung in einem alten Pattern wie "Gehalt Firma XYZ Mitarbeiter 12345"
// enthalten war. Jetzt nur noch desc.includes(pattern) — die Description
// muss das Pattern als Substring enthalten, nicht umgekehrt.
export function matchesRecurringPattern(description: string, patterns: RecurringPattern[]): boolean {
  const normalizedDesc = description.toLowerCase().trim();
  if (!normalizedDesc) return false;

  return patterns.some(pattern => {
    const normalizedPattern = pattern.descriptionPattern.toLowerCase().trim();
    if (normalizedPattern.length < MIN_PATTERN_LENGTH) return false;
    return normalizedDesc.includes(normalizedPattern);
  });
}
