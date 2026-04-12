export interface BankTransaction {
  id: string;
  userId: string;
  bankStatementId: string | null;
  date: string;
  description: string;
  amount: number;
  transactionType: "debit" | "credit";
  matchedInvoiceId: string | null;
  matchConfidence: number | null;
  matchReason: string | null;
  matchStatus: "unmatched" | "matched" | "confirmed" | "no_match" | "recurring";
  createdAt?: string;
  updatedAt?: string;
}

export interface MatchSuggestion {
  invoiceId: string;
  confidence: number;
  reason: string;
}

export type BankType = "amex" | "volksbank";

export const BANK_TYPE_LABELS: Record<BankType, string> = {
  amex: "American Express",
  volksbank: "Volksbank Raiffeisen",
};
