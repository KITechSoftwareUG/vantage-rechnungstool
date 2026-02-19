import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { InvoiceData } from "@/types/documents";
import { useToast } from "@/hooks/use-toast";

export function useInvoices() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["invoices", user?.id],
    queryFn: async (): Promise<InvoiceData[]> => {
      if (!user) return [];
      
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .neq("status", "processing")
        .order("date", { ascending: false });

      if (error) throw error;

      return (data || []).map((inv) => ({
        id: inv.id,
        fileName: inv.file_name,
        fileUrl: inv.file_url || undefined,
        date: inv.date,
        year: inv.year,
        month: inv.month,
        issuer: inv.issuer,
        amount: Number(inv.amount),
        currency: (inv as any).currency || "EUR",
        type: inv.type as "incoming" | "outgoing",
        status: inv.status as "processing" | "ready" | "saved",
        createdAt: inv.created_at,
      }));
    },
    enabled: !!user,
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (invoice: Omit<InvoiceData, "id" | "createdAt">) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("invoices")
        .insert({
          user_id: user.id,
          file_name: invoice.fileName,
          file_url: invoice.fileUrl,
          date: invoice.date,
          year: invoice.year,
          month: invoice.month,
          issuer: invoice.issuer,
          amount: invoice.amount,
          currency: invoice.currency || "EUR",
          type: invoice.type,
          status: invoice.status,
          payment_method: invoice.paymentMethod || "bank",
          invoice_number: invoice.invoiceNumber || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Rechnung gespeichert" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (invoice: InvoiceData) => {
      const { data, error } = await supabase
        .from("invoices")
        .update({
          file_name: invoice.fileName,
          date: invoice.date,
          year: invoice.year,
          month: invoice.month,
          issuer: invoice.issuer,
          amount: invoice.amount,
          currency: invoice.currency || "EUR",
          type: invoice.type,
          status: invoice.status,
        })
        .eq("id", invoice.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Rechnung aktualisiert" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Aktualisieren",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Rechnung gelöscht" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Löschen",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useBulkDeleteInvoices() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const promises = ids.map(id =>
        supabase.from("invoices").delete().eq("id", id)
      );
      const results = await Promise.all(promises);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) throw new Error(`${errors.length} Fehler beim Löschen`);
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: `${ids.length} Rechnungen gelöscht` });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Löschen",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export async function checkDuplicateInvoice(
  userId: string,
  invoice: { date: string; issuer: string; amount: number; fileName?: string }
): Promise<boolean> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, file_name, issuer, amount")
    .eq("user_id", userId)
    .eq("date", invoice.date);

  if (error) throw error;
  
  const hasDuplicate = (data || []).some(
    (existing) =>
      existing.issuer.toLowerCase().trim() === invoice.issuer.toLowerCase().trim() &&
      Math.abs(Number(existing.amount) - invoice.amount) < 0.01
  );
  
  return hasDuplicate;
}
