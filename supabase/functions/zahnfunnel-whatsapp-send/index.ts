// Zahnfunnel WhatsApp Send — authentifizierter Outbound-Endpoint fuer den
// eingeloggten Browser (Inbox-Compose). Verschickt Freitext ueber die Meta
// Graph API und loggt den Versand in `wa_messages`.
//
// Auth: verify_jwt=true (Default). Der Call kommt aus dem eingeloggten
// Frontend, Supabase verifiziert den User-JWT automatisch. Intern verwenden
// wir trotzdem den Service-Role-Client, weil RLS auf `wa_messages` /
// `leads` das nicht verlaesslich zulassen wuerde — der Browser schreibt
// WhatsApp-Logs, ja, aber nur durch diese Funktion, nicht direkt.
//
// Freitext-Hinweis: Meta erlaubt Freitext nur innerhalb des 24-Stunden-
// Fensters nach der letzten Inbound-Nachricht des Users. Fehler 131047 von
// Meta = "Message failed to send because more than 24 hours have passed...".
// Wir reichen den Fehler durch; die UI zeigt einen passenden Toast.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getConfig } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const META_SEND_TIMEOUT_MS = 15_000;
const BODY_MAX_CHARS = 4096;

type SupabaseClient = ReturnType<typeof createClient>;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// RFC-4122-ish UUID-Check. Ein string-Vergleich reicht — wir rejecten nur
// offensichtlich kaputte IDs, die DB-Query filtert den Rest.
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
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

  // --- Parse Body ---
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
  const body = typeof payload.body === "string" ? payload.body : "";
  const bodyTrimmed = body.trim();

  if (!leadId || !isUuid(leadId)) {
    return jsonResponse(422, { ok: false, error: "lead_id_invalid" });
  }
  if (!bodyTrimmed) {
    return jsonResponse(422, { ok: false, error: "body_required" });
  }
  if (body.length > BODY_MAX_CHARS) {
    return jsonResponse(422, { ok: false, error: "body_too_long" });
  }

  // --- Lead-Lookup ---
  const { data: leadRow, error: leadErr } = await supabase
    .from("leads")
    .select("id, phone")
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr) {
    console.error("leads lookup failed:", leadErr);
    return jsonResponse(500, { ok: false, error: "db_error" });
  }
  if (!leadRow) {
    return jsonResponse(404, { ok: false, error: "lead_not_found" });
  }
  const phone = String((leadRow as { phone?: string }).phone ?? "");
  if (!phone) {
    return jsonResponse(422, { ok: false, error: "lead_has_no_phone" });
  }

  // --- Meta-Credentials ---
  const [accessToken, phoneNumberId, graphVersion] = await Promise.all([
    getConfig(supabase, "WA_ACCESS_TOKEN"),
    getConfig(supabase, "WA_PHONE_NUMBER_ID"),
    getConfig(supabase, "WA_GRAPH_API_VERSION"),
  ]);

  if (!accessToken || !phoneNumberId) {
    return jsonResponse(503, {
      ok: false,
      error: "whatsapp_not_configured",
    });
  }

  const version = graphVersion ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  // --- Meta-Call ---
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), META_SEND_TIMEOUT_MS);
  let metaStatus = 0;
  let metaRaw = "";
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
        text: { body: bodyTrimmed },
      }),
    });
    metaStatus = resp.status;
    metaRaw = await resp.text();
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("whatsapp send network error:", msg);
    return jsonResponse(502, {
      ok: false,
      error: "meta_api_network",
      detail: msg.slice(0, 300),
    });
  } finally {
    clearTimeout(timer);
  }

  if (metaStatus < 200 || metaStatus >= 300) {
    console.error(`whatsapp send ${metaStatus}:`, metaRaw.slice(0, 500));
    // Meta-Error-Codes extrahieren, damit das Frontend 131047 (24h-Fenster)
    // erkennen und einen klaren Toast zeigen kann.
    let metaCode: number | null = null;
    let metaMessage: string | null = null;
    try {
      const parsed = JSON.parse(metaRaw) as {
        error?: { code?: number; message?: string };
      };
      metaCode = typeof parsed.error?.code === "number" ? parsed.error.code : null;
      metaMessage =
        typeof parsed.error?.message === "string" ? parsed.error.message : null;
    } catch {
      // no-op
    }
    return jsonResponse(502, {
      ok: false,
      error: `meta_api_${metaStatus}`,
      detail: (metaMessage ?? metaRaw).slice(0, 300),
      meta_code: metaCode,
    });
  }

  // --- Parse Success ---
  let waMessageId: string | null = null;
  try {
    const parsed = JSON.parse(metaRaw) as {
      messages?: Array<{ id?: string }>;
    };
    waMessageId = parsed.messages?.[0]?.id ?? null;
  } catch {
    // Send war erfolgreich, nur die ID konnten wir nicht parsen.
  }

  // --- Log + Lead-Update ---
  const { error: logErr } = await supabase.from("wa_messages").insert({
    lead_id: leadId,
    phone,
    direction: "outbound",
    body: bodyTrimmed,
    wa_message_id: waMessageId,
  });
  if (logErr) {
    // Versand ist erfolgt — Log-Fehler ist aergerlich, aber kein Hard-Fail.
    console.error("wa_messages insert failed (non-fatal):", logErr);
  }

  const { error: updErr } = await supabase
    .from("leads")
    .update({ last_message: bodyTrimmed })
    .eq("id", leadId);
  if (updErr) {
    console.error("leads last_message update failed (non-fatal):", updErr);
  }

  return jsonResponse(200, { ok: true, wa_message_id: waMessageId });
});
