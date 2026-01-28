import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadZone } from "@/components/upload/UploadZone";
import { GoogleDriveSync } from "@/components/upload/GoogleDriveSync";
import { InvoiceReviewCard } from "@/components/upload/InvoiceReviewCard";
import { StatementCard } from "@/components/documents/StatementCard";
import { ArrowDownLeft, ArrowUpRight, Building, CreditCard, Loader2, Sparkles, AlertTriangle, Receipt, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { InvoiceData, StatementData, ExtractedTransaction } from "@/types/documents";
import { useAuth } from "@/hooks/useAuth";
import { 
  useCreateInvoice, 
  useCreateBankStatement, 
  uploadDocument, 
  processDocumentOCR,
  checkDuplicateTransactions,
  checkDuplicateInvoice,
  createBankTransactions 
} from "@/hooks/useDocuments";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateBankTransaction } from "@/hooks/useMatching";

interface ProcessedStatement extends StatementData {
  file: File;
  transactions: ExtractedTransaction[];
  duplicateCount?: number;
}

type UploadCategory = "incoming" | "outgoing" | "cash" | "volksbank" | "amex" | "commission";

export default function UploadPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<UploadCategory>("incoming");
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Separate state for each category
  const [incomingInvoices, setIncomingInvoices] = useState<(InvoiceData & { file: File })[]>([]);
  const [outgoingInvoices, setOutgoingInvoices] = useState<(InvoiceData & { file: File })[]>([]);
  const [cashInvoices, setCashInvoices] = useState<(InvoiceData & { file: File })[]>([]);
  const [volksbankStatements, setVolksbankStatements] = useState<ProcessedStatement[]>([]);
  const [amexStatements, setAmexStatements] = useState<ProcessedStatement[]>([]);
  const [commissionStatements, setCommissionStatements] = useState<ProcessedStatement[]>([]);

  const createInvoice = useCreateInvoice();
  const createBankStatement = useCreateBankStatement();
  const createBankTransaction = useCreateBankTransaction();

  const handleInvoiceUpload = async (files: File[], type: "incoming" | "outgoing") => {
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
            invoiceNumber: result.data.invoiceNumber || null,
            type, // Use the type from the tab, not from OCR
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
            type, // Use the type from the tab
            status: "ready",
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            file,
          });
        }
      }

      if (type === "incoming") {
        setIncomingInvoices(prev => [...prev, ...newInvoices]);
      } else {
        setOutgoingInvoices(prev => [...prev, ...newInvoices]);
      }
      
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

  const handleStatementUpload = async (files: File[], bankType: "volksbank" | "amex" | "commission") => {
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
          
          newStatements.push({
            id: `temp-${Date.now()}-${Math.random()}`,
            fileName: file.name,
            bank: summary.bank || (bankType === "amex" ? "American Express" : bankType === "commission" ? "Provisionsabrechnung" : "Volksbank"),
            bankType, // Use the bankType from the tab
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
            bank: bankType === "amex" ? "American Express" : bankType === "commission" ? "Provisionsabrechnung" : "Volksbank",
            bankType,
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

      if (bankType === "volksbank") {
        setVolksbankStatements(prev => [...prev, ...newStatements]);
      } else if (bankType === "amex") {
        setAmexStatements(prev => [...prev, ...newStatements]);
      } else {
        setCommissionStatements(prev => [...prev, ...newStatements]);
      }
      
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

  const handleInvoiceSave = async (data: InvoiceData & { file?: File }, type: "incoming" | "outgoing") => {
    if (!user) return;
    
    try {
      // Check for duplicate
      const isDuplicate = await checkDuplicateInvoice(user.id, {
        date: data.date,
        issuer: data.issuer,
        amount: data.amount,
      });

      if (isDuplicate) {
        toast({
          title: "Duplikat erkannt",
          description: `Eine Rechnung mit gleichem Datum, Aussteller und Betrag existiert bereits.`,
          variant: "destructive",
        });
        return;
      }

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

      if (type === "incoming") {
        setIncomingInvoices(prev => prev.filter(inv => inv.id !== data.id));
      } else {
        setOutgoingInvoices(prev => prev.filter(inv => inv.id !== data.id));
      }
      
      toast({ title: "Rechnung gespeichert" });
    } catch (error: any) {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // Handler for cash/private payment invoices - creates invoice + matched transaction in one go
  const handleCashInvoiceSave = async (data: InvoiceData & { file?: File }) => {
    if (!user) return;
    
    try {
      // Check for duplicate
      const isDuplicate = await checkDuplicateInvoice(user.id, {
        date: data.date,
        issuer: data.issuer,
        amount: data.amount,
      });

      if (isDuplicate) {
        toast({
          title: "Duplikat erkannt",
          description: `Eine Rechnung mit gleichem Datum, Aussteller und Betrag existiert bereits.`,
          variant: "destructive",
        });
        return;
      }

      let fileUrl: string | undefined;
      
      if (data.file) {
        fileUrl = await uploadDocument(data.file, user.id, "invoices");
      }

      // Create invoice with payment_method = 'cash'
      const invoice = await createInvoice.mutateAsync({
        fileName: data.fileName,
        fileUrl,
        date: data.date,
        year: data.year,
        month: data.month,
        issuer: data.issuer,
        amount: data.amount,
        type: data.type,
        status: "saved",
        paymentMethod: "cash",
      });

      // Create a matching "cash" transaction that is already confirmed
      await createBankTransaction.mutateAsync({
        bankStatementId: null,
        date: data.date,
        description: `Kasse: ${data.issuer}`,
        amount: data.amount,
        transactionType: data.type === "outgoing" ? "debit" : "credit",
        matchedInvoiceId: invoice.id,
        matchConfidence: 100,
        matchStatus: "confirmed",
      });

      setCashInvoices(prev => prev.filter(inv => inv.id !== data.id));
      
      toast({ 
        title: "Kassenbeleg gespeichert",
        description: "Beleg und Transaktion wurden automatisch zugeordnet."
      });
    } catch (error: any) {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleCashInvoiceUpload = async (files: File[]) => {
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
            invoiceNumber: result.data.invoiceNumber || null,
            type: "outgoing", // Cash payments are typically expenses
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

      setCashInvoices(prev => [...prev, ...newInvoices]);
      
      toast({
        title: "OCR-Verarbeitung abgeschlossen",
        description: `${files.length} Kassenbeleg(e) analysiert`,
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

  const handleStatementSave = async (data: StatementData & { file?: File; transactions?: ExtractedTransaction[] }, bankType: "volksbank" | "amex" | "commission") => {
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

      if (bankType === "volksbank") {
        setVolksbankStatements(prev => prev.filter(stmt => stmt.id !== data.id));
      } else if (bankType === "amex") {
        setAmexStatements(prev => prev.filter(stmt => stmt.id !== data.id));
      } else {
        setCommissionStatements(prev => prev.filter(stmt => stmt.id !== data.id));
      }
    } catch (error: any) {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const renderInvoiceSection = (
    invoices: (InvoiceData & { file: File })[],
    type: "incoming" | "outgoing",
    setInvoices: React.Dispatch<React.SetStateAction<(InvoiceData & { file: File })[]>>
  ) => (
    <>
      <div className="glass-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="font-heading text-lg font-semibold text-foreground">
              {type === "incoming" ? "Eingangsrechnungen" : "Ausgangsrechnungen"} hochladen
            </h2>
          </div>
          <GoogleDriveSync 
            category={type}
            onFilesImported={(files) => handleInvoiceUpload(files, type)}
          />
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {type === "incoming" 
            ? "Rechnungen die Sie erhalten haben und bezahlen müssen (Ausgaben)"
            : "Rechnungen die Sie gestellt haben und bezahlt werden (Einnahmen)"
          }
        </p>
        <UploadZone 
          onFilesSelected={(files) => handleInvoiceUpload(files, type)}
          acceptedTypes=".pdf,.png,.jpg,.jpeg"
        />
      </div>

      {isProcessing && activeTab === type && (
        <div className="glass-card flex items-center justify-center gap-3 p-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-foreground">Dokumente werden analysiert...</span>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-heading text-lg font-semibold text-foreground">
            Erkannte {type === "incoming" ? "Eingangsrechnungen" : "Ausgangsrechnungen"} ({invoices.length})
          </h3>
          <p className="text-sm text-muted-foreground">
            Überprüfen Sie die extrahierten Daten anhand der Dokumentvorschau und klicken Sie auf "Bestätigen" um sie zu speichern.
          </p>
          <div className="space-y-4">
            {invoices.map((invoice, index) => (
              <InvoiceReviewCard
                key={invoice.id}
                invoice={invoice}
                onSave={(data) => handleInvoiceSave(data, type)}
                onDiscard={(id) => setInvoices(prev => prev.filter(inv => inv.id !== id))}
                index={index}
                showTypeSelector={false}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );

  // Render cash payment section
  const renderCashSection = () => (
    <>
      <div className="glass-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <h2 className="font-heading text-lg font-semibold text-foreground">
              Kasse / Barzahlung
            </h2>
          </div>
          <GoogleDriveSync 
            category="cash"
            onFilesImported={handleCashInvoiceUpload}
          />
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Belege für Bar- oder Privatzahlungen. Diese werden automatisch als "Kasse" markiert und sofort zugeordnet.
        </p>
        <UploadZone 
          onFilesSelected={handleCashInvoiceUpload}
          acceptedTypes=".pdf,.png,.jpg,.jpeg"
        />
      </div>

      {isProcessing && activeTab === "cash" && (
        <div className="glass-card flex items-center justify-center gap-3 p-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-foreground">Kassenbelege werden analysiert...</span>
        </div>
      )}

      {cashInvoices.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-heading text-lg font-semibold text-foreground">
            Erkannte Kassenbelege ({cashInvoices.length})
          </h3>
          <p className="text-sm text-muted-foreground">
            Überprüfen Sie die extrahierten Daten. Nach dem Bestätigen wird automatisch eine Transaktion erstellt.
          </p>
          <div className="space-y-4">
            {cashInvoices.map((invoice, index) => (
              <InvoiceReviewCard
                key={invoice.id}
                invoice={invoice}
                onSave={handleCashInvoiceSave}
                onDiscard={(id) => setCashInvoices(prev => prev.filter(inv => inv.id !== id))}
                index={index}
                showTypeSelector={false}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );

  const getBankLabel = (bankType: "volksbank" | "amex" | "commission") => {
    switch (bankType) {
      case "volksbank": return "Volksbank";
      case "amex": return "American Express";
      case "commission": return "Provisionsabrechnung";
    }
  };

  const renderStatementSection = (
    statements: ProcessedStatement[],
    bankType: "volksbank" | "amex" | "commission",
    setStatements: React.Dispatch<React.SetStateAction<ProcessedStatement[]>>
  ) => (
    <>
      <div className="glass-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="font-heading text-lg font-semibold text-foreground">
              {getBankLabel(bankType)} {bankType === "commission" ? "" : "Kontoauszüge"}
            </h2>
          </div>
          <GoogleDriveSync 
            category={bankType}
            onFilesImported={(files) => handleStatementUpload(files, bankType)}
          />
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Transaktionen werden automatisch zeilenweise extrahiert und auf Duplikate geprüft.
        </p>
        <UploadZone 
          onFilesSelected={(files) => handleStatementUpload(files, bankType)}
          acceptedTypes=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
        />
      </div>

      {isProcessing && activeTab === bankType && (
        <div className="glass-card flex items-center justify-center gap-3 p-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-foreground">Kontoauszüge werden analysiert und Duplikate geprüft...</span>
        </div>
      )}

      {statements.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-heading text-lg font-semibold text-foreground">
            Erkannte Kontoauszüge ({statements.length})
          </h3>
          <p className="text-sm text-muted-foreground">
            Überprüfen Sie die extrahierten Daten und klicken Sie auf "Bestätigen" um sie zu speichern.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {statements.map((statement, index) => (
              <div key={statement.id} className="space-y-2">
                <StatementCard
                  statement={statement}
                  onSave={(data) => handleStatementSave(data, bankType)}
                  onDelete={(id) => setStatements(prev => prev.filter(s => s.id !== id))}
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
    </>
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Dokumente hochladen
        </h1>
        <p className="mt-1 text-muted-foreground">
          Wählen Sie die Kategorie und laden Sie Ihre Dokumente hoch
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as UploadCategory)} className="animate-fade-in">
        <TabsList className="glass-card h-auto p-1 flex-wrap">
          <TabsTrigger 
            value="incoming" 
            className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <ArrowDownLeft className="h-4 w-4" />
            Eingangsrechnungen
          </TabsTrigger>
          <TabsTrigger 
            value="outgoing"
            className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <ArrowUpRight className="h-4 w-4" />
            Ausgangsrechnungen
          </TabsTrigger>
          <TabsTrigger 
            value="volksbank"
            className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Building className="h-4 w-4" />
            Volksbank
          </TabsTrigger>
          <TabsTrigger 
            value="amex"
            className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <CreditCard className="h-4 w-4" />
            American Express
          </TabsTrigger>
          <TabsTrigger 
            value="commission"
            className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Receipt className="h-4 w-4" />
            Provisionsabrechnung
          </TabsTrigger>
          <TabsTrigger 
            value="cash"
            className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            <Wallet className="h-4 w-4" />
            Kasse
          </TabsTrigger>
        </TabsList>

        <TabsContent value="incoming" className="mt-6 space-y-6">
          {renderInvoiceSection(incomingInvoices, "incoming", setIncomingInvoices)}
        </TabsContent>

        <TabsContent value="outgoing" className="mt-6 space-y-6">
          {renderInvoiceSection(outgoingInvoices, "outgoing", setOutgoingInvoices)}
        </TabsContent>

        <TabsContent value="volksbank" className="mt-6 space-y-6">
          {renderStatementSection(volksbankStatements, "volksbank", setVolksbankStatements)}
        </TabsContent>

        <TabsContent value="amex" className="mt-6 space-y-6">
          {renderStatementSection(amexStatements, "amex", setAmexStatements)}
        </TabsContent>

        <TabsContent value="commission" className="mt-6 space-y-6">
          {renderStatementSection(commissionStatements, "commission", setCommissionStatements)}
        </TabsContent>

        <TabsContent value="cash" className="mt-6 space-y-6">
          {renderCashSection()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
