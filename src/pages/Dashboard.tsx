import { FileText, ArrowDownLeft, ArrowUpRight, TrendingUp, Building } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const stats = [
  {
    title: "Rechnungen",
    value: "24",
    change: "+3 diese Woche",
    icon: FileText,
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    title: "Einnahmen",
    value: "12.450,00 €",
    change: "+8,2%",
    icon: ArrowDownLeft,
    color: "text-success",
    bgColor: "bg-success/10",
  },
  {
    title: "Ausgaben",
    value: "8.320,00 €",
    change: "-2,4%",
    icon: ArrowUpRight,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
  },
  {
    title: "Kontoauszüge",
    value: "6",
    change: "Aktuell",
    icon: Building,
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
];

const recentDocuments = [
  { name: "Rechnung_2024_001.pdf", type: "incoming" as const, amount: 1250.00, date: "2024-01-15" },
  { name: "Stromrechnung_Jan.pdf", type: "outgoing" as const, amount: 189.50, date: "2024-01-14" },
  { name: "Kundenrechnung_XYZ.pdf", type: "incoming" as const, amount: 3400.00, date: "2024-01-12" },
];

export default function Dashboard() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Willkommen zurück
        </h1>
        <p className="mt-1 text-muted-foreground">
          Hier ist Ihre Dokumentenübersicht
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <div
            key={stat.title}
            className="glass-card p-5 animate-slide-up opacity-0"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className="flex items-center justify-between">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                {stat.change}
              </span>
            </div>
            <div className="mt-4">
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.title}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="glass-card p-6 animate-fade-in" style={{ animationDelay: "0.4s" }}>
        <h2 className="font-heading text-lg font-semibold text-foreground mb-4">
          Schnellaktionen
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="gradient" asChild>
            <Link to="/upload">
              <FileText className="mr-2 h-4 w-4" />
              Dokument hochladen
            </Link>
          </Button>
          <Button variant="glass" asChild>
            <Link to="/invoices">
              Rechnungen anzeigen
            </Link>
          </Button>
          <Button variant="glass" asChild>
            <Link to="/statements">
              Kontoauszüge anzeigen
            </Link>
          </Button>
        </div>
      </div>

      {/* Recent Documents */}
      <div className="glass-card p-6 animate-fade-in" style={{ animationDelay: "0.5s" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Letzte Dokumente
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/invoices">Alle anzeigen</Link>
          </Button>
        </div>
        <div className="space-y-3">
          {recentDocuments.map((doc, index) => (
            <div
              key={doc.name}
              className="flex items-center justify-between rounded-lg bg-muted/30 p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                  doc.type === "incoming" ? "bg-success/10" : "bg-muted"
                }`}>
                  {doc.type === "incoming" ? (
                    <ArrowDownLeft className="h-4 w-4 text-success" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(doc.date).toLocaleDateString("de-DE")}
                  </p>
                </div>
              </div>
              <span className={`font-semibold ${
                doc.type === "incoming" ? "text-success" : "text-foreground"
              }`}>
                {doc.type === "incoming" ? "+" : "-"}
                {doc.amount.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
