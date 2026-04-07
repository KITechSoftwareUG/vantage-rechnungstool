import { useState, memo } from "react";
import { Calendar, Building2, Euro, Edit2, Check, X, ArrowDownLeft, ArrowUpRight, Hash, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { UrlDocumentPreview } from "./UrlDocumentPreview";
import { DuplicateBadge } from "@/components/documents/DuplicateBadge";

interface ReviewInvoice {
  id: string;
  fileName: string;
  fileUrl: string;
  date: string;
  issuer: string;
  amount: number;
  currency: string;
  type: "incoming" | "outgoing";
  invoiceNumber: string | null;
  paymentMethod: string;
  year: number;
  month: number;
}

interface ReviewCardProps {
  invoice: ReviewInvoice;
  onConfirm: (data: ReviewInvoice) => void;
  onDiscard: (id: string) => void;
  duplicates?: Array<{ id: string; fileName: string; date: string; issuer: string; amount: number; currency?: string; status?: string; fileUrl?: string }>;
  onMerge?: (keeperId: string, duplicateId: string) => void;
  isMerging?: boolean;
  index?: number;
}

export const ReviewCard = memo(function ReviewCard({ invoice, onConfirm, onDiscard, duplicates = [], onMerge, isMerging, index = 0 }: ReviewCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(invoice);
  const [amountInput, setAmountInput] = useState(invoice.amount.toString().replace(".", ","));
  const [invoiceNumberInput, setInvoiceNumberInput] = useState(invoice.invoiceNumber || "");

  const handleConfirm = () => {
    const date = new Date(editData.date);
    onConfirm({
      ...editData,
      invoiceNumber: invoiceNumberInput.trim() || null,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
    });
  };

  const handleCancel = () => {
    setEditData(invoice);
    setAmountInput(invoice.amount.toString().replace(".", ","));
    setInvoiceNumberInput(invoice.invoiceNumber || "");
    setIsEditing(false);
  };

  const isExpense = editData.type === "outgoing";

  return (
    <div
      className={cn("glass-card p-4 transition-all duration-300 animate-slide-up opacity-0")}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Document Preview */}
        <UrlDocumentPreview fileUrl={invoice.fileUrl} fileName={invoice.fileName} className="h-[400px]" />

        {/* Right: Extracted Data */}
        <div className="flex flex-col">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg",
                isExpense ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
              )}>
                {isExpense ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground line-clamp-1">{invoice.fileName}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                    Zur Überprüfung
                  </Badge>
                  {duplicates.length > 0 && onMerge && (
                    <DuplicateBadge
                      currentId={invoice.id}
                      currentDoc={{
                        id: invoice.id,
                        fileName: invoice.fileName,
                        date: invoice.date,
                        issuer: invoice.issuer,
                        amount: invoice.amount,
                        currency: invoice.currency,
                        status: "processing",
                        fileUrl: invoice.fileUrl,
                      }}
                      duplicates={duplicates}
                      onMerge={onMerge}
                      isMerging={isMerging}
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!isEditing && (
                <Button variant="ghost" size="icon" onClick={() => setIsEditing(true)} className="h-8 w-8" title="Bearbeiten">
                  <Edit2 className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => onDiscard(invoice.id)} className="h-8 w-8 text-destructive hover:text-destructive" title="Verwerfen">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 space-y-4">
            {/* Type */}
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 text-muted-foreground flex items-center justify-center">
                {isExpense ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </div>
              {isEditing ? (
                <div className="flex-1 flex gap-2">
                  <Button type="button" variant={editData.type === "outgoing" ? "default" : "outline"} size="sm" className="flex-1"
                    onClick={() => { setEditData({ ...editData, type: "outgoing", amount: Math.abs(editData.amount) }); setAmountInput(Math.abs(editData.amount).toString().replace(".", ",")); }}>
                    <ArrowDownLeft className="mr-1 h-3 w-3" /> Eingang
                  </Button>
                  <Button type="button" variant={editData.type === "incoming" ? "default" : "outline"} size="sm" className="flex-1"
                    onClick={() => { setEditData({ ...editData, type: "incoming", amount: Math.abs(editData.amount) }); setAmountInput(Math.abs(editData.amount).toString().replace(".", ",")); }}>
                    <ArrowUpRight className="mr-1 h-3 w-3" /> Ausgang
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
                <Input type="date" value={editData.date} onChange={(e) => setEditData({ ...editData, date: e.target.value })} className="h-9" />
              ) : (
                <div className="flex-1 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Datum</span>
                  <span className="text-sm font-medium text-foreground">{new Date(invoice.date).toLocaleDateString("de-DE")}</span>
                </div>
              )}
            </div>

            {/* Issuer */}
            <div className="flex items-center gap-3">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              {isEditing ? (
                <Input value={editData.issuer} onChange={(e) => setEditData({ ...editData, issuer: e.target.value })} className="h-9" placeholder="Aussteller" />
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
                <Input value={invoiceNumberInput} onChange={(e) => setInvoiceNumberInput(e.target.value)} className="h-9" placeholder="Rechnungsnummer (optional)" />
              ) : (
                <div className="flex-1 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Rechnungs-Nr.</span>
                  <span className="text-sm font-medium text-foreground">
                    {invoice.invoiceNumber || <span className="text-muted-foreground italic">—</span>}
                  </span>
                </div>
              )}
            </div>

            {/* Amount & Currency */}
            <div className="flex items-center gap-3">
              {(editData.currency || "EUR") === "EUR" ? (
                <Euro className="h-4 w-4 text-muted-foreground" />
              ) : (
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              )}
              {isEditing ? (
                <div className="flex gap-2 flex-1">
                  <Input
                    type="text" inputMode="decimal" value={amountInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (/^-?[\d]*[,.]?[\d]*$/.test(value) || value === "") {
                        setAmountInput(value);
                        const parsed = parseFloat(value.replace(",", "."));
                        if (!isNaN(parsed)) setEditData({ ...editData, amount: parsed });
                      }
                    }}
                    onBlur={() => {
                      const parsed = parseFloat(amountInput.replace(",", "."));
                      if (!isNaN(parsed)) { setAmountInput(parsed.toString().replace(".", ",")); setEditData({ ...editData, amount: parsed }); }
                    }}
                    className="h-9" placeholder="Betrag"
                  />
                  <select
                    value={editData.currency || "EUR"}
                    onChange={(e) => setEditData({ ...editData, currency: e.target.value })}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="CHF">CHF</option>
                  </select>
                </div>
              ) : (
                <div className="flex-1 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Betrag</span>
                  <span className={cn("text-lg font-bold", isExpense ? "text-foreground" : "text-primary")}>
                    {isExpense ? "-" : "+"}{invoice.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} {invoice.currency || "EUR"}
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
                  <X className="mr-1 h-4 w-4" /> Abbrechen
                </Button>
                <Button variant="default" size="sm" onClick={() => { handleConfirm(); setIsEditing(false); }}>
                  <Check className="mr-1 h-4 w-4" /> Übernehmen
                </Button>
              </div>
            ) : (
              <Button variant="default" className="w-full" onClick={handleConfirm}>
                <Check className="mr-2 h-4 w-4" /> Bestätigen & Speichern
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => prev.invoice.id === next.invoice.id && prev.index === next.index && prev.duplicates?.length === next.duplicates?.length && prev.isMerging === next.isMerging);
