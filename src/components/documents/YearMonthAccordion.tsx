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
    <div className="space-y-8">
      {data.map((yearGroup) => (
        <div 
          key={yearGroup.year} 
          className="flex gap-6 animate-fade-in"
        >
          {/* Year Sidebar - Fixed Left Column */}
          <div className="flex-shrink-0 w-24">
            <button
              onClick={() => toggleYear(yearGroup.year)}
              className="sticky top-4 flex flex-col items-center justify-center w-24 h-24 rounded-2xl bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
            >
              <span className="text-3xl font-bold font-heading">{yearGroup.year}</span>
              <span className="text-xs opacity-80 mt-1">
                {yearGroup.months.reduce((sum, m) => sum + m.documents.length, 0)} Dok.
              </span>
              <ChevronDown 
                className={cn(
                  "h-4 w-4 mt-1 transition-transform duration-200",
                  openYears.includes(yearGroup.year) && "rotate-180"
                )} 
              />
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 min-w-0">
            {openYears.includes(yearGroup.year) ? (
              <div className="glass-card overflow-hidden">
                <div className="divide-y divide-border/50">
                  {yearGroup.months.map((monthGroup) => {
                    const monthKey = `${yearGroup.year}-${monthGroup.month}`;
                    const isMonthOpen = openMonths.includes(monthKey);
                    
                    return (
                      <div key={monthKey}>
                        {/* Month Header */}
                        <button
                          onClick={() => toggleMonth(yearGroup.year, monthGroup.month)}
                          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                              <Calendar className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <span className="font-medium text-foreground">
                                {MONTH_NAMES[monthGroup.month - 1]}
                              </span>
                              <p className="text-sm text-muted-foreground">
                                {monthGroup.documents.length} {monthGroup.documents.length === 1 ? 'Dokument' : 'Dokumente'}
                              </p>
                            </div>
                          </div>
                          <ChevronDown 
                            className={cn(
                              "h-5 w-5 text-muted-foreground transition-transform duration-200",
                              isMonthOpen && "rotate-180"
                            )} 
                          />
                        </button>

                        {/* Documents */}
                        {isMonthOpen && (
                          <div className="bg-muted/20 p-4">
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {monthGroup.documents.map((doc, index) => 
                                renderDocument(doc, index)
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="glass-card p-6 text-center text-muted-foreground">
                <p>Klicken Sie auf das Jahr, um die Monate anzuzeigen</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
