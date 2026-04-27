import { useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Send,
  Wallet,
} from "lucide-react";
import { useExportTransactions, ExportTransaction } from "@/hooks/useExportTransactions";
import { useAuth } from "@/hooks/useAuth";
import { resolveStorageUrl, createLongLivedSignedUrl } from "@/lib/resolveStorageUrl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function formatAmount(amount: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function deriveYearMonth(dateIso: string): { year: number; month: number } | null {
  try {
    const d = new Date(dateIso);
    if (Number.isNaN(d.getTime())) return null;
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Baut die schicke HTML-Datei fuer den Steuerberater. Long-lived signedUrls
// (1 Jahr) damit der Empfaenger die Rechnungen auch in Wochen/Monaten noch
// oeffnen kann. Inline-CSS ohne Abhaengigkeiten — Datei muss im Drive-
// Preview, lokalem Browser und Druck-Dialog gleich gut aussehen.
async function buildExportHtml(
  transactions: ExportTransaction[],
  userId: string,
): Promise<string> {
  const withUrls = await Promise.all(
    transactions.map(async (t) => {
      if (!t.matchedInvoice) return { t, url: null as string | null };
      const ym = deriveYearMonth(t.matchedInvoice.date);
      if (!ym) return { t, url: null };
      const url = await createLongLivedSignedUrl(
        userId,
        ym.year,
        ym.month,
        t.matchedInvoice.fileName,
        t.matchedInvoice.fileUrl,
      );
      return { t, url };
    }),
  );

  const byYear = withUrls.reduce<Record<string, typeof withUrls>>((acc, item) => {
    const ym = deriveYearMonth(item.t.date);
    const key = ym ? String(ym.year) : "ohne Datum";
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
  const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));

  const generatedAt = format(new Date(), "dd.MM.yyyy 'um' HH:mm 'Uhr'", { locale: de });
  const validUntil = format(
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    "dd.MM.yyyy",
    { locale: de },
  );

  const tablesHtml = years
    .map((year) => {
      const items = byYear[year];
      const saldo = items.reduce((sum, { t }) => {
        return sum + (t.transactionType === "credit" ? t.amount : -Math.abs(t.amount));
      }, 0);

      const rowsHtml = items
        .map(({ t, url }) => {
          const isDebit = t.transactionType === "debit";
          const sign = isDebit ? "−" : "+";
          const cls = isDebit ? "debit" : "credit";
          const date = format(new Date(t.date), "dd.MM.yyyy", { locale: de });
          const desc = escapeHtml(t.description ?? "");
          const quelle = t.isCashPayment
            ? "Kasse"
            : escapeHtml(t.bankStatement?.bank ?? "—");
          const amount = formatAmount(Math.abs(t.amount));
          const inv = t.matchedInvoice;
          const linkCell = inv && url
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${
                inv.invoiceNumber ? `#${escapeHtml(inv.invoiceNumber)} · ` : ""
              }${escapeHtml(inv.issuer)}</a>`
            : inv
            ? `<span class="muted">${escapeHtml(inv.issuer)} (Datei nicht erreichbar)</span>`
            : `<span class="muted">—</span>`;

          return `<tr>
  <td class="num">${date}</td>
  <td>${desc}</td>
  <td>${quelle}</td>
  <td class="num amount ${cls}">${sign}${amount}</td>
  <td>${linkCell}</td>
</tr>`;
        })
        .join("\n");

      return `<section>
  <h2>Buchungsjahr ${escapeHtml(year)} <span class="muted">· ${items.length} ${
        items.length === 1 ? "Buchung" : "Buchungen"
      } · Saldo ${formatAmount(saldo)}</span></h2>
  <table>
    <thead>
      <tr>
        <th>Datum</th>
        <th>Beschreibung</th>
        <th>Quelle</th>
        <th class="num">Betrag</th>
        <th>Rechnung</th>
      </tr>
    </thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
</section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Steuerexport ${escapeHtml(generatedAt)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #1a1a1a;
    background: #f7f7f8;
    line-height: 1.5;
  }
  main { max-width: 1100px; margin: 0 auto; }
  header {
    border-bottom: 2px solid #d8d8dc;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  h1 { font-size: 28px; margin: 0 0 4px; font-weight: 700; }
  h2 { font-size: 18px; margin: 32px 0 12px; font-weight: 600; }
  .meta { font-size: 13px; color: #6b6b73; margin: 0; }
  .muted { color: #8a8a92; font-weight: 400; font-size: 13px; }
  table {
    width: 100%;
    border-collapse: collapse;
    background: #fff;
    border: 1px solid #e3e3e7;
    border-radius: 6px;
    overflow: hidden;
    font-size: 14px;
  }
  thead th {
    text-align: left;
    background: #f0f0f3;
    color: #4a4a52;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 10px 14px;
    border-bottom: 1px solid #e3e3e7;
  }
  tbody td {
    padding: 10px 14px;
    border-bottom: 1px solid #ececef;
    vertical-align: top;
  }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: #fafafb; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.amount { font-weight: 600; }
  td.amount.debit { color: #b22222; }
  td.amount.credit { color: #1f7a3a; }
  a {
    color: #1f5fbe;
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  a:hover { border-bottom-color: #1f5fbe; }
  footer {
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid #d8d8dc;
    font-size: 12px;
    color: #8a8a92;
  }
  @media print {
    body { background: #fff; padding: 0; }
    main { max-width: none; }
    table { border: 1px solid #ccc; }
    tbody tr:hover { background: transparent; }
    a { color: #000; border-bottom: 1px solid #999; }
  }
</style>
</head>
<body>
<main>
  <header>
    <h1>Steuerexport</h1>
    <p class="meta">Erstellt am ${escapeHtml(generatedAt)} · ${transactions.length} ${
    transactions.length === 1 ? "Buchung" : "Buchungen"
  } · Rechnungs-Links gueltig bis ${escapeHtml(validUntil)}</p>
  </header>
${tablesHtml}
  <footer>
    Erzeugt von Vantage Rechnungstool. Klick auf eine Rechnung oeffnet das
    PDF im Browser. Alle Links sind privat signiert und laufen am
    ${escapeHtml(validUntil)} ab — fuer aelteren Zugriff einen neuen Export
    generieren.
  </footer>
</main>
</body>
</html>`;
}

function triggerDownload(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Kurzer Delay vor revoke, damit der Browser den Download tatsaechlich
  // gestartet hat — sonst race-condition in manchen Chrome-Versionen.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportPage() {
  const { user } = useAuth();
  const { data: transactions, isLoading } = useExportTransactions();
  const [isSending, setIsSending] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // Gruppiert nach Jahr fuer den Steuerberater-Workflow ("Buchungsjahr 2025"
  // separat von 2024). Innerhalb des Jahres chronologisch absteigend wie
  // schon im Hook sortiert.
  const groupedByYear = (transactions ?? []).reduce<Record<string, ExportTransaction[]>>(
    (acc, t) => {
      const ym = deriveYearMonth(t.date);
      const year = ym ? String(ym.year) : "ohne Datum";
      (acc[year] ??= []).push(t);
      return acc;
    },
    {},
  );
  const years = Object.keys(groupedByYear).sort((a, b) => b.localeCompare(a));

  const handleOpenInvoice = async (t: ExportTransaction) => {
    const inv = t.matchedInvoice;
    if (!inv || !user?.id) {
      toast.error("Keine Rechnung verknuepft");
      return;
    }
    setOpeningId(t.id);
    try {
      const ym = deriveYearMonth(inv.date);
      if (!ym) {
        // Fallback: Wenn das invoice-Datum kaputt ist, versuchen wir den
        // direkt gespeicherten file_url. Klappt nur wenn der bereits eine
        // browser-erreichbare signedUrl ist — sonst zeigt der neue Tab "404".
        if (inv.fileUrl) {
          window.open(inv.fileUrl, "_blank", "noopener,noreferrer");
          return;
        }
        toast.error("Datei nicht aufloesbar");
        return;
      }
      const url = await resolveStorageUrl(user.id, ym.year, ym.month, inv.fileName, inv.fileUrl);
      if (!url) {
        toast.error("Datei nicht im Storage gefunden");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("open invoice failed:", err);
      toast.error("Fehler beim Oeffnen der Rechnung");
    } finally {
      setOpeningId(null);
    }
  };

  const handleDownloadHtml = async () => {
    if (!transactions || transactions.length === 0) {
      toast.error("Keine Transaktionen zum Exportieren");
      return;
    }
    if (!user?.id) {
      toast.error("Kein angemeldeter Nutzer");
      return;
    }
    setIsDownloading(true);
    try {
      const html = await buildExportHtml(transactions, user.id);
      const stamp = format(new Date(), "yyyy-MM-dd", { locale: de });
      triggerDownload(html, `Steuerexport-${stamp}.html`);
      toast.success(
        "HTML heruntergeladen — jetzt in den Drive-Jahresordner ziehen und mit dem Steuerberater teilen.",
      );
    } catch (err) {
      console.error("HTML export failed:", err);
      toast.error("Fehler beim Erzeugen des Exports");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSendToN8n = async () => {
    if (!transactions || transactions.length === 0) {
      toast.error("Keine Transaktionen zum Senden");
      return;
    }

    setIsSending(true);
    try {
      const exportData = await Promise.all(
        transactions.map(async (transaction: ExportTransaction) => {
          let fileBase64: string | null = null;
          let fileMimeType: string | null = null;

          if (transaction.matchedInvoice?.fileUrl) {
            try {
              const response = await fetch(transaction.matchedInvoice.fileUrl);
              if (response.ok) {
                const blob = await response.blob();
                const arrayBuffer = await blob.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                let binary = "";
                bytes.forEach((b) => (binary += String.fromCharCode(b)));
                fileBase64 = btoa(binary);
                fileMimeType = blob.type;
              }
            } catch (e) {
              console.error("Error downloading file:", e);
            }
          }

          return {
            transactionId: transaction.id,
            date: transaction.date,
            description: transaction.description,
            amount: transaction.amount,
            transactionType: transaction.transactionType,
            bank: transaction.bankStatement?.bank || null,
            bankType: transaction.bankStatement?.bankType || null,
            invoice: transaction.matchedInvoice
              ? {
                  id: transaction.matchedInvoice.id,
                  fileName: transaction.matchedInvoice.fileName,
                  issuer: transaction.matchedInvoice.issuer,
                  amount: transaction.matchedInvoice.amount,
                  date: transaction.matchedInvoice.date,
                  type: transaction.matchedInvoice.type,
                  fileBase64,
                  fileMimeType,
                }
              : null,
          };
        }),
      );

      const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_URL;
      if (!webhookUrl) throw new Error("Webhook URL nicht konfiguriert");

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exportDate: new Date().toISOString(),
          transactionCount: exportData.length,
          transactions: exportData,
        }),
      });

      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      toast.success(`${exportData.length} Transaktionen erfolgreich gesendet`);
    } catch (error) {
      console.error("Send to n8n error:", error);
      toast.error("Fehler beim Senden an n8n");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
            Steuerberater Export
          </h1>
          <p className="mt-1 text-sm sm:text-base text-muted-foreground">
            Alle zugeordneten Transaktionen mit Klick-Link zur Rechnung
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            onClick={handleDownloadHtml}
            disabled={isDownloading || isLoading || !transactions?.length}
            className="w-full gap-2 sm:w-auto"
          >
            {isDownloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Wird erzeugt...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                HTML herunterladen
              </>
            )}
          </Button>
          <Button
            onClick={handleSendToN8n}
            disabled={isSending || isLoading || !transactions?.length}
            variant="outline"
            className="w-full gap-2 sm:w-auto"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Wird gesendet...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                An n8n senden
              </>
            )}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : transactions && transactions.length > 0 ? (
        <div className="space-y-6">
          {years.map((year) => (
            <YearSection
              key={year}
              year={year}
              transactions={groupedByYear[year]}
              onOpen={handleOpenInvoice}
              openingId={openingId}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-lg font-medium">Keine zugeordneten Transaktionen</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ordnen Sie zuerst Transaktionen Rechnungen zu
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function YearSection({
  year,
  transactions,
  onOpen,
  openingId,
}: {
  year: string;
  transactions: ExportTransaction[];
  onOpen: (t: ExportTransaction) => void;
  openingId: string | null;
}) {
  const total = transactions.reduce((sum, t) => {
    return sum + (t.transactionType === "credit" ? t.amount : -Math.abs(t.amount));
  }, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {year}
          </span>
          <span className="text-sm font-normal tabular-nums text-muted-foreground">
            Saldo {formatAmount(total)}
          </span>
        </CardTitle>
        <CardDescription>
          {transactions.length} {transactions.length === 1 ? "Buchung" : "Buchungen"}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {/* Desktop: echte Tabelle. Mobile: Karten-Liste, weil 5 Spalten zu eng werden. */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Datum</th>
                <th className="px-4 py-2 text-left font-medium">Beschreibung</th>
                <th className="px-4 py-2 text-left font-medium">Quelle</th>
                <th className="px-4 py-2 text-right font-medium">Betrag</th>
                <th className="px-4 py-2 text-left font-medium">Rechnung</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <ExportRow
                  key={t.id}
                  t={t}
                  onOpen={onOpen}
                  isOpening={openingId === t.id}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-2 p-3 md:hidden">
          {transactions.map((t) => (
            <ExportCard
              key={t.id}
              t={t}
              onOpen={onOpen}
              isOpening={openingId === t.id}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ExportRow({
  t,
  onOpen,
  isOpening,
}: {
  t: ExportTransaction;
  onOpen: (t: ExportTransaction) => void;
  isOpening: boolean;
}) {
  const isDebit = t.transactionType === "debit";
  const inv = t.matchedInvoice;

  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30">
      <td className="whitespace-nowrap px-4 py-2.5 align-top tabular-nums text-foreground">
        <span className="inline-flex items-center gap-1.5">
          {isDebit ? (
            <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5 text-green-600" />
          )}
          {format(new Date(t.date), "dd.MM.yyyy", { locale: de })}
        </span>
      </td>
      <td className="px-4 py-2.5 align-top text-foreground">
        <span className="line-clamp-1" title={t.description}>
          {t.description}
        </span>
      </td>
      <td className="px-4 py-2.5 align-top">
        {t.isCashPayment ? (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Wallet className="mr-1 h-3 w-3" />
            Kasse
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal">
            {t.bankStatement?.bank || "—"}
          </Badge>
        )}
      </td>
      <td
        className={cn(
          "whitespace-nowrap px-4 py-2.5 text-right align-top font-semibold tabular-nums",
          isDebit ? "text-destructive" : "text-green-600",
        )}
      >
        {isDebit ? "−" : "+"}
        {formatAmount(Math.abs(t.amount))}
      </td>
      <td className="px-4 py-2.5 align-top">
        {inv ? (
          <button
            type="button"
            onClick={() => onOpen(t)}
            disabled={isOpening}
            className="group inline-flex max-w-[280px] items-center gap-1.5 text-left text-primary hover:underline disabled:opacity-60"
            title={`${inv.issuer} · ${inv.fileName}`}
          >
            {isOpening ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100" />
            )}
            <span className="truncate">
              {inv.invoiceNumber ? `#${inv.invoiceNumber} · ` : ""}
              {inv.issuer}
            </span>
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

function ExportCard({
  t,
  onOpen,
  isOpening,
}: {
  t: ExportTransaction;
  onOpen: (t: ExportTransaction) => void;
  isOpening: boolean;
}) {
  const isDebit = t.transactionType === "debit";
  const inv = t.matchedInvoice;

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          {isDebit ? (
            <ArrowDownRight className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5 text-green-600" />
          )}
          {format(new Date(t.date), "dd.MM.yyyy", { locale: de })}
        </span>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            isDebit ? "text-destructive" : "text-green-600",
          )}
        >
          {isDebit ? "−" : "+"}
          {formatAmount(Math.abs(t.amount))}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.description}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        {t.isCashPayment ? (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Wallet className="mr-1 h-3 w-3" />
            Kasse
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal">
            {t.bankStatement?.bank || "—"}
          </Badge>
        )}
        {inv ? (
          <button
            type="button"
            onClick={() => onOpen(t)}
            disabled={isOpening}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline disabled:opacity-60"
          >
            {isOpening ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
            <span className="max-w-[160px] truncate">
              {inv.invoiceNumber ? `#${inv.invoiceNumber}` : inv.issuer}
            </span>
          </button>
        ) : (
          <span className="text-sm text-muted-foreground">keine Rechnung</span>
        )}
      </div>
    </div>
  );
}
