import { useState } from "react";
import { Calendar, Building2, Euro, Edit2, Check, X, ArrowDownLeft, ArrowUpRight, Eye, Trash2, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { InvoiceData } from "@/types/documents";

interface DocumentCardProps {
  document: InvoiceData;
  onSave: (data: InvoiceData) => void;
  onDelete?: (id: string) => void;
  index?: number;
}

export function DocumentCard({ document, onSave, onDelete, index = 0 }: DocumentCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(document);

  const handleSave = () => {
    const date = new Date(editData.date);
    onSave({
      ...editData,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditData(document);
    setIsEditing(false);
  };

  const handleTypeToggle = (isOutgoing: boolean) => {
    const newType = isOutgoing ? "outgoing" : "incoming";
    const updatedData = { ...document, type: newType as "incoming" | "outgoing" };
    onSave(updatedData);
    setEditData(updatedData);
  };

  const handleView = () => {
    if (!document.fileUrl) return;
    // fileUrl is already a full URL, open directly
    window.open(document.fileUrl, "_blank");
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

  // Eingang = ich erhalte eine Rechnung und bezahle (Ausgabe)
  // Ausgang = ich stelle eine Rechnung und erhalte Geld (Einnahme)
  // outgoing = Eingangsrechnung = ich bezahle = Ausgabe
  const isExpense = document.type === "outgoing";

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
            isExpense
              ? "bg-destructive/10 text-destructive" 
              : "bg-success/10 text-success"
          )}>
            {isExpense ? (
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
        
        <div className="flex items-center gap-1">
          {document.fileUrl && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleView}
              className="h-8 w-8"
              title="Anzeigen"
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
          {!isEditing && document.status !== "processing" && document.status !== "saved" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsEditing(true)}
              className="h-8 w-8"
              title="Bearbeiten"
            >
              <Edit2 className="h-4 w-4" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(document.id)}
              className="h-8 w-8 text-destructive hover:text-destructive"
              title="Löschen"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-3">
        {/* Type Toggle - only in edit mode */}
        {isEditing ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-2">
            <span className={cn(
              "text-xs font-medium transition-colors",
              isExpense ? "text-foreground" : "text-muted-foreground"
            )}>
              Eingang
            </span>
            <Switch
              checked={document.type === "outgoing"}
              onCheckedChange={handleTypeToggle}
              className="data-[state=checked]:bg-success data-[state=unchecked]:bg-destructive/70"
            />
            <span className={cn(
              "text-xs font-medium transition-colors",
              !isExpense ? "text-success" : "text-muted-foreground"
            )}>
              Ausgang
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            {isExpense ? (
              <span className="text-muted-foreground">Eingang</span>
            ) : (
              <span className="text-success">Ausgang</span>
            )}
          </div>
        )}

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

        {/* Amount & Currency */}
        <div className="flex items-center gap-3">
          {(document.currency || "EUR") === "EUR" ? (
            <Euro className="h-4 w-4 text-muted-foreground" />
          ) : (
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          )}
          {isEditing ? (
            <div className="flex gap-2 flex-1">
              <Input
                type="number"
                step="0.01"
                value={editData.amount}
                onChange={(e) => setEditData({ ...editData, amount: parseFloat(e.target.value) })}
                className="h-8"
                placeholder="Betrag"
              />
              <select
                value={editData.currency || "EUR"}
                onChange={(e) => setEditData({ ...editData, currency: e.target.value })}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
                <option value="CHF">CHF</option>
              </select>
            </div>
          ) : (
            <span className={cn(
              "text-lg font-semibold",
              isExpense ? "text-foreground" : "text-success"
            )}>
              {isExpense ? "-" : "+"}
              {document.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} {document.currency || "EUR"}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {isEditing ? (
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
      ) : document.status === "ready" && (
        <div className="mt-4">
          <Button variant="gradient" size="sm" className="w-full" onClick={handleSave}>
            <Check className="mr-1 h-4 w-4" />
            Bestätigen
          </Button>
        </div>
      )}
    </div>
  );
}