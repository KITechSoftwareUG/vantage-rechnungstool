import { useMemo, useState, useEffect, useCallback } from "react";
import { useBankTransactions, useUpdateTransactionMatch } from "@/hooks/useMatching";
import { useRecurringPatterns, matchesRecurringPattern } from "@/hooks/useRecurringPatterns";

type FilterStatus = "all" | "unmatched" | "matched" | "confirmed";

interface MonthGroup {
  year: number;
  month: number;
  transactions: any[];
}

export function useFilteredTransactions() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [recurringOpen, setRecurringOpen] = useState(false);

  const { data: transactions = [], isLoading, refetch } = useBankTransactions();
  const { data: recurringPatterns = [] } = useRecurringPatterns();
  const updateMatch = useUpdateTransactionMatch();

  // Auto-mark unmatched transactions that match recurring patterns
  useEffect(() => {
    if (recurringPatterns.length === 0 || transactions.length === 0) return;

    const unmatchedTransactions = transactions.filter(
      (t: any) => t.matchStatus === "unmatched"
    );

    const toMark = unmatchedTransactions.filter((t: any) =>
      matchesRecurringPattern(t.description, recurringPatterns)
    );

    if (toMark.length === 0) return;

    (async () => {
      for (const transaction of toMark) {
        try {
          await updateMatch.mutateAsync({
            transactionId: transaction.id,
            invoiceId: null,
            matchStatus: "recurring",
          });
        } catch (error) {
          console.error("Error auto-marking recurring:", error);
        }
      }
    })();
  }, [recurringPatterns, transactions.length]);

  const recurringTransactions = useMemo(
    () => transactions.filter((t: any) => t.matchStatus === "recurring"),
    [transactions]
  );

  const sortedTransactions = useMemo(() => {
    return [...transactions]
      .filter((t: any) => t.matchStatus !== "recurring")
      .sort((a: any, b: any) => {
        const statusOrder: Record<string, number> = {
          matched: 0,
          unmatched: 1,
          no_match: 2,
          confirmed: 3,
        };
        const orderA = statusOrder[a.matchStatus] ?? 4;
        const orderB = statusOrder[b.matchStatus] ?? 4;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    let filtered = sortedTransactions;

    if (filterStatus !== "all") {
      filtered = filtered.filter((t: any) => t.matchStatus === filterStatus);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((t: any) => {
        const description = (t.description || "").toLowerCase();
        const amount = Math.abs(t.amount).toString();
        const date = t.date || "";
        const invoiceIssuer = (t.matchedInvoice?.issuer || "").toLowerCase();
        return (
          description.includes(query) ||
          amount.includes(query) ||
          date.includes(query) ||
          invoiceIssuer.includes(query)
        );
      });
    }

    return filtered;
  }, [sortedTransactions, filterStatus, searchQuery]);

  const groupedByMonth = useMemo((): MonthGroup[] => {
    const groupMap = new Map<string, any[]>();

    filteredTransactions.forEach((t: any) => {
      const date = new Date(t.date);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const key = `${year}-${month}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(t);
    });

    const groups: MonthGroup[] = [];
    groupMap.forEach((txns, key) => {
      const [year, month] = key.split("-").map(Number);
      groups.push({ year, month, transactions: txns });
    });

    return groups.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  }, [filteredTransactions]);

  // Auto-open first group
  useEffect(() => {
    if (groupedByMonth.length > 0 && openMonths.size === 0) {
      const firstKey = `${groupedByMonth[0].year}-${groupedByMonth[0].month}`;
      setOpenMonths(new Set([firstKey]));
    }
  }, [groupedByMonth.length]);

  const toggleMonth = useCallback((key: string) => {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const unmatchedCount = transactions.filter((t: any) => t.matchStatus === "unmatched").length;
  const matchedCount = transactions.filter((t: any) => t.matchStatus === "matched").length;
  const confirmedCount = transactions.filter((t: any) => t.matchStatus === "confirmed").length;
  const recurringCount = recurringTransactions.length;

  return {
    transactions,
    isLoading,
    refetch,
    searchQuery,
    setSearchQuery,
    filterStatus,
    setFilterStatus,
    openMonths,
    toggleMonth,
    recurringOpen,
    setRecurringOpen,
    groupedByMonth,
    recurringTransactions,
    unmatchedCount,
    matchedCount,
    confirmedCount,
    recurringCount,
  };
}
