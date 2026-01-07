import { useState, useMemo, memo } from "react";
import { Calendar, Building2, Euro, Edit2, Check, X, ArrowDownLeft, ArrowUpRight, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InvoiceData } from "@/types/documents";
import { DocumentPreview } from "./DocumentPreview";

interface InvoiceReviewCardProps {
  invoice: InvoiceData & { file: File };
  onSave: (data: InvoiceData & { file: File }) => void;
  onDiscard: (id: string) => void;
  index?: number;
  showTypeSelector?: boolean;
}

// Memoized document preview to prevent re-renders when editing
const MemoizedDocumentPreview = memo(DocumentPreview);

export function InvoiceReviewCard({ invoice, onSave, onDiscard, index = 0, showTypeSelector = false }: InvoiceReviewCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(invoice);
  const [amountInput, setAmountInput] = useState(invoice.amount.toString().replace('.', ','));
  const [invoiceNumberInput, setInvoiceNumberInput] = useState(invoice.invoiceNumber || '');
  
  // Memoize the file to prevent DocumentPreview re-renders
  const memoizedFile = useMemo(() => invoice.file, [invoice.file]);

  const handleSave = () => {
    const date = new Date(editData.date);
    onSave({
      ...editData,
      invoiceNumber: invoiceNumberInput.trim() || null,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
    });
  };

  const handleCancel = () => {
    setEditData(invoice);
    setIsEditing(false);
  };

  // outgoing = Eingangsrechnung = ich erhalte eine Rechnung und bezahle (Ausgabe/Geld geht raus)
  // incoming = Ausgangsrechnung = ich stelle eine Rechnung und erhalte Geld (Einnahme/Geld kommt rein)
  const isExpense = editData.type === "outgoing";

  return (
    <div 
      className={cn(
        "glass-card p-4 transition-all duration-300 animate-slide-up opacity-0"
      )}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Document Preview */}
        <MemoizedDocumentPreview file={memoizedFile} className="h-[400px]" />

        {/* Right: Extracted Data */}
        <div className="flex flex-col">
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
                  {invoice.fileName}
                </p>
                <Badge variant="outline" className="mt-1 bg-primary/10 text-primary border-primary/20">
                  Zur Überprüfung
                </Badge>
              </div>
            </div>
            
            <div className="flex items-center gap-1">
              {!isEditing && (
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
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDiscard(invoice.id)}
                className="h-8 w-8 text-destructive hover:text-destructive"
                title="Verwerfen"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 space-y-4">
            {/* Type Selector - editable when in editing mode */}
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 text-muted-foreground flex items-center justify-center">
                {isExpense ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </div>
              {isEditing ? (
                <div className="flex-1 flex gap-2">
                  <Button
                    type="button"
                    variant={editData.type === "outgoing" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      if (editData.type !== "outgoing") {
                        // Wechsel zu Eingangsrechnung - Betrag positiv machen
                        const newAmount = Math.abs(editData.amount);
                        setEditData({ ...editData, type: "outgoing", amount: newAmount });
                        setAmountInput(newAmount.toString().replace('.', ','));
                      }
                    }}
                  >
                    <ArrowDownLeft className="mr-1 h-3 w-3" />
                    Eingang
                  </Button>
                  <Button
                    type="button"
                    variant={editData.type === "incoming" ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      if (editData.type !== "incoming") {
                        // Wechsel zu Ausgangsrechnung - Betrag positiv machen
                        const newAmount = Math.abs(editData.amount);
                        setEditData({ ...editData, type: "incoming", amount: newAmount });
                        setAmountInput(newAmount.toString().replace('.', ','));
                      }
                    }}
                  >
                    <ArrowUpRight className="mr-1 h-3 w-3" />
                    Ausgang
                  </Button>
                </div>
              ) : (
                <div className="flex-1 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Typ</span>
                  <Badge variant={isExpense ? "secondary" : "default"}>
                    {isExpense ? "Eingang (Ausgabe)" : "Ausgang (Einnahme)"}
                  </Badge>
                </div>
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
                  className="h-9"
                />
              ) : (
                <div className="flex-1 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Datum</span>
                  <span className="text-sm font-medium text-foreground">
                    {new Date(invoice.date).toLocaleDateString("de-DE")}
                  </span>
                </div>
              )}
            </div>

            {/* Issuer */}
            <div className="flex items-center gap-3">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              {isEditing ? (
                <Input
                  value={editData.issuer}
                  onChange={(e) => setEditData({ ...editData, issuer: e.target.value })}
                  className="h-9"
                  placeholder="Aussteller"
                />
              ) : (
                <div className="flex-1 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Aussteller</span>
                  <span className="text-sm font-medium text-foreground">{invoice.issuer}</span>
                </div>
              )}
            </div>

            {/* Invoice Number */}
            <div className="flex items-center gap-3">
              <Hash className="h-4 w-4 text-muted-foreground" />
              {isEditing ? (
                <Input
                  value={invoiceNumberInput}
                  onChange={(e) => setInvoiceNumberInput(e.target.value)}
                  className="h-9"
                  placeholder="Rechnungsnummer (optional)"
                />
              ) : (
                <div className="flex-1 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Rechnungs-Nr.</span>
                  <span className="text-sm font-medium text-foreground">
                    {invoice.invoiceNumber || <span className="text-muted-foreground italic">—</span>}
                  </span>
                </div>
              )}
            </div>

            {/* Amount */}
            <div className="flex items-center gap-3">
              <Euro className="h-4 w-4 text-muted-foreground" />
              {isEditing ? (
                <Input
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Allow: digits, comma, dot, minus sign
                    if (/^-?[\d]*[,.]?[\d]*$/.test(value) || value === '') {
                      setAmountInput(value);
                      const parsed = parseFloat(value.replace(',', '.'));
                      if (!isNaN(parsed)) {
                        setEditData({ ...editData, amount: parsed });
                      }
                    }
                  }}
                  onBlur={() => {
                    // Format on blur
                    const parsed = parseFloat(amountInput.replace(',', '.'));
                    if (!isNaN(parsed)) {
                      setAmountInput(parsed.toString().replace('.', ','));
                      setEditData({ ...editData, amount: parsed });
                    }
                  }}
                  className="h-9"
                  placeholder="Betrag"
                />
              ) : (
                <div className="flex-1 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Betrag</span>
                  <span className={cn(
                    "text-lg font-bold",
                    isExpense ? "text-foreground" : "text-success"
                  )}>
                    {isExpense ? "-" : "+"}
                    {invoice.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 pt-4 border-t border-border">
            {isEditing ? (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  <X className="mr-1 h-4 w-4" />
                  Abbrechen
                </Button>
                <Button variant="gradient" size="sm" onClick={() => { handleSave(); setIsEditing(false); }}>
                  <Check className="mr-1 h-4 w-4" />
                  Übernehmen
                </Button>
              </div>
            ) : (
              <Button variant="gradient" className="w-full" onClick={handleSave}>
                <Check className="mr-2 h-4 w-4" />
                Bestätigen & Speichern
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
