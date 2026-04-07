import { Copy, Merge } from "lucide-react";
import { UrlDocumentPreview } from "@/components/upload/UrlDocumentPreview";
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

interface CurrentDocInfo {
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
  currentDoc?: CurrentDocInfo;
  duplicates: DuplicateInfo[];
  onMerge: (keeperId: string, duplicateId: string) => void;
  isMerging?: boolean;
  compact?: boolean;
}

export function DuplicateBadge({ currentId, currentDoc, duplicates, onMerge, isMerging, compact }: DuplicateBadgeProps) {
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

  const DocCard = ({ doc, label, highlight }: { doc: DuplicateInfo | CurrentDocInfo; label: string; highlight?: boolean }) => (
    <div className={cn(
      "flex-1 min-w-0 rounded-lg border p-3 space-y-2",
      highlight ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30"
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Badge variant={highlight ? "default" : "outline"} className="text-[10px] shrink-0">
          {label}
        </Badge>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {statusLabel(doc.status)}
        </Badge>
      </div>
      {doc.fileUrl && (
        <div className="rounded border border-border overflow-hidden" style={{ maxHeight: 280 }}>
          <UrlDocumentPreview fileUrl={doc.fileUrl} fileName={doc.fileName} className="h-[260px]" />
        </div>
      )}
      <p className="text-sm font-medium break-all leading-snug">{doc.fileName}</p>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground/70">Datum:</span>
          <span>{new Date(doc.date).toLocaleDateString("de-DE")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground/70">Aussteller:</span>
          <span>{doc.issuer}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-foreground/70">Betrag:</span>
          <span>{doc.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} {doc.currency || "EUR"}</span>
        </div>
      </div>
    </div>
  );

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
        <DialogContent className="max-w-2xl" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-5 w-5 text-warning" />
              Mögliche Duplikate gefunden
            </DialogTitle>
            <DialogDescription>
              Vergleiche die Dokumente nebeneinander. Du kannst das Duplikat zusammenführen (löschen), wobei das aktuelle Dokument beibehalten wird.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[400px] overflow-y-auto">
            {duplicates.map((dup) => (
              <div key={dup.id} className="space-y-2">
                <div className="flex gap-3">
                  {currentDoc ? (
                    <DocCard doc={currentDoc} label="Aktuelles Dokument" highlight />
                  ) : (
                    <div className="flex-1 min-w-0 rounded-lg border border-primary/40 bg-primary/5 p-3 flex items-center justify-center text-xs text-muted-foreground">
                      Aktuelles Dokument (ID: {currentId.slice(0, 8)}…)
                    </div>
                  )}
                  <DocCard doc={dup} label="Mögliches Duplikat" />
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 text-xs bg-warning hover:bg-warning/90 text-warning-foreground"
                    onClick={() => {
                      onMerge(currentId, dup.id);
                      setDialogOpen(false);
                    }}
                    disabled={isMerging}
                  >
                    <Merge className="h-3 w-3 mr-1" />
                    Duplikat entfernen & zusammenführen
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
