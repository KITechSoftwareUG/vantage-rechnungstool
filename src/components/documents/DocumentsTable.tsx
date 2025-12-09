import { FileText, ArrowDownLeft, ArrowUpRight, MoreHorizontal, Eye, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InvoiceData } from "@/types/documents";
import { cn } from "@/lib/utils";

interface DocumentsTableProps {
  documents: InvoiceData[];
  onView?: (doc: InvoiceData) => void;
  onDelete?: (id: string) => void;
}

export function DocumentsTable({ documents, onView, onDelete }: DocumentsTableProps) {
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
    <div className="glass-card overflow-hidden animate-fade-in">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50 hover:bg-transparent">
            <TableHead className="text-muted-foreground">Dokument</TableHead>
            <TableHead className="text-muted-foreground">Typ</TableHead>
            <TableHead className="text-muted-foreground">Datum</TableHead>
            <TableHead className="text-muted-foreground">Aussteller</TableHead>
            <TableHead className="text-right text-muted-foreground">Betrag</TableHead>
            <TableHead className="text-muted-foreground">Status</TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow 
              key={doc.id} 
              className="border-border/30 transition-colors hover:bg-muted/30"
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="font-medium text-foreground">{doc.fileName}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className={cn(
                  "flex items-center gap-2 text-sm",
                  doc.type === "incoming" ? "text-success" : "text-muted-foreground"
                )}>
                  {doc.type === "incoming" ? (
                    <>
                      <ArrowDownLeft className="h-4 w-4" />
                      <span>Eingang</span>
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="h-4 w-4" />
                      <span>Ausgang</span>
                    </>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-foreground">
                {new Date(doc.date).toLocaleDateString("de-DE")}
              </TableCell>
              <TableCell className="text-foreground">{doc.issuer}</TableCell>
              <TableCell className="text-right">
                <span className={cn(
                  "font-semibold",
                  doc.type === "incoming" ? "text-success" : "text-foreground"
                )}>
                  {doc.type === "incoming" ? "+" : "-"}
                  {doc.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={statusColors[doc.status]}>
                  {statusLabels[doc.status]}
                </Badge>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => onView?.(doc)}>
                      <Eye className="mr-2 h-4 w-4" />
                      Ansehen
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => onDelete?.(doc.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Löschen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
