import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { de } from "date-fns/locale";
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
  RefreshCw
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
  // Fallback for legacy/english values
  incoming: ArrowDownLeft,
  outgoing: ArrowUpRight,
  volksbank: Building,
  commission: Receipt,
  cash: Wallet,
};

const CATEGORY_LABELS: Record<string, string> = {
  eingang: "Eingangsrechnung",
  ausgang: "Ausgangsrechnung",
  vrbank: "VR-Bank Kontoauszug",
  provision: "Provisionsabrechnung",
  kasse: "Kasse",
  // Fallback for legacy/english values
  incoming: "Eingangsrechnung",
  outgoing: "Ausgangsrechnung",
  volksbank: "Volksbank",
  amex: "American Express",
  commission: "Provision",
  cash: "Kasse",
};

export function IngestionTracker() {
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
      case "success":
        return (
          <Badge variant="secondary" className="gap-1 bg-primary/20 text-primary">
            <CheckCircle2 className="h-3 w-3" />
            Erfolgreich
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Fehler
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3 animate-pulse" />
            Verarbeitung
          </Badge>
        );
      case "received":
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Empfangen
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            {status}
          </Badge>
        );
    }
  };

  const getEndpointPath = (log: IngestionLog) => {
    if (log.endpoint_month) {
      return `${log.endpoint_category}/${log.endpoint_year}/${String(log.endpoint_month).padStart(2, "0")}`;
    }
    return `${log.endpoint_category}/${log.endpoint_year}`;
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
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {logs.map((log) => {
                const Icon = CATEGORY_ICONS[log.endpoint_category] || FileText;
                
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium">
                          {log.file_name}
                        </p>
                        {getStatusBadge(log.status)}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="font-mono text-xs">
                          /{getEndpointPath(log)}
                        </Badge>
                        <span>•</span>
                        <span>{CATEGORY_LABELS[log.endpoint_category] || log.endpoint_category}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
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
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}