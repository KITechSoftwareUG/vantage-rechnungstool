// Zahnfunnel Form Webhook — Public-Ingest fuer das Lead-Formular der
// externen Landingpage.
//
// Flow:
//   1. X-Api-Key gegen FORM_API_KEY aus app_config pruefen.
//   2. Payload tolerant parsen, nur `phone` ist Pflicht.
//   3. Phone zu E.164-ohne-Plus (Meta-Format) normalisieren.
//   4. Upsert auf `leads` (Conflict-Key: phone), Anamnese-Felder und Tracking
//      landen in `meta` JSONB.
//   5. Wenn `einverstaendnis == "ja"` und WA_ACCESS_TOKEN gesetzt: Meta
//      Graph API Template-Send + Outbound-Log in `wa_messages`. Fehler hier
//      brechen den Flow NICHT ab — Lead ist gespeichert, WA ist Bonus.
//
// Auth: public Endpoint (kein verify_jwt). Service-Role-Client umgeht RLS,
// weil das Formular von aussen via Shared-Secret authentifiziert wird.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getConfig } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Byte-genauer Vergleich — kein timing-safe compare, Deno hat keinen nativen
// crypto.timingSafeEqual im Edge-Runtime. Der Key ist lang genug (zufaellig),
// und der Endpoint ist nicht hochfrequent; der praktische Timing-Leak ist
// vernachlaessigbar gegen den Nutzen, das auf dem Hot-Path einfach zu halten.
function apiKeyMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// E.164 ohne fuehrendes '+' (Meta-Format).
// Reine Ziffern-Extraktion: '+491511234567' -> '491511234567'.
// Eingaben mit DE-Landesvorwahl (0151…) werden NICHT auto-konvertiert — die
// Landingpage liefert bereits normalisierte Nummern mit Country-Code. Wenn das
// mal nicht mehr stimmt, ist die richtige Stelle das Form, nicht hier.
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
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

  // --- Auth: FORM_API_KEY ---
  const expectedApiKey = await getConfig(supabase, "FORM_API_KEY");
  if (!expectedApiKey) {
    // Setup-Fehler laut machen, nicht still durchlassen.
    return jsonResponse(503, { ok: false, error: "form_api_key_not_configured" });
  }
  const providedApiKey = req.headers.get("x-api-key") ?? "";
  if (!apiKeyMatches(providedApiKey, expectedApiKey)) {
    return jsonResponse(401, { ok: false, error: "unauthorized" });
  }

  // --- Parse Body ---
  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return jsonResponse(400, { ok: false, error: "invalid_json" });
    }
    body = raw as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }

  // --- Validate ---
  // Deutsche Aliase aus dem Lovable-Funnel akzeptieren: das externe Frontend
  // sendet `telnr` / `mail` / `quelle` statt `phone` / `email` / `source`.
  // Englischer Name gewinnt, falls beide gesetzt sind.
  const phoneRaw = asString(body.phone) ?? asString(body.telnr);
  if (!phoneRaw) {
    return jsonResponse(422, { ok: false, error: "phone_required" });
  }
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return jsonResponse(422, { ok: false, error: "phone_required" });
  }

  const name = asString(body.name);
  const email = (asString(body.email) ?? asString(body.mail))?.toLowerCase() ?? null;
  const source = asString(body.source) ?? asString(body.quelle) ?? "website";

  // Spec-konforme "extra=allow"-Semantik: nur die persistierten DB-Spalten
  // (inkl. der deutschen Aliase) werden aus dem Top-Level gezogen, ALLES
  // andere landet 1:1 in `meta`. So kann die Landingpage neue Anamnese-Felder
  // einfuehren ohne Backend-Aenderung — und Tracking/Anliegen-Summary werden
  // ohne weisse Liste durchgereicht. `undefined` filtern wir raus,
  // `null`/`false`/"" bleiben erhalten (kann fuer Auswertung relevant sein).
  const KNOWN_TOP_LEVEL = new Set([
    "name",
    "phone", "telnr",
    "email", "mail",
    "source", "quelle",
  ]);
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (KNOWN_TOP_LEVEL.has(key)) continue;
    if (value === undefined) continue;
    meta[key] = value;
  }

  const einverstaendnis = asString(body.einverstaendnis)?.toLowerCase() ?? null;

  // --- Upsert Lead ---
  // onConflict=phone: wenn derselbe Lead nochmal absendet, merge'n wir auf
  // Feldebene. `meta` wird dabei UEBERSCHRIEBEN (nicht deep-merged) — das ist
  // gewollt: die letzte Formular-Abgabe ist die aktuelle Wahrheit. Wer die
  // History braucht, schaut in `wa_messages`.
  const upsertPayload: Record<string, unknown> = {
    phone,
    name,
    email,
    source,
    meta,
  };

  const { data: leadRow, error: upsertError } = await supabase
    .from("leads")
    .upsert(upsertPayload, { onConflict: "phone" })
    .select("id")
    .single();

  if (upsertError || !leadRow?.id) {
    console.error("leads upsert failed:", upsertError);
    return jsonResponse(500, { ok: false, error: "db_error" });
  }

  const leadId: string = leadRow.id;

  // --- WhatsApp-Template-Send (optional, fail-safe) ---
  if (einverstaendnis === "ja") {
    try {
      await sendWhatsAppTemplate(supabase, leadId, phone);
    } catch (err) {
      // WhatsApp-Fehler bricht den Webhook NICHT ab — Lead ist gespeichert,
      // die UI kann den Template-Send manuell triggern.
      console.error("whatsapp template send failed (non-fatal):", err);
    }
  }

  return jsonResponse(200, { ok: true, id: leadId });
});

async function sendWhatsAppTemplate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  leadId: string,
  phone: string,
): Promise<void> {
  const [accessToken, phoneNumberId, templateName, templateLang, graphVersion] = await Promise.all([
    getConfig(supabase, "WA_ACCESS_TOKEN"),
    getConfig(supabase, "WA_PHONE_NUMBER_ID"),
    getConfig(supabase, "WA_TEMPLATE_NAME"),
    getConfig(supabase, "WA_TEMPLATE_LANG"),
    getConfig(supabase, "WA_GRAPH_API_VERSION"),
  ]);

  if (!accessToken) {
    // Kein Token -> still skippen, das ist ein valider Betriebszustand
    // (z.B. vor Meta-Approval).
    return;
  }
  if (!phoneNumberId) {
    console.error("WA_PHONE_NUMBER_ID not set, cannot send template");
    return;
  }

  const name = templateName ?? "lead_intro_de";
  const lang = templateLang ?? "de";
  const version = graphVersion ?? "v21.0";

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name,
      language: { code: lang },
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const respText = await resp.text();
  if (!resp.ok) {
    console.error(`whatsapp graph api ${resp.status}:`, respText);
    throw new Error(`whatsapp_send_failed_${resp.status}`);
  }

  // Meta-Response: { messaging_product, contacts:[...], messages:[{id}] }
  let waMessageId: string | null = null;
  try {
    const parsed = JSON.parse(respText);
    waMessageId = parsed?.messages?.[0]?.id ?? null;
  } catch {
    // Ignorieren — Send war erfolgreich, nur ID nicht parsbar.
  }

  const { error: logError } = await supabase.from("wa_messages").insert({
    lead_id: leadId,
    phone,
    direction: "outbound",
    body: null,
    template_name: name,
    wa_message_id: waMessageId,
  });
  if (logError) {
    console.error("wa_messages insert failed (non-fatal):", logError);
  }
}
