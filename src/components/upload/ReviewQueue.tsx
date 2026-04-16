import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
// Dedup passiert ausschliesslich im Matching-Tool nach der Bestaetigung.
// In der Review-Queue werden Duplikate NICHT erwaehnt.
import { ReviewCard } from "./ReviewCard";
import { Loader2, Inbox, Trash2, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { useState, useCallback } from "react";
import { resolveStorageUrl } from "@/lib/resolveStorageUrl";
import { buildStoragePaths } from "@/lib/storagePaths";

interface PendingInvoice {
  id: string;
  fileName: string;
  fileUrl: string;
  date: string;
  issuer: string;
  amount: number;
  currency: string;
  type: "incoming" | "outgoing";
  invoiceNumber: string | null;
  paymentMethod: string;
  year: number;
  month: number;
  fileHash: string | null;
}


export function ReviewQueue() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [discardId, setDiscardId] = useState<string | null>(null);
  const [discardAll, setDiscardAll] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const { data: pendingInvoices = [], isLoading } = useQuery({
    queryKey: ["pending-invoices", user?.id],
    queryFn: async (): Promise<PendingInvoice[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("status", "processing")
        .order("created_at", { ascending: false });

      if (error) throw error;
      const invoices = await Promise.all(
        (data || []).map(async (inv) => {
          const resolvedFileUrl = await resolveStorageUrl(
            user.id,
            inv.year,
            inv.month,
            inv.file_name,
            inv.file_url
          );

          return {
            id: inv.id,
            fileName: inv.file_name,
            fileUrl: resolvedFileUrl,
            date: inv.date,
            issuer: inv.issuer,
            amount: Number(inv.amount),
            currency: (inv as any).currency || "EUR",
            type: inv.type as "incoming" | "outgoing",
            invoiceNumber: inv.invoice_number,
            paymentMethod: inv.payment_method,
            year: inv.year,
            month: inv.month,
            fileHash: (inv as any).file_hash ?? null,
          } as PendingInvoice;
        })
      );

      return invoices;
    },
    enabled: !!user,
    // 3 s statt 10 s: OCR-Pipeline braucht mit Flash typischerweise 3-8 s,
    // ein schnellerer Refetch verkürzt die gefühlte Upload→Sichtbar-Latenz.
    refetchInterval: 3000,
  });

  const confirmMutation = useMutation({
    mutationFn: async (invoice: PendingInvoice) => {
      const { error } = await supabase
        .from("invoices")
        .update({
          date: invoice.date,
          year: invoice.year,
          month: invoice.month,
          issuer: invoice.issuer,
          amount: invoice.amount,
          type: invoice.type,
          invoice_number: invoice.invoiceNumber,
          status: "ready",
        })
        .eq("id", invoice.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Rechnung bestätigt und gespeichert" });
    },
    onError: (error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    },
  });

  const discardMutation = useMutation({
    mutationFn: async (id: string) => {
      const inv = pendingInvoices.find((p) => p.id === id);
      // Vollstaendig entfernen: Storage-File zuerst (best-effort mit 1 Retry),
      // dann Invoice-Record, dann Ingestion-Log-Eintrag.
      //
      // Ingestion-Log-IDs ZUERST queryen (vor Deletes), damit wir nach dem
      // Invoice-Delete deterministisch aufraeumen koennen und nicht von Race
      // Conditions mit RLS-Kaskaden abhaengig sind.
      const { data: logRows } = await supabase
        .from("document_ingestion_log")
        .select("id")
        .eq("document_id", id);
      const logIds = (logRows || []).map((r: any) => r.id);

      // Schritt 1: Storage-Cleanup best-effort mit 1 Retry.
      // Selbst wenn das fehlschlaegt, loeschen wir die DB-Zeile trotzdem
      // (der User will den Eintrag loswerden) — warnen aber via Toast.
      let storageCleanupFailed = false;
      let storagePathsAttempted: string[] = [];
      if (inv && user) {
        storagePathsAttempted = buildStoragePaths([
          { userId: user.id, year: inv.year, month: inv.month, fileName: inv.fileName, fileUrl: inv.fileUrl },
        ]);
        if (storagePathsAttempted.length) {
          const tryRemove = () => supabase.storage.from("documents").remove(storagePathsAttempted);
          let { error: rmErr } = await tryRemove();
          if (rmErr) {
            const retry = await tryRemove();
            rmErr = retry.error;
          }
          if (rmErr) {
            storageCleanupFailed = true;
            console.error(
              `Storage cleanup failed for path ${storagePathsAttempted.join(", ")} — orphan file may remain`,
              rmErr
            );
          }
        }
      }

      // Schritt 2: Invoice-Delete. Wenn das failt, NICHT das ingestion-log
      // loeschen — sonst ist der Log-Eintrag weg aber die Invoice-Zeile steht.
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;

      // Schritt 3: Ingestion-Log-Delete mit 1 Retry, kein throw bei Failure.
      if (logIds.length) {
        const deleteLog = () =>
          supabase.from("document_ingestion_log").delete().in("id", logIds);
        let { error: logErr } = await deleteLog();
        if (logErr) {
          const retry = await deleteLog();
          logErr = retry.error;
        }
        if (logErr) {
          console.error("Ingestion-Log-Delete fehlgeschlagen nach erfolgreichem Invoice-Delete:", logErr);
          toast({
            title: "Hinweis",
            description: "Rechnung verworfen, aber Einspeisungs-Log-Eintrag konnte nicht entfernt werden.",
          });
        }
      }

      // Schritt 4: Storage-Warnung erst jetzt, nachdem DB-Delete sicher durch ist.
      if (storageCleanupFailed) {
        toast({
          title: "Datei wurde als verworfen markiert, aber die physische Datei konnte nicht gelöscht werden. Admin informieren.",
          variant: "destructive",
        });
      }
    },
    onMutate: async (id: string) => {
      setDiscardId(null);
      await queryClient.cancelQueries({ queryKey: ["pending-invoices"] });
      const previous = queryClient.getQueryData<PendingInvoice[]>(["pending-invoices", user?.id]);
      queryClient.setQueryData<PendingInvoice[]>(
        ["pending-invoices", user?.id],
        (old) => (old || []).filter((p) => p.id !== id)
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      toast({ title: "Rechnung verworfen" });
    },
    onError: (error, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["pending-invoices", user?.id], ctx.previous);
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
    },
  });

  const confirmAllMutation = useMutation({
    mutationFn: async () => {
      // Promise.allSettled statt Promise.all: ein Fehler in der Mitte des
      // Batches darf nicht alle nachfolgenden Updates verschlucken. Wir
      // liefern detaillierte Fehler pro Datei zurück, damit der User sieht,
      // welche Rechnung wirklich gehängt hat.
      const updates = pendingInvoices.map(async (inv) => {
        const { error } = await supabase
          .from("invoices")
          .update({
            date: inv.date,
            year: inv.year,
            month: inv.month,
            issuer: inv.issuer,
            amount: inv.amount,
            type: inv.type,
            invoice_number: inv.invoiceNumber,
            status: "ready",
          })
          .eq("id", inv.id);
        if (error) throw new Error(`${inv.fileName}: ${error.message}`);
        return inv;
      });
      const results = await Promise.allSettled(updates);
      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
      const successCount = results.length - failures.length;
      return { successCount, failures };
    },
    onSuccess: ({ successCount, failures }) => {
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      if (successCount > 0) {
        toast({ title: `${successCount} Rechnung${successCount === 1 ? "" : "en"} bestätigt` });
      }
      // Pro Fehler eine eigene Toast — bei Massen-Aktion können das viele
      // sein, deshalb cappen wir bei 3 und fassen den Rest zusammen.
      const previewFailures = failures.slice(0, 3);
      for (const msg of previewFailures) {
        toast({ title: "Bestätigung fehlgeschlagen", description: msg, variant: "destructive" });
      }
      if (failures.length > previewFailures.length) {
        toast({
          title: `${failures.length - previewFailures.length} weitere Fehler`,
          description: "Siehe Konsole für Details.",
          variant: "destructive",
        });
        console.error("Bulk confirm failures:", failures);
      }
      setConfirmAll(false);
    },
    onError: (error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      setConfirmAll(false);
    },
  });

  const discardAllMutation = useMutation({
    mutationFn: async () => {
      const snapshot = pendingInvoices.slice();
      const ids = snapshot.map((inv) => inv.id);

      // Schritt 1: Storage-Cleanup best-effort mit 1 Retry (vor DB-Delete,
      // gleiche Reihenfolge wie Single-Discard).
      let storageCleanupFailed = false;
      let storagePathsAttempted: string[] = [];
      if (user) {
        storagePathsAttempted = buildStoragePaths(
          snapshot.map((inv) => ({
            userId: user.id,
            year: inv.year,
            month: inv.month,
            fileName: inv.fileName,
            fileUrl: inv.fileUrl,
          }))
        );
        if (storagePathsAttempted.length) {
          const tryRemove = () => supabase.storage.from("documents").remove(storagePathsAttempted);
          let { error: rmErr } = await tryRemove();
          if (rmErr) {
            const retry = await tryRemove();
            rmErr = retry.error;
          }
          if (rmErr) {
            storageCleanupFailed = true;
            console.error(
              `Storage cleanup failed for paths ${storagePathsAttempted.join(", ")} — orphan files may remain`,
              rmErr
            );
          }
        }
      }

      // Schritt 2: Invoice-Delete. Bei Fehler kein Log-Delete.
      const { error } = await supabase.from("invoices").delete().in("id", ids);
      if (error) throw error;

      // Schritt 3: Ingestion-Log-Delete mit 1 Retry, kein throw bei Failure.
      const deleteLog = () =>
        supabase.from("document_ingestion_log").delete().in("document_id", ids);
      let { error: logErr } = await deleteLog();
      if (logErr) {
        const retry = await deleteLog();
        logErr = retry.error;
      }
      if (logErr) {
        console.error("Ingestion-Log-Delete fehlgeschlagen nach erfolgreichem Invoice-Delete:", logErr);
        toast({
          title: "Hinweis",
          description: "Rechnungen verworfen, aber Einspeisungs-Log-Eintraege konnten nicht entfernt werden.",
        });
      }

      if (storageCleanupFailed) {
        toast({
          title: "Dateien wurden als verworfen markiert, aber die physischen Dateien konnten nicht gelöscht werden. Admin informieren.",
          variant: "destructive",
        });
      }
    },
    onMutate: async () => {
      setDiscardAll(false);
      await queryClient.cancelQueries({ queryKey: ["pending-invoices"] });
      const previous = queryClient.getQueryData<PendingInvoice[]>(["pending-invoices", user?.id]);
      queryClient.setQueryData<PendingInvoice[]>(["pending-invoices", user?.id], []);
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      toast({ title: "Alle Rechnungen verworfen" });
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["pending-invoices", user?.id], ctx.previous);
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
    },
  });

  const handleConfirmOne = useCallback((data: PendingInvoice) => confirmMutation.mutate(data), [confirmMutation]);
  const handleDiscardOne = useCallback((id: string) => setDiscardId(id), []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (pendingInvoices.length === 0) {
    return null; // Don't show anything if no pending documents
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Zur Überprüfung ({pendingInvoices.length})
          </h2>
        </div>
        {pendingInvoices.length > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => setConfirmAll(true)}
            >
              <CheckCheck className="h-4 w-4 mr-1" />
              Alle bestätigen
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDiscardAll(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Alle verwerfen
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-4">
        {pendingInvoices.map((invoice, index) => (
          <ReviewCard
            key={invoice.id}
            invoice={invoice}
            onConfirm={handleConfirmOne}
            onDiscard={handleDiscardOne}
            index={index}
          />
        ))}
      </div>
      <DeleteConfirmationDialog
        open={!!discardId}
        onOpenChange={(open) => !open && setDiscardId(null)}
        onConfirm={() => discardId && discardMutation.mutate(discardId)}
        title="Rechnung verwerfen"
        description="Möchten Sie diese Rechnung wirklich verwerfen? Das Dokument wird gelöscht."
        isDeleting={discardMutation.isPending}
      />
      <DeleteConfirmationDialog
        open={discardAll}
        onOpenChange={(open) => !open && setDiscardAll(false)}
        onConfirm={() => discardAllMutation.mutate()}
        title="Alle Rechnungen verwerfen"
        description={`Möchten Sie wirklich alle ${pendingInvoices.length} Rechnungen verwerfen? Alle Dokumente werden gelöscht.`}
        isDeleting={discardAllMutation.isPending}
      />
      <DeleteConfirmationDialog
        open={confirmAll}
        onOpenChange={(open) => !open && setConfirmAll(false)}
        onConfirm={() => confirmAllMutation.mutate()}
        title="Alle Rechnungen bestätigen"
        description={`Möchten Sie wirklich alle ${pendingInvoices.length} Rechnungen mit den aktuellen Daten bestätigen?`}
        isDeleting={confirmAllMutation.isPending}
        confirmLabel="Alle bestätigen"
      />
    </div>
  );
}
