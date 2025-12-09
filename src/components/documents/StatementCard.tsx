import { useState } from "react";
import { Building, Calendar, CreditCard, Edit2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { StatementData } from "@/types/documents";

interface StatementCardProps {
  statement: StatementData;
  onSave: (data: StatementData) => void;
  index?: number;
}

export function StatementCard({ statement, onSave, index = 0 }: StatementCardProps) {
  const [isEditing, setIsEditing] = useState(false);
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
            <div className="mt-1 flex gap-1">
              <Badge variant="outline" className={cn(statusColors[statement.status])}>
                {statusLabels[statement.status]}
              </Badge>
              <Badge variant="outline" className="bg-secondary/50">
                {bankTypeLabels[statement.bankType || "volksbank"]}
              </Badge>
            </div>
          </div>
        </div>
        
        {!isEditing && statement.status !== "processing" && statement.status !== "saved" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsEditing(true)}
            className="h-8 w-8"
          >
            <Edit2 className="h-4 w-4" />
          </Button>
        )}
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
      ) : statement.status === "ready" && (
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
