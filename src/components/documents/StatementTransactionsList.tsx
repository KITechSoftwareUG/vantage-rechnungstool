import { useState } from "react";
import { Check, X, Edit2, Trash2, Loader2, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useBankStatementTransactions,
  useUpdateBankTransaction,
  useDeleteBankTransaction,
  StatementTransaction,
} from "@/hooks/useBankStatements";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";

interface Props {
  statementId: string;
  expectedDiff?: number;
  searchQuery?: string;
}

function matchesQuery(
  tx: { date: string; description: string; amount: number },
  q: string
) {
  const lower = q.toLowerCase();
  if (tx.description.toLowerCase().includes(lower)) return true;
  if (tx.date === q) return true;
  const n = parseFloat(q.replace(",", "."));
  if (!isNaN(n) && Math.abs(Math.abs(tx.amount) - Math.abs(n)) < 0.01) return true;
  return false;
}

const statusConfig: Record<StatementTransaction["matchStatus"], { label: string; color: string }> = {
  unmatched: { label: "Offen", color: "bg-warning/10 text-warning border-warning/20" },
  matched: { label: "Vorschlag", color: "bg-primary/10 text-primary border-primary/20" },
  confirmed: { label: "Bestätigt", color: "bg-success/10 text-success border-success/20" },
  no_match: { label: "Keine Rechnung", color: "bg-muted text-muted-foreground border-muted" },
  recurring: { label: "Laufende Kosten", color: "bg-info/10 text-info border-info/20" },
};

export function StatementTransactionsList({ statementId, expectedDiff, searchQuery }: Props) {
  const { data: transactions = [], isLoading } = useBankStatementTransactions(statementId);
  const q = searchQuery?.trim() ?? "";
  const updateTx = useUpdateBankTransaction();
  const deleteTx = useDeleteBankTransaction();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<StatementTransaction | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 p-4 text-center text-sm text-muted-foreground">
        Keine Transaktionen vorhanden.
      </div>
    );
  }

  const sum = transactions.reduce(
    (acc, t) => acc + (t.transactionType === "credit" ? t.amount : -t.amount),
    0
  );
  const diffMismatch =
    typeof expectedDiff === "number" && Math.abs(sum - expectedDiff) > 0.01;

  const startEdit = (tx: StatementTransaction) => {
    setEditingId(tx.id);
    setEditData(tx);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData(null);
  };

  const saveEdit = () => {
    if (!editData) return;
    updateTx.mutate(
      {
        id: editData.id,
        date: editData.date,
        description: editData.description,
        amount: editData.amount,
        transactionType: editData.transactionType,
      },
      { onSuccess: cancelEdit }
    );
  };

  return (
    <div className="space-y-2">
      {/* Summary */}
      <div
        className={cn(
          "flex items-center justify-between rounded-md border px-3 py-2 text-xs",
          diffMismatch
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "border-border/50 bg-muted/20 text-muted-foreground"
        )}
      >
        <span>
          {transactions.length} Transaktionen · Summe{" "}
          <span className="font-semibold">
            {sum.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </span>
        </span>
        {typeof expectedDiff === "number" && (
          <span>
            Erwartet:{" "}
            <span className="font-semibold">
              {expectedDiff.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
            </span>
          </span>
        )}
      </div>

      {/* Transactions table */}
      <div className="overflow-hidden rounded-md border border-border/50">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left font-medium">Datum</th>
              <th className="px-2 py-2 text-left font-medium">Beschreibung</th>
              <th className="px-2 py-2 text-right font-medium">Betrag</th>
              <th className="px-2 py-2 text-center font-medium">Typ</th>
              <th className="px-2 py-2 text-center font-medium">Status</th>
              <th className="px-2 py-2 text-right font-medium w-20">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {transactions.map((tx) => {
              const isEditing = editingId === tx.id;
              const data = isEditing ? editData! : tx;
              const isCredit = data.transactionType === "credit";
              const isMatch = q.length > 0 && matchesQuery(tx, q);
              return (
                <tr
                  key={tx.id}
                  className={cn(
                    "hover:bg-muted/20",
                    isMatch && "bg-warning/10 ring-1 ring-inset ring-warning/30"
                  )}
                >
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <Input
                        type="date"
                        value={editData!.date}
                        onChange={(e) =>
                          setEditData({ ...editData!, date: e.target.value })
                        }
                        className="h-7 text-xs"
                      />
                    ) : (
                      <span className="whitespace-nowrap text-xs">
                        {new Date(tx.date).toLocaleDateString("de-DE")}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {isEditing ? (
                      <Input
                        value={editData!.description}
                        onChange={(e) =>
                          setEditData({ ...editData!, description: e.target.value })
                        }
                        className="h-7 text-xs"
                      />
                    ) : (
                      <span className="line-clamp-2 break-words">{tx.description}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        step="0.01"
                        value={editData!.amount}
                        onChange={(e) =>
                          setEditData({
                            ...editData!,
                            amount: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="h-7 w-24 text-right text-xs"
                      />
                    ) : (
                      <span
                        className={cn(
                          "whitespace-nowrap font-mono font-medium",
                          isCredit ? "text-success" : "text-foreground"
                        )}
                      >
                        {isCredit ? "+" : "-"}
                        {Math.abs(tx.amount).toLocaleString("de-DE", {
                          minimumFractionDigits: 2,
                        })}{" "}
                        €
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {isEditing ? (
                      <Select
                        value={editData!.transactionType}
                        onValueChange={(v: "credit" | "debit") =>
                          setEditData({ ...editData!, transactionType: v })
                        }
                      >
                        <SelectTrigger className="h-7 w-24 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="credit">Eingang</SelectItem>
                          <SelectItem value="debit">Ausgang</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : isCredit ? (
                      <ArrowDownLeft className="mx-auto h-4 w-4 text-success" />
                    ) : (
                      <ArrowUpRight className="mx-auto h-4 w-4 text-muted-foreground" />
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Badge
                      variant="outline"
                      className={cn("text-xs", statusConfig[tx.matchStatus].color)}
                    >
                      {statusConfig[tx.matchStatus].label}
                    </Badge>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={cancelEdit}
                            disabled={updateTx.isPending}
                            title="Abbrechen"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-success"
                            onClick={saveEdit}
                            disabled={updateTx.isPending}
                            title="Speichern"
                          >
                            {updateTx.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => startEdit(tx)}
                            title="Bearbeiten"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteId(tx.id)}
                            title="Löschen"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DeleteConfirmationDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) {
            deleteTx.mutate(deleteId, { onSuccess: () => setDeleteId(null) });
          }
        }}
        title="Transaktion löschen"
        description="Möchten Sie diese Transaktion wirklich löschen? Eine zugehörige Rechnungszuordnung wird ebenfalls entfernt. Diese Aktion kann nicht rückgängig gemacht werden."
      />
    </div>
  );
}
