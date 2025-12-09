import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadZone } from "@/components/upload/UploadZone";
import { DocumentCard } from "@/components/documents/DocumentCard";
import { StatementCard } from "@/components/documents/StatementCard";
import { FileText, Building, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { InvoiceData, StatementData } from "@/types/documents";
import { useAuth } from "@/hooks/useAuth";
import { useCreateInvoice, useCreateBankStatement, uploadDocument, processDocumentOCR } from "@/hooks/useDocuments";
import { supabase } from "@/integrations/supabase/client";

export default function UploadPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("invoices");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedInvoices, setProcessedInvoices] = useState<(InvoiceData & { file: File })[]>([]);
  const [processedStatements, setProcessedStatements] = useState<(StatementData & { file: File })[]>([]);

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
          // Add with default values on error
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
      const newStatements: (StatementData & { file: File })[] = [];

      for (const file of files) {
        try {
          const result = await processDocumentOCR(file, "statement");
          
          const date = new Date(result.data.date || new Date());
          
          newStatements.push({
            id: `temp-${Date.now()}-${Math.random()}`,
            fileName: file.name,
            bank: result.data.bank || "Unbekannt",
            accountNumber: result.data.accountNumber || "Unbekannt",
            date: result.data.date || date.toISOString().split("T")[0],
            openingBalance: result.data.openingBalance || 0,
            closingBalance: result.data.closingBalance || 0,
            status: "ready",
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            file,
          });
        } catch (error) {
          console.error("OCR error for file:", file.name, error);
          const date = new Date();
          newStatements.push({
            id: `temp-${Date.now()}-${Math.random()}`,
            fileName: file.name,
            bank: "Unbekannt - Bitte manuell eingeben",
            accountNumber: "Unbekannt",
            date: date.toISOString().split("T")[0],
            openingBalance: 0,
            closingBalance: 0,
            status: "ready",
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            file,
          });
        }
      }

      setProcessedStatements(prev => [...prev, ...newStatements]);
      
      toast({
        title: "OCR-Verarbeitung abgeschlossen",
        description: `${files.length} Kontoauszug/-auszüge analysiert`,
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
      
      // Upload file if exists
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

      // Remove from processed list
      setProcessedInvoices(prev => prev.filter(inv => inv.id !== data.id));
    } catch (error: any) {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleStatementSave = async (data: StatementData & { file?: File }) => {
    if (!user) return;
    
    try {
      let fileUrl: string | undefined;
      
      // Upload file if exists
      if (data.file) {
        fileUrl = await uploadDocument(data.file, user.id, "statements");
      }

      await createBankStatement.mutateAsync({
        fileName: data.fileName,
        fileUrl,
        bank: data.bank,
        accountNumber: data.accountNumber,
        date: data.date,
        year: data.year,
        month: data.month,
        openingBalance: data.openingBalance,
        closingBalance: data.closingBalance,
        status: "saved",
      });

      // Remove from processed list
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
                Überprüfen Sie die extrahierten Daten und klicken Sie auf "Speichern" um sie in der Datenbank zu sichern.
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
            <UploadZone 
              onFilesSelected={handleStatementUpload}
              acceptedTypes=".pdf,.png,.jpg,.jpeg"
            />
          </div>

          {isProcessing && (
            <div className="glass-card flex items-center justify-center gap-3 p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-foreground">Kontoauszüge werden analysiert...</span>
            </div>
          )}

          {processedStatements.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-heading text-lg font-semibold text-foreground">
                Erkannte Kontoauszüge ({processedStatements.length})
              </h3>
              <p className="text-sm text-muted-foreground">
                Überprüfen Sie die extrahierten Daten und klicken Sie auf "Speichern" um sie in der Datenbank zu sichern.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {processedStatements.map((statement, index) => (
                  <StatementCard
                    key={statement.id}
                    statement={statement}
                    onSave={handleStatementSave}
                    index={index}
                  />
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
