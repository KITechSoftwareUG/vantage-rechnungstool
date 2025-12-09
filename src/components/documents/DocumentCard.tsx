import { useState } from "react";
import { FileText, Calendar, Building2, Euro, Edit2, Check, X, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface InvoiceData {
  id: string;
  fileName: string;
  date: string;
  issuer: string;
  amount: number;
  type: "incoming" | "outgoing";
  status: "processing" | "ready" | "saved";
}

interface DocumentCardProps {
  document: InvoiceData;
  onSave: (data: InvoiceData) => void;
  index?: number;
}

export function DocumentCard({ document, onSave, index = 0 }: DocumentCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(document);

  const handleSave = () => {
    onSave(editData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditData(document);
    setIsEditing(false);
  };

  const statusColors = {
    processing: "bg-warning/10 text-warning border-warning/20",
    ready: "bg-primary/10 text-primary border-primary/20",
    saved: "bg-success/10 text-success border-success/20",
  };

  const statusLabels = {
    processing: "Verarbeitung",
    ready: "Bereit",
    saved: "Gespeichert",
  };

  return (
    <div 
      className={cn(
        "glass-card group p-5 transition-all duration-300 hover:scale-[1.02] glow-effect",
        "animate-slide-up opacity-0"
      )}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg",
            document.type === "incoming" 
              ? "bg-success/10 text-success" 
              : "bg-destructive/10 text-destructive"
          )}>
            {document.type === "incoming" ? (
              <ArrowDownLeft className="h-5 w-5" />
            ) : (
              <ArrowUpRight className="h-5 w-5" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground line-clamp-1">
              {document.fileName}
            </p>
            <Badge variant="outline" className={cn("mt-1", statusColors[document.status])}>
              {statusLabels[document.status]}
            </Badge>
          </div>
        </div>
        
        {!isEditing && document.status !== "processing" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsEditing(true)}
            className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Edit2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="space-y-3">
        {/* Date */}
        <div className="flex items-center gap-3">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          {isEditing ? (
            <Input
              type="date"
              value={editData.date}
              onChange={(e) => setEditData({ ...editData, date: e.target.value })}
              className="h-8"
            />
          ) : (
            <span className="text-sm text-foreground">
              {new Date(document.date).toLocaleDateString("de-DE")}
            </span>
          )}
        </div>

        {/* Issuer */}
        <div className="flex items-center gap-3">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          {isEditing ? (
            <Input
              value={editData.issuer}
              onChange={(e) => setEditData({ ...editData, issuer: e.target.value })}
              className="h-8"
              placeholder="Aussteller"
            />
          ) : (
            <span className="text-sm text-foreground">{document.issuer}</span>
          )}
        </div>

        {/* Amount */}
        <div className="flex items-center gap-3">
          <Euro className="h-4 w-4 text-muted-foreground" />
          {isEditing ? (
            <Input
              type="number"
              step="0.01"
              value={editData.amount}
              onChange={(e) => setEditData({ ...editData, amount: parseFloat(e.target.value) })}
              className="h-8"
              placeholder="Betrag"
            />
          ) : (
            <span className={cn(
              "text-lg font-semibold",
              document.type === "incoming" ? "text-success" : "text-foreground"
            )}>
              {document.type === "incoming" ? "+" : "-"}
              {document.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
            </span>
          )}
        </div>
      </div>

      {/* Edit Actions */}
      {isEditing && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            <X className="mr-1 h-4 w-4" />
            Abbrechen
          </Button>
          <Button variant="gradient" size="sm" onClick={handleSave}>
            <Check className="mr-1 h-4 w-4" />
            Speichern
          </Button>
        </div>
      )}
    </div>
  );
}
