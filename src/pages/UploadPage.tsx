import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadZone } from "@/components/upload/UploadZone";
import { DocumentCard } from "@/components/documents/DocumentCard";
import { StatementCard } from "@/components/documents/StatementCard";
import { FileText, Building, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { InvoiceData, StatementData, ExtractedTransaction } from "@/types/documents";
import { useAuth } from "@/hooks/useAuth";
import { 
  useCreateInvoice, 
  useCreateBankStatement, 
  uploadDocument, 
  processDocumentOCR,
  checkDuplicateTransactions,
  createBankTransactions 
} from "@/hooks/useDocuments";
import { useQueryClient } from "@tanstack/react-query";

interface ProcessedStatement extends StatementData {
  file: File;
  transactions: ExtractedTransaction[];
  duplicateCount?: number;
}

export default function UploadPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("invoices");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedInvoices, setProcessedInvoices] = useState<(InvoiceData & { file: File })[]>([]);
  const [processedStatements, setProcessedStatements] = useState<ProcessedStatement[]>([]);

  const createInvoice = useCreateInvoice();
  const createBankStatement = useCreateBankStatement();

  const handleInvoiceUpload = async (files: File[]) => {
    if (!user) return;
    setIsProcessing(true);
    
    try {
      const newInvoices: (InvoiceData & { file: File })[] = [];

      for (const file of files) {
        try {
          const result = await processDocumentOCR(file, "invoice");
          
          const date = new Date(result.data.date || new Date());
          
          newInvoices.push({
            id: `temp-${Date.now()}-${Math.random()}`,
            fileName: file.name,
            date: result.data.date || date.toISOString().split("T")[0],
            issuer: result.data.issuer || "Unbekannt",
            amount: result.data.amount || 0,
            type: result.data.type || "outgoing",
            status: "ready",
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            file,
          });
        } catch (error) {
          console.error("OCR error for file:", file.name, error);
          const date = new Date();
          newInvoices.push({
            id: `temp-${Date.now()}-${Math.random()}`,
            fileName: file.name,
            date: date.toISOString().split("T")[0],
            issuer: "Unbekannt - Bitte manuell eingeben",
            amount: 0,
            type: "outgoing",
            status: "ready",
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            file,
          });
        }
      }

      setProcessedInvoices(prev => [...prev, ...newInvoices]);
      
      toast({
        title: "OCR-Verarbeitung abgeschlossen",
        description: `${files.length} Dokument(e) analysiert`,
      });
    } catch (error: any) {
      toast({
        title: "Fehler bei der Verarbeitung",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStatementUpload = async (files: File[]) => {
    if (!user) return;
    setIsProcessing(true);
    
    try {
      const newStatements: ProcessedStatement[] = [];

      for (const file of files) {
        try {
          const result = await processDocumentOCR(file, "statement");
          
          // Handle new format with summary and transactions
          const summary = result.data.summary || result.data;
          const transactions: ExtractedTransaction[] = result.data.transactions || [];
          
          const date = new Date(summary.date || new Date());
          
          // Check for duplicates
          let duplicateCount = 0;
          let newTransactions = transactions;
          
          if (transactions.length > 0) {
            const duplicateCheck = await checkDuplicateTransactions(user.id, transactions);
            duplicateCount = duplicateCheck.duplicates.length;
            newTransactions = duplicateCheck.newTransactions;
          }
          
          // Determine bankType from bank name
          let bankType: "volksbank" | "amex" = "volksbank";
          const bankName = (summary.bank || "").toLowerCase();
          if (bankName.includes("amex") || bankName.includes("american express")) {
            bankType = "amex";
          } else if (summary.bankType) {
            bankType = summary.bankType;
          }
          
          newStatements.push({
            id: `temp-${Date.now()}-${Math.random()}`,
            fileName: file.name,
            bank: summary.bank || "Unbekannt",
            bankType,
            accountNumber: summary.accountNumber || "Unbekannt",
            date: summary.date || date.toISOString().split("T")[0],
            openingBalance: summary.openingBalance || 0,
            closingBalance: summary.closingBalance || 0,
            status: "ready",
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            file,
            transactions: newTransactions,
            duplicateCount,
          });
        } catch (error) {
          console.error("OCR error for file:", file.name, error);
          const date = new Date();
          newStatements.push({
            id: `temp-${Date.now()}-${Math.random()}`,
            fileName: file.name,
            bank: "Unbekannt - Bitte manuell eingeben",
            bankType: "volksbank",
            accountNumber: "Unbekannt",
            date: date.toISOString().split("T")[0],
            openingBalance: 0,
            closingBalance: 0,
            status: "ready",
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            file,
            transactions: [],
            duplicateCount: 0,
          });
        }
      }

      setProcessedStatements(prev => [...prev, ...newStatements]);
      
      const totalTransactions = newStatements.reduce((sum, s) => sum + (s.transactions?.length || 0), 0);
      const totalDuplicates = newStatements.reduce((sum, s) => sum + (s.duplicateCount || 0), 0);
      
      let description = `${files.length} Kontoauszug/-auszüge analysiert`;
      if (totalTransactions > 0) {
        description += `, ${totalTransactions} neue Transaktionen erkannt`;
      }
      if (totalDuplicates > 0) {
        description += `, ${totalDuplicates} Duplikate übersprungen`;
      }
      
      toast({
        title: "OCR-Verarbeitung abgeschlossen",
        description,
      });
    } catch (error: any) {
      toast({
        title: "Fehler bei der Verarbeitung",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInvoiceSave = async (data: InvoiceData & { file?: File }) => {
    if (!user) return;
    
    try {
      let fileUrl: string | undefined;
      
      if (data.file) {
        fileUrl = await uploadDocument(data.file, user.id, "invoices");
      }

      await createInvoice.mutateAsync({
        fileName: data.fileName,
        fileUrl,
        date: data.date,
        year: data.year,
        month: data.month,
        issuer: data.issuer,
        amount: data.amount,
        type: data.type,
        status: "saved",
      });

      setProcessedInvoices(prev => prev.filter(inv => inv.id !== data.id));
    } catch (error: any) {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleStatementSave = async (data: StatementData & { file?: File; transactions?: ExtractedTransaction[] }) => {
    if (!user) return;
    
    try {
      let fileUrl: string | undefined;
      
      if (data.file) {
        fileUrl = await uploadDocument(data.file, user.id, "statements");
      }

      // Create bank statement first
      const statement = await createBankStatement.mutateAsync({
        fileName: data.fileName,
        fileUrl,
        bank: data.bank,
        bankType: data.bankType,
        accountNumber: data.accountNumber,
        date: data.date,
        year: data.year,
        month: data.month,
        openingBalance: data.openingBalance,
        closingBalance: data.closingBalance,
        status: "saved",
      });

      // Then create associated transactions
      const transactions = (data as ProcessedStatement).transactions || [];
      if (transactions.length > 0 && statement) {
        const savedCount = await createBankTransactions(user.id, statement.id, transactions);
        toast({
          title: "Kontoauszug gespeichert",
          description: `${savedCount} Transaktionen hinzugefügt`,
        });
      } else {
        toast({ title: "Kontoauszug gespeichert" });
      }

      // Invalidate transactions query
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });

      setProcessedStatements(prev => prev.filter(stmt => stmt.id !== data.id));
    } catch (error: any) {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Dokumente hochladen
        </h1>
        <p className="mt-1 text-muted-foreground">
          Laden Sie Rechnungen oder Kontoauszüge hoch für automatische OCR-Erkennung
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in">
        <TabsList className="glass-card h-auto p-1">
          <TabsTrigger 
            value="invoices" 
            className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <FileText className="h-4 w-4" />
            Rechnungen
          </TabsTrigger>
          <TabsTrigger 
            value="statements"
            className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Building className="h-4 w-4" />
            Kontoauszüge
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-6 space-y-6">
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="font-heading text-lg font-semibold text-foreground">
                KI-gestützte Rechnungserkennung
              </h2>
            </div>
            <UploadZone 
              onFilesSelected={handleInvoiceUpload}
              acceptedTypes=".pdf,.png,.jpg,.jpeg"
            />
          </div>

          {isProcessing && (
            <div className="glass-card flex items-center justify-center gap-3 p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-foreground">Dokumente werden analysiert...</span>
            </div>
          )}

          {processedInvoices.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-heading text-lg font-semibold text-foreground">
                Erkannte Rechnungen ({processedInvoices.length})
              </h3>
              <p className="text-sm text-muted-foreground">
                Überprüfen Sie die extrahierten Daten und klicken Sie auf "Bestätigen" um sie zu speichern.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {processedInvoices.map((invoice, index) => (
                  <DocumentCard
                    key={invoice.id}
                    document={invoice}
                    onSave={handleInvoiceSave}
                    index={index}
                  />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="statements" className="mt-6 space-y-6">
          <div className="glass-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="font-heading text-lg font-semibold text-foreground">
                KI-gestützte Kontoauszugerkennung
              </h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Transaktionen werden automatisch zeilenweise extrahiert und auf Duplikate geprüft.
            </p>
            <UploadZone 
              onFilesSelected={handleStatementUpload}
              acceptedTypes=".pdf,.png,.jpg,.jpeg"
            />
          </div>

          {isProcessing && (
            <div className="glass-card flex items-center justify-center gap-3 p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-foreground">Kontoauszüge werden analysiert und Duplikate geprüft...</span>
            </div>
          )}

          {processedStatements.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-heading text-lg font-semibold text-foreground">
                Erkannte Kontoauszüge ({processedStatements.length})
              </h3>
              <p className="text-sm text-muted-foreground">
                Überprüfen Sie die extrahierten Daten und klicken Sie auf "Bestätigen" um sie zu speichern.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {processedStatements.map((statement, index) => (
                  <div key={statement.id} className="space-y-2">
                    <StatementCard
                      statement={statement}
                      onSave={handleStatementSave}
                      index={index}
                    />
                    {/* Transaction info */}
                    <div className="glass-card p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Transaktionen:</span>
                        <span className="font-medium text-foreground">
                          {statement.transactions?.length || 0} neu
                        </span>
                      </div>
                      {(statement.duplicateCount || 0) > 0 && (
                        <div className="mt-1 flex items-center gap-1 text-amber-500">
                          <AlertTriangle className="h-3 w-3" />
                          <span className="text-xs">{statement.duplicateCount} Duplikate übersprungen</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
