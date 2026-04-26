// Zahnfunnel Suggest-Reply — generiert einen AI-Antwortvorschlag fuer die
// Inbox-Compose-Bar. Wird vom eingeloggten Frontend per Click auf den
// "KI-Vorschlag"-Button gerufen.
//
// Auth: verify_jwt=true (Default). Service-Role-Client fuer DB-Zugriff,
// damit RLS keine Probleme macht und wir die Anamnese aus `leads.meta`
// zuverlaessig lesen koennen.
//
// Flow:
//   1. lead_id validieren
//   2. Lead + letzte 12 wa_messages laden
//   3. Anthropic mit System-Prompt + Anamnese + Konversation aufrufen
//   4. Vorschlag zurueckgeben — KEIN Outbound-Send, das macht der User
//      manuell ueber zahnfunnel-whatsapp-send.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getConfig } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_TIMEOUT_MS = 30_000;
const HISTORY_LIMIT = 12;

type SupabaseClient = ReturnType<typeof createClient>;

interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  meta: Record<string, unknown> | null;
}

interface WaMessageRow {
  direction: "inbound" | "outbound";
  body: string | null;
  template_name: string | null;
  created_at: string;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Mappt die wichtigsten Anamnese-Felder aus leads.meta auf lesbare Labels.
// Reihenfolge ist intentional: zuerst was der User selbst formuliert hat
// (anliegen_summary), dann strukturierte Anamnese-Antworten.
const META_FIELD_LABELS: Array<[string, string]> = [
  ["anliegen_summary", "Anliegen"],
  ["fehlende_zaehne", "Fehlende Zaehne"],
  ["ersatz_typ", "Geplanter Zahnersatz"],
  ["fehlend_seit", "Zaehne fehlend seit"],
  ["laufende_behandlungen", "Laufende Behandlungen"],
  ["geplante_behandlungen", "Geplante Behandlungen"],
  ["hkp_erstellt", "HKP erstellt"],
  ["behandlung_begonnen", "Behandlung begonnen"],
  ["parodontitis_behandelt", "Parodontitis behandelt"],
  ["zahnfleischerkrankung", "Zahnfleischerkrankung"],
  ["kieferfehlstellung", "Kieferfehlstellung"],
  ["kfo_angeraten", "KFO angeraten"],
  ["einverstaendnis", "Einverstaendnis"],
];

function formatMeta(meta: Record<string, unknown> | null): string {
  if (!meta || typeof meta !== "object") return "(keine Anamnese-Daten erfasst)";
  const lines: string[] = [];
  for (const [key, label] of META_FIELD_LABELS) {
    const raw = meta[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      lines.push(`- ${label}: ${trimmed}`);
    } else if (typeof raw === "boolean") {
      lines.push(`- ${label}: ${raw ? "ja" : "nein"}`);
    } else if (typeof raw === "number") {
      lines.push(`- ${label}: ${raw}`);
    }
  }
  if (lines.length === 0) return "(keine relevanten Anamnese-Felder gesetzt)";
  return lines.join("\n");
}

// HH:mm im selben Lokal-Stil wie der Server. Kein Timezone-Aufwand — der
// Anthropic-Prompt nutzt das nur fuer Reihenfolge / Kontext.
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "??:??";
  }
}

function formatHistory(messages: WaMessageRow[]): string {
  if (messages.length === 0) return "(noch keine Nachrichten ausgetauscht)";
  const lines = messages.map((m) => {
    const time = formatTime(m.created_at);
    const marker = m.direction === "inbound" ? "eingehend" : "ausgehend";
    let body = m.body ?? "";
    if (m.direction === "outbound" && (body === null || body.trim().length === 0)) {
      body = `[Template: ${m.template_name ?? "unbekannt"}]`;
    }
    return `[${marker} ${time}] ${body}`;
  });
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse(500, { ok: false, error: "server_misconfigured" });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // --- Body parsen ---
  let payload: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return jsonResponse(400, { ok: false, error: "invalid_json" });
    }
    payload = raw as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }

  const leadId = typeof payload.lead_id === "string" ? payload.lead_id.trim() : "";
  if (!leadId || !isUuid(leadId)) {
    return jsonResponse(422, { ok: false, error: "lead_id_invalid" });
  }

  // --- Lead laden ---
  const { data: leadData, error: leadErr } = await supabase
    .from("leads")
    .select("id, name, phone, email, meta")
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr) {
    console.error("leads lookup failed:", leadErr);
    return jsonResponse(500, { ok: false, error: "db_error" });
  }
  if (!leadData) {
    return jsonResponse(404, { ok: false, error: "lead_not_found" });
  }
  const lead = leadData as unknown as LeadRow;

  // --- Konversations-History laden ---
  const { data: msgsData, error: msgsErr } = await supabase
    .from("wa_messages")
    .select("direction, body, template_name, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  if (msgsErr) {
    console.error("wa_messages lookup failed:", msgsErr);
    return jsonResponse(500, { ok: false, error: "db_error" });
  }
  const messages = (msgsData ?? []) as unknown as WaMessageRow[];

  // --- Anthropic-Config laden ---
  const [apiKey, modelCfg, beraterName, beraterFirma, beraterTyp] = await Promise.all([
    getConfig(supabase, "ANTHROPIC_API_KEY"),
    getConfig(supabase, "ANTHROPIC_MODEL"),
    getConfig(supabase, "BERATER_NAME"),
    getConfig(supabase, "BERATER_FIRMA"),
    getConfig(supabase, "BERATER_TYP"),
  ]);

  if (!apiKey) {
    return jsonResponse(503, { ok: false, error: "anthropic_not_configured" });
  }

  const model = modelCfg ?? "claude-sonnet-4-5";
  const name = beraterName ?? "Ihr Berater";
  const firma = beraterFirma ?? "ExpatVantage";
  const typ = beraterTyp ?? "Zahnzusatzversicherungen";

  const system =
    `Du bist persoenlicher Assistent fuer ${name} von ${firma}, einem ` +
    `Beratungs-Profi fuer ${typ}. Schreibe einen kurzen, freundlichen, ` +
    `menschlichen Antwortvorschlag auf die letzte WhatsApp-Nachricht des ` +
    `Interessenten — als waere ${name} selbst am Handy. Nutze die bisherige ` +
    `Konversation und die Anamnese-Daten als Kontext. Stelle bei Bedarf eine ` +
    `verbindende Rueckfrage. Keine Emojis. Keine Begruessung wenn die ` +
    `Konversation schon laeuft. Keine Signatur. Maximal 3 Saetze. Nur den ` +
    `Antwort-Text ausgeben, keine Erklaerung.`;

  const userPrompt =
    `Anamnese (vom Lead aus dem Formular):\n` +
    `${formatMeta(lead.meta)}\n\n` +
    `WhatsApp-Konversation (chronologisch):\n` +
    `${formatHistory(messages)}\n\n` +
    `Generiere den naechsten ausgehenden Antwort-Vorschlag.`;

  // --- Anthropic-Call ---
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ANTHROPIC_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("anthropic network error:", msg);
    return jsonResponse(502, {
      ok: false,
      error: "anthropic_network",
      detail: msg.slice(0, 300),
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await resp.text();
  if (!resp.ok) {
    console.error(`anthropic ${resp.status}:`, raw.slice(0, 500));
    return jsonResponse(502, {
      ok: false,
      error: `anthropic_failed_${resp.status}`,
      detail: raw.slice(0, 300),
    });
  }

  let parsed: { content?: Array<{ type?: string; text?: string }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("anthropic response not json:", raw.slice(0, 200));
    return jsonResponse(502, {
      ok: false,
      error: "anthropic_invalid_json",
    });
  }

  const blocks = parsed.content ?? [];
  const suggestion = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();

  if (suggestion.length === 0) {
    return jsonResponse(502, {
      ok: false,
      error: "anthropic_empty_response",
    });
  }

  return jsonResponse(200, { ok: true, suggestion });
});
