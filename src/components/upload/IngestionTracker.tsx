import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { MONTH_NAMES } from "@/types/documents";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  FileText, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Building, 
  CreditCard,
  Receipt,
  Wallet,
  RefreshCw,
  ChevronRight,
  FolderOpen,
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { Checkbox } from "@/components/ui/checkbox";

interface IngestionLog {
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

const CATEGORY_ICONS: Record<string, React.ElementType> = {
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

const CATEGORY_FOLDER_NAMES: Record<string, string> = {
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

const CATEGORY_LABELS: Record<string, string> = {
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

function getMonthFolderName(month: number): string {
  return `${String(month).padStart(2, "0")} ${MONTH_NAMES[month - 1]}`;
}

function getSourceBreadcrumb(log: IngestionLog) {
  const parts: string[] = [];
  parts.push(String(log.endpoint_year));
  parts.push(CATEGORY_FOLDER_NAMES[log.endpoint_category] || log.endpoint_category);
  if (log.endpoint_month) {
    parts.push(getMonthFolderName(log.endpoint_month));
  }
  return parts;
}

export function IngestionTracker() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [deleteLogId, setDeleteLogId] = useState<string | null>(null);
  const [deleteLogDocId, setDeleteLogDocId] = useState<string | null>(null);
  const [deleteLogDocType, setDeleteLogDocType] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
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

  const groupedLogs = useMemo(() => {
    if (!logs) return [];
    const groups: Record<string, { category: string; logs: IngestionLog[] }> = {};
    for (const log of logs) {
      const key = log.endpoint_category;
      if (!groups[key]) {
        groups[key] = { category: key, logs: [] };
      }
      groups[key].logs.push(log);
    }
    // Sort categories by folder name order
    const order = ["eingang", "incoming", "ausgang", "outgoing", "provision", "commission", "vrbank", "volksbank", "amex", "kasse", "cash"];
    return Object.values(groups).sort((a, b) => {
      const ai = order.indexOf(a.category);
      const bi = order.indexOf(b.category);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [logs]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!logs) return;
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map((l) => l.id)));
    }
  };

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ingestion-logs"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["bank-statements"] });
      queryClient.invalidateQueries({ queryKey: ["pending-invoices"] });
      toast({ title: `${selectedIds.size} Dokument${selectedIds.size !== 1 ? "e" : ""} entfernt` });
      setSelectedIds(new Set());
      setShowBulkDelete(false);
    },
    onError: (error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      setShowBulkDelete(false);
    },
  });
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
      setDeleteLogId(null);
    },
    onError: (error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      setDeleteLogId(null);
    },
  });

  const handleDeleteClick = (log: IngestionLog) => {
    setDeleteLogId(log.id);
    setDeleteLogDocId(log.document_id ?? null);
    setDeleteLogDocType(log.document_type);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
      case "success":
        return (
          <Badge variant="secondary" className="gap-1 bg-primary/20 text-primary text-xs">
            <CheckCircle2 className="h-3 w-3" />
            Erfolgreich
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="gap-1 text-xs">
            <XCircle className="h-3 w-3" />
            Fehler
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="secondary" className="gap-1 text-xs">
            <Clock className="h-3 w-3 animate-pulse" />
            Verarbeitung
          </Badge>
        );
      case "received":
        return (
          <Badge variant="outline" className="gap-1 text-xs">
            <Clock className="h-3 w-3" />
            Empfangen
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1 text-xs">
            <Clock className="h-3 w-3" />
            {status}
          </Badge>
        );
    }
  };

  const getStatusSummary = (categoryLogs: IngestionLog[]) => {
    const success = categoryLogs.filter((l) => l.status === "completed" || l.status === "success").length;
    const errors = categoryLogs.filter((l) => l.status === "error").length;
    const pending = categoryLogs.filter((l) => l.status === "processing" || l.status === "received").length;
    return { success, errors, pending, total: categoryLogs.length };
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5" />
          Eingespeiste Dokumente
        </CardTitle>
        <div className="flex items-center gap-2">
          {logs && logs.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedIds.size === logs.length && logs.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-xs text-muted-foreground">Alle</span>
              </div>
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1"
                  onClick={() => setShowBulkDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {selectedIds.size} löschen
                </Button>
              )}
            </>
          )}
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!logs || logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              Noch keine Dokumente über n8n eingespeist
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Dokumente erscheinen hier, sobald sie über die Webhook-Endpoints ankommen
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {groupedLogs.map((group) => {
              const Icon = CATEGORY_ICONS[group.category] || FileText;
              const label = CATEGORY_LABELS[group.category] || group.category;
              const summary = getStatusSummary(group.logs);
              const isOpen = openCategories[group.category] !== false; // default open

              return (
                <Collapsible
                  key={group.category}
                  open={isOpen}
                  onOpenChange={() => toggleCategory(group.category)}
                >
                  <CollapsibleTrigger asChild>
                    <button className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{label}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{summary.total} Dokument{summary.total !== 1 ? "e" : ""}</span>
                          {summary.errors > 0 && (
                            <span className="text-destructive">{summary.errors} Fehler</span>
                          )}
                          {summary.pending > 0 && (
                            <span className="text-warning">{summary.pending} ausstehend</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-4 mt-1 space-y-1 border-l-2 border-muted pl-4">
                      {group.logs.map((log) => {
                        const breadcrumb = getSourceBreadcrumb(log);
                        return (
                          <div
                            key={log.id}
                            className="flex items-start gap-3 rounded-md p-2.5 transition-colors hover:bg-muted/30"
                          >
                            <Checkbox
                              checked={selectedIds.has(log.id)}
                              onCheckedChange={() => toggleSelect(log.id)}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-medium">
                                  {log.file_name}
                                </p>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {getStatusBadge(log.status)}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteClick(log); }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <FolderOpen className="h-3 w-3 shrink-0" />
                                {breadcrumb.map((part, i) => (
                                  <span key={i} className="flex items-center gap-1">
                                    {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                                    <span>{part}</span>
                                  </span>
                                ))}
                              </div>
                              <p className="text-xs text-muted-foreground/70">
                                {format(new Date(log.created_at), "dd. MMM yyyy, HH:mm", { locale: de })}
                              </p>
                              {log.error_message && (
                                <p className="text-xs text-destructive">
                                  {log.error_message}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
    <DeleteConfirmationDialog
      open={!!deleteLogId}
      onOpenChange={(open) => !open && setDeleteLogId(null)}
      onConfirm={() => deleteLogId && deleteMutation.mutate({ logId: deleteLogId, documentId: deleteLogDocId, documentType: deleteLogDocType || "" })}
      title="Dokument entfernen"
      description="Möchten Sie dieses Dokument wirklich entfernen? Der Eintrag und das zugehörige Dokument werden aus der Datenbank gelöscht."
      isDeleting={deleteMutation.isPending}
    />
    <DeleteConfirmationDialog
      open={showBulkDelete}
      onOpenChange={setShowBulkDelete}
      onConfirm={() => bulkDeleteMutation.mutate()}
      title={`${selectedIds.size} Dokument${selectedIds.size !== 1 ? "e" : ""} entfernen`}
      description={`Möchten Sie ${selectedIds.size} ausgewählte Dokument${selectedIds.size !== 1 ? "e" : ""} wirklich entfernen? Die Einträge und zugehörigen Dokumente werden aus der Datenbank gelöscht.`}
      isDeleting={bulkDeleteMutation.isPending}
    />
    </>
  );
}
