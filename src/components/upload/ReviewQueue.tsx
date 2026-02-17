import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ReviewCard } from "./ReviewCard";
import { Loader2, Inbox, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { useState } from "react";

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
}

export function ReviewQueue() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [discardId, setDiscardId] = useState<string | null>(null);
  const [discardAll, setDiscardAll] = useState(false);

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
      return (data || []).map((inv) => ({
        id: inv.id,
        fileName: inv.file_name,
        fileUrl: inv.file_url || "",
        date: inv.date,
        issuer: inv.issuer,
        amount: Number(inv.amount),
        currency: (inv as any).currency || "EUR",
        type: inv.type as "incoming" | "outgoing",
        invoiceNumber: inv.invoice_number,
        paymentMethod: inv.payment_method,
        year: inv.year,
        month: inv.month,
      }));
    },
    enabled: !!user,
    refetchInterval: 10000,
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
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Rechnung verworfen" });
      setDiscardId(null);
    },
    onError: (error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      setDiscardId(null);
    },
  });

  const discardAllMutation = useMutation({
    mutationFn: async () => {
      const ids = pendingInvoices.map((inv) => inv.id);
      const { error } = await supabase.from("invoices").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Alle Rechnungen verworfen" });
      setDiscardAll(false);
    },
    onError: (error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      setDiscardAll(false);
    },
  });

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
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDiscardAll(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Alle verwerfen
          </Button>
        )}
      </div>
      <div className="space-y-4">
        {pendingInvoices.map((invoice, index) => (
          <ReviewCard
            key={invoice.id}
            invoice={invoice}
            onConfirm={(data) => confirmMutation.mutate(data)}
            onDiscard={(id) => setDiscardId(id)}
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
    </div>
  );
}
