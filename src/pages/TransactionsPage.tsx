import { useState } from "react";
import { Plus, Search, Trash2, ArrowUpRight, ArrowDownLeft, Loader2, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useTransactions, useCreateTransaction, useDeleteTransaction } from "@/hooks/useTransactions";
import { useBankStatements } from "@/hooks/useDocuments";

export default function TransactionsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "credit" | "debit">("all");
  const [filterStatement, setFilterStatement] = useState<string>("all");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newTransaction, setNewTransaction] = useState({
    date: new Date().toISOString().split("T")[0],
    description: "",
    amount: 0,
    transactionType: "debit" as "credit" | "debit",
    bankStatementId: "",
  });

  const { data: transactions = [], isLoading } = useTransactions();
  const { data: statements = [] } = useBankStatements();
  const createTransaction = useCreateTransaction();
  const deleteTransaction = useDeleteTransaction();

  const filteredTransactions = transactions.filter((tx) => {
    const matchesSearch =
      tx.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tx.amount.toString().includes(searchQuery);
    const matchesType = filterType === "all" || tx.transactionType === filterType;
    const matchesStatement =
      filterStatement === "all" || tx.bankStatementId === filterStatement;
    return matchesSearch && matchesType && matchesStatement;
  });

  const totalCredits = filteredTransactions
    .filter((tx) => tx.transactionType === "credit")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalDebits = filteredTransactions
    .filter((tx) => tx.transactionType === "debit")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const handleAddTransaction = () => {
    createTransaction.mutate(
      {
        date: newTransaction.date,
        description: newTransaction.description,
        amount: newTransaction.amount,
        transactionType: newTransaction.transactionType,
        bankStatementId: newTransaction.bankStatementId || undefined,
      },
      {
        onSuccess: () => {
          setIsAddDialogOpen(false);
          setNewTransaction({
            date: new Date().toISOString().split("T")[0],
            description: "",
            amount: 0,
            transactionType: "debit",
            bankStatementId: "",
          });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fade-in">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Transaktionen
          </h1>
          <p className="mt-1 text-muted-foreground">
            {filteredTransactions.length} Transaktionen
          </p>
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="gradient">
              <Plus className="mr-2 h-4 w-4" />
              Transaktion hinzufügen
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neue Transaktion</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Datum</Label>
                <Input
                  type="date"
                  value={newTransaction.date}
                  onChange={(e) =>
                    setNewTransaction({ ...newTransaction, date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Beschreibung</Label>
                <Input
                  placeholder="z.B. Miete, Gehalt..."
                  value={newTransaction.description}
                  onChange={(e) =>
                    setNewTransaction({ ...newTransaction, description: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Betrag (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={newTransaction.amount || ""}
                  onChange={(e) =>
                    setNewTransaction({
                      ...newTransaction,
                      amount: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Typ</Label>
                <Select
                  value={newTransaction.transactionType}
                  onValueChange={(value: "credit" | "debit") =>
                    setNewTransaction({ ...newTransaction, transactionType: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">Eingang (Haben)</SelectItem>
                    <SelectItem value="debit">Ausgang (Soll)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Kontoauszug (optional)</Label>
                <Select
                  value={newTransaction.bankStatementId || "none"}
                  onValueChange={(value) =>
                    setNewTransaction({
                      ...newTransaction,
                      bankStatementId: value === "none" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kein Kontoauszug" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Kontoauszug</SelectItem>
                    {statements.map((stmt) => (
                      <SelectItem key={stmt.id} value={stmt.id}>
                        {stmt.fileName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="gradient"
                className="w-full"
                onClick={handleAddTransaction}
                disabled={
                  createTransaction.isPending ||
                  !newTransaction.description ||
                  !newTransaction.amount
                }
              >
                {createTransaction.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Hinzufügen
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="glass-card p-4">
          <p className="text-sm text-muted-foreground">Gesamt</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {filteredTransactions.length}
          </p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2">
            <ArrowDownLeft className="h-4 w-4 text-success" />
            <p className="text-sm text-muted-foreground">Eingänge</p>
          </div>
          <p className="mt-1 text-2xl font-bold text-success">
            +{totalCredits.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4 text-destructive" />
            <p className="text-sm text-muted-foreground">Ausgänge</p>
          </div>
          <p className="mt-1 text-2xl font-bold text-destructive">
            -{totalDebits.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suchen nach Beschreibung oder Betrag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
              <SelectTrigger className="w-[150px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Typen</SelectItem>
                <SelectItem value="credit">Eingänge</SelectItem>
                <SelectItem value="debit">Ausgänge</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatement} onValueChange={setFilterStatement}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Alle Kontoauszüge" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Kontoauszüge</SelectItem>
                {statements.map((stmt) => (
                  <SelectItem key={stmt.id} value={stmt.id}>
                    {stmt.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="glass-card overflow-hidden animate-fade-in" style={{ animationDelay: "0.3s" }}>
        {filteredTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">Keine Transaktionen gefunden.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Fügen Sie Transaktionen manuell hinzu oder extrahieren Sie sie aus Kontoauszügen.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Datum</TableHead>
                <TableHead>Beschreibung</TableHead>
                <TableHead className="w-[120px]">Typ</TableHead>
                <TableHead className="w-[150px] text-right">Betrag</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="font-mono text-sm">
                    {new Date(tx.date).toLocaleDateString("de-DE")}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{tx.description}</p>
                      {tx.bankStatementFileName && (
                        <p className="text-xs text-muted-foreground">
                          {tx.bankStatementFileName}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        tx.transactionType === "credit"
                          ? "bg-success/10 text-success border-success/20"
                          : "bg-destructive/10 text-destructive border-destructive/20"
                      )}
                    >
                      {tx.transactionType === "credit" ? (
                        <ArrowDownLeft className="mr-1 h-3 w-3" />
                      ) : (
                        <ArrowUpRight className="mr-1 h-3 w-3" />
                      )}
                      {tx.transactionType === "credit" ? "Eingang" : "Ausgang"}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium",
                      tx.transactionType === "credit" ? "text-success" : "text-destructive"
                    )}
                  >
                    {tx.transactionType === "credit" ? "+" : "-"}
                    {tx.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        tx.matchStatus === "confirmed"
                          ? "bg-success/10 text-success"
                          : tx.matchStatus === "matched"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {tx.matchStatus === "confirmed"
                        ? "Bestätigt"
                        : tx.matchStatus === "matched"
                        ? "Zugeordnet"
                        : "Offen"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteTransaction.mutate(tx.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
