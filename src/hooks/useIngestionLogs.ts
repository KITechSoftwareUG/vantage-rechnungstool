import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MONTH_NAMES } from "@/types/documents";
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
  created_at: string;
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
  vrbank: "04 VR-Bank Kontoauszüge",
  amex: "05 AMEX Kontoauszüge",
  kasse: "06 Kasse",
  incoming: "01 Eingang",
  outgoing: "02 Ausgang",
  volksbank: "04 VR-Bank Kontoauszüge",
  commission: "03 Provisionsabrechnung",
  cash: "06 Kasse",
};

export const CATEGORY_LABELS: Record<string, string> = {
  eingang: "Eingangsrechnungen",
  ausgang: "Ausgangsrechnungen",
  vrbank: "VR-Bank Kontoauszüge",
  provision: "Provisionsabrechnungen",
  kasse: "Kasse",
  incoming: "Eingangsrechnungen",
  outgoing: "Ausgangsrechnungen",
  volksbank: "VR-Bank Kontoauszüge",
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
  return { success, errors, pending, total: categoryLogs.length };
}

// ---------- Hook ----------

const CATEGORY_ORDER = ["eingang", "incoming", "ausgang", "outgoing", "provision", "commission", "vrbank", "volksbank", "amex", "kasse", "cash"];

export function useIngestionLogs() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: logs, isLoading, refetch } = useQuery({
    queryKey: ["ingestion-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_ingestion_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as IngestionLog[];
    },
    refetchInterval: 10000,
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
      if (documentId) {
        const table = documentType === "bank_statement" ? "bank_statements" : "invoices";
        await supabase.from(table).delete().eq("id", documentId);
      }
      const { error } = await supabase.from("document_ingestion_log").delete().eq("id", logId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["bank-statements"] });
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
      for (const log of selected) {
        if (log.document_id) {
          const table = log.document_type === "bank_statement" ? "bank_statements" : "invoices";
          await supabase.from(table).delete().eq("id", log.document_id);
        }
      }
      const ids = selected.map((l) => l.id);
      const { error } = await supabase.from("document_ingestion_log").delete().in("id", ids);
      if (error) throw error;
      return selectedIds.size;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["bank-statements"] });
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
