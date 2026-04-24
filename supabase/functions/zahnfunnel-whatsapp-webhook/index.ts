// Zahnfunnel WhatsApp Webhook — Meta-Endpoint fuer die offizielle WhatsApp
// Cloud API. Laeuft unter derselben Public-URL in zwei Rollen:
//
//   GET  /webhook/whatsapp  — Webhook-Verifikation beim Meta-Setup. Meta
//                             schickt hub.mode/hub.verify_token/hub.challenge,
//                             wir spiegeln die challenge als plain text,
//                             wenn der Verify-Token matcht.
//
//   POST /webhook/whatsapp  — Inbound-Messages. HMAC-SHA256 ueber den rohen
//                             Request-Body mit dem Meta App Secret. Bei
//                             gueltiger Signatur: Lead in `leads` anlegen/
//                             updaten, Message in `wa_messages` loggen,
//                             AI-Antwort generieren und via Graph API
//                             zurueckschicken.
//
// Auth: kein verify_jwt. Authentifizierung ist die HMAC-Signatur selbst.
// Service-Role-Client umgeht RLS.
//
// Design-Entscheidungen:
// - Der Body wird als ArrayBuffer gelesen, damit HMAC auf exakt denselben
//   Bytes rechnet, die Meta signiert hat. Re-Serialisieren via JSON.stringify
//   wuerde Reihenfolge/Whitespace aendern und die Signatur kippen.
// - Auf alles ausser Auth-/Config-Fehler antworten wir 200. Meta retried
//   endlos bei 5xx, und unsere Inbound-DB-Writes sind schon passiert — ein
//   Retry wuerde nur doppelte AI-Antworten produzieren.
// - AI- und Outbound-Send sind fail-safe: Inbound-Log ist Pflicht, Reply
//   ist Kuer.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getConfig } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const ANTHROPIC_TIMEOUT_MS = 30_000;
const META_SEND_TIMEOUT_MS = 15_000;

type SupabaseClient = ReturnType<typeof createClient>;

interface WaTextMessage {
  from: string;
  id: string;
  type: string;
  text?: { body?: string };
}

interface WaContact {
  wa_id?: string;
  profile?: { name?: string };
}

interface LeadRow {
  id: string;
  status: string | null;
  message_count: number | null;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

// HMAC-SHA256 hex ueber rohe Bytes. Key als UTF-8 aus dem App Secret.
async function hmacHex(secret: string, bytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, bytes);
  const view = new Uint8Array(sig);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}

// Konstantzeit-Vergleich. Keine timing-sichere Abkuerzung bei ungleicher
// Laenge — wir vergleichen bis zum Min und or'en die Laengen-Differenz rein.
function constantTimeEquals(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

async function verifySignature(
  signatureHeader: string | null,
  bodyBytes: Uint8Array,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const received = signatureHeader.slice("sha256=".length);
  const computed = await hmacHex(appSecret, bodyBytes);
  return constantTimeEquals(received, computed);
}

// Meta liefert die Nummer bereits als E.164 ohne '+'. Defensive Normalisierung
// auf reine Ziffern, falls mal Zeichen durchschluepfen.
function normalizeMetaPhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse(500, { ok: false, error: "server_misconfigured" });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (req.method === "GET") {
    return await handleVerify(req, supabase);
  }
  if (req.method === "POST") {
    return await handleInbound(req, supabase);
  }
  return jsonResponse(405, { ok: false, error: "method_not_allowed" });
});

async function handleVerify(req: Request, supabase: SupabaseClient): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode") ?? "";
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  const expected = await getConfig(supabase, "WA_VERIFY_TOKEN");
  if (!expected) {
    console.error("WA_VERIFY_TOKEN not configured");
    return textResponse(403, "forbidden");
  }
  if (mode === "subscribe" && token === expected) {
    // Plain text, NICHT JSON — Meta erwartet die nackte challenge zurueck.
    return textResponse(200, challenge);
  }
  console.warn("whatsapp verify failed mode=%s", mode);
  return textResponse(403, "forbidden");
}

async function handleInbound(req: Request, supabase: SupabaseClient): Promise<Response> {
  const appSecret = await getConfig(supabase, "WA_APP_SECRET");
  if (!appSecret) {
    return jsonResponse(503, { ok: false, error: "app_secret_not_configured" });
  }

  // ArrayBuffer -> Uint8Array. HMAC MUSS auf exakt diesen Bytes laufen, sonst
  // wird ein spaeteres JSON-Reparse die Signatur brechen.
  const buf = await req.arrayBuffer();
  const bodyBytes = new Uint8Array(buf);

  const signatureHeader = req.headers.get("x-hub-signature-256");
  const sigOk = await verifySignature(signatureHeader, bodyBytes, appSecret);
  if (!sigOk) {
    console.warn(
      "whatsapp signature invalid (len=%d, header_present=%s)",
      bodyBytes.length,
      signatureHeader ? "yes" : "no",
    );
    return jsonResponse(401, { ok: false, error: "invalid_signature" });
  }

  // Jetzt erst parsen. Fehler hier -> 200, damit Meta nicht retried.
  let payload: Record<string, unknown>;
  try {
    const text = new TextDecoder().decode(bodyBytes);
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.warn("whatsapp payload not valid JSON");
    return jsonResponse(200, { ok: true, ignored: true });
  }

  const entries = Array.isArray((payload as { entry?: unknown }).entry)
    ? ((payload as { entry: unknown[] }).entry as Array<Record<string, unknown>>)
    : [];

  let processed = 0;
  let ignored = 0;

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes)
      ? (entry.changes as Array<Record<string, unknown>>)
      : [];
    for (const change of changes) {
      const value = (change.value ?? {}) as Record<string, unknown>;
      const messages = Array.isArray(value.messages)
        ? (value.messages as WaTextMessage[])
        : [];
      const contacts = Array.isArray(value.contacts)
        ? (value.contacts as WaContact[])
        : [];

      for (const msg of messages) {
        if (msg.type !== "text") {
          ignored++;
          continue;
        }
        try {
          await handleTextMessage(supabase, msg, contacts);
          processed++;
        } catch (err) {
          // Einzelne Message soll nie den ganzen Batch killen.
          console.error("handleTextMessage failed:", err);
        }
      }
    }
  }

  return jsonResponse(200, { ok: true, processed, ignored });
}

async function handleTextMessage(
  supabase: SupabaseClient,
  msg: WaTextMessage,
  contacts: WaContact[],
): Promise<void> {
  const phoneRaw = msg.from ?? "";
  const phone = normalizeMetaPhone(phoneRaw);
  if (!phone) {
    console.warn("whatsapp message without usable 'from'");
    return;
  }
  const body = msg.text?.body ?? "";
  const waMessageId = msg.id ?? null;

  // Kontakt-Name aus dem ersten passenden contacts-Eintrag ziehen.
  let profileName: string | null = null;
  const match = contacts.find((c) => c.wa_id === phoneRaw) ?? contacts[0];
  if (match?.profile?.name && typeof match.profile.name === "string") {
    const trimmed = match.profile.name.trim();
    if (trimmed.length > 0) profileName = trimmed;
  }

  // --- Lead lookup / insert ---
  const { data: existing, error: lookupErr } = await supabase
    .from("leads")
    .select("id, status, message_count")
    .eq("phone", phone)
    .maybeSingle();

  if (lookupErr) {
    console.error("leads lookup failed:", lookupErr);
    throw lookupErr;
  }

  let lead: LeadRow;
  if (!existing) {
    const { data: created, error: insertErr } = await supabase
      .from("leads")
      .insert({
        phone,
        name: profileName,
        source: "whatsapp",
        status: "new",
      })
      .select("id, status, message_count")
      .single();
    if (insertErr || !created) {
      console.error("leads insert failed:", insertErr);
      throw insertErr ?? new Error("lead_insert_failed");
    }
    lead = created as unknown as LeadRow;
  } else {
    lead = existing as unknown as LeadRow;
  }

  // --- Inbound-Message loggen ---
  const { error: inboundErr } = await supabase.from("wa_messages").insert({
    lead_id: lead.id,
    phone,
    direction: "inbound",
    body,
    wa_message_id: waMessageId,
  });
  if (inboundErr) {
    console.error("wa_messages inbound insert failed:", inboundErr);
    // Wir werfen hier bewusst nicht — der AI-Reply ist wichtiger als ein
    // Log-Insert-Fehler.
  }

  // --- Lead-Counters updaten ---
  const nextCount = (lead.message_count ?? 0) + 1;
  const nextStatus = lead.status === "new" ? "contacted" : lead.status;
  const { error: updateErr } = await supabase
    .from("leads")
    .update({
      message_count: nextCount,
      last_message: body,
      status: nextStatus,
    })
    .eq("id", lead.id);
  if (updateErr) {
    console.error("leads update failed:", updateErr);
  }

  // --- AI-Reply (fail-safe) ---
  try {
    const replyText = await generateReply(supabase, body);
    if (!replyText) {
      console.info("no reply generated (no api key or empty response)");
      return;
    }
    const outboundId = await sendWhatsAppText(supabase, phone, replyText);
    const { error: outboundErr } = await supabase.from("wa_messages").insert({
      lead_id: lead.id,
      phone,
      direction: "outbound",
      body: replyText,
      wa_message_id: outboundId,
    });
    if (outboundErr) {
      console.error("wa_messages outbound insert failed:", outboundErr);
    }
  } catch (err) {
    console.error("ai reply pipeline failed (non-fatal):", err);
  }
}

async function generateReply(
  supabase: SupabaseClient,
  userText: string,
): Promise<string | null> {
  const [apiKey, modelCfg, beraterName, beraterFirma, beraterTyp] = await Promise.all([
    getConfig(supabase, "ANTHROPIC_API_KEY"),
    getConfig(supabase, "ANTHROPIC_MODEL"),
    getConfig(supabase, "BERATER_NAME"),
    getConfig(supabase, "BERATER_FIRMA"),
    getConfig(supabase, "BERATER_TYP"),
  ]);

  if (!apiKey) return null;

  const model = modelCfg ?? "claude-sonnet-4-5";
  const name = beraterName ?? "Ihr Berater";
  const firma = beraterFirma ?? "ExpatVantage";
  const typ = beraterTyp ?? "Zahnzusatzversicherungen";

  const system =
    `Du bist ein persoenlicher Assistent fuer ${name} von ${firma}, einem ` +
    `Beratungs-Profi fuer ${typ}. Antworte auf die WhatsApp-Nachricht des ` +
    `Interessenten kurz, freundlich und menschlich — als waere ${name} ` +
    `selbst am Handy. Stelle bei Bedarf eine verbindende Rueckfrage. Keine ` +
    `Emojis. Keine Signatur. Maximal 3 Saetze.`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
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
        messages: [{ role: "user", content: userText || "(leere Nachricht)" }],
      }),
    });
    const raw = await resp.text();
    if (!resp.ok) {
      console.error(`anthropic ${resp.status}:`, raw.slice(0, 500));
      return null;
    }
    let parsed: { content?: Array<{ type?: string; text?: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("anthropic response not json:", raw.slice(0, 200));
      return null;
    }
    const blocks = parsed.content ?? [];
    const text = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("")
      .trim();
    return text.length > 0 ? text : null;
  } finally {
    clearTimeout(timer);
  }
}

async function sendWhatsAppText(
  supabase: SupabaseClient,
  phone: string,
  body: string,
): Promise<string | null> {
  const [accessToken, phoneNumberId, graphVersion] = await Promise.all([
    getConfig(supabase, "WA_ACCESS_TOKEN"),
    getConfig(supabase, "WA_PHONE_NUMBER_ID"),
    getConfig(supabase, "WA_GRAPH_API_VERSION"),
  ]);
  if (!accessToken || !phoneNumberId) {
    console.warn("whatsapp send skipped (missing token or phone_number_id)");
    return null;
  }
  const version = graphVersion ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), META_SEND_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body },
      }),
    });
    const raw = await resp.text();
    if (!resp.ok) {
      console.error(`whatsapp send ${resp.status}:`, raw.slice(0, 500));
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as {
        messages?: Array<{ id?: string }>;
      };
      return parsed.messages?.[0]?.id ?? null;
    } catch {
      return null;
    }
  } finally {
    clearTimeout(timer);
  }
}
