import { useMemo, useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { de as deLocale } from "date-fns/locale";
import { Eye, EyeOff, Loader2, RefreshCw, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppConfig, useUpsertAppConfig } from "@/hooks/useAppConfig";
import type { ConfigEntry } from "@/types/config";
import { cn } from "@/lib/utils";

// Hartcoded Sektionen. Keys die hier nicht auftauchen, landen in "Weitere".
const SECTIONS: Array<{ title: string; keys: string[] }> = [
  {
    title: "Form-Webhook",
    keys: ["FORM_API_KEY"],
  },
  {
    title: "WhatsApp (Meta Graph API)",
    keys: [
      "WA_PHONE_NUMBER_ID",
      "WA_ACCESS_TOKEN",
      "WA_APP_SECRET",
      "WA_VERIFY_TOKEN",
      "WA_TEMPLATE_NAME",
      "WA_TEMPLATE_LANG",
      "WA_GRAPH_API_VERSION",
    ],
  },
  {
    title: "Anthropic (KI-Antworten)",
    keys: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
  },
  {
    title: "Gmail (Mail-Fallback)",
    keys: [
      "GMAIL_CREDENTIALS_JSON",
      "GMAIL_TOKEN_JSON",
      "GMAIL_FROM_ADDRESS",
      "GMAIL_FROM_NAME",
    ],
  },
  {
    title: "Berater-Profil",
    keys: ["BERATER_NAME", "BERATER_FIRMA", "BERATER_TYP"],
  },
];

// Keys die als Textarea (mehrzeilig) gerendert werden sollen.
const TEXTAREA_KEYS = new Set(["GMAIL_CREDENTIALS_JSON", "GMAIL_TOKEN_JSON"]);

function relativeTime(iso: string): string {
  if (!iso) return "";
  try {
    return formatDistanceToNow(new Date(iso), {
      addSuffix: true,
      locale: deLocale,
    });
  } catch {
    return iso;
  }
}

// 48-Zeichen-langer zufaelliger String, base64url-encoded.
// crypto.getRandomValues gibt 36 Bytes → base64 von 36 Bytes = 48 Zeichen.
function generateRandomKey(): string {
  const bytes = new Uint8Array(36);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // base64url: '+' → '-', '/' → '_', trailing '=' entfernt
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function ConfigPage() {
  const { data: entries = [], isLoading } = useAppConfig();

  const { sections, extras } = useMemo(() => {
    const byKey = new Map<string, ConfigEntry>();
    for (const entry of entries) {
      byKey.set(entry.key, entry);
    }

    const sectioned = SECTIONS.map((section) => {
      const sectionEntries = section.keys
        .map((key) => byKey.get(key))
        .filter((e): e is ConfigEntry => !!e);
      return { title: section.title, entries: sectionEntries };
    });

    const coveredKeys = new Set(SECTIONS.flatMap((s) => s.keys));
    const extraEntries = entries.filter((e) => !coveredKeys.has(e.key));

    return { sections: sectioned, extras: extraEntries };
  }, [entries]);

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
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground">
          Konfiguration
        </h1>
        <p className="mt-1 text-sm sm:text-base text-muted-foreground">
          Zahnfunnel-Settings, API-Keys, Berater-Texte. Aenderungen greifen
          sofort — Edge Functions lesen bei jedem Request aus der Tabelle.
        </p>
      </div>

      {entries.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {sections.map((section) =>
            section.entries.length === 0 ? null : (
              <ConfigSection
                key={section.title}
                title={section.title}
                entries={section.entries}
              />
            ),
          )}
          {extras.length > 0 && (
            <ConfigSection title="Weitere" entries={extras} />
          )}
        </div>
      )}
    </div>
  );
}

function ConfigSection({
  title,
  entries,
}: {
  title: string;
  entries: ConfigEntry[];
}) {
  const setCount = entries.filter(
    (e) => e.value !== null && e.value !== "",
  ).length;
  const total = entries.length;

  const badgeTone =
    setCount === total
      ? "bg-success/15 text-success border-success/30"
      : setCount === 0
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : "bg-warning/15 text-warning border-warning/30";

  return (
    <Card className="animate-fade-in">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
        <div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription className="mt-1">
            {total === 1 ? "1 Eintrag" : `${total} Eintraege`}
          </CardDescription>
        </div>
        <Badge variant="outline" className={cn("border", badgeTone)}>
          {setCount}/{total} gesetzt
        </Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        {entries.map((entry) => (
          <ConfigRow key={entry.key} entry={entry} />
        ))}
      </CardContent>
    </Card>
  );
}

function ConfigRow({ entry }: { entry: ConfigEntry }) {
  const upsert = useUpsertAppConfig();

  // Lokaler Input-State pro Row. Wird bei Server-Aenderung (neuer
  // entry.value nach Invalidation) nachgezogen, sofern die Row nicht gerade
  // dirty ist.
  const [draft, setDraft] = useState<string>(entry.value ?? "");
  const [showSecret, setShowSecret] = useState<boolean>(false);

  const serverValue = entry.value ?? "";
  const dirty = draft !== serverValue;

  // Nach erfolgreichem Save ziehen wir den frischen Wert vom Server nach.
  // Solange die Row aber dirty ist (User tippt), nicht ueberschreiben.
  useEffect(() => {
    if (!dirty) {
      setDraft(serverValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverValue]);

  const isTextarea = TEXTAREA_KEYS.has(entry.key);
  const isFormApiKey = entry.key === "FORM_API_KEY";
  const mask = entry.is_secret && !showSecret;

  const handleSave = () => {
    upsert.mutate({ key: entry.key, value: draft });
  };

  const handleGenerate = () => {
    setDraft(generateRandomKey());
    setShowSecret(true);
  };

  const placeholder = entry.value === null ? "Nicht gesetzt" : "";

  return (
    <div className="space-y-2 rounded-lg border border-border/50 bg-background/30 p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-xs sm:text-sm text-muted-foreground">
              {entry.key}
            </span>
            {entry.is_secret && (
              <Badge
                variant="outline"
                className="text-[10px] font-normal uppercase tracking-wide"
              >
                Secret
              </Badge>
            )}
            {serverValue && (
              <Badge
                variant="outline"
                className="border-success/30 bg-success/10 text-[10px] font-normal text-success"
              >
                Gesetzt
              </Badge>
            )}
          </div>
          {entry.description && (
            <p className="mt-1 text-xs text-muted-foreground">
              {entry.description}
            </p>
          )}
        </div>
        {entry.value !== null && entry.updated_at && (
          <div className="shrink-0 text-left text-xs text-muted-foreground sm:text-right">
            zuletzt geaendert: {relativeTime(entry.updated_at)}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="relative flex-1">
          {isTextarea ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              rows={4}
              className="font-mono text-xs"
              // Secret-Maskierung fuer Textarea per inline-Style, weil
              // <textarea type="password"> nicht existiert. webkit-text-security
              // wird von allen aktuellen Chromium/WebKit/Firefox (>125) gerendert.
              // Die Properties stehen nicht in React.CSSProperties, daher Cast.
              style={
                mask
                  ? ({
                      WebkitTextSecurity: "disc",
                      textSecurity: "disc",
                    } as unknown as React.CSSProperties)
                  : undefined
              }
            />
          ) : (
            <Input
              type={mask ? "password" : "text"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              className={cn(entry.is_secret && "pr-10", "font-mono text-sm")}
            />
          )}
          {entry.is_secret && !isTextarea && (
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={showSecret ? "Wert verbergen" : "Wert anzeigen"}
            >
              {showSecret ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {entry.is_secret && isTextarea && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? (
                <>
                  <EyeOff className="h-4 w-4" />
                  Verbergen
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" />
                  Anzeigen
                </>
              )}
            </Button>
          )}
          {isFormApiKey && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              title="48-Zeichen-langen zufaelligen Key generieren"
            >
              <RefreshCw className="h-4 w-4" />
              Generieren
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || upsert.isPending}
          >
            {upsert.isPending && upsert.variables?.key === entry.key ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Speichern
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass-card flex flex-col items-center justify-center gap-4 p-10 text-center animate-fade-in">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <Settings className="h-6 w-6 text-primary" />
      </div>
      <div>
        <p className="font-medium text-foreground">
          Keine Konfigurationseintraege gefunden.
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Die Tabelle <code className="font-mono text-xs">app_config</code> ist
          leer. Seeds werden ueber die Supabase-Migration angelegt.
        </p>
      </div>
    </div>
  );
}
