import { ChevronDown, Calendar } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { YearOnlyGroup } from "@/types/documents";

interface YearAccordionProps<T> {
  data: YearOnlyGroup<T>[];
  renderDocument: (doc: T, index: number) => React.ReactNode;
  emptyMessage?: string;
}

export function YearAccordion<T>({
  data,
  renderDocument,
  emptyMessage = "Keine Dokumente gefunden",
}: YearAccordionProps<T>) {
  const [openYears, setOpenYears] = useState<number[]>(
    data.length > 0 ? [data[0].year] : []
  );

  const toggleYear = (year: number) => {
    setOpenYears((prev) =>
      prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
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
        <div key={yearGroup.year} className="flex gap-6 animate-fade-in">
          {/* Year Sidebar - Fixed Left Column */}
          <div className="flex-shrink-0 w-24">
            <button
              onClick={() => toggleYear(yearGroup.year)}
              className="sticky top-4 flex flex-col items-center justify-center w-24 h-24 rounded-2xl bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105"
            >
              <span className="text-3xl font-bold font-heading">{yearGroup.year}</span>
              <span className="text-xs opacity-80 mt-1">
                {yearGroup.documents.length} Dok.
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
              <div className="glass-card overflow-hidden p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {yearGroup.documents.map((doc, index) => renderDocument(doc, index))}
                </div>
              </div>
            ) : (
              <div className="glass-card p-6 text-center text-muted-foreground">
                <p>Klicken Sie auf das Jahr, um die Dokumente anzuzeigen</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
