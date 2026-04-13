import { useState } from "react";
import { Building, Calendar, CreditCard, Edit2, Check, X, RefreshCw, Loader2, Eye, Trash2, ChevronDown, ChevronUp, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { StatementData } from "@/types/documents";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { StatementTransactionsList } from "./StatementTransactionsList";

interface StatementCardProps {
  statement: StatementData;
  onSave: (data: StatementData) => void;
  onDelete?: (id: string) => void;
  onReprocess?: (data: StatementData) => void;
  isReprocessing?: boolean;
  transactionCount?: number;
  index?: number;
}

export function StatementCard({ 
  statement, 
  onSave, 
  onDelete,
  onReprocess,
  isReprocessing = false,
  transactionCount,
  index = 0 
}: StatementCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [editData, setEditData] = useState(statement);

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
    setEditData(statement);
    setIsEditing(false);
  };

  const handleView = () => {
    if (!statement.fileUrl) return;
    // fileUrl is already a full URL, open directly
    window.open(statement.fileUrl, "_blank");
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

  const bankTypeLabels = {
    volksbank: "Volksbank/Raiffeisen",
    amex: "American Express",
  };

  const balanceDiff = statement.closingBalance - statement.openingBalance;

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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Building className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground line-clamp-1">
              {statement.fileName}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge variant="outline" className={cn(statusColors[statement.status])}>
                {statusLabels[statement.status]}
              </Badge>
              <Badge variant="outline" className="bg-secondary/50">
                {bankTypeLabels[statement.bankType || "volksbank"]}
              </Badge>
              {transactionCount !== undefined && (
                <Badge variant="outline" className="bg-muted">
                  {transactionCount} Trans.
                </Badge>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {statement.fileUrl && (
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
          {!isEditing && statement.status !== "processing" && statement.status !== "saved" && (
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
              onClick={() => setShowDeleteDialog(true)}
              className="h-8 w-8 text-destructive hover:text-destructive"
              title="Löschen"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        
        <DeleteConfirmationDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={() => {
            onDelete?.(statement.id);
            setShowDeleteDialog(false);
          }}
          title="Kontoauszug löschen"
          description={`Möchten Sie den Kontoauszug "${statement.fileName}" wirklich löschen? Alle zugehörigen Transaktionen werden ebenfalls gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`}
        />
      </div>

      {/* Content */}
      <div className="space-y-3">
        {/* Bank Type (only in edit mode) */}
        {isEditing && (
          <div className="flex items-center gap-3">
            <Building className="h-4 w-4 text-muted-foreground" />
            <Select
              value={editData.bankType}
              onValueChange={(value: "volksbank" | "amex") => setEditData({ ...editData, bankType: value })}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Banktyp wählen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="volksbank">Volksbank/Raiffeisen</SelectItem>
                <SelectItem value="amex">American Express</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Bank */}
        <div className="flex items-center gap-3">
          <Building className="h-4 w-4 text-muted-foreground" />
          {isEditing ? (
            <Input
              value={editData.bank}
              onChange={(e) => setEditData({ ...editData, bank: e.target.value })}
              className="h-8"
              placeholder="Bank"
            />
          ) : (
            <span className="text-sm text-foreground">{statement.bank}</span>
          )}
        </div>

        {/* Account Number */}
        <div className="flex items-center gap-3">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          {isEditing ? (
            <Input
              value={editData.accountNumber}
              onChange={(e) => setEditData({ ...editData, accountNumber: e.target.value })}
              className="h-8"
              placeholder="Kontonummer"
            />
          ) : (
            <span className="text-sm font-mono text-foreground">{statement.accountNumber}</span>
          )}
        </div>

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
              {new Date(statement.date).toLocaleDateString("de-DE")}
            </span>
          )}
        </div>

        {/* Balances */}
        <div className="mt-4 rounded-lg bg-muted/30 p-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Anfangssaldo</span>
            {isEditing ? (
              <Input
                type="number"
                step="0.01"
                value={editData.openingBalance}
                onChange={(e) => setEditData({ ...editData, openingBalance: parseFloat(e.target.value) })}
                className="h-6 w-32 text-right"
              />
            ) : (
              <span className="font-medium text-foreground">
                {statement.openingBalance.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
              </span>
            )}
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">Endsaldo</span>
            {isEditing ? (
              <Input
                type="number"
                step="0.01"
                value={editData.closingBalance}
                onChange={(e) => setEditData({ ...editData, closingBalance: parseFloat(e.target.value) })}
                className="h-6 w-32 text-right"
              />
            ) : (
              <span className="font-semibold text-foreground">
                {statement.closingBalance.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
              </span>
            )}
          </div>
          {!isEditing && (
            <div className="mt-2 flex justify-between border-t border-border/50 pt-2 text-sm">
              <span className="text-muted-foreground">Differenz</span>
              <span className={cn(
                "font-semibold",
                balanceDiff >= 0 ? "text-success" : "text-destructive"
              )}>
                {balanceDiff >= 0 ? "+" : ""}
                {balanceDiff.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Transactions toggle */}
      {!isEditing && transactionCount !== undefined && transactionCount > 0 && (
        <div className="mt-4">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between"
            onClick={() => setShowTransactions((v) => !v)}
          >
            <span className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4" />
              Transaktionen ({transactionCount})
            </span>
            {showTransactions ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
          {showTransactions && (
            <div className="mt-3">
              <StatementTransactionsList
                statementId={statement.id}
                expectedDiff={balanceDiff}
              />
            </div>
          )}
        </div>
      )}

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
      ) : statement.status === "ready" ? (
        <div className="mt-4">
          <Button variant="gradient" size="sm" className="w-full" onClick={handleSave}>
            <Check className="mr-1 h-4 w-4" />
            Bestätigen
          </Button>
        </div>
      ) : statement.status === "saved" && onReprocess && transactionCount === 0 && statement.fileUrl ? (
        <div className="mt-4">
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full" 
            onClick={() => onReprocess(statement)}
            disabled={isReprocessing}
          >
            {isReprocessing ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Verarbeite...
              </>
            ) : (
              <>
                <RefreshCw className="mr-1 h-4 w-4" />
                Transaktionen extrahieren
              </>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}