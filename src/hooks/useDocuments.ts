// Re-export everything from split modules for backward compatibility
export { useInvoices, useCreateInvoice, useUpdateInvoice, useDeleteInvoice, useBulkDeleteInvoices, checkDuplicateInvoice } from "./useInvoices";
export { useBankStatements, useCreateBankStatement, useUpdateBankStatement, useDeleteBankStatement, checkDuplicateTransactions, createBankTransactions } from "./useBankStatements";
export { uploadDocument, processDocumentOCR } from "@/services/documentService";
