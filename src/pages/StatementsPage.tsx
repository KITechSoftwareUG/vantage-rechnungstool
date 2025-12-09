import { useState } from "react";
import { Grid3X3, List, Search, Building, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatementCard, StatementData } from "@/components/documents/StatementCard";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Mock data
const mockStatements: StatementData[] = [
  {
    id: "1",
    fileName: "Kontoauszug_Jan_2024.pdf",
    bank: "Deutsche Bank",
    accountNumber: "DE89 3704 0044 0532 0130 00",
    date: "2024-01-31",
    openingBalance: 12500.00,
    closingBalance: 14250.00,
    status: "saved",
  },
  {
    id: "2",
    fileName: "Kontoauszug_Dez_2023.pdf",
    bank: "Deutsche Bank",
    accountNumber: "DE89 3704 0044 0532 0130 00",
    date: "2023-12-31",
    openingBalance: 11200.00,
    closingBalance: 12500.00,
    status: "saved",
  },
  {
    id: "3",
    fileName: "Sparkasse_Jan_2024.pdf",
    bank: "Sparkasse München",
    accountNumber: "DE45 7015 0000 0012 3456 78",
    date: "2024-01-31",
    openingBalance: 8500.00,
    closingBalance: 7200.00,
    status: "saved",
  },
  {
    id: "4",
    fileName: "Geschäftskonto_Q4.pdf",
    bank: "Commerzbank",
    accountNumber: "DE12 3704 0044 0987 6543 21",
    date: "2024-01-15",
    openingBalance: 25000.00,
    closingBalance: 28750.00,
    status: "saved",
  },
];

export default function StatementsPage() {
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [statements, setStatements] = useState(mockStatements);

  const filteredStatements = statements.filter(stmt =>
    stmt.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    stmt.bank.toLowerCase().includes(searchQuery.toLowerCase()) ||
    stmt.accountNumber.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSave = (data: StatementData) => {
    setStatements(prev => prev.map(stmt => stmt.id === data.id ? data : stmt));
  };

  // Calculate totals
  const totalClosingBalance = filteredStatements.reduce((sum, stmt) => sum + stmt.closingBalance, 0);
  const totalChange = filteredStatements.reduce((sum, stmt) => sum + (stmt.closingBalance - stmt.openingBalance), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fade-in">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Kontoauszüge
          </h1>
          <p className="mt-1 text-muted-foreground">
            {filteredStatements.length} Kontoauszüge gefunden
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="icon"
            onClick={() => setViewMode("grid")}
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "ghost"}
            size="icon"
            onClick={() => setViewMode("table")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="glass-card p-4">
          <p className="text-sm text-muted-foreground">Gesamtsaldo aller Konten</p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {totalClosingBalance.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">Gesamtveränderung</p>
            {totalChange >= 0 ? (
              <TrendingUp className="h-4 w-4 text-success" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
          </div>
          <p className={cn(
            "mt-1 text-2xl font-bold",
            totalChange >= 0 ? "text-success" : "text-destructive"
          )}>
            {totalChange >= 0 ? "+" : ""}
            {totalChange.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="glass-card p-4 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Suchen nach Bank, Kontonummer oder Dateiname..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Content */}
      {viewMode === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStatements.map((statement, index) => (
            <StatementCard
              key={statement.id}
              statement={statement}
              onSave={handleSave}
              index={index}
            />
          ))}
        </div>
      ) : (
        <div className="glass-card overflow-hidden animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-muted-foreground">Dokument</TableHead>
                <TableHead className="text-muted-foreground">Bank</TableHead>
                <TableHead className="text-muted-foreground">Kontonummer</TableHead>
                <TableHead className="text-muted-foreground">Datum</TableHead>
                <TableHead className="text-right text-muted-foreground">Anfangssaldo</TableHead>
                <TableHead className="text-right text-muted-foreground">Endsaldo</TableHead>
                <TableHead className="text-right text-muted-foreground">Differenz</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStatements.map((stmt) => {
                const diff = stmt.closingBalance - stmt.openingBalance;
                return (
                  <TableRow 
                    key={stmt.id} 
                    className="border-border/30 transition-colors hover:bg-muted/30"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                          <Building className="h-4 w-4 text-primary" />
                        </div>
                        <span className="font-medium text-foreground">{stmt.fileName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground">{stmt.bank}</TableCell>
                    <TableCell className="font-mono text-sm text-foreground">
                      {stmt.accountNumber}
                    </TableCell>
                    <TableCell className="text-foreground">
                      {new Date(stmt.date).toLocaleDateString("de-DE")}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {stmt.openingBalance.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                    </TableCell>
                    <TableCell className="text-right font-semibold text-foreground">
                      {stmt.closingBalance.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge 
                        variant="outline" 
                        className={cn(
                          diff >= 0 
                            ? "bg-success/10 text-success border-success/20" 
                            : "bg-destructive/10 text-destructive border-destructive/20"
                        )}
                      >
                        {diff >= 0 ? "+" : ""}
                        {diff.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {filteredStatements.length === 0 && (
        <div className="glass-card flex flex-col items-center justify-center p-12 text-center">
          <Building className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 font-heading text-lg font-semibold text-foreground">
            Keine Kontoauszüge gefunden
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Passen Sie Ihre Suchkriterien an oder laden Sie neue Dokumente hoch
          </p>
        </div>
      )}
    </div>
  );
}
