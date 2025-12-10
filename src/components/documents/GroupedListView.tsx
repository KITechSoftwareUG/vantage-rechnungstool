import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { YearGroup, MONTH_NAMES } from "@/types/documents";
import { cn } from "@/lib/utils";

interface GroupedListViewProps<T> {
  data: YearGroup<T>[];
  renderRow: (item: T) => React.ReactNode;
  renderHeader: () => React.ReactNode;
  emptyMessage?: string;
}

export function GroupedListView<T>({
  data,
  renderRow,
  renderHeader,
  emptyMessage = "Keine Einträge gefunden",
}: GroupedListViewProps<T>) {
  const [openYears, setOpenYears] = useState<Set<number>>(() => {
    const firstYear = data[0]?.year;
    return firstYear ? new Set([firstYear]) : new Set();
  });
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => {
    const firstYear = data[0]?.year;
    const firstMonth = data[0]?.months[0]?.month;
    return firstYear && firstMonth !== undefined 
      ? new Set([`${firstYear}-${firstMonth}`]) 
      : new Set();
  });

  const toggleYear = (year: number) => {
    setOpenYears((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(year)) {
        newSet.delete(year);
      } else {
        newSet.add(year);
      }
      return newSet;
    });
  };

  const toggleMonth = (year: number, month: number) => {
    const key = `${year}-${month}`;
    setOpenMonths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  if (data.length === 0) {
    return (
      <div className="glass-card overflow-hidden animate-fade-in">
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-lg font-medium">Keine Einträge gefunden</p>
          <p className="mt-1 text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {data.map((yearGroup) => (
        <Collapsible
          key={yearGroup.year}
          open={openYears.has(yearGroup.year)}
          onOpenChange={() => toggleYear(yearGroup.year)}
        >
          <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-lg bg-primary/10 px-4 py-3 text-left font-heading text-lg font-bold transition-colors hover:bg-primary/20">
            {openYears.has(yearGroup.year) ? (
              <ChevronDown className="h-5 w-5 text-primary" />
            ) : (
              <ChevronRight className="h-5 w-5 text-primary" />
            )}
            <span>{yearGroup.year}</span>
            <span className="ml-auto text-sm font-normal text-muted-foreground">
              {yearGroup.months.reduce((sum, m) => sum + m.documents.length, 0)} Einträge
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-3 pl-2">
            {yearGroup.months.map((monthGroup) => {
              const monthKey = `${yearGroup.year}-${monthGroup.month}`;
              const isMonthOpen = openMonths.has(monthKey);
              
              return (
                <Collapsible
                  key={monthKey}
                  open={isMonthOpen}
                  onOpenChange={() => toggleMonth(yearGroup.year, monthGroup.month)}
                >
                  <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-left font-medium transition-colors hover:bg-muted">
                    {isMonthOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span>{MONTH_NAMES[monthGroup.month - 1]}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {monthGroup.documents.length} Einträge
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <div className="glass-card overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border bg-muted/50">
                              {renderHeader()}
                            </tr>
                          </thead>
                          <tbody>
                            {monthGroup.documents.map((item) => renderRow(item))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
