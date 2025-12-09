import { ChevronDown, Calendar } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { YearGroup, MONTH_NAMES } from "@/types/documents";

interface YearMonthAccordionProps<T> {
  data: YearGroup<T>[];
  renderDocument: (doc: T, index: number) => React.ReactNode;
  emptyMessage?: string;
}

export function YearMonthAccordion<T>({ 
  data, 
  renderDocument,
  emptyMessage = "Keine Dokumente gefunden" 
}: YearMonthAccordionProps<T>) {
  const [openYears, setOpenYears] = useState<number[]>(
    data.length > 0 ? [data[0].year] : []
  );
  const [openMonths, setOpenMonths] = useState<string[]>(
    data.length > 0 && data[0].months.length > 0 
      ? [`${data[0].year}-${data[0].months[0].month}`] 
      : []
  );

  const toggleYear = (year: number) => {
    setOpenYears(prev => 
      prev.includes(year) 
        ? prev.filter(y => y !== year)
        : [...prev, year]
    );
  };

  const toggleMonth = (year: number, month: number) => {
    const key = `${year}-${month}`;
    setOpenMonths(prev => 
      prev.includes(key)
        ? prev.filter(m => m !== key)
        : [...prev, key]
    );
  };

  if (data.length === 0) {
    return (
      <div className="glass-card flex flex-col items-center justify-center p-12 text-center">
        <Calendar className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 font-heading text-lg font-semibold text-foreground">
          {emptyMessage}
        </h3>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.map((yearGroup) => (
        <div 
          key={yearGroup.year} 
          className="glass-card overflow-hidden animate-fade-in"
        >
          {/* Year Header */}
          <button
            onClick={() => toggleYear(yearGroup.year)}
            className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <span className="text-sm font-bold text-primary">{yearGroup.year}</span>
              </div>
              <div>
                <h3 className="font-heading text-lg font-semibold text-foreground">
                  {yearGroup.year}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {yearGroup.months.reduce((sum, m) => sum + m.documents.length, 0)} Dokumente
                </p>
              </div>
            </div>
            <ChevronDown 
              className={cn(
                "h-5 w-5 text-muted-foreground transition-transform duration-200",
                openYears.includes(yearGroup.year) && "rotate-180"
              )} 
            />
          </button>

          {/* Months */}
          {openYears.includes(yearGroup.year) && (
            <div className="border-t border-border/50 px-4 pb-4">
              {yearGroup.months.map((monthGroup) => {
                const monthKey = `${yearGroup.year}-${monthGroup.month}`;
                const isMonthOpen = openMonths.includes(monthKey);
                
                return (
                  <div key={monthKey} className="mt-3">
                    {/* Month Header */}
                    <button
                      onClick={() => toggleMonth(yearGroup.year, monthGroup.month)}
                      className="flex w-full items-center justify-between rounded-lg bg-muted/30 p-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">
                          {MONTH_NAMES[monthGroup.month - 1]}
                        </span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {monthGroup.documents.length}
                        </span>
                      </div>
                      <ChevronDown 
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform duration-200",
                          isMonthOpen && "rotate-180"
                        )} 
                      />
                    </button>

                    {/* Documents */}
                    {isMonthOpen && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {monthGroup.documents.map((doc, index) => 
                          renderDocument(doc, index)
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
