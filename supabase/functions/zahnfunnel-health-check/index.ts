// Zahnfunnel Health-Check — prueft die drei externen Integrationen, die das
// Zahnfunnel-System braucht: Meta WhatsApp Cloud API, Anthropic Claude API
// und Gmail (OAuth-Refresh).
//
// Auth: verify_jwt=true (Default). Wird nur vom eingeloggten /status-
// Dashboard aufgerufen.
//
// Alle drei Checks laufen parallel, jeder mit eigenem 8s-Timeout. Missing
// config -> status "not_configured" (Info, kein Fehler). Echte API-Fehler
// -> status "error" + detail.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getConfig } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const CHECK_TIMEOUT_MS = 8_000;

type SupabaseClient = ReturnType<typeof createClient>;

type CheckStatus = "ok" | "not_configured" | "error";

interface MetaCheck {
  status: CheckStatus;
  detail: string;
  display_phone_number?: string;
  verified_name?: string;
}

interface AnthropicCheck {
  status: CheckStatus;
  detail: string;
  model?: string;
}

interface GmailCheck {
  status: CheckStatus;
  detail: string;
  email?: string;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Wrapper um fetch mit AbortController-Timeout. Wirft bei Timeout/Netzwerk-
// fehler — Caller faengt und mapped auf CheckStatus.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkMeta(supabase: SupabaseClient): Promise<MetaCheck> {
  const [accessToken, phoneNumberId, graphVersion] = await Promise.all([
    getConfig(supabase, "WA_ACCESS_TOKEN"),
    getConfig(supabase, "WA_PHONE_NUMBER_ID"),
    getConfig(supabase, "WA_GRAPH_API_VERSION"),
  ]);

  if (!accessToken || !phoneNumberId) {
    return {
      status: "not_configured",
      detail: "WA_ACCESS_TOKEN oder WA_PHONE_NUMBER_ID fehlen.",
    };
  }

  const version = graphVersion ?? "v21.0";
  const url =
    `https://graph.facebook.com/${version}/${phoneNumberId}` +
    `?fields=id,verified_name,display_phone_number`;

  try {
    const resp = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      CHECK_TIMEOUT_MS,
    );
    const text = await resp.text();
    if (!resp.ok) {
      let msg = text;
      try {
        const parsed = JSON.parse(text) as {
          error?: { message?: string };
        };
        msg = parsed.error?.message ?? text;
      } catch {
        // no-op
      }
      return {
        status: "error",
        detail: `Meta ${resp.status}: ${msg.slice(0, 200)}`,
      };
    }
    const parsed = JSON.parse(text) as {
      id?: string;
      verified_name?: string;
      display_phone_number?: string;
    };
    return {
      status: "ok",
      detail: parsed.verified_name
        ? `${parsed.verified_name} verifiziert`
        : "Phone-Number-ID erreichbar.",
      display_phone_number: parsed.display_phone_number,
      verified_name: parsed.verified_name,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      detail: `Meta-Netzwerkfehler: ${msg.slice(0, 200)}`,
    };
  }
}

async function checkAnthropic(supabase: SupabaseClient): Promise<AnthropicCheck> {
  const [apiKey, modelCfg] = await Promise.all([
    getConfig(supabase, "ANTHROPIC_API_KEY"),
    getConfig(supabase, "ANTHROPIC_MODEL"),
  ]);

  if (!apiKey) {
    return {
      status: "not_configured",
      detail: "ANTHROPIC_API_KEY fehlt.",
    };
  }

  const model = modelCfg ?? "claude-sonnet-4-5";

  try {
    const resp = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: "user", content: "ping" }],
        }),
      },
      CHECK_TIMEOUT_MS,
    );
    const text = await resp.text();
    if (!resp.ok) {
      let msg = text;
      try {
        const parsed = JSON.parse(text) as {
          error?: { message?: string };
        };
        msg = parsed.error?.message ?? text;
      } catch {
        // no-op
      }
      return {
        status: "error",
        detail: `Anthropic ${resp.status}: ${msg.slice(0, 200)}`,
        model,
      };
    }
    return {
      status: "ok",
      detail: `Modell ${model} antwortet.`,
      model,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      detail: `Anthropic-Netzwerkfehler: ${msg.slice(0, 200)}`,
      model,
    };
  }
}

async function checkGmail(supabase: SupabaseClient): Promise<GmailCheck> {
  const [tokenJson, credsJson] = await Promise.all([
    getConfig(supabase, "GMAIL_TOKEN_JSON"),
    getConfig(supabase, "GMAIL_CREDENTIALS_JSON"),
  ]);

  if (!tokenJson) {
    return {
      status: "not_configured",
      detail: "GMAIL_TOKEN_JSON fehlt.",
    };
  }

  // Token-JSON parsen. Struktur laut Google OAuth-Lib:
  // { refresh_token, client_id, client_secret, ... }
  // Fallback: Credentials aus GMAIL_CREDENTIALS_JSON ziehen
  // (installed/web -> { client_id, client_secret }).
  let refreshToken: string | null = null;
  let clientId: string | null = null;
  let clientSecret: string | null = null;
  let emailHint: string | null = null;

  try {
    const parsed = JSON.parse(tokenJson) as Record<string, unknown>;
    refreshToken =
      typeof parsed.refresh_token === "string" ? parsed.refresh_token : null;
    if (typeof parsed.client_id === "string") clientId = parsed.client_id;
    if (typeof parsed.client_secret === "string") clientSecret = parsed.client_secret;
    if (typeof parsed.email === "string") emailHint = parsed.email;
  } catch (err) {
    return {
      status: "error",
      detail: `GMAIL_TOKEN_JSON kein gueltiges JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!refreshToken) {
    return {
      status: "error",
      detail: "refresh_token in GMAIL_TOKEN_JSON fehlt.",
    };
  }

  // Falls client_id/secret im Token-JSON nicht drinstehen, versuchen wir
  // GMAIL_CREDENTIALS_JSON. Google liefert dort { installed: {...} } oder
  // { web: {...} }.
  if ((!clientId || !clientSecret) && credsJson) {
    try {
      const parsed = JSON.parse(credsJson) as Record<string, unknown>;
      const root = (parsed.installed ?? parsed.web ?? parsed) as Record<
        string,
        unknown
      >;
      if (!clientId && typeof root.client_id === "string") clientId = root.client_id;
      if (!clientSecret && typeof root.client_secret === "string") {
        clientSecret = root.client_secret;
      }
    } catch {
      // no-op — wir fallen unten auf den Fehlerpfad.
    }
  }

  if (!clientId || !clientSecret) {
    return {
      status: "error",
      detail: "client_id/client_secret fehlen (weder in TOKEN_JSON noch CREDENTIALS_JSON).",
    };
  }

  try {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const resp = await fetchWithTimeout(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
      CHECK_TIMEOUT_MS,
    );
    const text = await resp.text();
    if (!resp.ok) {
      let msg = text;
      try {
        const parsed = JSON.parse(text) as {
          error?: string;
          error_description?: string;
        };
        msg = parsed.error_description ?? parsed.error ?? text;
      } catch {
        // no-op
      }
      return {
        status: "error",
        detail: `Google OAuth ${resp.status}: ${msg.slice(0, 200)}`,
        email: emailHint ?? undefined,
      };
    }
    return {
      status: "ok",
      detail: emailHint
        ? `Token refresht fuer ${emailHint}.`
        : "Token refresht.",
      email: emailHint ?? undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      detail: `Google-Netzwerkfehler: ${msg.slice(0, 200)}`,
      email: emailHint ?? undefined,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse(500, { ok: false, error: "server_misconfigured" });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Promise.allSettled — ein einzelner Check soll den Rest nicht killen.
  const [metaRes, anthropicRes, gmailRes] = await Promise.allSettled([
    checkMeta(supabase),
    checkAnthropic(supabase),
    checkGmail(supabase),
  ]);

  const meta: MetaCheck =
    metaRes.status === "fulfilled"
      ? metaRes.value
      : {
          status: "error",
          detail: `Interner Fehler: ${
            metaRes.reason instanceof Error
              ? metaRes.reason.message
              : String(metaRes.reason)
          }`.slice(0, 200),
        };

  const anthropic: AnthropicCheck =
    anthropicRes.status === "fulfilled"
      ? anthropicRes.value
      : {
          status: "error",
          detail: `Interner Fehler: ${
            anthropicRes.reason instanceof Error
              ? anthropicRes.reason.message
              : String(anthropicRes.reason)
          }`.slice(0, 200),
        };

  const gmail: GmailCheck =
    gmailRes.status === "fulfilled"
      ? gmailRes.value
      : {
          status: "error",
          detail: `Interner Fehler: ${
            gmailRes.reason instanceof Error
              ? gmailRes.reason.message
              : String(gmailRes.reason)
          }`.slice(0, 200),
        };

  return jsonResponse(200, { meta, anthropic, gmail });
});
