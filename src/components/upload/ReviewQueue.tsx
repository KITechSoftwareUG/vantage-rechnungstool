import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useInvoices } from "@/hooks/useDocuments";
import { useDuplicateDetection, useMergeDuplicate } from "@/hooks/useDuplicateDetection";
import { ReviewCard } from "./ReviewCard";
import { Loader2, Inbox, Trash2, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { useState, useCallback, useMemo } from "react";
import { resolveStorageUrl } from "@/lib/resolveStorageUrl";

function extractStoragePath(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  try {
    const parsed = new URL(fileUrl);
    const markers = [
      "/storage/v1/object/public/documents/",
      "/storage/v1/object/sign/documents/",
      "/storage/v1/object/authenticated/documents/",
    ];
    for (const marker of markers) {
      const idx = parsed.pathname.indexOf(marker);
      if (idx !== -1) {
        return decodeURIComponent(parsed.pathname.slice(idx + marker.length));
      }
    }
  } catch {}
  return null;
}

interface StorageRef {
  userId: string;
  year: number;
  month: number;
  fileName: string;
  fileUrl?: string | null;
}

function buildStoragePaths(refs: StorageRef[]): string[] {
  const paths = new Set<string>();
  for (const ref of refs) {
    const fromUrl = extractStoragePath(ref.fileUrl);
    if (fromUrl) paths.add(fromUrl);
    if (ref.userId && ref.year != null && ref.month != null && ref.fileName) {
      paths.add(`${ref.userId}/${ref.year}/${ref.month}/${ref.fileName}`);
      paths.add(`${ref.userId}/${ref.year}/${String(ref.month).padStart(2, "0")}/${ref.fileName}`);
    }
  }
  return Array.from(paths);
}

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

  // Fetch all confirmed invoices for duplicate detection across pending + confirmed
  const { data: confirmedInvoices = [] } = useInvoices();
  const mergeDuplicate = useMergeDuplicate();

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
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
      // Storage-Cleanup nur nach erfolgreichem DB-Delete, als fire-and-forget.
      // Scheitert das Storage-Remove, ist das kein User-sichtbarer Fehler.
      if (inv && user) {
        const paths = buildStoragePaths([
          { userId: user.id, year: inv.year, month: inv.month, fileName: inv.fileName, fileUrl: inv.fileUrl },
        ]);
        if (paths.length) {
          void supabase.storage.from("documents").remove(paths).then(
            () => undefined,
            () => undefined
          );
        }
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
      const { error } = await supabase.from("invoices").delete().in("id", ids);
      if (error) throw error;
      if (user) {
        const paths = buildStoragePaths(
          snapshot.map((inv) => ({
            userId: user.id,
            year: inv.year,
            month: inv.month,
            fileName: inv.fileName,
            fileUrl: inv.fileUrl,
          }))
        );
        if (paths.length) {
          void supabase.storage.from("documents").remove(paths).then(
            () => undefined,
            () => undefined
          );
        }
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

  // Combine pending + confirmed invoices for cross-status duplicate detection
  const allInvoicesForDuplicateCheck = useMemo(() => {
    const confirmed = confirmedInvoices.map((inv) => ({
      id: inv.id,
      date: inv.date,
      issuer: inv.issuer,
      amount: inv.amount,
      currency: inv.currency,
      fileName: inv.fileName,
      fileUrl: inv.fileUrl,
      status: inv.status,
      invoiceNumber: inv.invoiceNumber,
      fileHash: inv.fileHash,
    }));
    const pending = pendingInvoices.map((inv) => ({
      id: inv.id,
      date: inv.date,
      issuer: inv.issuer,
      amount: inv.amount,
      currency: inv.currency,
      fileName: inv.fileName,
      fileUrl: inv.fileUrl,
      status: "processing" as string,
      invoiceNumber: inv.invoiceNumber,
      fileHash: inv.fileHash,
    }));
    return [...pending, ...confirmed];
  }, [pendingInvoices, confirmedInvoices]);

  const duplicateMap = useDuplicateDetection(allInvoicesForDuplicateCheck);

  const handleMerge = useCallback(
    (keeperId: string, duplicateId: string) => mergeDuplicate.mutate({ keeperId, duplicateId }),
    [mergeDuplicate]
  );

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
            duplicates={duplicateMap.get(invoice.id) || []}
            onMerge={handleMerge}
            isMerging={mergeDuplicate.isPending}
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
