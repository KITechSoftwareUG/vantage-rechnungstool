import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Harte Obergrenze pro Invocation: bei 1-2s pro OpenAI-Call gibt das einen
// Wall-Clock von ~100s — gut unterhalb des Edge-Function-Timeouts. Das
// Frontend ruft die Function in einer Schleife auf, bis `remaining === 0`.
const MAX_TRANSACTIONS_PER_INVOCATION = 50;

// Per-Call-Timeout für OpenAI: ein hängender Call darf nicht den gesamten
// Run blockieren.
const OPENAI_TIMEOUT_MS = 20000;

// Version-Tag in JEDER Response, damit Frontend zweifelsfrei sieht ob die
// neue Edge-Function-Version live ist. Bei jedem Code-Change hochzaehlen.
const EDGE_VERSION = "2026-04-15-diagnostic-v4";

// Maximale Anzahl Kandidaten, die wir dem LLM pro Transaktion zumuten.
// Bei einem generischen Issuer ("Amazon") können sonst Dutzende Kandidaten
// pro Transaktion auftauchen → Token-Explosion und schlechtere Genauigkeit.
const MAX_CANDIDATES_PER_TX = 15;

// Supabase begrenzt Selects standardmäßig auf 1000 Rows. Ohne Pagination
// verschwinden bei großen Datenmengen sowohl Transaktionen als auch
// already-matched Invoice-IDs aus der Sicht der Function — letzteres führt
// dazu, dass bereits gematchte Rechnungen erneut als Kandidaten auftauchen.
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

// Pre-LLM dedup der Invoice-Kandidatenliste. Ohne diesen Schritt kriegt das
// Modell bei identischen Duplikat-Rechnungen (gleicher Inhalt, versehentlich
// zweimal ingested) mehrere Kandidaten mit identischen Feldern zur Auswahl und
// entscheidet zufällig. Wir wählen pro Duplikat-Gruppe genau EINEN
// Repräsentanten — bevorzugt den mit dem ältesten `created_at`, weil das der
// "echte" Originaleintrag ist.
function dedupInvoices(invoices: any[]): any[] {
  const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
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
    // Älteste Rechnung als Repräsentant → `created_at` aufsteigend sortieren.
    group.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
    result.push(group[0]);
  }
  return result;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      throw new Error("Not authenticated");
    }

    // Alle drei Selects MÜSSEN paginiert sein, sonst werden bei >1000 Rows
    // stillschweigend Daten abgeschnitten.
    const allTransactions = await fetchAllPaginated<any>(() =>
      supabaseClient
        .from("bank_transactions")
        .select("*, bank_statements(bank_type)")
        .eq("match_status", "unmatched")
        .order("date", { ascending: false }),
    );

    const matchedInvoiceIds = await fetchAllPaginated<any>(() =>
      supabaseClient.from("bank_transactions").select("matched_invoice_id").not("matched_invoice_id", "is", null),
    );

    const alreadyMatchedIds = new Set(matchedInvoiceIds.map((t: any) => t.matched_invoice_id));

    const allInvoicesRaw = await fetchAllPaginated<any>(() => supabaseClient.from("invoices").select("*"));

    // Filter out already matched invoices
    const invoicesAfterMatchFilter = allInvoicesRaw.filter((inv: any) => !alreadyMatchedIds.has(inv.id));
    // Dedup auf Inhalt/Rechnungsnummer/Metadaten, damit das LLM bei echten
    // Duplikat-Rechnungen nicht zufällig eine Kopie auswählt.
    const invoices = dedupInvoices(invoicesAfterMatchFilter);
    console.log(
      `Invoices: ${allInvoicesRaw.length} total → ${invoicesAfterMatchFilter.length} unmatched → ${invoices.length} after dedup`,
    );

    const totalUnmatched = allTransactions.length;

    // Pro Invocation nur eine begrenzte Menge Transaktionen verarbeiten,
    // damit wir nicht in den Wall-Clock-Timeout der Edge Function laufen.
    // Das Frontend ruft die Function in einer Schleife auf, bis `remaining=0`.
    const transactions = allTransactions.slice(0, MAX_TRANSACTIONS_PER_INVOCATION);
    const remaining = Math.max(0, totalUnmatched - transactions.length);

    if (transactions.length === 0 || invoices.length === 0) {
      // Diagnostik: WARUM hat die Function nichts zu tun? Das war vorher
      // unsichtbar — Frontend bekam nur stumm 0 zurueck.
      const reason =
        transactions.length === 0 && invoices.length === 0
          ? "Keine offenen Transaktionen UND keine unmatched Rechnungen sichtbar"
          : transactions.length === 0
            ? `Keine 'unmatched' Transaktionen sichtbar (Auth-User sieht 0 unmatched). Insgesamt: ${totalUnmatched}`
            : `Keine unmatched Rechnungen sichtbar (allInvoicesRaw=${allInvoicesRaw.length}, nach Match-Filter=${invoicesAfterMatchFilter.length}, nach Dedup=${invoices.length})`;
      console.warn(`auto-match early-return: ${reason}`);
      return new Response(
        JSON.stringify({
          success: true,
          version: EDGE_VERSION,
          earlyReturnReason: reason,
          rawCounts: {
            unmatchedTransactions: totalUnmatched,
            allInvoices: allInvoicesRaw.length,
            unmatchedInvoices: invoicesAfterMatchFilter.length,
            invoicesAfterDedup: invoices.length,
          },
          matchedCount: 0,
          autoConfirmedCount: 0,
          processedCount: 0,
          totalUnmatched,
          remaining: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // LLM-Config: Gemini oder OpenAI, je nachdem welches Secret gesetzt ist.
    // Beide nutzen den OpenAI-kompatiblen Endpoint — Google bietet den offiziell
    // unter generativelanguage.googleapis.com/v1beta/openai an.
    const llm = resolveLLM();
    if (!llm) {
      return new Response(
        JSON.stringify({
          success: false,
          version: EDGE_VERSION,
          aiKeyMissing: true,
          error:
            "Weder GEMINI_API_KEY noch OPENAI_API_KEY ist in den Edge-Function-Secrets gesetzt. KI-Matching deaktiviert.",
          matchedCount: 0,
          autoConfirmedCount: 0,
          processedCount: 0,
          totalUnmatched: 0,
          remaining: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Confidence-Schwellen für die zweistufige Auto-Confirm-Logik:
    // - >= AUTO_CONFIRM_THRESHOLD → direkt als bestätigt speichern (vollautomatisch)
    // - >= SUGGEST_THRESHOLD       → als Vorschlag (matched) speichern, User bestätigt manuell
    // - <  SUGGEST_THRESHOLD       → ignoriert (kein Match)
    const AUTO_CONFIRM_THRESHOLD = 95;
    const SUGGEST_THRESHOLD = 30;

    let matchedCount = 0;
    let autoConfirmedCount = 0;
    // Konkrete Liste aller neu zugeordneten Transaktionen — damit der User
    // im UI sieht WAS gematcht wurde, nicht nur dass irgendwas passierte.
    const matchedTransactions: Array<{
      transactionId: string;
      transactionDescription: string;
      transactionAmount: number;
      transactionDate: string;
      invoiceId: string;
      invoiceIssuer: string;
      invoiceAmount: number;
      invoiceDate: string;
      confidence: number;
      reason: string;
      source: "deterministic" | "ai" | "amount-fallback";
      status: "confirmed" | "matched";
    }> = [];
    // KI-Telemetrie, damit das Frontend Silent-Failures erkennen kann.
    let aiAttempted = 0;
    let aiSucceeded = 0;
    let aiTimeouts = 0;
    let aiHttpErrors = 0;
    let aiParseErrors = 0;
    let lastAiError: string | null = null;
    // Entscheidungs-Telemetrie: wo landet jede TX? Damit wir bei "0 Treffer"
    // sofort sehen auf welchem Pfad sie versanden.
    let deterministicMatched = 0;
    let noCandidates = 0;
    let aiRejectedInvalidId = 0;
    let aiRejectedLowConfidence = 0;
    let aiReturnedNull = 0;
    let dbUpdateErrors = 0;

    // Helper function to extract original amount from original_currency field
    // Supports multiple formats:
    // - "Foreign Spend Amount: 5.95 US Dollars Commission Amount: 0.1 Currency Exchange Rate: 1.1531"
    // - "5.95 USD"
    // - "350.00 GBP"
    const extractOriginalAmount = (originalCurrency: string | null): number | null => {
      if (!originalCurrency) return null;

      // Try "Foreign Spend Amount: X.XX" format first
      const foreignSpendMatch = originalCurrency.match(/Foreign Spend Amount:\s*([\d,.]+)/i);
      if (foreignSpendMatch) {
        const amountStr = foreignSpendMatch[1].replace(",", ".");
        const amount = parseFloat(amountStr);
        if (!isNaN(amount)) {
          console.log(`Extracted Foreign Spend Amount: ${amount}`);
          return amount;
        }
      }

      // Try simple "X.XX CURRENCY" format (e.g., "5.95 USD", "350.00 GBP")
      const simpleMatch = originalCurrency.match(/^([\d,.]+)\s*[A-Z]{3}/i);
      if (simpleMatch) {
        const amountStr = simpleMatch[1].replace(",", ".");
        const amount = parseFloat(amountStr);
        if (!isNaN(amount)) {
          console.log(`Extracted simple amount: ${amount}`);
          return amount;
        }
      }

      // Try to find any number followed by currency code
      const anyMatch = originalCurrency.match(/([\d,.]+)\s*(?:US Dollars|USD|EUR|GBP|CHF|JPY)/i);
      if (anyMatch) {
        const amountStr = anyMatch[1].replace(",", ".");
        const amount = parseFloat(amountStr);
        if (!isNaN(amount)) {
          console.log(`Extracted amount from text: ${amount}`);
          return amount;
        }
      }

      return null;
    };

    // Process transactions
    for (const transaction of transactions) {
      const transactionAmount = Math.abs(transaction.amount);
      const isAmexWithCurrencyConversion =
        transaction.bank_statements?.bank_type === "amex" && transaction.original_currency !== null;

      let potentialMatches: any[] = [];
      let matchAmount = transactionAmount;

      if (isAmexWithCurrencyConversion) {
        // For Amex with currency conversion: Extract Foreign Spend Amount and match exactly
        const foreignAmount = extractOriginalAmount(transaction.original_currency);

        if (foreignAmount !== null) {
          matchAmount = foreignAmount;
          console.log(`Amex currency conversion - Using Foreign Spend Amount: ${foreignAmount} for matching`);
        }
      }

      // IMPROVED MATCHING STRATEGY:
      // 1. First find matches by name/description similarity
      // 2. Then validate with amount (with currency tolerance)

      // Step 1: Find invoices with similar names/descriptions
      const transactionDesc = transaction.description.toLowerCase();

      // Calculate similarity score for each invoice based on name matching
      const invoicesWithScores = invoices.map((inv: any) => {
        const issuerLower = inv.issuer.toLowerCase();
        let nameScore = 0;

        // Check if issuer name is contained in transaction description
        if (transactionDesc.includes(issuerLower)) {
          nameScore = 100;
        } else {
          // Word-by-word matching. Wir bewerten zwei Signale parallel:
          //  a) Anteil gematchter Issuer-Wörter (fractionScore) — gut wenn Issuer kurz ist
          //  b) Stärkster Einzel-Token-Match (bestTokenScore) — rettet Fälle wie
          //     "Udemy Ireland Ltd" vs. Verwendungszweck "UDEMYEU", wo nur ein
          //     Token substring-matcht, das aber lang und eindeutig ist.
          const issuerWords = issuerLower.split(/[\s,.-]+/).filter((w: string) => w.length > 2);
          const descWords = transactionDesc.split(/[\s,.-]+/).filter((w: string) => w.length > 2);

          let matchedWords = 0;
          let bestTokenScore = 0;
          for (const issuerWord of issuerWords) {
            for (const descWord of descWords) {
              if (descWord.includes(issuerWord) || issuerWord.includes(descWord)) {
                matchedWords++;
                const minLen = Math.min(issuerWord.length, descWord.length);
                // Je länger der gemeinsame Kern, desto eindeutiger das Signal.
                if (minLen >= 5) bestTokenScore = Math.max(bestTokenScore, 80);
                else if (minLen >= 4) bestTokenScore = Math.max(bestTokenScore, 70);
                else if (minLen >= 3) bestTokenScore = Math.max(bestTokenScore, 55);
                break;
              }
            }
          }

          const fractionScore = issuerWords.length > 0 ? (matchedWords / issuerWords.length) * 80 : 0;
          nameScore = Math.max(fractionScore, bestTokenScore);
        }

        // Amount matching with tolerance for currency differences (up to 10% difference)
        const amountDiff = Math.abs(matchAmount - inv.amount);
        const amountTolerance = Math.max(matchAmount, inv.amount) * 0.1; // 10% tolerance
        const exactMatch = amountDiff < 0.01;
        const closeMatch = amountDiff <= amountTolerance;

        let amountScore = 0;
        if (exactMatch) {
          amountScore = 100;
        } else if (closeMatch) {
          amountScore = 80 - (amountDiff / amountTolerance) * 30; // 50-80 for close matches
        }

        // Combined score: prioritize name matches, use amount as validation
        const combinedScore = nameScore * 0.6 + amountScore * 0.4;

        return {
          invoice: inv,
          nameScore,
          amountScore,
          combinedScore,
          exactAmountMatch: exactMatch,
          closeAmountMatch: closeMatch,
        };
      });

      // Filter potential matches: bewusst großzügig — die KI soll entscheiden,
      // nicht der lokale Pre-Filter. Der KI-Assistent-Dialog hat keine harte
      // Schwelle und findet genau deswegen Treffer, die der alte Auto-Match-
      // Pfad schluckt. Wir schicken jetzt ebenfalls Top-N ohne harten Cutoff.
      potentialMatches = invoicesWithScores
        .filter((item: any) => item.nameScore >= 25 || item.closeAmountMatch)
        .sort((a: any, b: any) => b.combinedScore - a.combinedScore)
        .slice(0, MAX_CANDIDATES_PER_TX)
        .map((item: any) => item.invoice);

      if (potentialMatches.length === 0) {
        // Letzter Fallback: Top-N nach Score, auch wenn jedes Signal schwach war.
        // Besser die KI sagt "keine Übereinstimmung" als dass wir die Transaktion
        // komplett ohne Prüfung durchfallen lassen.
        potentialMatches = invoicesWithScores
          .sort((a: any, b: any) => b.combinedScore - a.combinedScore)
          .slice(0, MAX_CANDIDATES_PER_TX)
          .map((item: any) => item.invoice);
      }

      if (potentialMatches.length === 0) {
        noCandidates++;
        continue;
      }

      // ------------------------------------------------------------------
      // DETERMINISTISCHER PRE-KI-MATCH
      // ------------------------------------------------------------------
      // Bei Slam-dunk-Faellen (exakter Betrag ±0.01 + klarer Name-Substring +
      // genau EINE passende Rechnung) ist die KI unnoetig. Wir matchen direkt.
      // Zweck: immun gegen KI-Ausfaelle, JSON-Parse-Probleme, UUID-Validierung
      // und was sonst alles zwischen KI-Response und DB-Zeile schiefgehen kann.
      // Die KI bleibt fuer mehrdeutige Faelle zustaendig.
      const txDescLower = transaction.description.toLowerCase();
      const slamDunks = potentialMatches.filter((inv: any) => {
        const amountOk = Math.abs(Number(inv.amount) - matchAmount) < 0.01;
        if (!amountOk) return false;
        // Klarer Name-Match: Issuer-Token (>=4 Zeichen) ist Substring der Desc,
        // oder ein Desc-Token ist Substring des Issuers. Das matcht
        // "SalesHub 2b" <-> "SALESHUB2B MUNCHEN", "Raidboxes GmbH" <->
        // "CKO*RAIDBOXES.IO", "Meta" <-> "META *..." etc. Aber NICHT Meta <->
        // FACEBK — dort kommt die KI zum Zug.
        const issuerLower = (inv.issuer ?? "").toLowerCase();
        const issuerTokens = issuerLower.split(/[\s,.\-_/]+/).filter((t: string) => t.length >= 4);
        const descTokens = txDescLower.split(/[\s,.\-_/*]+/).filter((t: string) => t.length >= 4);
        for (const it of issuerTokens) {
          if (txDescLower.includes(it)) return true;
          for (const dt of descTokens) {
            if (it.includes(dt) || dt.includes(it)) return true;
          }
        }
        return false;
      });

      if (slamDunks.length === 1) {
        const pick = slamDunks[0];
        const reason = `Deterministisch: exakter Betrag ${pick.amount} + eindeutiger Aussteller-Match (${pick.issuer})`;
        const { error: upErr } = await supabaseClient
          .from("bank_transactions")
          .update({
            matched_invoice_id: pick.id,
            match_status: "confirmed",
            match_confidence: 100,
            match_reason: reason,
          })
          .eq("id", transaction.id);
        if (upErr) {
          dbUpdateErrors++;
          console.error(`DB update FAILED for tx ${transaction.id} (deterministic): ${upErr.message}`);
        } else {
          deterministicMatched++;
          matchedCount++;
          autoConfirmedCount++;
          matchedTransactions.push({
            transactionId: transaction.id,
            transactionDescription: transaction.description,
            transactionAmount: transaction.amount,
            transactionDate: transaction.date,
            invoiceId: pick.id,
            invoiceIssuer: pick.issuer,
            invoiceAmount: Number(pick.amount),
            invoiceDate: pick.date,
            confidence: 100,
            reason,
            source: "deterministic",
            status: "confirmed",
          });
          console.log(`DETERMINISTIC tx ${transaction.id} → invoice ${pick.id} (${pick.issuer} ${pick.amount})`);
        }
        continue;
      }

      if (potentialMatches.length >= 1) {
        // KI-Matching fuer mehrdeutige Faelle
        aiAttempted++;
        try {
          const buildPayload = () => ({
            model: llm.model,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `Du bist ein deutscher Buchhaltungs-Assistent, der Banktransaktionen Rechnungen zuordnet.

DEINE AUFGABE: Finde die WAHRSCHEINLICHSTE Rechnung aus der Kandidatenliste und gib eine EHRLICHE Confidence zurück. Die Applikation entscheidet auf Basis deiner Confidence selbst, was damit passiert — du sollst NICHT selbst entscheiden "das ist zu unsicher, ich gebe null zurück". Gib null NUR zurück, wenn wirklich KEINE der Kandidaten-Rechnungen inhaltlich zur Transaktion passt.

KRITERIEN (gewichtet):

1. AUSSTELLER vs. VERWENDUNGSZWECK (wichtigstes Signal):
   - Firmennamen variieren: "OpenAI" ↔ "OPENAI SAN FRANCISCO CA", "Hetzner" ↔ "HETZNER ONLINE GMBH NUERNBE", "Udemy Ireland Ltd" ↔ "UDEMYEU".
   - Rechtsformen (GmbH, Ltd, Inc., LLC), Standorte und Zahlungsdienstleister-Präfixe ("PAYPAL *…", "AMZN Mktp") ignorieren.
   - Der KERN des Firmennamens muss plausibel im Verwendungszweck auftauchen.

2. BETRAG:
   - Exakt (±0.01) → starkes Signal.
   - Bei Fremdwährung/FX bis ~10% Abweichung plausibel (SEPA in USD/GBP-Rechnung).
   - Reiner Betragstreffer ohne Name-Signal ist SCHWACH.

3. DATUM:
   - Rechnungsdatum typischerweise 0-45 Tage VOR der Transaktion.
   - Bei Abos: gleicher Tag oder ±wenige Tage wiederkehrend.

CONFIDENCE-SKALA (ehrlich ausfüllen, KEIN Selbst-Zensieren):
- 95-100: Aussteller passt eindeutig + Betrag exakt + Datum plausibel
- 70-94:  Aussteller passt klar, aber eine Dimension abweichend (Betrag leicht off ODER Datum weiter weg)
- 40-69:  Aussteller passt teilweise (nur Kern-Token), oder starker Betragstreffer ohne klaren Name
- 20-39:  Schwacher aber vorhandener Hinweis — trotzdem die beste Option von allen
- null + confidence 0: KEINE der Kandidaten-Rechnungen passt inhaltlich

WICHTIG: Die Applikation hat eine interne Schwelle. Du wirst deine Entscheidung NICHT damit "helfen" dass du knappe Matches auf null setzt — im Gegenteil, du machst es dadurch schlechter. Gib deine beste Option + ehrliche Confidence.

ANTWORT: NUR ein JSON-Objekt, keine Code-Fences, kein Fließtext:
{"matchedInvoiceId": <eine UUID aus der Kandidatenliste ODER null>, "confidence": <0-100>, "reason": "<ein kurzer deutscher Satz>"}`,
              },
              {
                role: "user",
                content: `### TRANSAKTION
- Datum: ${transaction.date}
- Verwendungszweck: ${transaction.description}
- Betrag (EUR): ${transactionAmount}${isAmexWithCurrencyConversion ? `\n- Foreign Spend Amount (original): ${matchAmount}` : ""}${transaction.original_currency ? `\n- Original-Currency-Info: ${transaction.original_currency}` : ""}

### KANDIDATEN-RECHNUNGEN
${potentialMatches.map((inv: any, i: number) => `${i + 1}. ID=${inv.id} | Aussteller: ${inv.issuer} | Betrag: ${inv.amount} ${inv.currency || "EUR"} | Datum: ${inv.date}${inv.invoice_number ? ` | Rech-Nr: ${inv.invoice_number}` : ""}`).join("\n")}

Wähle die plausibelste Rechnung aus dieser Liste (oder null) und gib deine Confidence ehrlich an.`,
              },
            ],
          });

          const doFetch = () =>
            fetchWithTimeout(
              `${llm.baseUrl}/chat/completions`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${llm.apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(buildPayload()),
              },
              OPENAI_TIMEOUT_MS,
            );

          let response = await doFetch();

          // Auto-Fallback: wenn das primaere Modell deprecated/entfernt wurde
          // (Google gibt 404 "no longer available"), einmal auf den Fallback
          // umschalten und diese Transaktion neu aufrufen. Der Switch bleibt
          // fuer den Rest des Invocation-Runs aktiv — alle weiteren TX nutzen
          // dann direkt das Fallback-Modell, ohne erneut 404 zu produzieren.
          if (response.status === 404 && llm.fallbackModel && llm.model !== llm.fallbackModel) {
            const deprecated = llm.model;
            llm.model = llm.fallbackModel;
            console.warn(
              `Model ${deprecated} returned 404 — switching to fallback ${llm.model} for rest of invocation`,
            );
            response = await doFetch();
          }

          if (response.ok) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;

            // Debug: erste 3 AI-Antworten pro Invocation verbatim loggen.
            // Unverzichtbar zum Debuggen von "0 Treffer" trott vieler Kandidaten.
            if (aiAttempted <= 3) {
              console.log(
                `[AI-DEBUG #${aiAttempted}] tx="${transaction.description}" (${matchAmount}) candidates=${potentialMatches.length} → content:`,
                (content ?? "").slice(0, 500),
              );
            }

            if (content) {
              try {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const result = JSON.parse(jsonMatch[0]);
                  aiSucceeded++;
                  if (aiAttempted <= 3) {
                    console.log(`[AI-DEBUG #${aiAttempted}] parsed:`, JSON.stringify(result));
                  }

                  // Validierung: invoiceId muss wirklich ein UUID aus der
                  // Kandidatenliste sein. trim() gegen ueberraschendes Whitespace.
                  const candidateIds = new Set(potentialMatches.map((c: any) => c.id));
                  const rawId = result.matchedInvoiceId;
                  const trimmedId = typeof rawId === "string" ? rawId.trim() : null;
                  const invoiceIdValid = trimmedId !== null && trimmedId !== "" && candidateIds.has(trimmedId);
                  const confRaw = result.confidence;
                  const confidenceNum =
                    typeof confRaw === "number" ? confRaw : typeof confRaw === "string" ? parseFloat(confRaw) : NaN;
                  const confidenceOk = Number.isFinite(confidenceNum);

                  // Separate Telemetrie: KI sagt "kein Match" vs. KI liefert
                  // muellige ID vs. KI liefert zu niedrige Confidence.
                  if (rawId === null || rawId === undefined) {
                    aiReturnedNull++;
                  } else if (!invoiceIdValid) {
                    aiRejectedInvalidId++;
                    console.warn(
                      `AI returned invalid invoiceId "${rawId}" for tx ${transaction.id} (not in candidate set)`,
                    );
                  } else if (!confidenceOk || confidenceNum < SUGGEST_THRESHOLD) {
                    aiRejectedLowConfidence++;
                  }

                  if (invoiceIdValid && confidenceOk && confidenceNum >= SUGGEST_THRESHOLD) {
                    const isAutoConfirm = confidenceNum >= AUTO_CONFIRM_THRESHOLD;
                    const newStatus = isAutoConfirm ? "confirmed" : "matched";

                    // ERROR-CHECK: das alte await ohne .error-Check hat Fehler
                    // (RLS, missing row, constraint violation) still verschluckt
                    // und dennoch matchedCount hochgezaehlt — Row blieb unmatched.
                    const { error: upErr } = await supabaseClient
                      .from("bank_transactions")
                      .update({
                        matched_invoice_id: trimmedId,
                        match_status: newStatus,
                        match_confidence: confidenceNum,
                        match_reason: result.reason ?? null,
                      })
                      .eq("id", transaction.id);

                    if (upErr) {
                      dbUpdateErrors++;
                      console.error(`DB update FAILED for tx ${transaction.id} (AI match): ${upErr.message}`);
                    } else {
                      console.log(
                        `${isAutoConfirm ? "AUTO-CONFIRMED" : "Matched"} transaction ${transaction.id} → invoice ${trimmedId} (${confidenceNum}%): ${result.reason}`,
                      );
                      matchedCount++;
                      if (isAutoConfirm) autoConfirmedCount++;
                      const matchedInv = potentialMatches.find((c: any) => c.id === trimmedId);
                      matchedTransactions.push({
                        transactionId: transaction.id,
                        transactionDescription: transaction.description,
                        transactionAmount: transaction.amount,
                        transactionDate: transaction.date,
                        invoiceId: trimmedId!,
                        invoiceIssuer: matchedInv?.issuer ?? "?",
                        invoiceAmount: Number(matchedInv?.amount ?? 0),
                        invoiceDate: matchedInv?.date ?? "",
                        confidence: confidenceNum,
                        reason: (result.reason ?? "").toString(),
                        source: "ai",
                        status: isAutoConfirm ? "confirmed" : "matched",
                      });
                    }
                    continue;
                  }
                }
              } catch (parseError: any) {
                aiParseErrors++;
                lastAiError = `parse: ${parseError?.message ?? parseError}`;
                console.error("Failed to parse AI response:", parseError);
              }
            } else {
              aiParseErrors++;
              lastAiError = "empty response content";
            }
          } else {
            aiHttpErrors++;
            const errBody = await response.text().catch(() => "");
            lastAiError = `http ${response.status}: ${errBody.slice(0, 200)}`;
            console.error("OpenAI HTTP error:", response.status, errBody.slice(0, 500));
          }
        } catch (aiError: any) {
          if (aiError?.name === "AbortError") {
            aiTimeouts++;
            lastAiError = `timeout after ${OPENAI_TIMEOUT_MS}ms`;
          } else {
            aiHttpErrors++;
            lastAiError = `fetch: ${aiError?.message ?? aiError}`;
          }
          console.error("AI matching error:", aiError);
        }
      }

      // Letzter Fallback: KI war nicht erreichbar ODER hat null geliefert,
      // und es gibt genau EINE Rechnung mit exaktem Betrag in der gesamten
      // (unmatched, dedupten) Invoice-Liste → eindeutiger Betragstreffer.
      const exactMatches = invoices.filter((inv: any) => Math.abs(matchAmount - inv.amount) < 0.01);
      if (exactMatches.length === 1) {
        const match = exactMatches[0];
        const { error: upErr } = await supabaseClient
          .from("bank_transactions")
          .update({
            matched_invoice_id: match.id,
            match_status: "confirmed",
            match_confidence: 100,
            match_reason: "Exakter Betragstreffer (eindeutig)",
          })
          .eq("id", transaction.id);
        if (upErr) {
          dbUpdateErrors++;
          console.error(`DB update FAILED for tx ${transaction.id} (amount-only fallback): ${upErr.message}`);
        } else {
          matchedCount++;
          autoConfirmedCount++;
          matchedTransactions.push({
            transactionId: transaction.id,
            transactionDescription: transaction.description,
            transactionAmount: transaction.amount,
            transactionDate: transaction.date,
            invoiceId: match.id,
            invoiceIssuer: match.issuer,
            invoiceAmount: Number(match.amount),
            invoiceDate: match.date,
            confidence: 100,
            reason: "Exakter Betragstreffer (eindeutig)",
            source: "amount-fallback",
            status: "confirmed",
          });
        }
        continue;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        // Version-Tag: bei "0 Treffer" sofort im Network-Tab erkennbar ob
        // ueberhaupt die neue Edge-Function-Version live ist.
        version: EDGE_VERSION,
        matchedCount,
        autoConfirmedCount,
        processedCount: transactions.length,
        totalUnmatched,
        remaining,
        ai: {
          provider: llm.provider,
          model: llm.model,
          attempted: aiAttempted,
          succeeded: aiSucceeded,
          timeouts: aiTimeouts,
          httpErrors: aiHttpErrors,
          parseErrors: aiParseErrors,
          lastError: lastAiError,
        },
        decisions: {
          deterministicMatched,
          noCandidates,
          aiReturnedNull,
          aiRejectedInvalidId,
          aiRejectedLowConfidence,
          dbUpdateErrors,
        },
        matchedTransactions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Auto-match error:", error);
    return new Response(JSON.stringify({ error: errorMessage, version: EDGE_VERSION }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

type LLMConfig = {
  provider: "gemini" | "openai";
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModel: string | null;
};

// Gemini bevorzugt (der User hat explizit darauf umgestellt). OpenAI nur als
// Fallback, damit ein altes Secret nicht sofort zu Downtime führt.
function resolveLLM(): LLMConfig | null {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) {
    return {
      provider: "gemini",
      apiKey: geminiKey,
      // Google stellt einen OpenAI-kompatiblen Endpoint unter /v1beta/openai bereit.
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      // gemini-2.5-flash-lite: neu, guenstig, schnell, kein Thinking-Mode by
      // default — ideal fuer strukturiertes JSON-Matching. gemini-2.0-flash ist
      // fuer neue API-Keys nicht mehr verfuegbar (404), 2.5-flash laeuft per
      // Default im teuren Thinking-Mode.
      model: Deno.env.get("LLM_MODEL") ?? "gemini-2.5-flash-lite",
      // gemini-flash-latest ist ein Alias auf das aktuell beste Flash-Modell.
      // Wenn das primaere Modell mit 404 deprecated wird, fallen wir darauf
      // zurueck — dann laeuft zumindest etwas, statt dass alle Matches ausfallen.
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
