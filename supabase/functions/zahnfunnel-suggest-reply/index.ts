// Zahnfunnel Suggest-Reply — generiert einen AI-Antwortvorschlag fuer die
// Inbox-Compose-Bar. Wird vom eingeloggten Frontend per Click auf den
// "KI-Vorschlag"-Button gerufen.
//
// Auth: verify_jwt=true (Default). Service-Role-Client fuer DB-Zugriff,
// damit RLS keine Probleme macht und wir die Anamnese aus `leads.meta`
// zuverlaessig lesen koennen.
//
// Provider: nutzt OPENAI_API_KEY aus den Edge-Function-Secrets bevorzugt
// (gleiches Pattern wie matching-agent), fallback auf ANTHROPIC_API_KEY
// in app_config. So muss der User keinen zweiten Key konfigurieren.
//
// Modes:
//   - "reply" (default): Folge-Antwort innerhalb laufender Konversation.
//     Returns { ok, suggestion, provider }.
//   - "first_contact": Salesy Erstnachricht + Kurz-Analyse fuer den Berater.
//     Returns { ok, suggestion, analysis, provider } — JSON-Mode beim Modell.
//
// Flow:
//   1. lead_id + mode validieren
//   2. Lead + letzte 12 wa_messages laden
//   3. AI mit mode-spezifischem System-Prompt + Anamnese + Konversation
//   4. Vorschlag zurueckgeben — KEIN Outbound-Send, das macht der User
//      manuell ueber zahnfunnel-whatsapp-send (oder wa.me bei Erstkontakt
//      solange Meta nicht eingerichtet ist).

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

// Lovable's strict TS-Check meckert sonst beim .from(...).select(...).eq(...)
// wegen "never"-Tabellen-Typen. Lokal als any.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

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

  // Mode-Default ist "reply" — alle bestehenden Aufrufer (Inbox-Compose)
  // schicken kein mode-Feld und sollen das alte Verhalten behalten.
  const mode: "reply" | "first_contact" =
    payload.mode === "first_contact" ? "first_contact" : "reply";

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

  // --- AI-Config laden ---
  // Provider-Resolver: bevorzugt OPENAI_API_KEY aus Edge-Function-Secrets
  // (gleiches Pattern wie matching-agent / auto-match-transactions), fallback
  // auf ANTHROPIC_API_KEY aus app_config wenn OpenAI nicht da. So muss der
  // User keinen zusaetzlichen Key konfigurieren falls OpenAI schon laeuft.
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const [anthropicKey, anthropicModelCfg, openaiModelCfg, beraterName, beraterFirma, beraterTyp] = await Promise.all([
    getConfig(supabase, "ANTHROPIC_API_KEY"),
    getConfig(supabase, "ANTHROPIC_MODEL"),
    getConfig(supabase, "OPENAI_MODEL"),
    getConfig(supabase, "BERATER_NAME"),
    getConfig(supabase, "BERATER_FIRMA"),
    getConfig(supabase, "BERATER_TYP"),
  ]);

  type Provider = "openai" | "anthropic";
  let provider: Provider;
  if (openaiKey) {
    provider = "openai";
  } else if (anthropicKey) {
    provider = "anthropic";
  } else {
    return jsonResponse(503, { ok: false, error: "ai_not_configured", detail: "Weder OPENAI_API_KEY (Edge Function Secret) noch ANTHROPIC_API_KEY (app_config) ist gesetzt." });
  }

  const name = beraterName ?? "Ihr Berater";
  const firma = beraterFirma ?? "ExpatVantage";
  const typ = beraterTyp ?? "Zahnzusatzversicherungen";

  const leadFirstName = (() => {
    const n = (lead.name ?? "").trim();
    if (!n) return null;
    return n.split(/\s+/)[0] || null;
  })();

  const replySystem =
    `Du bist persoenlicher Assistent fuer ${name} von ${firma}, einem ` +
    `Beratungs-Profi fuer ${typ}. Schreibe einen kurzen, freundlichen, ` +
    `menschlichen Antwortvorschlag auf die letzte WhatsApp-Nachricht des ` +
    `Interessenten — als waere ${name} selbst am Handy. Nutze die bisherige ` +
    `Konversation und die Anamnese-Daten als Kontext. Stelle bei Bedarf eine ` +
    `verbindende Rueckfrage. Keine Emojis. Keine Begruessung wenn die ` +
    `Konversation schon laeuft. Keine Signatur. Maximal 3 Saetze. Nur den ` +
    `Antwort-Text ausgeben, keine Erklaerung.`;

  // first_contact: Erstnachricht via WhatsApp. Lead hat noch nichts geschrieben,
  // nur das Formular ausgefuellt. Tone: persoenlich, salesy, "Du", konkret auf
  // angekreuzte Anamnese-Felder Bezug nehmend, klare CTA.
  const firstContactSystem =
    `Du bist ${name} von ${firma}, persoenlicher Ansprechpartner fuer ${typ}. ` +
    `Du schreibst gerade selbst auf WhatsApp an einen frischen Interessenten, ` +
    `der das Anfrage-Formular ausgefuellt hat. Tonalitaet: locker per Du, ` +
    `direkt, salesy aber sympathisch — wie ein Berater, der Bock auf den ` +
    `Termin hat. Stil: kurze Saetze, ein bisschen Schwung, KEINE Floskeln ` +
    `wie "Ich hoffe es geht Ihnen gut". Keine Emojis. Keine Signatur.\n\n` +
    `Aufbau der Nachricht (3-5 kurze Saetze, EIN Absatz):\n` +
    `1) "Hey ${leadFirstName ?? "[Vorname]"}, hier ist ${name} – dein ` +
    `persoenlicher Ansprechpartner bei ${firma}."\n` +
    `2) Konkreter Bezug auf 1-2 Dinge, die er/sie im Formular angegeben hat ` +
    `(z.B. "Hab gesehen du hast X angekreuzt / Y eingetragen"). Niemals ` +
    `medizinische Details aufzaehlen, die er nicht selbst genannt hat.\n` +
    `3) Ein konkretes salesy Angebot: ein passendes Angebot rausschicken, ` +
    `Tarife durchgehen, kurzer Call. KEIN "Wir melden uns".\n` +
    `4) Eine niedrigschwellige Frage am Ende, auf die er einfach mit "Ja" ` +
    `oder einem Wunschzeitpunkt antworten kann.\n\n` +
    `Du bekommst zusaetzlich eine "Analyse" (2-3 Saetze, fuer den Berater ` +
    `zum schnellen Reinkommen, NICHT an den Lead): Wer ist das, was will er, ` +
    `was ist der Sales-Hook?\n\n` +
    `Antworte AUSSCHLIESSLICH als JSON in genau diesem Format:\n` +
    `{"analysis": "...", "suggestion": "..."}`;

  const system = mode === "first_contact" ? firstContactSystem : replySystem;

  const userPromptIntro =
    mode === "first_contact"
      ? `Generiere die Erstnachricht (suggestion) und die Berater-Analyse (analysis) fuer diesen frischen Lead.`
      : `Generiere den naechsten ausgehenden Antwort-Vorschlag.`;

  const userPrompt =
    `Lead-Name: ${lead.name ?? "(unbekannt)"}\n` +
    `Anamnese (vom Lead aus dem Formular):\n` +
    `${formatMeta(lead.meta)}\n\n` +
    `WhatsApp-Konversation (chronologisch):\n` +
    `${formatHistory(messages)}\n\n` +
    `${userPromptIntro}`;

  // --- AI-Call ---
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ANTHROPIC_TIMEOUT_MS);
  let resp: Response;
  let endpoint: string;
  let requestInit: RequestInit;

  if (provider === "openai") {
    endpoint = "https://api.openai.com/v1/chat/completions";
    // first_contact braucht ~600 Tokens (analysis + suggestion), reply ~400.
    const openaiBody: Record<string, unknown> = {
      model: openaiModelCfg ?? "gpt-4o-mini",
      max_tokens: mode === "first_contact" ? 600 : 400,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    };
    if (mode === "first_contact") {
      // OpenAI JSON-Mode garantiert geschachteltes JSON-Output.
      openaiBody.response_format = { type: "json_object" };
    }
    requestInit = {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(openaiBody),
    };
  } else {
    endpoint = "https://api.anthropic.com/v1/messages";
    requestInit = {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "x-api-key": anthropicKey as string,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: anthropicModelCfg ?? "claude-sonnet-4-5",
        max_tokens: mode === "first_contact" ? 600 : 400,
        system,
        messages: [{ role: "user", content: userPrompt }],
      }),
    };
  }

  try {
    resp = await fetch(endpoint, requestInit);
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${provider} network error:`, msg);
    return jsonResponse(502, {
      ok: false,
      error: `${provider}_network`,
      detail: msg.slice(0, 300),
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await resp.text();
  if (!resp.ok) {
    console.error(`${provider} ${resp.status}:`, raw.slice(0, 500));
    return jsonResponse(502, {
      ok: false,
      error: `${provider}_failed_${resp.status}`,
      detail: raw.slice(0, 300),
    });
  }

  // Response-Format pro Provider extrahieren — das ist der Roh-Text vom
  // Modell. Bei first_contact ist der Roh-Text selbst JSON `{analysis, suggestion}`.
  let modelText = "";
  try {
    const parsed = JSON.parse(raw);
    if (provider === "openai") {
      modelText = String(parsed?.choices?.[0]?.message?.content ?? "").trim();
    } else {
      const blocks: Array<{ type?: string; text?: string }> = parsed?.content ?? [];
      modelText = blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("")
        .trim();
    }
  } catch {
    console.error(`${provider} response not json:`, raw.slice(0, 200));
    return jsonResponse(502, { ok: false, error: `${provider}_invalid_json` });
  }

  if (modelText.length === 0) {
    return jsonResponse(502, { ok: false, error: `${provider}_empty_response` });
  }

  if (mode === "first_contact") {
    // Anthropic kennt keinen JSON-Mode — wir bitten im Prompt darum und
    // fischen das JSON-Objekt notfalls mit einem regex-Fallback raus,
    // falls das Modell drumherum noch was schreibt.
    let parsedJson: { analysis?: unknown; suggestion?: unknown } | null = null;
    try {
      parsedJson = JSON.parse(modelText) as { analysis?: unknown; suggestion?: unknown };
    } catch {
      const match = modelText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsedJson = JSON.parse(match[0]) as { analysis?: unknown; suggestion?: unknown };
        } catch {
          // bleibt null
        }
      }
    }
    const analysis = typeof parsedJson?.analysis === "string" ? parsedJson.analysis.trim() : "";
    const suggestion = typeof parsedJson?.suggestion === "string" ? parsedJson.suggestion.trim() : "";
    if (!analysis || !suggestion) {
      console.error(`${provider} first_contact non-conforming JSON:`, modelText.slice(0, 300));
      return jsonResponse(502, { ok: false, error: `${provider}_invalid_json` });
    }
    return jsonResponse(200, { ok: true, suggestion, analysis, provider });
  }

  return jsonResponse(200, { ok: true, suggestion: modelText, provider });
});
