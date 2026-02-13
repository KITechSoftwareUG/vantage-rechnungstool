import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
  FolderOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface IngestionLog {
  id: string;
  endpoint_category: string;
  endpoint_year: number;
  endpoint_month: number | null;
  file_name: string;
  document_type: string;
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5" />
          Eingespeiste Dokumente
        </CardTitle>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </Button>
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
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-medium">
                                  {log.file_name}
                                </p>
                                {getStatusBadge(log.status)}
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
  );
}
