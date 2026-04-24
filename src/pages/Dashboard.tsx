import { FileText, ArrowDownLeft, ArrowUpRight, TrendingUp, Building, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useInvoices, useBankStatements } from "@/hooks/useDocuments";

export default function Dashboard() {
  const { data: invoices = [], isLoading: invoicesLoading } = useInvoices();
  const { data: statements = [], isLoading: statementsLoading } = useBankStatements();

  const isLoading = invoicesLoading || statementsLoading;

  const totalIncoming = invoices
    .filter(inv => inv.type === "incoming")
    .reduce((sum, inv) => sum + inv.amount, 0);
  
  const totalOutgoing = invoices
    .filter(inv => inv.type === "outgoing")
    .reduce((sum, inv) => sum + inv.amount, 0);

  const stats = [
    {
      title: "Rechnungen",
      value: invoices.length.toString(),
      change: `${invoices.filter(i => {
        const d = new Date(i.date);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length} diesen Monat`,
      icon: FileText,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Einnahmen",
      value: `${totalIncoming.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`,
      change: "Gesamt",
      icon: ArrowDownLeft,
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      title: "Ausgaben",
      value: `${totalOutgoing.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`,
      change: "Gesamt",
      icon: ArrowUpRight,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
    },
    {
      title: "Kontoauszüge",
      value: statements.length.toString(),
      change: "Gesamt",
      icon: Building,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
  ];

  const recentInvoices = invoices.slice(0, 5);

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-2xl font-bold text-foreground sm:text-3xl">
          Willkommen zurück
        </h1>
        <p className="mt-1 text-sm text-muted-foreground sm:text-base">
          Hier ist Ihre Dokumentenübersicht
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <div
            key={stat.title}
            className="glass-card p-4 sm:p-5 animate-slide-up opacity-0"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 ${stat.bgColor}`}>
                <stat.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${stat.color}`} />
              </div>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground sm:text-xs">
                <TrendingUp className="h-3 w-3 shrink-0" />
                <span className="truncate">{stat.change}</span>
              </span>
            </div>
            <div className="mt-3 sm:mt-4">
              <p className="truncate text-lg font-bold text-foreground sm:text-2xl">{stat.value}</p>
              <p className="text-xs text-muted-foreground sm:text-sm">{stat.title}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="glass-card p-4 sm:p-6 animate-fade-in" style={{ animationDelay: "0.4s" }}>
        <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground mb-3 sm:mb-4">
          Schnellaktionen
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
          <Button variant="gradient" className="w-full sm:w-auto" asChild>
            <Link to="/upload">
              <FileText className="mr-2 h-4 w-4" />
              Dokument hochladen
            </Link>
          </Button>
          <Button variant="glass" className="w-full sm:w-auto" asChild>
            <Link to="/invoices">
              Rechnungen anzeigen
            </Link>
          </Button>
          <Button variant="glass" className="w-full sm:w-auto" asChild>
            <Link to="/statements">
              Kontoauszüge anzeigen
            </Link>
          </Button>
        </div>
      </div>

      {/* Recent Documents */}
      <div className="glass-card p-4 sm:p-6 animate-fade-in" style={{ animationDelay: "0.5s" }}>
        <div className="flex items-center justify-between mb-3 sm:mb-4 gap-2">
          <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground">
            Letzte Rechnungen
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/invoices">Alle anzeigen</Link>
          </Button>
        </div>
        {recentInvoices.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Noch keine Rechnungen vorhanden. Laden Sie Dokumente unter "Upload" hoch.
          </p>
        ) : (
          <div className="space-y-3">
            {recentInvoices.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-3 sm:p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    doc.type === "incoming" ? "bg-success/10" : "bg-muted"
                  }`}>
                    {doc.type === "incoming" ? (
                      <ArrowDownLeft className="h-4 w-4 text-success" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{doc.fileName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {new Date(doc.date).toLocaleDateString("de-DE")} · {doc.issuer}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 text-sm font-semibold sm:text-base ${
                  doc.type === "incoming" ? "text-success" : "text-foreground"
                }`}>
                  {doc.type === "incoming" ? "+" : "-"}
                  {doc.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
