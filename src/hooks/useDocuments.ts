import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { InvoiceData, StatementData, ExtractedTransaction } from "@/types/documents";
import { useToast } from "@/hooks/use-toast";

// Invoices hooks
export function useInvoices() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["invoices", user?.id],
    queryFn: async (): Promise<InvoiceData[]> => {
      if (!user) return [];
      
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .order("date", { ascending: false });

      if (error) throw error;

      return (data || []).map((inv) => ({
        id: inv.id,
        fileName: inv.file_name,
        fileUrl: inv.file_url || undefined,
        date: inv.date,
        year: inv.year,
        month: inv.month,
        issuer: inv.issuer,
        amount: Number(inv.amount),
        type: inv.type as "incoming" | "outgoing",
        status: inv.status as "processing" | "ready" | "saved",
        createdAt: inv.created_at,
      }));
    },
    enabled: !!user,
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (invoice: Omit<InvoiceData, "id" | "createdAt">) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("invoices")
        .insert({
          user_id: user.id,
          file_name: invoice.fileName,
          file_url: invoice.fileUrl,
          date: invoice.date,
          year: invoice.year,
          month: invoice.month,
          issuer: invoice.issuer,
          amount: invoice.amount,
          type: invoice.type,
          status: invoice.status,
          payment_method: invoice.paymentMethod || "bank",
          invoice_number: invoice.invoiceNumber || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Rechnung gespeichert" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateInvoice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (invoice: InvoiceData) => {
      const { data, error } = await supabase
        .from("invoices")
        .update({
          file_name: invoice.fileName,
          date: invoice.date,
          year: invoice.year,
          month: invoice.month,
          issuer: invoice.issuer,
          amount: invoice.amount,
          type: invoice.type,
          status: invoice.status,
        })
        .eq("id", invoice.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Rechnung aktualisiert" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Aktualisieren",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Rechnung gelöscht" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Löschen",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteBankStatement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      // First delete related transactions
      await supabase.from("bank_transactions").delete().eq("bank_statement_id", id);
      // Then delete the statement
      const { error } = await supabase.from("bank_statements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_statements"] });
      queryClient.invalidateQueries({ queryKey: ["bank_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transaction_counts"] });
      toast({ title: "Kontoauszug gelöscht" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Löschen",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Check for duplicate invoice - stricter check: same date AND same issuer AND same amount
export async function checkDuplicateInvoice(
  userId: string,
  invoice: { date: string; issuer: string; amount: number; fileName?: string }
): Promise<boolean> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, file_name, issuer, amount")
    .eq("user_id", userId)
    .eq("date", invoice.date);

  if (error) throw error;
  
  // Check for exact match: same issuer AND same amount (within 0.01 tolerance)
  const hasDuplicate = (data || []).some(
    (existing) =>
      existing.issuer.toLowerCase().trim() === invoice.issuer.toLowerCase().trim() &&
      Math.abs(Number(existing.amount) - invoice.amount) < 0.01
  );
  
  return hasDuplicate;
}

// Bank Statements hooks
export function useBankStatements() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bank_statements", user?.id],
    queryFn: async (): Promise<StatementData[]> => {
      if (!user) return [];
      
      const { data, error } = await supabase
        .from("bank_statements")
        .select("*")
        .order("date", { ascending: false });

      if (error) throw error;

      return (data || []).map((stmt) => ({
        id: stmt.id,
        fileName: stmt.file_name,
        fileUrl: stmt.file_url || undefined,
        bank: stmt.bank,
        bankType: stmt.bank_type as "volksbank" | "amex",
        accountNumber: stmt.account_number,
        date: stmt.date,
        year: stmt.year,
        month: stmt.month,
        openingBalance: Number(stmt.opening_balance),
        closingBalance: Number(stmt.closing_balance),
        status: stmt.status as "processing" | "ready" | "saved",
        createdAt: stmt.created_at,
      }));
    },
    enabled: !!user,
  });
}

export function useCreateBankStatement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (statement: Omit<StatementData, "id" | "createdAt">) => {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("bank_statements")
        .insert({
          user_id: user.id,
          file_name: statement.fileName,
          file_url: statement.fileUrl,
          bank: statement.bank,
          bank_type: statement.bankType,
          account_number: statement.accountNumber,
          date: statement.date,
          year: statement.year,
          month: statement.month,
          opening_balance: statement.openingBalance,
          closing_balance: statement.closingBalance,
          status: statement.status,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_statements"] });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Speichern",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateBankStatement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (statement: StatementData) => {
      const { data, error } = await supabase
        .from("bank_statements")
        .update({
          file_name: statement.fileName,
          bank: statement.bank,
          bank_type: statement.bankType,
          account_number: statement.accountNumber,
          date: statement.date,
          year: statement.year,
          month: statement.month,
          opening_balance: statement.openingBalance,
          closing_balance: statement.closingBalance,
          status: statement.status,
        })
        .eq("id", statement.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank_statements"] });
      toast({ title: "Kontoauszug aktualisiert" });
    },
    onError: (error) => {
      toast({
        title: "Fehler beim Aktualisieren",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

// Check for duplicate transactions
export async function checkDuplicateTransactions(
  userId: string,
  transactions: ExtractedTransaction[],
  bankStatementId?: string
): Promise<{ duplicates: ExtractedTransaction[]; newTransactions: ExtractedTransaction[] }> {
  // Get existing transactions for this user
  const { data: existingTransactions, error } = await supabase
    .from("bank_transactions")
    .select("date, description, amount, transaction_type")
    .eq("user_id", userId);

  if (error) throw error;

  const duplicates: ExtractedTransaction[] = [];
  const newTransactions: ExtractedTransaction[] = [];

  for (const tx of transactions) {
    // Check if transaction already exists (same date, description, amount, type)
    const isDuplicate = (existingTransactions || []).some(
      (existing) =>
        existing.date === tx.date &&
        existing.description === tx.description &&
        Math.abs(Number(existing.amount) - tx.amount) < 0.01 &&
        existing.transaction_type === tx.type
    );

    if (isDuplicate) {
      duplicates.push(tx);
    } else {
      newTransactions.push(tx);
    }
  }

  return { duplicates, newTransactions };
}

// Create bank transactions
export async function createBankTransactions(
  userId: string,
  bankStatementId: string,
  transactions: ExtractedTransaction[]
): Promise<number> {
  if (transactions.length === 0) return 0;

  const transactionsToInsert = transactions.map((tx) => ({
    user_id: userId,
    bank_statement_id: bankStatementId,
    date: tx.date,
    description: tx.description,
    amount: tx.amount,
    transaction_type: tx.type,
    match_status: "unmatched",
    original_currency: tx.originalCurrency || null,
  }));

  const { error } = await supabase
    .from("bank_transactions")
    .insert(transactionsToInsert);

  if (error) throw error;

  return transactions.length;
}

// Upload file to storage
export async function uploadDocument(
  file: File,
  userId: string,
  documentType: "invoices" | "statements"
): Promise<string> {
  const fileExt = file.name.split(".").pop();
  const fileName = `${userId}/${documentType}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(fileName, file);

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("documents").getPublicUrl(fileName);
  return data.publicUrl;
}

// Process document with OCR
export async function processDocumentOCR(
  file: File,
  documentType: "invoice" | "statement"
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("type", documentType);

  const { data, error } = await supabase.functions.invoke("process-document", {
    body: formData,
  });

  if (error) throw error;
  return data;
}
