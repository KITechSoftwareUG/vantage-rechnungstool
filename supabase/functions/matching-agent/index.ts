// Matching-Agent: Nimmt eine offene Transaktion + User-Antwort und
// entscheidet (via Lovable AI Gateway / Gemini 2.5 Pro), was damit
// geschehen soll. Das Frontend wendet die Entscheidung dann per normaler
// DB-Mutation an — die Edge Function schreibt NICHT in die DB.
//
// Ausgabe-Schema (JSON):
//   {
//     action: "match" | "recurring" | "ignored" | "no_match" | "ask",
//     invoiceId: string | null,   // nur bei action="match"
//     confidence: number,         // 0-100
//     message: string,            // kurze Erklärung für den User (DE)
//     followUp?: string           // nur bei action="ask": konkrete Rückfrage
//   }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatMessage = { role: "user" | "assistant"; content: string };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const llm = resolveLLM();
    if (!llm) throw new Error("Weder GEMINI_API_KEY noch OPENAI_API_KEY ist in den Edge-Function-Secrets gesetzt");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const body = await req.json().catch(() => ({}));
    const transactionId: string | undefined = body.transactionId;
    const userMessage: string = (body.userMessage ?? "").toString().slice(0, 2000);
    const chatHistory: ChatMessage[] = Array.isArray(body.chatHistory) ? body.chatHistory.slice(-10) : [];
    if (!transactionId) throw new Error("transactionId fehlt");

    // Transaktion laden
    const { data: tx, error: txErr } = await supabase
      .from("bank_transactions")
      .select("id, date, description, amount, transaction_type, match_status, bank_statements(bank, bank_type)")
      .eq("id", transactionId)
      .single();
    if (txErr) throw txErr;
    if (!tx) throw new Error("Transaktion nicht gefunden");

    // Bereits zugeordnete invoice ids rausfiltern. Paginiert, damit bei >1000
    // Zeilen nicht still abgeschnitten wird (Supabase default limit).
    const matchedRows = await fetchAllPaginated<any>(() =>
      supabase
        .from("bank_transactions")
        .select("matched_invoice_id")
        .in("match_status", ["matched", "confirmed"])
        .not("matched_invoice_id", "is", null),
    );
    const alreadyMatched = new Set(matchedRows.map((r: any) => r.matched_invoice_id));

    const allInvoices = await fetchAllPaginated<any>(() =>
      supabase
        .from("invoices")
        .select("id, issuer, amount, currency, date, file_name, invoice_number, type, file_hash, created_at")
        .order("date", { ascending: false }),
    );
    const candidatesAfterMatchFilter = allInvoices.filter((i: any) => !alreadyMatched.has(i.id));
    // Pre-LLM dedup: bei identischen Duplikat-Rechnungen würde das Modell sonst
    // zufällig eine Kopie auswählen. Wir behalten pro Gruppe nur den ältesten
    // Eintrag (wahrscheinlich das Original).
    const candidates = dedupInvoices(candidatesAfterMatchFilter);

    // Kandidaten vorfiltern: wenn zu viele, dann nach groben Heuristiken beschneiden
    // (Beschreibung/Issuer-Overlap oder Betrags-Nähe), damit der Prompt nicht explodiert.
    const scored = scoreCandidates(tx, candidates);
    const topCandidates = scored.slice(0, 25);

    const systemPrompt = [
      "Du bist ein deutscher Buchhaltungs-Assistent, der offene Kontotransaktionen zu Rechnungen zuordnet.",
      "Der User sagt dir frei, worum es bei einer Transaktion ging. Du entscheidest genau EINE Aktion:",
      "- match: Transaktion einer konkreten Rechnung zuordnen (invoiceId angeben)",
      "- recurring: Laufende Kosten (Miete, Abos, Gehälter, Strom, Internet, …), keine Rechnung nötig",
      "- ignored: Vom User explizit als irrelevant markiert (z.B. 'ignoriere das', 'privat')",
      "- no_match: Es gehört keine Rechnung dazu, ist aber auch kein Abo (z.B. Bargeldabhebung, Erstattung ohne Beleg)",
      "- ask: Du brauchst eine Rückfrage, weil die Antwort mehrdeutig ist oder mehrere Rechnungen plausibel sind",
      "",
      "Wichtig:",
      "- Antworte NUR mit einem validen JSON-Objekt in diesem Schema:",
      '  {"action":"match|recurring|ignored|no_match|ask","invoiceId":string|null,"confidence":0-100,"message":"kurze Erklärung auf Deutsch","followUp":"nur bei ask, konkrete Frage"}',
      "- Ohne Code-Fences, ohne zusätzlichen Text.",
      "- Wenn der User eine der Kandidaten-Nummern nennt (z.B. 'Nummer 3' oder 'die erste'), wähle die entsprechende Rechnung.",
      "- Wenn der User 'passt', 'ja', 'genau' sagt und es gibt genau einen stark passenden Vorschlag, matche diesen.",
      "- Wenn die User-Antwort klar auf eine Firma/Rechnung zeigt, die NICHT in der Kandidatenliste ist, gib action='no_match' mit erklärender message zurück.",
      "- Frei-Text wie 'laufende Kosten' / 'Abo' / 'Miete' → recurring. 'Ignorier das' / 'egal' → ignored.",
    ].join("\n");

    const txCtx = {
      date: tx.date,
      description: tx.description,
      amount: Number(tx.amount),
      type: tx.transaction_type,
      bank: (tx as any).bank_statements?.bank ?? null,
    };

    const candidatesCtx = topCandidates.map((c: any, idx: number) => ({
      nummer: idx + 1,
      invoiceId: c.id,
      issuer: c.issuer,
      amount: Number(c.amount),
      currency: c.currency ?? "EUR",
      date: c.date,
      file: c.file_name ?? null,
      invoiceNumber: c.invoice_number ?? null,
      type: c.type ?? null,
    }));

    const userPrompt = [
      "### TRANSAKTION",
      JSON.stringify(txCtx, null, 2),
      "",
      "### KANDIDATEN-RECHNUNGEN (nach Relevanz sortiert)",
      JSON.stringify(candidatesCtx, null, 2),
      "",
      "### VERLAUF",
      chatHistory.map((m) => `${m.role === "user" ? "USER" : "AGENT"}: ${m.content}`).join("\n") || "(leer)",
      "",
      "### NEUE USER-ANTWORT",
      userMessage || "(keine Antwort, triff den besten Vorschlag)",
    ].join("\n");

    const buildBody = () =>
      JSON.stringify({
        model: llm.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

    const doCall = () =>
      fetch(`${llm.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${llm.apiKey}`,
        },
        body: buildBody(),
      });

    let llmRes = await doCall();

    // Auto-Fallback bei 404 (Modell deprecated): einmal auf gemini-flash-latest
    // umschalten und neu aufrufen. Ohne Fallback waere ein deprecated Modell
    // ein harter Ausfall fuer den KI-Assistenten.
    if (
      llmRes.status === 404 &&
      llm.fallbackModel &&
      llm.model !== llm.fallbackModel
    ) {
      const deprecated = llm.model;
      llm.model = llm.fallbackModel;
      console.warn(`matching-agent: ${deprecated} → 404, switching to ${llm.model}`);
      llmRes = await doCall();
    }

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      throw new Error(`LLM-Fehler ${llmRes.status}: ${errText.slice(0, 300)}`);
    }

    const llmJson = await llmRes.json();
    const raw: string = llmJson.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(raw);

    if (!parsed || typeof parsed.action !== "string") {
      return json({
        action: "ask",
        invoiceId: null,
        confidence: 0,
        message: "Ich konnte deine Antwort nicht eindeutig interpretieren. Kannst du das anders formulieren?",
        followUp: "Was ist das für eine Transaktion?",
        topCandidates: candidatesCtx.slice(0, 5),
      });
    }

    // Validate invoiceId belongs to candidates if match
    if (parsed.action === "match") {
      const valid = candidatesCtx.some((c: any) => c.invoiceId === parsed.invoiceId);
      if (!valid) {
        parsed.action = "ask";
        parsed.message = "Die vorgeschlagene Rechnung passt nicht zu den bekannten Kandidaten. Bitte präzisiere.";
        parsed.followUp = "Welche Rechnung gehört dazu?";
      }
    }

    return json({
      action: parsed.action,
      invoiceId: parsed.invoiceId ?? null,
      confidence: clampNumber(parsed.confidence, 0, 100, 50),
      message: (parsed.message ?? "").toString().slice(0, 500),
      followUp: (parsed.followUp ?? "").toString().slice(0, 300) || undefined,
      topCandidates: candidatesCtx.slice(0, 5),
    });
  } catch (error: any) {
    console.error("matching-agent error", error);
    return new Response(
      JSON.stringify({ error: error?.message ?? "Unbekannter Fehler" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clampNumber(v: any, min: number, max: number, fallback: number) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function extractJson(text: string): any | null {
  if (!text) return null;
  // Strip ``` fences if present
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* noop */ }
    }
  }
  return null;
}

// Pre-LLM dedup: groups invoices that are almost certainly the same bill and
// returns one representative per group. Prevents the LLM from arbitrarily
// picking between byte-identical / metadata-identical duplicates.
function dedupInvoices(invoices: any[]): any[] {
  const norm = (s: string | null | undefined) =>
    (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const keyOf = (inv: any) => {
    if (inv.file_hash) return `hash:${inv.file_hash}`;
    const num = norm(inv.invoice_number);
    if (num.length >= 3) return `num:${num}|${Math.round(Number(inv.amount) * 100)}`;
    return `meta:${inv.date}|${norm(inv.issuer)}|${Math.round(Number(inv.amount) * 100)}`;
  };
  const groups = new Map<string, any[]>();
  for (const inv of invoices) {
    const k = keyOf(inv);
    const g = groups.get(k) || [];
    g.push(inv);
    groups.set(k, g);
  }
  const result: any[] = [];
  for (const group of groups.values()) {
    group.sort(
      (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
    );
    result.push(group[0]);
  }
  return result;
}

type LLMConfig = {
  provider: "gemini" | "openai";
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModel: string | null;
};

function resolveLLM(): LLMConfig | null {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) {
    return {
      provider: "gemini",
      apiKey: geminiKey,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: Deno.env.get("LLM_MODEL") ?? "gemini-2.5-flash-lite",
      fallbackModel: Deno.env.get("LLM_MODEL_FALLBACK") ?? "gemini-flash-latest",
    };
  }
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (openaiKey) {
    return {
      provider: "openai",
      apiKey: openaiKey,
      baseUrl: "https://api.openai.com/v1",
      model: Deno.env.get("OPENAI_MODEL") ?? Deno.env.get("LLM_MODEL") ?? "gpt-4o-mini",
      fallbackModel: null,
    };
  }
  return null;
}

async function fetchAllPaginated<T>(makeQuery: () => any): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function scoreCandidates(tx: any, candidates: any[]): any[] {
  const desc = (tx.description ?? "").toLowerCase();
  const txAmount = Math.abs(Number(tx.amount));
  const txDate = new Date(tx.date).getTime();

  return [...candidates]
    .map((inv) => {
      const issuer = (inv.issuer ?? "").toLowerCase();
      let score = 0;

      // Issuer-Tokens im Verwendungszweck?
      const tokens = issuer.split(/[\s,.\-_/]+/).filter((t: string) => t.length >= 4);
      let hits = 0;
      for (const t of tokens) if (desc.includes(t)) hits++;
      if (tokens.length > 0) score += (hits / tokens.length) * 60;

      // Betrag
      const invAmount = Math.abs(Number(inv.amount));
      if (invAmount > 0) {
        if (Math.abs(txAmount - invAmount) < 0.01) score += 30;
        else if (Math.abs(txAmount - invAmount) / invAmount < 0.05) score += 15;
      }

      // Datum-Nähe (30 Tage Fenster)
      const invDate = new Date(inv.date).getTime();
      const days = Math.abs(txDate - invDate) / 86400000;
      if (days <= 30) score += 10 - Math.min(10, Math.floor(days / 3));

      return { ...inv, _score: score };
    })
    .sort((a, b) => b._score - a._score);
}
