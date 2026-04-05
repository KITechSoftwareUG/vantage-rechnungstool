import { Copy, Merge, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface DuplicateInfo {
  id: string;
  fileName: string;
  date: string;
  issuer: string;
  amount: number;
  currency?: string;
  status?: string;
  fileUrl?: string;
}

interface DuplicateBadgeProps {
  currentId: string;
  duplicates: DuplicateInfo[];
  onMerge: (keeperId: string, duplicateId: string) => void;
  isMerging?: boolean;
  compact?: boolean;
}

export function DuplicateBadge({ currentId, duplicates, onMerge, isMerging, compact }: DuplicateBadgeProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (duplicates.length === 0) return null;

  const statusLabel = (status?: string) => {
    switch (status) {
      case "ready": return "Bestätigt";
      case "processing": return "Zur Überprüfung";
      case "saved": return "Gespeichert";
      default: return status || "—";
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
        className="inline-flex items-center"
      >
        <Badge
          variant="outline"
          className={cn(
            "bg-warning/10 text-warning border-warning/30 cursor-pointer hover:bg-warning/20 transition-colors gap-1",
            compact && "text-[10px] px-1.5 py-0"
          )}
        >
          <Copy className={cn("h-3 w-3", compact && "h-2.5 w-2.5")} />
          {duplicates.length} Duplikat{duplicates.length > 1 ? "e" : ""}
        </Badge>
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-5 w-5 text-warning" />
              Mögliche Duplikate gefunden
            </DialogTitle>
            <DialogDescription>
              Die folgenden Dokumente haben gleiches Datum, gleichen Aussteller und gleichen Betrag.
              Du kannst ein Duplikat zusammenführen (löschen), wobei das aktuelle Dokument beibehalten wird.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {duplicates.map((dup) => (
              <div
                key={dup.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 bg-muted/30"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium break-all leading-snug">{dup.fileName}</p>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{new Date(dup.date).toLocaleDateString("de-DE")}</span>
                    <span>•</span>
                    <span>{dup.issuer}</span>
                    <span>•</span>
                    <span>{dup.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} {dup.currency || "EUR"}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {statusLabel(dup.status)}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {dup.fileUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => window.open(dup.fileUrl, "_blank")}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Ansehen
                    </Button>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 text-xs bg-warning hover:bg-warning/90 text-warning-foreground"
                    onClick={() => {
                      onMerge(currentId, dup.id);
                      setDialogOpen(false);
                    }}
                    disabled={isMerging}
                  >
                    <Merge className="h-3 w-3 mr-1" />
                    Zusammenführen
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Schließen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
