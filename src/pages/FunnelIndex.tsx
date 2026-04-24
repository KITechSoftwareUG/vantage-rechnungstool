import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { de as deLocale } from "date-fns/locale";
import {
  BarChart3,
  Loader2,
  Mail,
  Phone,
  Search,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLeads } from "@/hooks/useLeads";
import type { Lead, LeadStatus } from "@/types/leads";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | LeadStatus;

function formatPhone(phone: string): string {
  if (!phone) return "";
  // DB speichert E.164 ohne '+'. Fuer die Anzeige rendern wir '+' davor,
  // solange es nach einer Telefonnummer aussieht.
  const cleaned = phone.replace(/[^0-9+]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function statusLabel(status: LeadStatus): string {
  switch (status) {
    case "new":
      return "Neu";
    case "contacted":
      return "Kontaktiert";
    case "closed":
      return "Geschlossen";
  }
}

function statusBadgeClass(status: LeadStatus): string {
  switch (status) {
    case "new":
      return "bg-primary/15 text-primary border-primary/30";
    case "contacted":
      return "bg-warning/15 text-warning border-warning/30";
    case "closed":
      return "bg-muted text-muted-foreground border-border";
  }
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), {
      addSuffix: true,
      locale: deLocale,
    });
  } catch {
    return iso;
  }
}

export default function FunnelIndex() {
  const navigate = useNavigate();
  const { data: leads = [], isLoading } = useLeads();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const stats = useMemo(() => {
    const counts = { total: leads.length, new: 0, contacted: 0, closed: 0 };
    for (const l of leads) {
      if (l.status === "new") counts.new += 1;
      else if (l.status === "contacted") counts.contacted += 1;
      else if (l.status === "closed") counts.closed += 1;
    }
    return counts;
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        lead.name ?? "",
        lead.phone ?? "",
        lead.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [leads, statusFilter, search]);

  const statCards: Array<{
    title: string;
    value: number;
    tone: "primary" | "warning" | "muted";
  }> = [
    { title: "Gesamt", value: stats.total, tone: "primary" },
    { title: "Neu", value: stats.new, tone: "primary" },
    { title: "Kontaktiert", value: stats.contacted, tone: "warning" },
    { title: "Geschlossen", value: stats.closed, tone: "muted" },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Funnelanalytics
        </h1>
        <p className="mt-1 text-muted-foreground">
          Leads aus der Landingpage
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in">
        {statCards.map((s) => (
          <div key={s.title} className="glass-card p-5">
            <p className="text-sm text-muted-foreground">{s.title}</p>
            <p
              className={cn(
                "mt-1 text-2xl font-bold",
                s.tone === "primary" && "text-foreground",
                s.tone === "warning" && "text-warning",
                s.tone === "muted" && "text-muted-foreground",
              )}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div
        className="glass-card p-4 animate-fade-in"
        style={{ animationDelay: "0.1s" }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Suchen nach Name, Telefon oder E-Mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="sm:w-48">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="new">Neu</SelectItem>
                <SelectItem value="contacted">Kontaktiert</SelectItem>
                <SelectItem value="closed">Geschlossen</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Table / Empty */}
      {leads.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">
          Keine Leads passen zu den aktuellen Filtern.
        </div>
      ) : (
        <div className="glass-card overflow-hidden animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Quelle</TableHead>
                <TableHead>Anliegen</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="whitespace-nowrap">Erstellt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  onClick={() => navigate(`/funnel/${lead.id}`)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function LeadRow({
  lead,
  onClick,
}: {
  lead: Lead;
  onClick: () => void;
}) {
  const utm = lead.meta.tracking;
  const utmLabel = [utm?.utm_source, utm?.utm_medium]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join("/");

  return (
    <TableRow className="cursor-pointer" onClick={onClick}>
      <TableCell className="max-w-[220px]">
        <div className="font-medium text-foreground truncate">
          {lead.name || <span className="text-muted-foreground">(ohne Name)</span>}
        </div>
        {lead.email && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.email}</span>
          </div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Phone className="h-3 w-3" />
          {formatPhone(lead.phone)}
        </div>
      </TableCell>
      <TableCell className="text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">{lead.source}</span>
          {utmLabel && (
            <Badge
              variant="outline"
              className="w-fit text-[10px] font-normal"
            >
              {utmLabel}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="max-w-[280px]">
        <div className="truncate text-sm text-muted-foreground">
          {lead.meta.anliegen_summary || "—"}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn("border", statusBadgeClass(lead.status))}
        >
          {statusLabel(lead.status)}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {relativeTime(lead.created_at)}
      </TableCell>
    </TableRow>
  );
}

function EmptyState() {
  return (
    <div className="glass-card flex flex-col items-center justify-center gap-4 p-10 text-center animate-fade-in">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Users className="h-6 w-6 text-primary" />
      </div>
      <div>
        <p className="font-medium text-foreground">
          Noch keine Leads eingegangen.
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Sobald die Landingpage auf die Webhook-URL
          (<code className="font-mono text-xs">zahnfunnel-form-webhook</code>)
          zeigt, erscheinen eingehende Leads hier.
        </p>
      </div>
      <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <BarChart3 className="h-3 w-3" />
        Funnelanalytics · Live-Daten aus Supabase
      </div>
    </div>
  );
}
