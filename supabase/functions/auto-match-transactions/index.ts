import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// auto-match-transactions — Edge Function
// =============================================================================
// Pipeline pro Transaktion:
//   1. Cooldown-Check (Skip-Marker im match_reason ausgewertet)
//   2. Kandidaten-Liste berechnen (normalize + scoring)
//   3. Tier 1 — Slam-Dunk (deterministisch, kein AI-Call noetig)
//   4. Tier 2 — Strong-Fuzzy (deterministisch, hoher Score, klarer Vorsprung)
//   5. Tier 3 — AI-Match (mit Multi-Shot-Prompt + Sanity-Gate v2)
//   6. Bei Reject/Null: Skip-Marker als match_reason schreiben (Cooldown)
//
// Sektionen:
//   1) String Normalization & Similarity
//   2) Scoring (SubScores + combinedScore)
//   3) Tier 1 (Slam-Dunk) und Tier 2 (Strong-Fuzzy)
//   4) AI Match (Tier 3) inkl. SYSTEM_PROMPT_V2
//   5) Helpers (extractOriginalAmount, fetchAllPaginated, dedupInvoices, ...)
//   6) Sanity-Gate v2
//   7) Cooldown (Skip-Marker + Fingerprint)
//   8) Main Handler (Claim/Release, Pipeline-Loop, Telemetrie, Response)
//   9) LLM Resolve
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const MAX_TRANSACTIONS_PER_INVOCATION = 50;
// OpenAI/Gemini-Pro-Modelle sind langsamer als die alten Flash-Lite-Modelle —
// 30s gibt uns Spielraum, ohne den Edge-Function-Wall-Clock zu sprengen.
const OPENAI_TIMEOUT_MS = 30000;
const STALE_CLAIM_MS = 60 * 1000;

// Amount-Toleranz fuer Matching.
// Same-Currency (EUR <-> EUR) ist 5% — nur Rundung / Gebuehren erlaubt.
// FX-Faelle (original_currency != EUR) duerfen bis 10% abweichen, weil
// Wechselkurs-Spreads das rechtfertigen.
const AMOUNT_TOLERANCE_SAME_CURRENCY = 0.05;
const AMOUNT_TOLERANCE_FX = 0.10;

// Maximale Kandidaten pro TX, die wir dem LLM zumuten. Token-Budget:
// 12 ist nahe am Sweet-Spot zwischen Coverage und Halluzinations-Risiko.
const MAX_CANDIDATES_PER_TX = 12;

// Auto-Confirm-Schwelle. Tier 3 nimmt den Treffer nur, wenn Confidence
// >= 80 UND das Sanity-Gate gruenes Licht gibt. Davor war 95 — zu rigide,
// hat viele plausible Treffer (Token-Match + recentDate + amountInTolerance)
// rausgefiltert.
const AUTO_CONFIRM_THRESHOLD = 80;

// Pre-Filter-Schwelle: jede Invoice mit combinedScore < 30 fliegt aus dem
// Kandidaten-Pool, bevor der AI-Call ueberhaupt nachdenkt.
const SCORE_THRESHOLD_CANDIDATE = 30;

// Tier-2-Schwelle: ab combinedScore >= 90 + zusaetzlichen Constraints
// (siehe tier2StrongFuzzy) matchen wir deterministisch ohne AI.
const SCORE_THRESHOLD_TIER2 = 90;

// Tier-1-Schwelle: nameSim ueber diesem Wert ist quasi "Issuer steckt im
// Verwendungszweck". Wird in tier1SlamDunk als alternative Bedingung verwendet.
const SCORE_THRESHOLD_TIER1_NAME_SIM = 0.85;

// Cooldown: TX, die wir bereits abgelehnt haben (kein Match gefunden), nicht
// jeden Lauf neu durch den AI-Call schicken — solange sich die Invoice-Liste
// nicht geaendert hat.
const SKIP_COOLDOWN_DAYS = 14;

// Version-Tag. Bei jedem Code-Change hochzaehlen, damit das Frontend live
// nachvollziehen kann, ob die neue Edge-Function-Version auch wirklich aktiv ist.
const EDGE_VERSION = "2026-04-27-pipeline-v2-worker-pool";

// =============================================================================
// SECTION 1 — String Normalization & Similarity
// =============================================================================
//
// Banktransaktions-Verwendungszwecke sind notorisch verstuemmelt:
//   - Payment-Processor-Praefixe (PAYPAL *, STRIPE *, CKO*, ...)
//   - Marketplace-Praefixe (AMZN MKTP DE*...)
//   - Nationale SEPA-Praefixe (LASTSCHRIFT AUS KARTENZAHLUNG VOM ...)
//   - Sonderzeichen-Salat (* / | : ; # ~)
//
// Wir strippen diese Pattern in fester Reihenfolge case-insensitive vom
// Anfang des Strings, normalisieren dann auf lowercase + clean whitespace.
// Beide Varianten (raw + normalized) werden zurueckgegeben, weil das
// Sanity-Gate gegen den raw-String pruefen will (manche Issuer matchen
// nur auf den ungestrippten String — z.B. wenn der Issuer "Lastschrift"
// heisst, was extrem selten aber moeglich ist).
// -----------------------------------------------------------------------------

function normalizeDescription(raw: string): { raw: string; normalized: string } {
  if (!raw) return { raw: "", normalized: "" };

  // Strip-Patterns case-insensitive in Reihenfolge. Reihenfolge ist relevant:
  // erst die langen, spezifischen Patterns, dann die kurzen generischen.
  const stripPrefixPatterns: RegExp[] = [
    // Payment-Processor-Praefixe
    /^paypal\s*\*/i,
    /^stripe\s*\*/i,
    /^sq\s*\*/i,
    /^sp\s+/i,                  // Shopify
    /^cko\*/i,                  // Checkout.com
    /^chargebee\s*\*/i,
    /^zettle_\*?/i,
    /^aplpay\s+/i,
    /^applepay\s+/i,
    /^googlepay\s+/i,
    /^gpay\s+/i,
    /^samsungpay\s+/i,

    // Amazon-Marketplace-Variations
    /^amzn\s+mktp\s+(de|us|uk)\*?/i,
    /^amazon\s+mktp\s+(de|us|uk)\*?/i,
    /^amazon\s+mktp\s+\*?/i,
    /^amazon\.de\s*\*/i,
    /^amzn\s+digital\s*\*?/i,

    // SEPA / Kartenzahlung
    /^sepa[-:]?(lastschrift|ueberweisung|sammelzahlung)\s+/i,
    /^lastschrift\s+aus\s+kartenzahlung\s+vom\s+\d{2}\.\d{2}\.\d{4}\s+/i,
    /^kartenzahlung\s+/i,
    /^pos\s+/i,
  ];

  let working = raw;
  // Mehrfach durchlaufen, falls mehrere Praefixe gestapelt sind
  // (z.B. "SEPA-LASTSCHRIFT PAYPAL *NETFLIX")
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of stripPrefixPatterns) {
      const next = working.replace(p, "");
      if (next !== working) {
        working = next;
        changed = true;
      }
    }
  }

  // Lowercase
  let normalized = working.toLowerCase();
  // Sonderzeichen → Space
  normalized = normalized.replace(/[\*_\/\\|:;#~]/g, " ");
  // Whitespace collapse + trim
  normalized = normalized.replace(/\s+/g, " ").trim();

  return { raw, normalized };
}

// Bigram-Set: alle 2-Zeichen-Substrings, mit Padding fuer Wortgrenzen.
// Padding hilft bei kurzen Strings — sonst hat "udemy" nur 4 Bigrams,
// die mit grossen Strings kollidieren.
function bigrams(s: string): Set<string> {
  const padded = ` ${s} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 1; i++) {
    set.add(padded.slice(i, i + 2));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const x of a) {
    if (b.has(x)) intersect++;
  }
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

// nameSimilarity: 0..1, wie gut der Issuer im Verwendungszweck steckt.
//   - Substring-Match → 1.0
//   - Token-Substring-Boost (Issuer-Token >=4 chars als Substring in desc) → Floor 0.7
//   - Bigram-Jaccard mit Padding (Bonus fuer kurze Issuer: coverage statt jaccard)
function nameSimilarity(issuer: string, desc: string): number {
  if (!issuer || !desc) return 0;
  const issuerLower = issuer.toLowerCase().trim();
  const descLower = desc.toLowerCase();

  // Direkter Substring-Match → 1.0
  if (descLower.includes(issuerLower)) return 1.0;

  // Token-Substring-Boost: Issuer-Token >= 4 chars steckt als Substring in desc
  let tokenBoost = 0;
  const issuerTokens = issuerLower.split(/[\s,.\-_/]+/).filter((t) => t.length >= 4);
  for (const t of issuerTokens) {
    if (descLower.includes(t)) {
      tokenBoost = Math.max(tokenBoost, 0.7);
      break;
    }
  }

  // Bigram-Jaccard (mit Padding via bigrams())
  const issuerBigrams = bigrams(issuerLower);
  const descBigrams = bigrams(descLower);
  const j = jaccard(issuerBigrams, descBigrams);

  // Laengen-Penalty: bei sehr kurzen Issuern ist die Bigram-Schnittmenge
  // automatisch klein. Nutze coverage (issuer-bigrams in desc) / issuer-bigrams.size.
  if (issuerLower.length <= 6) {
    let inDesc = 0;
    for (const bg of issuerBigrams) {
      if (descBigrams.has(bg)) inDesc++;
    }
    const coverage = issuerBigrams.size === 0 ? 0 : inDesc / issuerBigrams.size;
    return Math.max(j, tokenBoost, coverage * 0.85);
  }

  return Math.max(j, tokenBoost);
}

// =============================================================================
// SECTION 2 — Scoring
// =============================================================================
// Pre-LLM-Scoring fuer Pre-Filter und Tier-2.
// Vier Sub-Scores (jeweils 0..1), gewichtete Summe = combinedScore (0..100).
// -----------------------------------------------------------------------------

type SubScores = {
  nameSim: number; // 0-1
  amountQuality: number; // 0-1
  dateProximity: number; // 0-1
  invoiceNumberInDesc: number; // 0 oder 1
};

function amountQuality(matchAmt: number, invAmt: number, tolerance: number): number {
  const diff = Math.abs(matchAmt - invAmt);
  const tolAbs = Math.max(matchAmt, invAmt) * tolerance;
  if (diff < 0.01) return 1.0;
  if (tolAbs <= 0) return 0;
  if (diff <= tolAbs) return 1 - 0.5 * (diff / tolAbs); // 0.5..1
  if (diff <= tolAbs * 2) return 0.3 - 0.2 * ((diff - tolAbs) / tolAbs); // 0.1..0.3
  return 0;
}

function dateProximity(txDate: string, invDate: string): number {
  if (!txDate || !invDate) return 0;
  const txTime = new Date(txDate).getTime();
  const invTime = new Date(invDate).getTime();
  if (!Number.isFinite(txTime) || !Number.isFinite(invTime)) return 0;
  const delta = (txTime - invTime) / 86400000;
  // delta > 0 = invoice VOR transaction (normal)
  // delta < 0 = invoice NACH transaction (selten, z.B. Pre-Auth)
  if (delta >= -7 && delta <= 45) return 1.0;
  if (delta >= -14 && delta <= 90) return 0.8;
  if (delta >= -30 && delta <= 120) return 0.5;
  if (delta >= -45 && delta <= 180) return 0.2;
  return 0;
}

function invoiceNumberInDesc(invNum: string | null | undefined, normalizedDesc: string): number {
  if (!invNum) return 0;
  const num = invNum.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (num.length < 5) return 0;
  const desc = normalizedDesc.toLowerCase().replace(/[^a-z0-9]/g, "");
  return desc.includes(num) ? 1 : 0;
}

function combinedScore(subs: SubScores): number {
  return (
    100 *
    (0.45 * subs.nameSim +
      0.35 * subs.amountQuality +
      0.10 * subs.dateProximity +
      0.10 * subs.invoiceNumberInDesc)
  );
}

function resolveAmountTolerance(transaction: any): number {
  const origCcyRaw = (transaction?.original_currency ?? "").toString();
  const hasForeignCurrency = origCcyRaw.trim().length > 0 && !/\bEUR\b/i.test(origCcyRaw);
  return hasForeignCurrency ? AMOUNT_TOLERANCE_FX : AMOUNT_TOLERANCE_SAME_CURRENCY;
}

// Token-Match-Helper: prueft, ob mind. ein Issuer-Token (>=minLen Zeichen)
// als Substring in der Description steckt.
function issuerTokenInDesc(issuer: string, desc: string, minLen = 4): boolean {
  const issuerLower = (issuer ?? "").toLowerCase();
  const descLower = (desc ?? "").toLowerCase();
  const tokens = issuerLower.split(/[\s,.\-_/]+/).filter((t) => t.length >= minLen);
  return tokens.some((t) => descLower.includes(t));
}

// =============================================================================
// SECTION 3 — Tier 1 (Slam-Dunk) und Tier 2 (Strong-Fuzzy)
// =============================================================================
// Tier 1 ("Slam-Dunk"):
//   genau 1 Kandidat erfuellt alle:
//     - exakter Betrag (diff < 0.01)
//     - mind. eines: nameSim >= 0.85, ODER issuerToken (>=5 chars) in desc,
//       ODER invoiceNumberInDesc
//     - dateProximity > 0
//
// Tier 2 ("Strong-Fuzzy"):
//   genau 1 Kandidat hat:
//     - combinedScore >= 90
//     - Betrag in Toleranz
//     - dateProximity > 0
//   UND der naechstbeste hat mind. 25 Punkte combinedScore weniger.
// -----------------------------------------------------------------------------

type ScoredCandidate = {
  invoice: any;
  subs: SubScores;
  combined: number;
  exactAmount: boolean;
  amountInTolerance: boolean;
};

type DeterministicMatch = {
  invoice: any;
  tier: "t1" | "t2";
  confidence: number;
  reason: string;
};

function tier1SlamDunk(scored: ScoredCandidate[], normalizedDesc: string): DeterministicMatch | null {
  const eligible: ScoredCandidate[] = [];

  for (const c of scored) {
    if (!c.exactAmount) continue;
    if (c.subs.dateProximity <= 0) continue;

    const issuer = (c.invoice.issuer ?? "").toString();
    // Token >= 5 chars in desc
    const issuerTokens5 = issuer.toLowerCase().split(/[\s,.\-_/]+/).filter((t) => t.length >= 5);
    const tokenHit = issuerTokens5.some((t) => normalizedDesc.toLowerCase().includes(t));

    const condition =
      c.subs.nameSim >= SCORE_THRESHOLD_TIER1_NAME_SIM ||
      tokenHit ||
      c.subs.invoiceNumberInDesc > 0;

    if (condition) eligible.push(c);
  }

  if (eligible.length !== 1) return null;
  const pick = eligible[0];
  return {
    invoice: pick.invoice,
    tier: "t1",
    confidence: 100,
    reason: `Tier-1 Slam-Dunk: exakter Betrag ${pick.invoice.amount} + eindeutiger Aussteller-Match (${pick.invoice.issuer})`,
  };
}

function tier2StrongFuzzy(scored: ScoredCandidate[]): DeterministicMatch | null {
  // Sortieren nach combinedScore desc
  const sorted = [...scored].sort((a, b) => b.combined - a.combined);
  if (sorted.length === 0) return null;
  const top = sorted[0];

  if (top.combined < SCORE_THRESHOLD_TIER2) return null;
  if (!top.amountInTolerance) return null;
  if (top.subs.dateProximity <= 0) return null;

  // 2nd-best mind. 25 Punkte schlechter
  if (sorted.length > 1) {
    const second = sorted[1];
    if (top.combined - second.combined < 25) return null;
  }

  return {
    invoice: top.invoice,
    tier: "t2",
    confidence: Math.min(99, Math.round(top.combined)),
    reason: `Tier-2 Strong-Fuzzy: Score ${Math.round(top.combined)}/100 (nameSim=${top.subs.nameSim.toFixed(2)}, amountQ=${top.subs.amountQuality.toFixed(2)}, dateProx=${top.subs.dateProximity.toFixed(2)})`,
  };
}

// =============================================================================
// SECTION 4 — AI Match (Tier 3): SYSTEM_PROMPT_V2
// =============================================================================
// Multi-Shot-Prompt mit Beispielen A-G. Wichtig: das LLM ist NICHT der
// Gatekeeper — es soll ehrlich confidence + signals liefern, das Sanity-Gate
// in der App entscheidet final.
// -----------------------------------------------------------------------------

const SYSTEM_PROMPT_V2 = `Du bist ein deutscher Buchhaltungs-Assistent. Du ordnest EINE Banktransaktion einer von mehreren Kandidaten-Rechnungen zu.

WICHTIGE REGELN
1. Du gibst NUR UUIDs zurück, die EXAKT in der Kandidatenliste stehen. Niemals erfinden, niemals abwandeln. Wenn keine passt: matchedInvoiceId=null.
2. Du gibst die Confidence ehrlich an. Die Anwendung hat die finale Schwelle — du bist NICHT der Gatekeeper.
3. Du antwortest mit GENAU EINEM JSON-Objekt, keine Code-Fences, kein Vortext, kein Nachtext.

HINTERGRUNDWISSEN: PAYMENT-PROCESSOR-PRÄFIXE
Banktransaktionen tragen oft Präfixe vom Zahlungsdienstleister, NICHT vom eigentlichen Empfänger. Strippe sie mental:
- "PAYPAL *NETFLIX" -> Empfänger ist Netflix
- "STRIPE *ANTHROPIC" -> Empfänger ist Anthropic
- "STRIPE *MIDJOURNE" -> Midjourney
- "CKO*RAIDBOXES.IO" -> Raidboxes (CKO = Checkout.com)
- "SQ *KAFFEEHAUS" -> Square-Akzeptanzstelle Kaffeehaus
- "AplPay APPLE.COM/BILL" -> Apple
- "AMZN Mktp DE*1A2B3" -> Amazon Marketplace, konkreter Händler oft nicht erkennbar
- "LASTSCHRIFT AUS KARTENZAHLUNG VOM 14.03.2026 X" -> X
- "SEPA-LASTSCHRIFT X" -> X

HINTERGRUNDWISSEN: VERBATIM-ALIAS-MAPPING
Manche Empfänger erscheinen verstümmelt:
- "FACEBK *XYZ" / "FACEBOOK *XYZ" -> Meta Platforms (Rechnungs-Aussteller meist "Meta Platforms Ireland Limited" oder "Meta")
- "UDEMYEU" / "UDEMY-DUBLIN" -> Udemy (Rechnung oft "Udemy Ireland Limited")
- "OPENAI SAN FRANCISCO CA" / "OPENAI *CHATGPT SUBSCR" -> OpenAI
- "GITHUB INC" / "GITHUB.COM/BILL" -> GitHub
- "HETZNER ONLINE GMBH NUERNBE" -> Hetzner
- "AMAZON WEB SERVICES" / "AWS EMEA" -> Amazon Web Services
- "GOOGLE *GSUITE" / "GOOGLE *CLOUD" -> Google (je nach Produkt)
- "MICROSOFT*OFFICE" / "MSFT *AZURE" -> Microsoft

KRITERIEN FÜR EINEN MATCH (gewichtet absteigend)
1. Aussteller-Match: Der Kern-Firmenname der Rechnung muss plausibel im (mental gestrippten) Verwendungszweck stecken. Rechtsformen (GmbH/Ltd/Inc/LLC), Standorte, Steuer-IDs ignorieren.
2. Betrag: Exakt (±0.01 EUR) ist ein starkes Signal. Bei Fremdwährung sind ~10% Abweichung durch Wechselkurs-Spread normal.
3. Datum: Rechnung ist meist 0-45 Tage VOR der Buchung. Bei Abos auch gleicher Tag.
4. Rechnungsnummer im Verwendungszweck: extrem starkes Signal wenn vorhanden.

CONFIDENCE-SKALA (ehrlich!)
- 95-100: Aussteller eindeutig + Betrag exakt + Datum plausibel
- 80-94:  Aussteller passt klar, EINE Dimension leicht off (Betrag bis Toleranz, Datum bis 90 Tage)
- 60-79:  Aussteller passt nur teilweise (Token-Match), oder Betrag exakt aber Name schwach
- 30-59:  Schwacher Hinweis, aber die beste Option in der Liste
- 0-29:   Keine plausible Übereinstimmung
- null:   KEINE der Kandidaten-Rechnungen passt inhaltlich

ANTWORTSCHEMA
{"matchedInvoiceId": <UUID-aus-Liste-oder-null>, "confidence": <0-100 Integer>, "reason": "<deutscher Satz, max. 200 Zeichen>", "signals": {"issuerMatch": <true|false>, "amountExact": <true|false>, "dateInWindow": <true|false>, "invoiceNumberHit": <true|false>}}

Das \`signals\`-Feld nutzt die App fuer das Sanity-Gate. Sei ehrlich.

BEISPIELE (illustrativ, nicht in der Kandidatenliste enthalten)

Beispiel A — Klassisches Aliasing
Transaktion: "FACEBK *MJ9Y3K2" 47.30 EUR am 2026-03-15
Kandidat 1: ID=aaa Aussteller="Meta Platforms Ireland Limited" 47.30 EUR am 2026-03-12 Rech-Nr=FB-2026-839
Antwort: {"matchedInvoiceId":"aaa","confidence":95,"reason":"FACEBK ist Meta-Aussteller, Betrag exakt, 3 Tage Differenz","signals":{"issuerMatch":true,"amountExact":true,"dateInWindow":true,"invoiceNumberHit":false}}

Beispiel B — Stripe-Präfix
Transaktion: "STRIPE *ANTHROPIC" 22.43 EUR am 2026-04-02
Kandidat 1: ID=bbb Aussteller="Anthropic, PBC" 22.43 EUR am 2026-04-01
Antwort: {"matchedInvoiceId":"bbb","confidence":98,"reason":"STRIPE-Vorspann, Anthropic eindeutig, Betrag exakt, 1 Tag Differenz","signals":{"issuerMatch":true,"amountExact":true,"dateInWindow":true,"invoiceNumberHit":false}}

Beispiel C — Hetzner mit Long-Form
Transaktion: "HETZNER ONLINE GMBH NUERNBE" 14.99 EUR am 2026-03-08
Kandidat 1: ID=ccc Aussteller="Hetzner Online GmbH" 14.99 EUR am 2026-03-01 Rech-Nr=R-12345
Antwort: {"matchedInvoiceId":"ccc","confidence":99,"reason":"Aussteller identisch, Betrag exakt","signals":{"issuerMatch":true,"amountExact":true,"dateInWindow":true,"invoiceNumberHit":false}}

Beispiel D — Udemy-Aliasing
Transaktion: "UDEMYEU" 11.99 EUR am 2026-02-20
Kandidat 1: ID=ddd Aussteller="Udemy Ireland Limited" 11.99 EUR am 2026-02-19
Antwort: {"matchedInvoiceId":"ddd","confidence":97,"reason":"UDEMYEU = Udemy Ireland, Betrag exakt","signals":{"issuerMatch":true,"amountExact":true,"dateInWindow":true,"invoiceNumberHit":false}}

Beispiel E — OpenAI Long-Form (FX)
Transaktion: "OPENAI SAN FRANCISCO CA" 18.74 EUR am 2026-04-10 (FX, original 20 USD)
Kandidat 1: ID=eee Aussteller="OpenAI, LLC" 20.00 USD am 2026-04-08
Antwort: {"matchedInvoiceId":"eee","confidence":92,"reason":"OpenAI eindeutig, USD-Betrag exakt zur Original-Currency","signals":{"issuerMatch":true,"amountExact":true,"dateInWindow":true,"invoiceNumberHit":false}}

Beispiel F — Kein Match
Transaktion: "REWE SAGT DANKE 12345" 23.40 EUR
Kandidaten (3 Stück, alle unrelated SaaS-Rechnungen)
Antwort: {"matchedInvoiceId":null,"confidence":0,"reason":"Supermarkt-Einkauf, keine passende Rechnung in der Liste","signals":{"issuerMatch":false,"amountExact":false,"dateInWindow":false,"invoiceNumberHit":false}}

Beispiel G — Falsche Versuchung (Betrag zufällig nahe)
Transaktion: "HONORIS FINANCE" 29.90 EUR
Kandidat 1: ID=fff Aussteller="Raidboxes GmbH" 29.95 EUR
Antwort: {"matchedInvoiceId":null,"confidence":0,"reason":"Aussteller komplett verschieden, knapper Betrag ist Zufall","signals":{"issuerMatch":false,"amountExact":false,"dateInWindow":false,"invoiceNumberHit":false}}`;

// AI-Response-Schema (typed)
type AIResult = {
  matchedInvoiceId: string | null;
  confidence: number;
  reason: string;
  signals?: {
    issuerMatch?: boolean;
    amountExact?: boolean;
    dateInWindow?: boolean;
    invoiceNumberHit?: boolean;
  };
};

// =============================================================================
// SECTION 5 — Helpers
// =============================================================================

// Supabase begrenzt Selects standardmaessig auf 1000 Rows. Pagination, sonst
// verschwinden bei grossen Datensaetzen sowohl TX als auch already-matched
// Invoice-IDs aus der Sicht der Function.
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

// Pre-LLM-Dedup der Invoice-Kandidaten. Bei identischen Duplikat-Rechnungen
// (gleicher Inhalt, doppelt ingested) wuerde das LLM zufaellig eine Kopie waehlen.
function dedupInvoices(invoices: any[]): any[] {
  const norm = (s: string | null | undefined) =>
    (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const pickOldest = (group: any[]) => {
    group.sort(
      (a, b) =>
        new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
    );
    return group[0];
  };

  // Pass 1: file_hash-Dedup
  const afterHash: any[] = [];
  const hashGroups = new Map<string, any[]>();
  for (const inv of invoices) {
    if (inv.file_hash) {
      const g = hashGroups.get(inv.file_hash) || [];
      g.push(inv);
      hashGroups.set(inv.file_hash, g);
    } else {
      afterHash.push(inv);
    }
  }
  for (const group of hashGroups.values()) {
    afterHash.push(pickOldest(group));
  }

  // Pass 2: Metadaten-Dedup
  const keyOf = (inv: any) => {
    const num = norm(inv.invoice_number);
    if (num.length >= 3) return `num:${num}|${Math.round(Number(inv.amount) * 100)}`;
    return `meta:${inv.date}|${norm(inv.issuer)}|${Math.round(Number(inv.amount) * 100)}`;
  };
  const groups = new Map<string, any[]>();
  for (const inv of afterHash) {
    const k = keyOf(inv);
    const g = groups.get(k) || [];
    g.push(inv);
    groups.set(k, g);
  }
  const result: any[] = [];
  for (const group of groups.values()) {
    result.push(pickOldest(group));
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

// extractOriginalAmount: parse Amex-FX-Field. Mehrere Formate, robust ggü.
// Komma/Punkt-Decimal und Variationen.
function extractOriginalAmount(originalCurrency: string | null): number | null {
  if (!originalCurrency) return null;

  // "Foreign Spend Amount: X.XX"
  const foreignSpendMatch = originalCurrency.match(/Foreign Spend Amount:\s*([\d,.]+)/i);
  if (foreignSpendMatch) {
    const amountStr = foreignSpendMatch[1].replace(",", ".");
    const amount = parseFloat(amountStr);
    if (!isNaN(amount)) return amount;
  }

  // "X.XX CCY"
  const simpleMatch = originalCurrency.match(/^([\d,.]+)\s*[A-Z]{3}/i);
  if (simpleMatch) {
    const amountStr = simpleMatch[1].replace(",", ".");
    const amount = parseFloat(amountStr);
    if (!isNaN(amount)) return amount;
  }

  // Number gefolgt von Currency-Code/Name
  const anyMatch = originalCurrency.match(/([\d,.]+)\s*(?:US Dollars|USD|EUR|GBP|CHF|JPY)/i);
  if (anyMatch) {
    const amountStr = anyMatch[1].replace(",", ".");
    const amount = parseFloat(amountStr);
    if (!isNaN(amount)) return amount;
  }

  return null;
}

// =============================================================================
// SECTION 6 — Sanity-Gate v2
// =============================================================================
//
// Schutzwall gegen LLM-Halluzinationen.
// Hard-Gate: Betrag MUSS in Toleranz liegen — egal was LLM behauptet.
// Soft-Gate: Signal-Score-System.
//   Strong-Signals (je 1 Punkt): exactAmount, highStringSim, issuerTokenInDesc,
//                                aiSignalsAgree (issuerMatch=true) bei conf>=90
//   Halbpunkt: recentDate (dateProximity >= 0.5)
//   Required Score: 1.5 wenn aiConfidence >= 90, sonst 2.0
//
// Sonderfall: invoiceNumberInDesc → hard-pass (ueberschreibt alle anderen Soft-
// Gates), Betrag-Hard-Gate gilt aber weiter.
// -----------------------------------------------------------------------------

type SanityArgs = {
  exactAmount: boolean;
  amountInTolerance: boolean;
  highStringSim: boolean;
  issuerTokenInDesc: boolean;
  recentDate: boolean;
  invoiceNumberInDesc: boolean;
  aiSignalsAgree: boolean;
  aiConfidence: number;
};

type SanityResult = {
  pass: boolean;
  breakdown: { hardGateAmount: boolean; insufficientSignals: boolean };
};

function passesSanityV2(args: SanityArgs): SanityResult {
  if (!args.amountInTolerance) {
    return {
      pass: false,
      breakdown: { hardGateAmount: true, insufficientSignals: false },
    };
  }
  if (args.invoiceNumberInDesc) {
    return {
      pass: true,
      breakdown: { hardGateAmount: false, insufficientSignals: false },
    };
  }

  let strongSignals = 0;
  if (args.exactAmount) strongSignals++;
  if (args.highStringSim) strongSignals++;
  if (args.issuerTokenInDesc) strongSignals++;
  if (args.aiSignalsAgree && args.aiConfidence >= 90) strongSignals++;

  const signalScore = strongSignals + (args.recentDate ? 0.5 : 0);
  const required = args.aiConfidence >= 90 ? 1.5 : 2.0;

  return {
    pass: signalScore >= required,
    breakdown: {
      hardGateAmount: false,
      insufficientSignals: signalScore < required,
    },
  };
}

// =============================================================================
// SECTION 7 — Cooldown (Skip-Marker + Fingerprint)
// =============================================================================
//
// Format: [auto-skip:YYYY-MM-DD:reason:fp=n=N;u=TIMESTAMP]
//   reason: "no-candidates" | "ai-no-match" | "sanity-rejected"
//   fp: Invoice-Fingerprint, damit der Cooldown bricht, sobald sich der
//       Invoice-Pool aendert.
//
// Cooldown wird ueber zwei Mechanismen erzwungen:
//   1. Cleanup-Pass am Anfang der Invocation: Marker mit Datum < cutoff oder
//      mit anderem Fingerprint werden geloescht (match_reason auf NULL).
//   2. Claim-Filter: TX mit `match_reason LIKE '[auto-skip:%'` werden gar
//      nicht erst claimed.
// Damit ist der TX-Loop selbst cooldown-frei — alles, was reinkommt, wird
// auch verarbeitet.
// -----------------------------------------------------------------------------

function fingerprintInvoices(invoices: any[]): string {
  const count = invoices.length;
  const maxUpdated = invoices.reduce((m: number, i: any) => {
    const t = new Date(i.updated_at ?? i.created_at ?? 0).getTime();
    return Number.isFinite(t) ? Math.max(m, t) : m;
  }, 0);
  return `n=${count};u=${maxUpdated}`;
}

function buildSkipMarker(
  reason: "no-candidates" | "ai-no-match" | "sanity-rejected",
  fingerprint: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  return `[auto-skip:${today}:${reason}:fp=${fingerprint}]`;
}

// =============================================================================
// SECTION 8 — Main Handler
// =============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Hoisted damit der Catch-Block im Fehlerfall noch Claims releasen kann.
  let supabaseClient: ReturnType<typeof createClient> | null = null;
  let claimedForCleanup: any[] = [];

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: { headers: { Authorization: authHeader } },
      },
    );

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      throw new Error("Not authenticated");
    }

    // Optional Body: { txIds?: string[] }
    // Wenn das Frontend explizit eine Liste mitliefert, ueberspringen wir die
    // SELECT-Race komplett — der Caller hat die Arbeit schon disjunkt
    // partitioniert. Ohne txIds laeuft die alte Logik (Legacy-Modus).
    let providedTxIds: string[] | null = null;
    try {
      const body = await req.json();
      if (body && Array.isArray(body.txIds) && body.txIds.length > 0) {
        // String-only und auf MAX limitieren, damit Wallclock im Rahmen bleibt
        providedTxIds = body.txIds
          .filter((x: unknown) => typeof x === "string")
          .slice(0, MAX_TRANSACTIONS_PER_INVOCATION);
      }
    } catch {
      // kein body / kein json — Legacy-Modus
    }

    // -----------------------------------------------------------------------
    // PARALLEL-SAFE CLAIM
    // -----------------------------------------------------------------------
    // (a) Stale-Recovery
    // (b) Cooldown-Maintenance: stale Skip-Marker raeumen, bevor sie den
    //     Claim-Filter unnoetig blocken
    // (c) Invoice-Fetch + Fingerprint frueher, damit (b) Fingerprint-Mismatches
    //     erkennen kann
    // (d) Kandidaten oversamplen — JETZT mit Filter "kein aktiver Skip-Marker"
    // (e) Atomischer UPDATE unmatched -> ai_processing
    // (f) Optional Second-Try
    //
    // Damit landen cooldown'd TX gar nicht erst in der Verarbeitung. Das
    // verhindert (1) den Wave-Loop ohne Fortschritt im Frontend und (2) dass
    // updated_at fuer cooldown'd TX bei jedem Run gebumped wird (= keine
    // visuelle Reshuffle der Liste).
    // -----------------------------------------------------------------------

    // (a) Stale-Recovery
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const { error: staleErr } = await supabaseClient
      .from("bank_transactions")
      .update({ match_status: "unmatched" })
      .eq("match_status", "ai_processing")
      .lt("updated_at", staleBefore);
    if (staleErr) console.warn("Stale-claim release failed (non-fatal):", staleErr.message);

    // (b+c) Invoices vorab laden, Fingerprint berechnen, dann stale Skip-Marker
    // raeumen. Das geht VOR dem Claim, weil der Claim-Filter spaeter die noch
    // vorhandenen Marker als "active cooldown" interpretiert.
    const allInvoicesRawEarly = await fetchAllPaginated<any>(() =>
      supabaseClient!.from("invoices").select("*"),
    );
    const matchedInvoiceIdRowsEarly = await fetchAllPaginated<any>(() =>
      supabaseClient!
        .from("bank_transactions")
        .select("matched_invoice_id")
        .not("matched_invoice_id", "is", null),
    );
    const alreadyMatchedIdsEarly = new Set(
      matchedInvoiceIdRowsEarly.map((t: any) => t.matched_invoice_id),
    );
    const invoicesUnmatchedEarly = allInvoicesRawEarly.filter(
      (inv: any) => !alreadyMatchedIdsEarly.has(inv.id),
    );
    const invoicesEarly = dedupInvoices(invoicesUnmatchedEarly);
    const invoiceFingerprintEarly = fingerprintInvoices(invoicesEarly);

    // Cooldown-Cleanup Pass 1: alle Marker mit Datum aelter als Cutoff loeschen.
    // Dadurch werden TX, deren Cooldown abgelaufen ist, beim naechsten Claim
    // wieder als regulaere unmatched-TX behandelt.
    const cooldownCutoffDate = new Date(Date.now() - SKIP_COOLDOWN_DAYS * 86400000)
      .toISOString()
      .slice(0, 10);
    const cooldownCutoffMarker = `[auto-skip:${cooldownCutoffDate}`;
    // Lexicographic compare auf "[auto-skip:YYYY-MM-DD" funktioniert weil
    // unsere Marker immer mit diesem Prefix-Format starten.
    const { error: clearStaleErr } = await supabaseClient
      .from("bank_transactions")
      .update({ match_reason: null })
      .eq("match_status", "unmatched")
      .like("match_reason", "[auto-skip:%")
      .lt("match_reason", cooldownCutoffMarker);
    if (clearStaleErr) {
      console.warn("Cooldown-Cleanup (date) fehlgeschlagen (non-fatal):", clearStaleErr.message);
    }

    // Cooldown-Cleanup Pass 2: Marker mit Fingerprint-Mismatch loeschen.
    // PostgREST kann kein "endsWith"-Filter; wir holen die Marker und filtern
    // client-side. Bei realistischer Backlog-Groesse (≤300 cooldown'd TX) ist
    // das cheap.
    const { data: markerRows, error: markerFetchErr } = await supabaseClient
      .from("bank_transactions")
      .select("id, match_reason")
      .eq("match_status", "unmatched")
      .like("match_reason", "[auto-skip:%");
    let cooldownClearedFingerprint = 0;
    if (markerFetchErr) {
      console.warn("Cooldown-Marker-Fetch fehlgeschlagen (non-fatal):", markerFetchErr.message);
    } else if (markerRows && markerRows.length > 0) {
      const expectedSuffix = `:fp=${invoiceFingerprintEarly}]`;
      const staleByFingerprint = (markerRows as Array<{ id: string; match_reason: string | null }>)
        .filter((r) => r.match_reason && !r.match_reason.endsWith(expectedSuffix))
        .map((r) => r.id);
      if (staleByFingerprint.length > 0) {
        const { error: clearFpErr } = await supabaseClient
          .from("bank_transactions")
          .update({ match_reason: null })
          .in("id", staleByFingerprint);
        if (clearFpErr) {
          console.warn("Cooldown-Cleanup (fingerprint) fehlgeschlagen (non-fatal):", clearFpErr.message);
        } else {
          cooldownClearedFingerprint = staleByFingerprint.length;
        }
      }
    }

    // (d) Kandidaten ermitteln. Zwei Modi:
    //   - body.txIds gegeben (NEUER Modus, vom Frontend-Worker-Pool):
    //     wir nehmen die Liste 1:1, der Caller hat das Splitting schon gemacht.
    //   - sonst (Legacy / curl): SELECT mit Date-DESC-Order, mit Filter
    //     "kein aktiver Skip-Marker" + Oversampling.
    let candidateIds: string[];
    if (providedTxIds && providedTxIds.length > 0) {
      candidateIds = providedTxIds;
    } else {
      const CLAIM_OVERSAMPLE = MAX_TRANSACTIONS_PER_INVOCATION * 2;
      const { data: candidateRows, error: candErr } = await supabaseClient
        .from("bank_transactions")
        .select("id")
        .eq("match_status", "unmatched")
        .or("match_reason.is.null,match_reason.not.like.[auto-skip:*")
        .order("date", { ascending: false })
        .limit(CLAIM_OVERSAMPLE);
      if (candErr) throw candErr;
      candidateIds = (candidateRows || []).map((r: any) => r.id);
    }

    let claimed: any[] = [];
    if (candidateIds.length > 0) {
      const toClaim = candidateIds.slice(0, MAX_TRANSACTIONS_PER_INVOCATION);
      // Im txIds-Modus filtern wir trotzdem nochmal auf "kein aktiver
      // Skip-Marker" als Defense-in-Depth: falls das Frontend eine Liste vor
      // einem Cooldown-Cleanup geschickt hat, werden cooldown'd TX hier
      // nicht versehentlich nochmal angefasst.
      const { data: claimResult, error: claimErr } = await supabaseClient
        .from("bank_transactions")
        .update({ match_status: "ai_processing" })
        .eq("match_status", "unmatched")
        .or("match_reason.is.null,match_reason.not.like.[auto-skip:*")
        .in("id", toClaim)
        .select("*, bank_statements(bank_type)");
      if (claimErr) throw claimErr;
      claimed = claimResult || [];
    }

    // (f) Second-Try nur im Legacy-Modus (txIds-Modus liefert disjunkte Listen
    // — kein Race, kein Second-Try noetig). Im Legacy-Modus retry mit dem
    // ZWEITEN Slice von candidateIds (nicht dem ersten — sonst probiert die
    // Function dieselben IDs nochmal).
    if (
      !providedTxIds &&
      claimed.length < MAX_TRANSACTIONS_PER_INVOCATION / 2 &&
      candidateIds.length > MAX_TRANSACTIONS_PER_INVOCATION
    ) {
      const claimedSet = new Set(claimed.map((t: any) => t.id));
      const rest = candidateIds
        .slice(MAX_TRANSACTIONS_PER_INVOCATION)
        .filter((id: string) => !claimedSet.has(id))
        .slice(0, MAX_TRANSACTIONS_PER_INVOCATION - claimed.length);
      if (rest.length > 0) {
        const { data: secondClaim, error: secondErr } = await supabaseClient
          .from("bank_transactions")
          .update({ match_status: "ai_processing" })
          .eq("match_status", "unmatched")
          .or("match_reason.is.null,match_reason.not.like.[auto-skip:*")
          .in("id", rest)
          .select("*, bank_statements(bank_type)");
        if (secondErr) console.warn("Second-try claim failed (non-fatal):", secondErr.message);
        else if (secondClaim) claimed.push(...secondClaim);
      }
    }

    const allTransactions = claimed;
    claimedForCleanup = claimed;

    // Release-Helper (alle Pfade muessen ihn aufrufen)
    const releaseUnmatchedClaims = async (matchedIds: Set<string>) => {
      const toRelease = claimed
        .filter((t: any) => !matchedIds.has(t.id))
        .map((t: any) => t.id);
      if (toRelease.length === 0) return;
      const { error } = await supabaseClient!
        .from("bank_transactions")
        .update({ match_status: "unmatched" })
        .eq("match_status", "ai_processing")
        .in("id", toRelease);
      if (error) console.error("Release of unmatched claims failed:", error.message);
    };

    // Invoice-Liste fuer den TX-Loop wieder verwenden (frueher in (b+c) geladen).
    const allInvoicesRaw = allInvoicesRawEarly;
    const invoicesAfterMatchFilter = invoicesUnmatchedEarly;
    const invoices = invoicesEarly;
    console.log(
      `Invoices: ${allInvoicesRaw.length} total → ${invoicesAfterMatchFilter.length} unmatched → ${invoices.length} after dedup`,
    );

    // Backlog-Counter — `remaining` ist die ECHTE Restarbeit fuer den naechsten
    // Frontend-Wave (cooldown'd TX zaehlen NICHT mit, weil sie eh nicht
    // claimed werden). Damit terminiert der Frontend-Loop natuerlich, sobald
    // nur noch cooldown'd TX uebrig sind.
    const { count: unmatchedActiveAfterClaim } = await supabaseClient
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("match_status", "unmatched")
      .or("match_reason.is.null,match_reason.not.like.[auto-skip:*");

    // Total-Counter inkl. cooldown'd — fuer Telemetrie/Anzeige.
    const { count: unmatchedTotalAfterClaim } = await supabaseClient
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("match_status", "unmatched");

    const cooldownInBacklog =
      Math.max(0, (unmatchedTotalAfterClaim ?? 0) - (unmatchedActiveAfterClaim ?? 0));

    const transactions = allTransactions;
    const remaining = unmatchedActiveAfterClaim ?? 0;
    const totalUnmatched = remaining + transactions.length;

    if (transactions.length === 0 || invoices.length === 0) {
      const reason =
        transactions.length === 0 && invoices.length === 0
          ? "Keine offenen Transaktionen UND keine unmatched Rechnungen sichtbar"
          : transactions.length === 0
            ? `Keine 'unmatched' Transaktionen sichtbar (Auth-User sieht 0 unmatched). Insgesamt: ${totalUnmatched}`
            : `Keine unmatched Rechnungen sichtbar (allInvoicesRaw=${allInvoicesRaw.length}, nach Match-Filter=${invoicesAfterMatchFilter.length}, nach Dedup=${invoices.length})`;
      console.warn(`auto-match early-return: ${reason}`);
      await releaseUnmatchedClaims(new Set());
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

    // LLM-Config
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

    // Cooldown-Fingerprint — wurde frueher schon fuer den Cleanup-Pass
    // berechnet (`invoiceFingerprintEarly`). Wir verwenden denselben Wert,
    // damit Cleanup, Claim-Filter und Skip-Marker-Writes konsistent sind.
    const invoiceFingerprint = invoiceFingerprintEarly;

    // Telemetrie-Counter
    let matchedCount = 0;
    let autoConfirmedCount = 0;
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
      source: "deterministic" | "ai";
      status: "confirmed";
    }> = [];

    let aiAttempted = 0;
    let aiSucceeded = 0;
    let aiTimeouts = 0;
    let aiHttpErrors = 0;
    let aiParseErrors = 0;
    let lastAiError: string | null = null;
    const aiLatencies: number[] = [];

    let deterministicTier1 = 0;
    let deterministicTier2 = 0;
    // cooldownSkipped == 0 in v2 — TX sind durch den Claim-Filter erst gar
    // nicht in den Loop gekommen. Wir reporten stattdessen `cooldownInBacklog`
    // als Anzahl wartender cooldown'd TX. Das Feld bleibt im JSON fuer
    // Frontend-Backwards-Compat.
    const cooldownSkipped = 0;
    let noCandidates = 0;
    let aiRejectedInvalidId = 0;
    let aiRejectedLowConfidence = 0;
    let aiRejectedSanity = 0;
    let aiRejectedSanity_hardGateAmount = 0;
    let aiRejectedSanity_insufficientSignals = 0;
    let aiReturnedNull = 0;
    let dbUpdateErrors = 0;

    // -----------------------------------------------------------------------
    // Pipeline-Loop pro Transaktion
    // -----------------------------------------------------------------------
    for (const transaction of transactions) {
      const transactionAmount = Math.abs(transaction.amount);
      const isAmexFX =
        transaction.bank_statements?.bank_type === "amex" &&
        transaction.original_currency !== null;

      let matchAmount = transactionAmount;
      if (isAmexFX) {
        const foreignAmount = extractOriginalAmount(transaction.original_currency);
        if (foreignAmount !== null) {
          matchAmount = foreignAmount;
        }
      }

      // Cooldown wird jetzt VOR dem Claim gefiltert (siehe Section 5,
      // PARALLEL-SAFE CLAIM Schritt d). Wenn eine TX hier landet, ist sie
      // garantiert nicht im Cooldown. skipAI-Flag entfaellt — Tier 3 laeuft
      // immer, wenn Tier 1/2 keinen Match liefern.

      // Step 2: Kandidaten berechnen mit normalize + scoring
      const { normalized: normalizedDesc } = normalizeDescription(transaction.description ?? "");
      const tolerancePct = resolveAmountTolerance(transaction);

      const allScored: ScoredCandidate[] = invoices.map((inv: any) => {
        const invAmt = Number(inv.amount);
        const subs: SubScores = {
          // nameSim gegen normalized Desc — das ist der Standardpfad
          nameSim: nameSimilarity(inv.issuer ?? "", normalizedDesc),
          amountQuality: amountQuality(matchAmount, invAmt, tolerancePct),
          dateProximity: dateProximity(transaction.date, inv.date),
          invoiceNumberInDesc: invoiceNumberInDesc(inv.invoice_number, normalizedDesc),
        };
        const combined = combinedScore(subs);
        const diff = Math.abs(matchAmount - invAmt);
        const tolAbs = Math.max(matchAmount, invAmt) * tolerancePct;
        return {
          invoice: inv,
          subs,
          combined,
          exactAmount: diff < 0.01,
          amountInTolerance: diff < 0.01 || diff <= tolAbs,
        };
      });

      // Pre-Filter: Score >= SCORE_THRESHOLD_CANDIDATE oder amountInTolerance
      let preFiltered = allScored
        .filter(
          (c) => c.combined >= SCORE_THRESHOLD_CANDIDATE || c.amountInTolerance,
        )
        .sort((a, b) => b.combined - a.combined)
        .slice(0, MAX_CANDIDATES_PER_TX);

      // Fallback: wenn nichts Pre-gefiltert wurde, Top-N nach Score nehmen,
      // damit das LLM ueberhaupt eine Chance hat zu sagen "passt nichts".
      if (preFiltered.length === 0) {
        preFiltered = [...allScored]
          .sort((a, b) => b.combined - a.combined)
          .slice(0, MAX_CANDIDATES_PER_TX);
      }

      if (preFiltered.length === 0) {
        noCandidates++;
        // Skip-Marker schreiben, damit der naechste Run das auch sieht.
        const marker = buildSkipMarker("no-candidates", invoiceFingerprint);
        await supabaseClient
          .from("bank_transactions")
          .update({ match_status: "unmatched", match_reason: marker })
          .eq("id", transaction.id);
        continue;
      }

      // Step 3: Tier 1 — Slam-Dunk
      const t1 = tier1SlamDunk(preFiltered, normalizedDesc);
      if (t1) {
        const pick = t1.invoice;
        const { error: upErr } = await supabaseClient
          .from("bank_transactions")
          .update({
            matched_invoice_id: pick.id,
            match_status: "confirmed",
            match_confidence: t1.confidence,
            match_reason: t1.reason,
          })
          .eq("id", transaction.id);
        if (upErr) {
          const isUniqueViolation =
            (upErr as any)?.code === "23505" ||
            /duplicate key|unique/i.test(upErr.message ?? "");
          if (isUniqueViolation) {
            console.warn(
              `[T1] invoice already confirmed elsewhere: tx ${transaction.id} -> invoice ${pick.id} (${pick.issuer}) — rolling back to unmatched`,
            );
            await supabaseClient
              .from("bank_transactions")
              .update({ match_status: "unmatched" })
              .eq("id", transaction.id);
            continue;
          }
          dbUpdateErrors++;
          console.error(`DB update FAILED for tx ${transaction.id} (T1): ${upErr.message}`);
        } else {
          deterministicTier1++;
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
            confidence: t1.confidence,
            reason: t1.reason,
            source: "deterministic",
            status: "confirmed",
          });
          console.log(`T1 tx ${transaction.id} → invoice ${pick.id} (${pick.issuer} ${pick.amount})`);
        }
        continue;
      }

      // Step 4: Tier 2 — Strong-Fuzzy
      const t2 = tier2StrongFuzzy(preFiltered);
      if (t2) {
        const pick = t2.invoice;
        const { error: upErr } = await supabaseClient
          .from("bank_transactions")
          .update({
            matched_invoice_id: pick.id,
            match_status: "confirmed",
            match_confidence: t2.confidence,
            match_reason: t2.reason,
          })
          .eq("id", transaction.id);
        if (upErr) {
          const isUniqueViolation =
            (upErr as any)?.code === "23505" ||
            /duplicate key|unique/i.test(upErr.message ?? "");
          if (isUniqueViolation) {
            console.warn(
              `[T2] invoice already confirmed elsewhere: tx ${transaction.id} -> invoice ${pick.id} (${pick.issuer}) — rolling back to unmatched`,
            );
            await supabaseClient
              .from("bank_transactions")
              .update({ match_status: "unmatched" })
              .eq("id", transaction.id);
            continue;
          }
          dbUpdateErrors++;
          console.error(`DB update FAILED for tx ${transaction.id} (T2): ${upErr.message}`);
        } else {
          deterministicTier2++;
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
            confidence: t2.confidence,
            reason: t2.reason,
            source: "deterministic",
            status: "confirmed",
          });
          console.log(
            `T2 tx ${transaction.id} → invoice ${pick.id} (${pick.issuer} ${pick.amount}, score=${Math.round(t2.confidence)})`,
          );
        }
        continue;
      }

      // Step 5: Tier 3 — AI-Call (Cooldown bereits beim Claim gefiltert)
      const potentialMatches = preFiltered.map((c) => {
        // Fuer den Prompt brauchen wir _combinedScore am invoice-Objekt
        return { ...c.invoice, _combinedScore: c.combined };
      });

      aiAttempted++;
      const aiStart = Date.now();
      try {
        const userPrompt = `### TRANSAKTION
- Datum: ${transaction.date}
- Verwendungszweck (raw): ${transaction.description}
- Verwendungszweck (normalisiert): ${normalizedDesc}
- Betrag: ${transactionAmount} EUR
${isAmexFX ? `- Betrag in Original-Währung (für Match): ${matchAmount}` : ""}
${transaction.original_currency ? `- Original-Currency-Info: ${transaction.original_currency}` : ""}

### KANDIDATEN-RECHNUNGEN (Top N, vor-sortiert)
${potentialMatches
  .map(
    (inv: any, i: number) =>
      `${i + 1}. ID=${inv.id}\n   Aussteller: ${inv.issuer}\n   Betrag: ${inv.amount} ${inv.currency || "EUR"}\n   Datum: ${inv.date}${inv.invoice_number ? `\n   Rech-Nr: ${inv.invoice_number}` : ""}\n   PreScore: ${Math.round(inv._combinedScore)}/100`,
  )
  .join("\n\n")}

Antworte mit dem JSON-Schema oben.`;

        const buildPayload = () => ({
          model: llm.model,
          temperature: 0.0,
          top_p: 0.1,
          response_format: { type: "json_object" },
          max_tokens: 400,
          messages: [
            { role: "system", content: SYSTEM_PROMPT_V2 },
            { role: "user", content: userPrompt },
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

        // 404 → Auto-Fallback aufs Fallback-Modell, fuer Rest der Invocation aktiv
        if (response.status === 404 && llm.fallbackModel && llm.model !== llm.fallbackModel) {
          const deprecated = llm.model;
          llm.model = llm.fallbackModel;
          console.warn(
            `Model ${deprecated} returned 404 — switching to fallback ${llm.model} for rest of invocation`,
          );
          response = await doFetch();
        }

        if (!response.ok) {
          aiHttpErrors++;
          const errBody = await response.text().catch(() => "");
          lastAiError = `http ${response.status}: ${errBody.slice(0, 200)}`;
          console.error("LLM HTTP error:", response.status, errBody.slice(0, 500));
          aiLatencies.push(Date.now() - aiStart);
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        aiLatencies.push(Date.now() - aiStart);

        // Erste 3 Antworten verbatim loggen
        if (aiAttempted <= 3) {
          console.log(
            `[AI-DEBUG #${aiAttempted}] tx="${transaction.description}" (${matchAmount}) candidates=${potentialMatches.length} → content:`,
            (content ?? "").slice(0, 500),
          );
        }

        if (!content) {
          aiParseErrors++;
          lastAiError = "empty response content";
          continue;
        }

        let result: AIResult | null = null;
        try {
          const jsonMatch = (content as string).match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            result = JSON.parse(jsonMatch[0]) as AIResult;
          }
        } catch (parseError: any) {
          aiParseErrors++;
          lastAiError = `parse: ${parseError?.message ?? parseError}`;
          console.error("Failed to parse AI response:", parseError);
        }

        if (!result) {
          // Unparseable
          continue;
        }

        aiSucceeded++;

        if (aiAttempted <= 3) {
          console.log(`[AI-DEBUG #${aiAttempted}] parsed:`, JSON.stringify(result));
        }

        // Validierung der invoiceId
        const candidateIdSet = new Set(potentialMatches.map((c: any) => c.id));
        const rawId = result.matchedInvoiceId;
        const trimmedId = typeof rawId === "string" ? rawId.trim() : null;
        const invoiceIdValid = trimmedId !== null && trimmedId !== "" && candidateIdSet.has(trimmedId);
        const confRaw = result.confidence;
        const confidenceNum =
          typeof confRaw === "number"
            ? confRaw
            : typeof confRaw === "string"
              ? parseFloat(confRaw)
              : NaN;
        const confidenceOk = Number.isFinite(confidenceNum);

        // Telemetrie nach Ablehnungsgrund
        if (rawId === null || rawId === undefined) {
          aiReturnedNull++;
          // Skip-Marker schreiben fuer Cooldown
          const marker = buildSkipMarker("ai-no-match", invoiceFingerprint);
          await supabaseClient
            .from("bank_transactions")
            .update({ match_status: "unmatched", match_reason: marker })
            .eq("id", transaction.id);
          continue;
        }
        if (!invoiceIdValid) {
          aiRejectedInvalidId++;
          console.warn(
            `AI returned invalid invoiceId "${rawId}" for tx ${transaction.id} (not in candidate set)`,
          );
          continue;
        }
        if (!confidenceOk || confidenceNum < AUTO_CONFIRM_THRESHOLD) {
          aiRejectedLowConfidence++;
          continue;
        }

        // Sanity-Gate v2
        const matchedInv = potentialMatches.find((c: any) => c.id === trimmedId);
        const matchedScored = preFiltered.find((c) => c.invoice.id === trimmedId);
        const invAmount = Number(matchedInv?.amount ?? 0);
        const aiAmountDiff = Math.abs(matchAmount - invAmount);
        const aiTolerancePct = resolveAmountTolerance(transaction);
        const aiAmountTolerance = Math.max(matchAmount, invAmount) * aiTolerancePct;
        const exactAmount = aiAmountDiff < 0.01;
        const amountInTolerance = exactAmount || aiAmountDiff <= aiAmountTolerance;

        // highStringSim: nameSim(rawDesc, issuer) >= 0.55 OR nameSim(normalized, issuer) >= 0.55
        const issuerStr = (matchedInv?.issuer ?? "") as string;
        const nameSimRaw = nameSimilarity(issuerStr, transaction.description ?? "");
        const nameSimNorm = nameSimilarity(issuerStr, normalizedDesc);
        const highStringSim = nameSimRaw >= 0.55 || nameSimNorm >= 0.55;

        const issuerHasTokenInDesc = issuerTokenInDesc(issuerStr, normalizedDesc, 4);

        const recentDate = (matchedScored?.subs.dateProximity ?? 0) >= 0.5;
        const invoiceNumberHit = (matchedScored?.subs.invoiceNumberInDesc ?? 0) > 0;

        const aiSignalsAgree = result.signals?.issuerMatch === true;

        const sanityArgs: SanityArgs = {
          exactAmount,
          amountInTolerance,
          highStringSim,
          issuerTokenInDesc: issuerHasTokenInDesc,
          recentDate,
          invoiceNumberInDesc: invoiceNumberHit,
          aiSignalsAgree,
          aiConfidence: confidenceNum,
        };
        const sanity = passesSanityV2(sanityArgs);

        if (!sanity.pass) {
          aiRejectedSanity++;
          if (sanity.breakdown.hardGateAmount) aiRejectedSanity_hardGateAmount++;
          if (sanity.breakdown.insufficientSignals) aiRejectedSanity_insufficientSignals++;

          console.warn(
            `AI SANITY-REJECT tx="${(transaction.description ?? "").slice(0, 60)}" (${matchAmount}€) -> "${matchedInv?.issuer}" (${invAmount}€) at conf=${confidenceNum}%: hardGateAmount=${sanity.breakdown.hardGateAmount}, insufficientSignals=${sanity.breakdown.insufficientSignals}, exactAmt=${exactAmount}, tolerance=${amountInTolerance}, highSim=${highStringSim}, tokenInDesc=${issuerHasTokenInDesc}, recentDate=${recentDate}, aiSignalsAgree=${aiSignalsAgree}`,
          );

          // Skip-Marker schreiben fuer Cooldown
          const marker = buildSkipMarker("sanity-rejected", invoiceFingerprint);
          await supabaseClient
            .from("bank_transactions")
            .update({ match_status: "unmatched", match_reason: marker })
            .eq("id", transaction.id);
          continue;
        }

        // Confirm
        const { error: upErr } = await supabaseClient
          .from("bank_transactions")
          .update({
            matched_invoice_id: trimmedId,
            match_status: "confirmed",
            match_confidence: confidenceNum,
            match_reason: result.reason ?? null,
          })
          .eq("id", transaction.id);

        if (upErr) {
          const isUniqueViolation =
            (upErr as any)?.code === "23505" ||
            /duplicate key|unique/i.test(upErr.message ?? "");
          if (isUniqueViolation) {
            console.warn(
              `[T3] invoice already confirmed elsewhere: tx ${transaction.id} -> invoice ${trimmedId} — rolling back to unmatched`,
            );
            await supabaseClient
              .from("bank_transactions")
              .update({ match_status: "unmatched" })
              .eq("id", transaction.id);
            continue;
          }
          dbUpdateErrors++;
          console.error(`DB update FAILED for tx ${transaction.id} (AI): ${upErr.message}`);
        } else {
          console.log(
            `T3 AUTO-CONFIRMED tx ${transaction.id} → invoice ${trimmedId} (${confidenceNum}%): ${result.reason}`,
          );
          matchedCount++;
          autoConfirmedCount++;
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
            status: "confirmed",
          });
        }
      } catch (aiError: any) {
        aiLatencies.push(Date.now() - aiStart);
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

    // -----------------------------------------------------------------------
    // Cleanup + Response
    // -----------------------------------------------------------------------

    const matchedTxIds = new Set<string>(
      matchedTransactions.map((m: any) => m.transactionId),
    );
    await releaseUnmatchedClaims(matchedTxIds);

    // Final-Remaining = ECHTE Restarbeit (cooldown'd ausgeklammert), damit
    // Frontend-Wave-Loop natuerlich terminiert sobald nur noch cooldown'd TX
    // uebrig sind. Cooldown-Anzahl bleibt fuer Telemetrie verfuegbar.
    const { count: finalRemaining } = await supabaseClient
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("match_status", "unmatched")
      .or("match_reason.is.null,match_reason.not.like.[auto-skip:*");

    const { count: finalCooldownInBacklog } = await supabaseClient
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("match_status", "unmatched")
      .like("match_reason", "[auto-skip:%");

    // Latency-Aggregate
    const sortedLatencies = [...aiLatencies].sort((a, b) => a - b);
    const avgLatencyMs =
      sortedLatencies.length === 0
        ? 0
        : Math.round(sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length);
    const p95LatencyMs =
      sortedLatencies.length === 0
        ? 0
        : sortedLatencies[Math.min(sortedLatencies.length - 1, Math.floor(sortedLatencies.length * 0.95))];

    return new Response(
      JSON.stringify({
        success: true,
        version: EDGE_VERSION,
        matchedCount,
        autoConfirmedCount,
        processedCount: transactions.length,
        totalUnmatched,
        remaining: finalRemaining ?? remaining,
        ai: {
          provider: llm.provider,
          model: llm.model,
          attempted: aiAttempted,
          succeeded: aiSucceeded,
          timeouts: aiTimeouts,
          httpErrors: aiHttpErrors,
          parseErrors: aiParseErrors,
          lastError: lastAiError,
          avgLatencyMs,
          p95LatencyMs,
        },
        decisions: {
          // Backwards-compat: deterministicMatched = t1 + t2
          deterministicMatched: deterministicTier1 + deterministicTier2,
          deterministicTier1,
          deterministicTier2,
          cooldownSkipped,                         // legacy, immer 0 in v2
          cooldownInBacklog: finalCooldownInBacklog ?? cooldownInBacklog,
          cooldownClearedFingerprint,              // wieviele Marker am Anfang geraeumt wurden
          noCandidates,
          aiReturnedNull,
          aiRejectedInvalidId,
          aiRejectedLowConfidence,
          aiRejectedSanity,
          aiRejectedSanityBreakdown: {
            hardGateAmount: aiRejectedSanity_hardGateAmount,
            insufficientSignals: aiRejectedSanity_insufficientSignals,
          },
          dbUpdateErrors,
        },
        matchedTransactions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Auto-match error:", error);
    if (supabaseClient && claimedForCleanup.length > 0) {
      try {
        await supabaseClient
          .from("bank_transactions")
          .update({ match_status: "unmatched" })
          .eq("match_status", "ai_processing")
          .in("id", claimedForCleanup.map((t: any) => t.id));
      } catch (releaseErr) {
        console.error("Claim-release on error path failed:", releaseErr);
      }
    }
    return new Response(JSON.stringify({ error: errorMessage, version: EDGE_VERSION }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// =============================================================================
// SECTION 9 — LLM Resolve
// =============================================================================

type LLMConfig = {
  provider: "gemini" | "openai";
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModel: string | null;
};

// Gemini bevorzugt (User hat darauf umgestellt). OpenAI als Fallback.
// gemini-2.5-flash (NICHT -lite) — der Plan v2 verlangt das stabilere
// Pro-Modell, weil Multi-Shot-Prompt + Sanity-Gate zuverlaessigere Antworten
// brauchen, als die Lite-Variante liefert.
function resolveLLM(): LLMConfig | null {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) {
    return {
      provider: "gemini",
      apiKey: geminiKey,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: Deno.env.get("LLM_MODEL") ?? "gemini-2.5-flash",
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
