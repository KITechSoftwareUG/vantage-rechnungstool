export interface InvoiceData {
  id: string;
  fileName: string;
  date: string;
  issuer: string;
  amount: number;
  type: "incoming" | "outgoing";
  status: "processing" | "ready" | "saved";
  paymentMethod: "bank" | "cash";
  year: number;
  month: number;
  fileUrl?: string;
  createdAt?: string;
}

export interface ExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  type: "credit" | "debit";
  originalCurrency?: string | null;
}

export interface StatementData {
  id: string;
  fileName: string;
  bank: string;
  bankType: "volksbank" | "amex" | "commission";
  accountNumber: string;
  date: string;
  openingBalance: number;
  closingBalance: number;
  status: "processing" | "ready" | "saved";
  year: number;
  month: number;
  fileUrl?: string;
  createdAt?: string;
  transactions?: ExtractedTransaction[];
}

export interface YearGroup<T> {
  year: number;
  months: MonthGroup<T>[];
}

export interface MonthGroup<T> {
  month: number;
  documents: T[];
}

export const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

export function groupByYearAndMonth<T extends { year: number; month: number; date?: string }>(
  documents: T[]
): YearGroup<T>[] {
  const grouped = documents.reduce((acc, doc) => {
    const yearKey = doc.year;
    const monthKey = doc.month;
    
    if (!acc[yearKey]) {
      acc[yearKey] = {};
    }
    if (!acc[yearKey][monthKey]) {
      acc[yearKey][monthKey] = [];
    }
    acc[yearKey][monthKey].push(doc);
    
    return acc;
  }, {} as Record<number, Record<number, T[]>>);

  return Object.entries(grouped)
    .map(([year, months]) => ({
      year: parseInt(year),
      months: Object.entries(months)
        .map(([month, documents]) => ({
          month: parseInt(month),
          documents: documents.sort((a, b) => 
            new Date(b.date || '').getTime() - new Date(a.date || '').getTime()
          ),
        }))
        .sort((a, b) => b.month - a.month),
    }))
    .sort((a, b) => b.year - a.year);
}
