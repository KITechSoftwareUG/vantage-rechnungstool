import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  RefreshCw,
  ChevronRight,
  FolderOpen,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useIngestionLogs,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  getSourceBreadcrumb,
  getStatusSummary,
  type IngestionLog,
} from "@/hooks/useIngestionLogs";

function getStatusBadge(status: string) {
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
}

// ---------- Log Row Sub-component ----------

function IngestionLogRow({
  log,
  isSelected,
  onToggleSelect,
  onDelete,
}: {
  log: IngestionLog;
  isSelected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
}) {
  const breadcrumb = getSourceBreadcrumb(log);
  return (
    <div className="flex items-start gap-3 rounded-md p-2.5 transition-colors hover:bg-muted/30">
      <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} className="mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium">{log.file_name}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            {getStatusBadge(log.status)}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
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
          <p className="text-xs text-destructive">{log.error_message}</p>
        )}
      </div>
    </div>
  );
}

// ---------- Main Component ----------

export function IngestionTracker() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const [deleteLogId, setDeleteLogId] = useState<string | null>(null);
  const [deleteLogDocId, setDeleteLogDocId] = useState<string | null>(null);
  const [deleteLogDocType, setDeleteLogDocType] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  const { logs, isLoading, refetch, groupedLogs, deleteMutation, bulkDeleteMutation } = useIngestionLogs();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  const toggleMonth = (key: string) => {
    setOpenMonths((prev) => ({ ...prev, [key]: !prev[key] }));
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

  const handleDeleteClick = (log: IngestionLog) => {
    setDeleteLogId(log.id);
    setDeleteLogDocId(log.document_id ?? null);
    setDeleteLogDocType(log.document_type);
  };

  const handleBulkDelete = () => {
    bulkDeleteMutation.mutate(selectedIds, {
      onSuccess: () => {
        setSelectedIds(new Set());
        setShowBulkDelete(false);
      },
      onSettled: () => setShowBulkDelete(false),
    });
  };

  const handleSingleDelete = () => {
    if (!deleteLogId) return;
    deleteMutation.mutate(
      { logId: deleteLogId, documentId: deleteLogDocId, documentType: deleteLogDocType || "" },
      { onSettled: () => setDeleteLogId(null) }
    );
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
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
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
                const summary = getStatusSummary(group.allLogs);
                const isOpen = openCategories[group.category] !== false;

                return (
                  <Collapsible key={group.category} open={isOpen} onOpenChange={() => toggleCategory(group.category)}>
                    <CollapsibleTrigger asChild>
                      <button className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">{label}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{summary.total} Dokument{summary.total !== 1 ? "e" : ""}</span>
                            {summary.errors > 0 && <span className="text-destructive">{summary.errors} Fehler</span>}
                            {summary.pending > 0 && <span className="text-warning">{summary.pending} ausstehend</span>}
                          </div>
                        </div>
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="ml-4 mt-1 space-y-2 border-l-2 border-muted pl-4">
                        {group.months.map((monthGroup) => {
                          const monthKey = `${group.category}-${monthGroup.year}-${monthGroup.month}`;
                          const isMonthOpen = openMonths[monthKey] !== false;
                          const monthLabel = monthGroup.month > 0
                            ? `${MONTH_NAMES[monthGroup.month - 1]} ${monthGroup.year}`
                            : `${monthGroup.year}`;

                          return (
                            <Collapsible key={monthKey} open={isMonthOpen} onOpenChange={() => toggleMonth(monthKey)}>
                              <CollapsibleTrigger asChild>
                                <button className="flex w-full items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted">
                                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isMonthOpen ? "rotate-90" : ""}`} />
                                  <span>{monthLabel}</span>
                                  <span className="ml-auto text-xs text-muted-foreground">
                                    {monthGroup.logs.length} Dokument{monthGroup.logs.length !== 1 ? "e" : ""}
                                  </span>
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="ml-2 mt-1 space-y-1 border-l border-muted pl-3">
                                  {monthGroup.logs.map((log) => (
                                    <IngestionLogRow
                                      key={log.id}
                                      log={log}
                                      isSelected={selectedIds.has(log.id)}
                                      onToggleSelect={() => toggleSelect(log.id)}
                                      onDelete={() => handleDeleteClick(log)}
                                    />
                                  ))}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
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
        onConfirm={handleSingleDelete}
        title="Dokument entfernen"
        description="Möchten Sie dieses Dokument wirklich entfernen? Der Eintrag und das zugehörige Dokument werden aus der Datenbank gelöscht."
        isDeleting={deleteMutation.isPending}
      />
      <DeleteConfirmationDialog
        open={showBulkDelete}
        onOpenChange={setShowBulkDelete}
        onConfirm={handleBulkDelete}
        title={`${selectedIds.size} Dokument${selectedIds.size !== 1 ? "e" : ""} entfernen`}
        description={`Möchten Sie ${selectedIds.size} ausgewählte Dokument${selectedIds.size !== 1 ? "e" : ""} wirklich entfernen? Die Einträge und zugehörigen Dokumente werden aus der Datenbank gelöscht.`}
        isDeleting={bulkDeleteMutation.isPending}
      />
    </>
  );
}
