import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MONTH_NAMES } from "@/types/documents";
import { buildStoragePaths } from "@/lib/storagePaths";
import { resetTransactionMatches } from "@/lib/matchReset";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building,
  CreditCard,
  Receipt,
  Wallet,
  FileText,
} from "lucide-react";

// ---------- Types ----------

export interface IngestionLog {
  id: string;
  endpoint_category: string;
  endpoint_year: number;
  endpoint_month: number | null;
  file_name: string;
  document_type: string;
  document_id: string | null;
  status: string;
  error_message: string | null;
  warning_message?: string | null;
  created_at: string;
  /** Status of the linked document (invoice/statement) – e.g. "ready", "processing" */
  document_status?: string | null;
}

export interface IngestionMonthGroup {
  month: number;
  year: number;
  logs: IngestionLog[];
}

export interface IngestionCategoryGroup {
  category: string;
  months: IngestionMonthGroup[];
  allLogs: IngestionLog[];
}

// ---------- Constants ----------

export const CATEGORY_ICONS: Record<string, React.ElementType> = {
  eingang: ArrowDownLeft,
  ausgang: ArrowUpRight,
  vrbank: Building,
  provision: Receipt,
  kasse: Wallet,
  incoming: ArrowDownLeft,
  outgoing: ArrowUpRight,
  volksbank: Building,
  commission: Receipt,
  cash: Wallet,
};

export const CATEGORY_FOLDER_NAMES: Record<string, string> = {
  eingang: "01 Eingang",
  ausgang: "02 Ausgang",
  provision: "03 Provisionsabrechnung",
  vrbank: "04 Kontoauszüge",
  amex: "05 AMEX Kontoauszüge",
  kasse: "06 Kasse",
  incoming: "01 Eingang",
  outgoing: "02 Ausgang",
  volksbank: "04 Kontoauszüge",
  commission: "03 Provisionsabrechnung",
  cash: "06 Kasse",
};

export const CATEGORY_LABELS: Record<string, string> = {
  eingang: "Eingangsrechnungen",
  ausgang: "Ausgangsrechnungen",
  vrbank: "Kontoauszüge",
  provision: "Provisionsabrechnungen",
  kasse: "Kasse",
  incoming: "Eingangsrechnungen",
  outgoing: "Ausgangsrechnungen",
  volksbank: "Kontoauszüge",
  amex: "AMEX Kontoauszüge",
  commission: "Provisionsabrechnungen",
  cash: "Kasse",
};

// ---------- Helpers ----------

export function getMonthFolderName(month: number): string {
  return `${String(month).padStart(2, "0")} ${MONTH_NAMES[month - 1]}`;
}

export function getSourceBreadcrumb(log: IngestionLog): string[] {
  const parts: string[] = [];
  parts.push(String(log.endpoint_year));
  parts.push(CATEGORY_FOLDER_NAMES[log.endpoint_category] || log.endpoint_category);
  if (log.endpoint_month) {
    parts.push(getMonthFolderName(log.endpoint_month));
  }
  return parts;
}

export function getStatusSummary(categoryLogs: IngestionLog[]) {
  const success = categoryLogs.filter((l) => l.status === "completed" || l.status === "success").length;
  const errors = categoryLogs.filter((l) => l.status === "error").length;
  const pending = categoryLogs.filter((l) => l.status === "processing" || l.status === "received").length;
  const confirmed = categoryLogs.filter((l) => l.document_status === "ready" || l.document_status === "saved").length;
  // Kontoauszüge werden automatisch übernommen (zweiter OCR-Pass im Webhook),
  // es gibt keine manuelle Review-UI dafür. Sie dürfen nicht als
  // "zur Überprüfung" gezählt werden, auch nicht bei Altdaten mit status="processing".
  const awaitingReview = categoryLogs.filter(
    (l) => l.document_status === "processing" && l.document_type !== "bank_statement"
  ).length;
  return { success, errors, pending, confirmed, awaitingReview, total: categoryLogs.length };
}

// ---------- Hook ----------

const CATEGORY_ORDER = ["eingang", "incoming", "ausgang", "outgoing", "provision", "commission", "vrbank", "volksbank", "amex", "kasse", "cash"];

export function useIngestionLogs() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: logs, isLoading, refetch } = useQuery({
    queryKey: ["ingestion-logs"],
    queryFn: async () => {
      // Filter serverseitig anwenden, damit das Limit erst NACH den Filtern
      // greift. Sonst schneidet .limit() auf 200 Rohzeilen und clientseitige
      // Filter reduzieren die sichtbare Liste weiter — was die Ingest-Zahl
      // kuenstlich kleiner macht als die Rechnungs-Gesamtzahl.
      const { data, error } = await supabase
        .from("document_ingestion_log")
        .select("*")
        .neq("document_type", "bank_statement")
        .neq("status", "duplicate")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;

      const rawLogs = data as IngestionLog[];

      // Enrich with linked document status
      const invoiceIds = rawLogs.filter(l => l.document_id).map(l => l.document_id!);

      const statusMap: Record<string, string> = {};

      if (invoiceIds.length > 0) {
        const { data: invoices } = await supabase
          .from("invoices")
          .select("id, status")
          .in("id", invoiceIds);
        invoices?.forEach(inv => { statusMap[inv.id] = inv.status; });
      }

      return rawLogs.map(log => ({
        ...log,
        document_status: log.document_id ? (statusMap[log.document_id] ?? null) : null,
      }));
    },
    // Adaptive Polling-Frequenz:
    // - 3 s wenn aktive `processing`-Logs existieren (User wartet auf OCR)
    // - 15 s sonst (nur Status-Aktualisierungen, keine Eile)
    // - false wenn Tab versteckt (kein Polling im Hintergrund)
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return false;
      }
      const data = query.state.data as IngestionLog[] | undefined;
      const hasProcessing = data?.some((l) => l.status === "processing") ?? false;
      return hasProcessing ? 3000 : 15000;
    },
    refetchIntervalInBackground: false,
  });

  const groupedLogs = useMemo((): IngestionCategoryGroup[] => {
    if (!logs) return [];
    const groups: Record<string, IngestionCategoryGroup> = {};

    for (const log of logs) {
      const key = log.endpoint_category;
      if (!groups[key]) {
        groups[key] = { category: key, months: [], allLogs: [] };
      }
      groups[key].allLogs.push(log);
    }

    for (const group of Object.values(groups)) {
      const monthMap: Record<string, IngestionMonthGroup> = {};
      for (const log of group.allLogs) {
        const m = log.endpoint_month ?? 0;
        const y = log.endpoint_year;
        const mk = `${y}-${m}`;
        if (!monthMap[mk]) {
          monthMap[mk] = { month: m, year: y, logs: [] };
        }
        monthMap[mk].logs.push(log);
      }
      group.months = Object.values(monthMap).sort((a, b) => b.year - a.year || b.month - a.month);
    }

    return Object.values(groups).sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.category);
      const bi = CATEGORY_ORDER.indexOf(b.category);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [logs]);

  const deleteMutation = useMutation({
    mutationFn: async ({ logId, documentId, documentType }: { logId: string; documentId: string | null; documentType: string }) => {
      const storagePaths: string[] = [];
      if (documentId) {
        const table = documentType === "bank_statement" ? "bank_statements" : "invoices";
        const { data: row } = await supabase
          .from(table)
          .select("file_url, year, month, file_name, user_id")
          .eq("id", documentId)
          .maybeSingle();
        if (documentType !== "bank_statement") {
          await resetTransactionMatches([documentId]);
        }
        const { error: delErr } = await supabase.from(table).delete().eq("id", documentId);
        if (delErr) throw delErr;
        if (row) {
          storagePaths.push(
            ...buildStoragePaths([
              {
                userId: row.user_id,
                year: row.year,
                month: row.month,
                fileName: row.file_name,
                fileUrl: row.file_url,
              },
            ])
          );
        }
      }
      const { error } = await supabase.from("document_ingestion_log").delete().eq("id", logId);
      if (error) throw error;

      if (storagePaths.length > 0) {
        const removeOnce = () => supabase.storage.from("documents").remove(storagePaths);
        let { error: storageErr } = await removeOnce();
        if (storageErr) {
          const retry = await removeOnce();
          storageErr = retry.error;
        }
        if (storageErr) {
          console.error("[useIngestionLogs] Storage-Cleanup fehlgeschlagen", storageErr, storagePaths);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["bank_statements"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      toast({ title: "Dokument entfernt" });
    },
    onError: (error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (selectedIds: Set<string>) => {
      if (!logs) return;
      const selected = logs.filter((l) => selectedIds.has(l.id));

      const invoiceIds = selected
        .filter((l) => l.document_id && l.document_type !== "bank_statement")
        .map((l) => l.document_id!) as string[];
      const statementIds = selected
        .filter((l) => l.document_id && l.document_type === "bank_statement")
        .map((l) => l.document_id!) as string[];

      const refs: Parameters<typeof buildStoragePaths>[0] = [];

      if (invoiceIds.length > 0) {
        const { data: invoiceRows } = await supabase
          .from("invoices")
          .select("id, file_url, year, month, file_name, user_id")
          .in("id", invoiceIds);
        invoiceRows?.forEach((r) =>
          refs.push({
            userId: r.user_id,
            year: r.year,
            month: r.month,
            fileName: r.file_name,
            fileUrl: r.file_url,
          })
        );
        await resetTransactionMatches(invoiceIds);
        const { error: invErr } = await supabase.from("invoices").delete().in("id", invoiceIds);
        if (invErr) throw invErr;
      }

      if (statementIds.length > 0) {
        const { data: statementRows } = await supabase
          .from("bank_statements")
          .select("id, file_url, year, month, file_name, user_id")
          .in("id", statementIds);
        statementRows?.forEach((r) =>
          refs.push({
            userId: r.user_id,
            year: r.year,
            month: r.month,
            fileName: r.file_name,
            fileUrl: r.file_url,
          })
        );
        const { error: stErr } = await supabase.from("bank_statements").delete().in("id", statementIds);
        if (stErr) throw stErr;
      }

      const ids = selected.map((l) => l.id);
      const { error } = await supabase.from("document_ingestion_log").delete().in("id", ids);
      if (error) throw error;

      const storagePaths = buildStoragePaths(refs);
      if (storagePaths.length > 0) {
        const removeOnce = () => supabase.storage.from("documents").remove(storagePaths);
        let { error: storageErr } = await removeOnce();
        if (storageErr) {
          const retry = await removeOnce();
          storageErr = retry.error;
        }
        if (storageErr) {
          console.error("[useIngestionLogs] Bulk-Storage-Cleanup fehlgeschlagen", storageErr, storagePaths);
        }
      }

      return selectedIds.size;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["bank_statements"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      toast({ title: `${count} Dokument${count !== 1 ? "e" : ""} entfernt` });
    },
    onError: (error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    },
  });

  return {
    logs,
    isLoading,
    refetch,
    groupedLogs,
    deleteMutation,
    bulkDeleteMutation,
  };
}
