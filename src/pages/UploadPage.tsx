import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadZone } from "@/components/upload/UploadZone";
import { DocumentCard, InvoiceData } from "@/components/documents/DocumentCard";
import { StatementCard, StatementData } from "@/components/documents/StatementCard";
import { Button } from "@/components/ui/button";
import { FileText, Building, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function UploadPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("invoices");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedInvoices, setProcessedInvoices] = useState<InvoiceData[]>([]);
  const [processedStatements, setProcessedStatements] = useState<StatementData[]>([]);

  const handleInvoiceUpload = async (files: File[]) => {
    setIsProcessing(true);
    
    // Simulate OCR processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const newInvoices: InvoiceData[] = files.map((file, index) => ({
      id: `inv-${Date.now()}-${index}`,
      fileName: file.name,
      date: new Date().toISOString().split("T")[0],
      issuer: "Erkannter Aussteller GmbH",
      amount: Math.round(Math.random() * 5000 * 100) / 100,
      type: Math.random() > 0.5 ? "incoming" : "outgoing",
      status: "ready" as const,
    }));

    setProcessedInvoices(prev => [...prev, ...newInvoices]);
    setIsProcessing(false);
    
    toast({
      title: "OCR-Verarbeitung abgeschlossen",
      description: `${files.length} Dokument(e) erfolgreich analysiert`,
    });
  };

  const handleStatementUpload = async (files: File[]) => {
    setIsProcessing(true);
    
    // Simulate OCR processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const newStatements: StatementData[] = files.map((file, index) => ({
      id: `stmt-${Date.now()}-${index}`,
      fileName: file.name,
      bank: "Deutsche Bank",
      accountNumber: "DE89 3704 0044 0532 0130 00",
      date: new Date().toISOString().split("T")[0],
      openingBalance: Math.round(Math.random() * 10000 * 100) / 100,
      closingBalance: Math.round(Math.random() * 15000 * 100) / 100,
      status: "ready" as const,
    }));

    setProcessedStatements(prev => [...prev, ...newStatements]);
    setIsProcessing(false);
    
    toast({
      title: "OCR-Verarbeitung abgeschlossen",
      description: `${files.length} Kontoauszug/-auszüge erfolgreich analysiert`,
    });
  };

  const handleInvoiceSave = (data: InvoiceData) => {
    setProcessedInvoices(prev => 
      prev.map(inv => inv.id === data.id ? { ...data, status: "saved" as const } : inv)
    );
    toast({
      title: "Rechnung gespeichert",
      description: `${data.fileName} wurde erfolgreich gespeichert`,
    });
  };

  const handleStatementSave = (data: StatementData) => {
    setProcessedStatements(prev => 
      prev.map(stmt => stmt.id === data.id ? { ...data, status: "saved" as const } : stmt)
    );
    toast({
      title: "Kontoauszug gespeichert",
      description: `${data.fileName} wurde erfolgreich gespeichert`,
    });
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
