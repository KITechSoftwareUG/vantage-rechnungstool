import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { InvoiceData } from "@/types/documents";
import { useToast } from "@/hooks/use-toast";
import { resolveStorageUrl } from "@/lib/resolveStorageUrl";
import { buildStoragePaths } from "@/lib/storagePaths";

interface InvoiceDeleteRef {
  id: string;
  user_id: string | null;
  year: number | null;
  month: number | null;
  file_name: string | null;
  file_url: string | null;
}

async function deleteIngestionLogs(logIds: string[]): Promise<void> {
  if (!logIds.length) return;
  const run = () =>
    supabase.from("document_ingestion_log").delete().in("id", logIds);
  let { error } = await run();
  if (error) {
    const retry = await run();
    error = retry.error;
  }
  if (error) {
    console.error("[useInvoices] ingestion log cleanup failed", error);
  }
}

async function removeStoragePaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const run = () => supabase.storage.from("documents").remove(paths);
  let { error } = await run();
  if (error) {
    const retry = await run();
    error = retry.error;
  }
  if (error) {
    console.error("[useInvoices] storage cleanup failed", error);
  }
}

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

      const invoices = await Promise.all(
        (data || []).map(async (inv) => {
          const fileUrl = await resolveStorageUrl(
            user.id, inv.year, inv.month, inv.file_name, inv.file_url
          );
          return {
            id: inv.id,
            fileName: inv.file_name,
            fileUrl,
            date: inv.date,
            year: inv.year,
            month: inv.month,
            issuer: inv.issuer,
            amount: Number(inv.amount),
            currency: (inv as any).currency || "EUR",
            type: inv.type as "incoming" | "outgoing",
            status: inv.status as "processing" | "ready" | "saved",
            createdAt: inv.created_at,
            invoiceNumber: (inv as any).invoice_number ?? null,
            fileHash: (inv as any).file_hash ?? null,
          } as InvoiceData;
        })
      );

      return invoices;
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
      // Regenerate standardized filename from metadata
      const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9äöüÄÖÜß\-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      const currency = invoice.currency || "EUR";
      const amount = Math.abs(invoice.amount).toFixed(2).replace(".", ",");
      const issuer = sanitize(invoice.issuer || "Unbekannt");
      const ext = invoice.fileName.split(".").pop() || "pdf";
      const newFileName = `${invoice.date}_${issuer}_${amount}${currency}.${ext}`;

      const { data, error } = await supabase
        .from("invoices")
        .update({
          file_name: newFileName,
          date: invoice.date,
          year: invoice.year,
          month: invoice.month,
          issuer: invoice.issuer,
          amount: invoice.amount,
          currency: currency,
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
      // Zuerst alle referenzierten Daten einsammeln, damit wir nach dem
      // Invoice-Delete Storage + Ingestion-Log deterministisch aufraeumen
      // koennen. RLS-Kaskaden oder Race Conditions helfen hier nicht.
      const { data: invData } = await supabase
        .from("invoices")
        .select("id, user_id, year, month, file_name, file_url")
        .eq("id", id)
        .single();
      const invRow = invData as unknown as InvoiceDeleteRef | null;

      const { data: logRows } = await supabase
        .from("document_ingestion_log")
        .select("id")
        .eq("document_id", id);
      const logIds = ((logRows ?? []) as { id: string }[]).map((r) => r.id);

      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;

      // Nach erfolgreichem Invoice-Delete: best-effort Cleanup. Fehler hier
      // kippen den User-Flow nicht — nur console.error.
      await deleteIngestionLogs(logIds);

      if (invRow) {
        const paths = buildStoragePaths([
          {
            userId: invRow.user_id,
            year: invRow.year,
            month: invRow.month,
            fileName: invRow.file_name,
            fileUrl: invRow.file_url,
          },
        ]);
        await removeStoragePaths(paths);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
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
      if (!ids.length) return;

      // Snapshot aller Invoice-Daten + Log-IDs vor dem Delete, damit wir
      // danach deterministisch Storage + Ingestion-Log aufraeumen koennen.
      const { data: invRows } = await supabase
        .from("invoices")
        .select("id, user_id, year, month, file_name, file_url")
        .in("id", ids);
      const snapshot = (invRows ?? []) as unknown as InvoiceDeleteRef[];

      const { data: logRows } = await supabase
        .from("document_ingestion_log")
        .select("id, document_id")
        .in("document_id", ids);

      const promises = ids.map((id) =>
        supabase.from("invoices").delete().eq("id", id).then((res) => ({ id, res }))
      );
      const results = await Promise.all(promises);
      const successfulIds = results.filter((r) => !r.res.error).map((r) => r.id);
      const errors = results.filter((r) => r.res.error);

      // Cleanup nur fuer erfolgreich geloeschte Invoices — sonst bleiben
      // bei Teil-Fehlern orphaned Logs/Storage liegen.
      const logRowsTyped = (logRows ?? []) as { id: string; document_id: string }[];
      const successfulLogIds = logRowsTyped
        .filter((l) => successfulIds.includes(l.document_id))
        .map((l) => l.id);
      await deleteIngestionLogs(successfulLogIds);

      const paths = buildStoragePaths(
        snapshot
          .filter((inv) => successfulIds.includes(inv.id))
          .map((inv) => ({
            userId: inv.user_id,
            year: inv.year,
            month: inv.month,
            fileName: inv.file_name,
            fileUrl: inv.file_url,
          }))
      );
      await removeStoragePaths(paths);

      if (errors.length > 0) throw new Error(`${errors.length} Fehler beim Löschen`);

      return { successfulCount: successfulIds.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      toast({ title: `${data?.successfulCount ?? 0} Rechnungen gelöscht` });
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
