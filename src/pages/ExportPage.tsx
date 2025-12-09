import { format } from "date-fns";
import { de } from "date-fns/locale";
import { FileText, Download, ExternalLink, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useExportTransactions } from "@/hooks/useExportTransactions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function ExportPage() {
  const { data: transactions, isLoading } = useExportTransactions();

  const handleDownload = async (fileUrl: string | null, fileName: string) => {
    if (!fileUrl) {
      toast.error("Keine Datei verfügbar");
      return;
    }

    try {
      const { data, error } = await supabase.storage
        .from("documents")
        .download(fileUrl);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Fehler beim Herunterladen");
    }
  };

  const handleView = async (fileUrl: string | null) => {
    if (!fileUrl) {
      toast.error("Keine Datei verfügbar");
      return;
    }

    try {
      const { data } = supabase.storage
        .from("documents")
        .getPublicUrl(fileUrl);

      window.open(data.publicUrl, "_blank");
    } catch (error) {
      console.error("View error:", error);
      toast.error("Fehler beim Öffnen");
    }
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          Steuerberater Export
        </h1>
        <p className="mt-2 text-muted-foreground">
          Alle zugeordneten Transaktionen mit ihren Rechnungen
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Zugeordnete Transaktionen
          </CardTitle>
          <CardDescription>
            {transactions?.length || 0} Transaktionen mit zugeordneten Rechnungen
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : transactions && transactions.length > 0 ? (
            <div className="space-y-4">
              {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      {transaction.transactionType === "debit" ? (
                        <ArrowDownRight className="h-4 w-4 text-destructive" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-green-500" />
                      )}
                      <span className="font-medium">
                        {format(new Date(transaction.date), "dd.MM.yyyy", { locale: de })}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {transaction.bankStatement?.bank || "Unbekannt"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-1">
                      {transaction.description}
                    </p>
                    <div className="flex items-center gap-4">
                      <span className={`font-semibold ${
                        transaction.transactionType === "debit" 
                          ? "text-destructive" 
                          : "text-green-500"
                      }`}>
                        {transaction.transactionType === "debit" ? "-" : "+"}
                        {formatAmount(Math.abs(transaction.amount))}
                      </span>
                    </div>
                  </div>

                  {transaction.matchedInvoice && (
                    <div className="flex flex-col gap-2 rounded-md border bg-muted/50 p-3 sm:min-w-[280px]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">
                            {transaction.matchedInvoice.issuer}
                          </span>
                        </div>
                        <Badge 
                          variant={transaction.matchedInvoice.type === "incoming" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {transaction.matchedInvoice.type === "incoming" ? "Eingang" : "Ausgang"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {transaction.matchedInvoice.fileName}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => handleView(transaction.matchedInvoice?.fileUrl || null)}
                        >
                          <ExternalLink className="mr-1 h-3 w-3" />
                          Ansehen
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          className="flex-1"
                          onClick={() => handleDownload(
                            transaction.matchedInvoice?.fileUrl || null,
                            transaction.matchedInvoice?.fileName || "rechnung.pdf"
                          )}
                        >
                          <Download className="mr-1 h-3 w-3" />
                          Download
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-lg font-medium">Keine zugeordneten Transaktionen</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ordnen Sie zuerst Transaktionen Rechnungen zu
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
