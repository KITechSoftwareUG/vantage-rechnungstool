import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// AI-Provider-Resolver: bevorzugt GEMINI_API_KEY (direkter Google-Endpoint,
// unabhaengig von Lovable-AI-Credits). Faellt auf Lovable-AI-Gateway zurueck,
// falls GEMINI_API_KEY nicht gesetzt ist. Einheitliche Model-Namen in beiden
// Welten via Mapping.
type AIConfig = {
  apiKey: string;
  baseUrl: string;
  mapModel: (logical: "flash" | "pro") => string;
  providerLabel: "gemini" | "lovable";
};

function resolveAIConfig(): AIConfig | null {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) {
    return {
      apiKey: geminiKey,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      mapModel: (logical) => (logical === "pro" ? "gemini-2.5-pro" : "gemini-2.5-flash"),
      providerLabel: "gemini",
    };
  }
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (lovableKey) {
    return {
      apiKey: lovableKey,
      baseUrl: "https://ai.gateway.lovable.dev/v1",
      mapModel: (logical) => (logical === "pro" ? "google/gemini-2.5-pro" : "google/gemini-2.5-flash"),
      providerLabel: "lovable",
    };
  }
  return null;
}

// Map German month names to numbers
const monthMap: Record<string, number> = {
  januar: 1,
  februar: 2,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

// Map category to document type for OCR routing
const categoryToDocType: Record<string, "invoice" | "statement" | "commission"> = {
  eingang: "invoice",
  ausgang: "invoice",
  vrbank: "statement",
  amex: "statement",
  provision: "commission",
  kasse: "invoice",
};

// Map category to payment method
const categoryToPayment: Record<string, string> = {
  eingang: "bank",
  ausgang: "bank",
  vrbank: "bank",
  amex: "bank",
  provision: "bank",
  kasse: "cash",
};

// Map category to bank type for statements
const categoryToBankType: Record<string, string> = {
  vrbank: "volksbank",
  amex: "amex",
};

// SHA-256 hex digest of a buffer — used for content-based duplicate detection.
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

// Convert ArrayBuffer to base64 in chunks to avoid stack overflow
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// Retry fetch with exponential backoff
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3, baseDelay = 2000): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        console.log(`Attempt ${attempt + 1}: Got ${response.status}, retrying...`);
        lastError = new Error(`AI Gateway error: ${response.status}`);
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
          continue;
        }
        throw lastError;
      }
      return response;
    } catch (error) {
      console.log(`Attempt ${attempt + 1}: Network error, retrying...`, error);
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError || new Error("Max retries exceeded");
}

// Build OCR prompt based on document type
function getOcrPrompt(docType: "invoice" | "statement" | "commission"): string {
  if (docType === "commission") {
    return `Du analysierst eine PROVISIONSABRECHNUNG (Courtage-/Vermittlungsabrechnung).
Diese Dokumente sind oft MEHRSEITIG mit VIELEN Zahlen, Einzelpositionen und Zwischensummen.
Deine wichtigste Aufgabe: den korrekten GESAMT-AUSZAHLUNGSBETRAG finden — NICHT eine Zwischensumme, NICHT eine Einzelprovision.

Gib JSON mit exakt diesen Feldern zurück:
- date: Abrechnungsdatum im Format YYYY-MM-DD (Datum der Abrechnung, nicht einzelner Positionen)
- issuer: Name des ausstellenden Unternehmens (Pool/Versicherer/Vermittler, der die Provision AUSZAHLT)
- invoiceNumber: Abrechnungsnummer / Provisionsnummer / Beleg-Nr. (oft oben rechts); sonst null
- amount: GESAMT-AUSZAHLUNGSBETRAG als POSITIVE Zahl, ohne Währungssymbol.
    SO GEHST DU VOR:
    * Suche die LETZTE Seite zuerst — dort steht meist die Endsumme.
    * Bevorzuge Felder mit Labels: "Auszahlungsbetrag", "Gesamtsumme", "Summe Auszahlung", "Überweisungsbetrag",
      "Endbetrag", "Zu zahlen", "Nettoauszahlung", "Gesamtbetrag", "Total".
    * IGNORIERE: Einzelprovisionen pro Vertrag, Stornos einzelner Positionen, Zwischensummen pro Produktgruppe,
      Bestandsprovisionen separat, MwSt-Beträge einzeln, Kontostände, Vorjahreswerte.
    * Wenn mehrere Summen vorkommen, nimm die am WEITESTEN UNTEN / am ENDE des Dokuments stehende Gesamtsumme.
    * Negativer Auszahlungsbetrag (Rückforderung): trotzdem POSITIV angeben, dafür "type": "outgoing" setzen.
- currency: ISO-4217-Code (meist "EUR"). Default: "EUR".
- type: "incoming" wenn Geld an UNS fließt (Standardfall bei Provisionsabrechnung),
        "outgoing" wenn das Dokument per Saldo eine Rückforderung an uns ist.
- detectedCategory: immer "provision" für Provisionsabrechnungen.

Doppelcheck vor der Antwort:
  1. Ist "amount" wirklich die Endsumme und nicht eine Einzelposition? Prüfe, ob es die größte plausible Summe am Dokumentende ist.
  2. Ist "issuer" der AUSZAHLER (nicht der Empfänger / nicht der Endkunde aus einer Einzelposition)?
  3. Ist "date" das Abrechnungsdatum (Kopfzeile/Fußzeile), nicht ein Vertragsdatum aus einer Einzelposition?

Antworte NUR mit dem JSON-Objekt, keine Erklärung, kein Markdown.
Beispiel: {"date":"2024-03-31","issuer":"Fonds Finanz","invoiceNumber":"PA-2024-03-00123","amount":4238.17,"currency":"EUR","type":"incoming","detectedCategory":"provision"}`;
  }

  if (docType === "invoice") {
    return `Analysiere dieses Dokument als Rechnung und extrahiere folgende Informationen im JSON-Format:
    - date: Rechnungsdatum im Format YYYY-MM-DD
    - issuer: Name des Ausstellers/Unternehmens (wer hat die Rechnung ausgestellt)
    - invoiceNumber: Die Rechnungsnummer (z.B. "INV-2024-001", "RE2024-1234", "#12345" etc.). 
      Suche nach Begriffen wie: "Invoice Number", "Rechnungsnummer", "Invoice #", "Rechnung Nr.", "Invoice ID", "Beleg-Nr." etc.
      Falls keine Rechnungsnummer gefunden wird: null
    - amount: Gesamtbetrag als POSITIVE Zahl (ohne Währungssymbol). WICHTIG: 
      * Wenn "Amount Due" oder "Fälliger Betrag" 0,00 ist, suche nach dem ursprünglichen Rechnungsbetrag (z.B. "Total", "Gesamtbetrag", "Invoice Total", "Subtotal" etc.)
      * Nimm immer den tatsächlichen Rechnungsbetrag, nicht den offenen Betrag
      * Betrag IMMER als positive Zahl angeben!
    - currency: Die Währung der Rechnung als ISO 4217 Code (z.B. "EUR", "USD", "GBP", "CHF"). 
      Suche nach Währungssymbolen (€, $, £, Fr.) oder Angaben wie "USD", "EUR" etc.
      Wenn keine Währung erkennbar ist, verwende "EUR" als Standard.
    - detectedCategory: Erkenne, was für ein Dokument das ist. WICHTIG: "Wir" sind Alexander Fürthbauer / Vantage. Dokumente, deren Empfänger Alexander Fürthbauer oder Vantage ist, sind "eingang". Dokumente, deren Aussteller Alexander Fürthbauer oder Vantage ist, sind "ausgang". Mögliche Werte:
      * "eingang" - Eingangsrechnung (Empfänger = wir; Rechnung die wir bezahlen müssen)
      * "ausgang" - Ausgangsrechnung (Aussteller = wir; Rechnung die wir gestellt haben)
      * "provision" - Provisionsabrechnung (Abrechnung von Provisionen, Courtage, Vermittlungsgebühren)
      * "kasse" - Kassenbeleg/Barzahlung (Quittung, Taxibeleg, Barrechnung)
      Achte besonders auf Begriffe wie "Provisionsabrechnung", "Courtage", "Vermittlung" -> "provision"
    
    WICHTIG: Das Feld "type" wird NICHT benötigt - der Typ wird automatisch aus dem Ordner bestimmt.
    
    Antworte NUR mit dem JSON-Objekt, keine andere Erklärung.
    Beispiel: {"date": "2024-01-15", "issuer": "OpenAI", "invoiceNumber": "INV-2024-12345", "amount": 52.50, "currency": "USD", "detectedCategory": "eingang"}`;
  }

  return `Analysiere diesen Kontoauszug und extrahiere folgende Informationen im JSON-Format:

    1. Zusammenfassung (summary):
    - bank: Name der Bank (z.B. "Volksbank", "American Express", "Raiffeisenbank", "VR Bank")
    - bankType: "volksbank" wenn Volksbank/Raiffeisenbank/VR Bank, "amex" wenn American Express
    - accountNumber: Kontonummer oder IBAN
    - date: Datum des Auszugs im Format YYYY-MM-DD
    - openingBalance: Anfangssaldo als Zahl (kann 0 sein wenn nicht vorhanden)
    - closingBalance: Endsaldo als Zahl (kann 0 sein wenn nicht vorhanden)

    2. Einzelne Transaktionen (transactions) - WICHTIG: Extrahiere ALLE Transaktionszeilen:
    - date: Buchungsdatum im Format YYYY-MM-DD
    - description: Beschreibung/Verwendungszweck der Transaktion
    - amount: Betrag als positive Zahl in EUR
    - type: "credit" für Gutschriften/Einzahlungen, "debit" für Abbuchungen/Ausgaben
    - originalCurrency: Bei Fremdwährungstransaktionen den kompletten Text, sonst null

    Antworte NUR mit dem JSON-Objekt, keine andere Erklärung.
    Beispiel:
    {
      "summary": {
        "bank": "Volksbank",
        "bankType": "volksbank",
        "accountNumber": "DE12345678",
        "date": "2024-01-31",
        "openingBalance": 1000,
        "closingBalance": 1450
      },
      "transactions": [
        {"date": "2024-01-05", "description": "Gehalt", "amount": 3000, "type": "credit", "originalCurrency": null}
      ]
    }`;
}

// Sanitize string for filename
function sanitizeForFilename(str: string): string {
  return str
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/[^a-zA-Z0-9\-_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 40);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    const category = pathParts[1]?.toLowerCase();
    const year = parseInt(pathParts[2], 10);
    const monthRaw = pathParts[3]?.toLowerCase();
    // Accept both German month names ("januar") and numbers ("1", "01")
    const monthAsNumber = parseInt(monthRaw, 10);
    const month =
      !isNaN(monthAsNumber) && monthAsNumber >= 1 && monthAsNumber <= 12 ? monthAsNumber : monthMap[monthRaw];

    const driveFileId = url.searchParams.get("drive_file_id");
    const originalFileName = url.searchParams.get("file_name") || url.searchParams.get("fileName") || "";
    const contentType = req.headers.get("content-type") || "";

    // Single-User-Tool: user_id kommt aus dem Query-Param. Keine JWT-Validierung,
    // keine Multi-Tenant-Grenze. Caller koennen der Python-Drive-Poller
    // (n8n-JWT) oder der Browser (Supabase-Session-JWT) sein — in beiden Faellen
    // wird user_id aus der Query gelesen.
    const userId = url.searchParams.get("user_id");

    console.log("=== N8N WEBHOOK ===");
    console.log("Category:", category, "Year:", year, "Month:", month);
    console.log("User ID:", userId, "Original filename:", originalFileName);

    // Validate required parameters
    if (!userId) {
      return new Response(JSON.stringify({ success: false, error: "Missing user_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const docType = categoryToDocType[category];
    if (!docType) {
      return new Response(JSON.stringify({ success: false, error: `Invalid category: ${category}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!year || !month) {
      return new Response(JSON.stringify({ success: false, error: "Invalid year or month in path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read the file from request body (n8n sends as raw binary)
    const fileBuffer = await req.arrayBuffer();
    const fileSize = fileBuffer.byteLength;

    if (fileSize === 0) {
      return new Response(JSON.stringify({ success: false, error: "Empty file received" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("File size:", fileSize, "bytes, docType:", docType);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check for duplicate if drive_file_id is provided
    if (driveFileId) {
      const { data: existing } = await supabase
        .from("processed_drive_files")
        .select("id")
        .eq("drive_file_id", driveFileId)
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        console.log("Duplicate file detected:", driveFileId);
        return new Response(JSON.stringify({ success: true, message: "File already processed", duplicate: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // file_hash wird weiterhin berechnet und in die DB geschrieben, damit das
    // Matching-Tool spaeter deduplizieren kann. Am Ingest selbst wird NICHT
    // geblockt — Duplikate landen in der Review-Queue und werden dort bzw.
    // beim Matching aufgeloest.
    const fileHash = await sha256Hex(fileBuffer);

    // Upload file to storage with temp name first
    const timestamp = Date.now();
    const extension = contentType.includes("pdf") ? "pdf" : "bin";
    const tempFileName = `n8n_${category}_${timestamp}.${extension}`;
    const tempStoragePath = `${userId}/${year}/${month}/${tempFileName}`;

    const { error: uploadError } = await supabase.storage.from("documents").upload(tempStoragePath, fileBuffer, {
      contentType: contentType || "application/pdf",
      upsert: false,
    });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(JSON.stringify({ success: false, error: `Upload failed: ${uploadError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("File uploaded to temp path:", tempStoragePath);

    // Log ingestion as "processing" - use original filename if available
    const displayFileName = originalFileName || tempFileName;
    const { data: logEntry, error: logError } = await supabase
      .from("document_ingestion_log")
      .insert({
        user_id: userId,
        file_name: displayFileName,
        document_type: docType !== "statement" ? category : "bank_statement",
        endpoint_category: category,
        endpoint_year: year,
        endpoint_month: month,
        status: "processing",
      })
      .select("id")
      .single();

    if (logError) {
      console.error("Log error:", logError);
    }

    // ===== OCR PROCESSING =====
    const aiConfig = resolveAIConfig();
    if (!aiConfig) {
      if (logEntry) {
        await supabase
          .from("document_ingestion_log")
          .update({
            status: "error",
            error_message: "Kein AI-Key konfiguriert (weder GEMINI_API_KEY noch LOVABLE_API_KEY)",
          })
          .eq("id", logEntry.id);
      }
      return new Response(JSON.stringify({ success: false, error: "OCR not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const base64 = arrayBufferToBase64(fileBuffer);
    const mimeType = contentType || "application/pdf";
    const prompt = getOcrPrompt(docType);

    console.log(`Starting OCR for ${docType} via ${aiConfig.providerLabel}`);

    const aiResponse = await fetchWithRetry(`${aiConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // `commission` = Provisionsabrechnungen sind mehrseitig und zahlen-
        // lastig; hier lohnt sich Pro. Rechnungen & Kontoauszüge sind mit
        // Flash genauso zuverlässig und ~3-5× schneller.
        model: aiConfig.mapModel(docType === "commission" ? "pro" : "flash"),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      if (logEntry) {
        await supabase
          .from("document_ingestion_log")
          .update({
            status: "error",
            error_message: `OCR failed: ${aiResponse.status}`,
          })
          .eq("id", logEntry.id);
      }
      return new Response(JSON.stringify({ success: false, error: `OCR failed: ${aiResponse.status}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";
    console.log("OCR Response:", aiContent);

    // Parse JSON from AI response
    let extractedData: any;
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in OCR response");
      }
    } catch (parseError) {
      console.error("Failed to parse OCR response:", parseError);
      // Kein Stub-Record mehr: wenn OCR kein verwertbares JSON liefert,
      // markieren wir den Ingest als error mit dem Raw-Response im
      // warning_message (max 500 Zeichen) und brechen mit 422 ab. Der Storage-
      // Blob wird aufgeraeumt, damit keine Waisen entstehen.
      const rawSnippet = String(aiContent).slice(0, 500);
      if (logEntry) {
        await supabase
          .from("document_ingestion_log")
          .update({
            status: "error",
            error_message: "OCR-Antwort konnte nicht als JSON geparst werden",
            warning_message: `OCR-Parse-Fail. Raw (500 chars): ${rawSnippet}`,
          })
          .eq("id", logEntry.id);
      }
      await supabase.storage.from("documents").remove([tempStoragePath]);
      return new Response(
        JSON.stringify({
          success: false,
          error: "OCR response could not be parsed as JSON",
          raw_snippet: rawSnippet,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ===== VERIFICATION PASS (Kontoauszüge) =====
    // Zweiter OCR-Lauf: Die im ersten Pass extrahierten Transaktionen werden
    // Zeile für Zeile gegen das PDF geprüft. Output: korrigierte Liste in der
    // Reihenfolge, in der die Buchungen im Auszug stehen. Diskrepanzen landen
    // als warning_message am Ingestion-Log, damit Alex sie prüfen kann.
    let verificationWarning: string | null = null;
    let verificationTimedOut = false;
    if (docType === "statement") {
      const initialTx = Array.isArray(extractedData.transactions) ? extractedData.transactions : [];

      const verifyPrompt = `Du hast diesen Kontoauszug bereits einmal extrahiert. Hier ist die Liste der erkannten Transaktionen:

${JSON.stringify(initialTx, null, 2)}

Prüfe die Liste SEHR SORGFÄLTIG gegen das PDF und liefere eine korrigierte, vollständige Liste.

DEINE AUFGABEN:
1. Vergleiche jede erkannte Zeile mit dem PDF. Stimmen Datum, Beschreibung, Betrag und Typ (credit/debit)?
2. Ergänze FEHLENDE Transaktionen, die im ersten Pass übersehen wurden.
3. Entferne DUPLIKATE oder Zeilen, die keine echte Transaktion sind (Zwischensummen, Salden, Überschriften).
4. Korrigiere falsche Beträge, Vorzeichen oder Buchungstypen.
5. WICHTIG: Gib die Transaktionen in EXAKT DER REIHENFOLGE zurück, in der sie im PDF untereinander stehen — NICHT nach Datum sortiert, NICHT nach Betrag sortiert. Die Reihenfolge im Auszug ist die Wahrheit.

Antworte mit JSON in diesem Format:
{
  "transactions": [
    {"date": "YYYY-MM-DD", "description": "...", "amount": 123.45, "type": "credit"|"debit", "originalCurrency": null}
  ],
  "discrepancies": ["Kurzer Hinweis pro gefundenem Unterschied zum ersten Pass, max. 5 Einträge"]
}

Jede Transaktion MUSS enthalten: date, description, amount (positive Zahl), type ("credit" oder "debit").
originalCurrency nur bei Fremdwährung, sonst null.
Antworte NUR mit dem JSON-Objekt, kein Markdown, keine Erklärung.`;

      // Der Verifikations-Pass ist OPTIONAL. Harter 45s-Cap via AbortController:
      // ohne Cap hing der 2. Pass (Pro + grosses PDF) bis zum Supabase-Edge-
      // Function-Wall-Clock-Limit (~150s) und der ganze Webhook-Run brach ab
      // → Kontoauszug wurde nicht eingefügt. KEIN Retry: wenn Pro langsam ist,
      // lieber Pass-1 übernehmen als den ganzen Ingest zu blockieren.
      const VERIFY_TIMEOUT_MS = 45000;
      const verifyCtrl = new AbortController();
      const verifyTimer = setTimeout(() => verifyCtrl.abort(), VERIFY_TIMEOUT_MS);
      try {
        const verifyResponse = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aiConfig.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // Zweiter Pass: Pro-Modell, weil hier Vollständigkeit + Reihenfolge
            // über Einzelheiten entscheiden, nicht Geschwindigkeit.
            model: aiConfig.mapModel("pro"),
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: verifyPrompt },
                  { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
                ],
              },
            ],
          }),
          signal: verifyCtrl.signal,
        });

        if (verifyResponse.ok) {
          const verifyData = await verifyResponse.json();
          const verifyContent = verifyData.choices?.[0]?.message?.content || "";
          const jsonMatch = verifyContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed.transactions)) {
              extractedData.transactions = parsed.transactions;
              console.log(`Verification pass: ${initialTx.length} → ${parsed.transactions.length} transactions`);
            }
            if (Array.isArray(parsed.discrepancies) && parsed.discrepancies.length > 0) {
              verificationWarning = `Verifikation: ${parsed.discrepancies.slice(0, 5).join("; ")}`;
            }
          }
        } else {
          console.error("Verification pass failed:", verifyResponse.status);
          verificationWarning = "Verifikationslauf nicht möglich — nur erster OCR-Pass verwendet.";
        }
      } catch (verifyError) {
        const isAbort = verifyError instanceof Error && verifyError.name === "AbortError";
        console.error("Verification pass error:", isAbort ? "timeout" : verifyError);
        if (isAbort) {
          verificationTimedOut = true;
          verificationWarning =
            "Verifikationslauf nach 45s abgebrochen — bitte Transaktionsliste pruefen bevor Matching lauft";
        } else {
          verificationWarning = "Verifikationslauf fehlgeschlagen — nur erster OCR-Pass verwendet.";
        }
      } finally {
        clearTimeout(verifyTimer);
      }
    }

    // ===== CATEGORY MISMATCH DETECTION =====
    let categoryMismatch: string | null = null;
    if (docType !== "statement" && extractedData.detectedCategory) {
      const detected = extractedData.detectedCategory;
      // Check if OCR-detected category differs from source folder category
      if (detected !== category) {
        // Map categories to German labels for the warning message
        const categoryLabels: Record<string, string> = {
          eingang: "Eingangsrechnung",
          ausgang: "Ausgangsrechnung",
          provision: "Provisionsabrechnung",
          kasse: "Kassenbeleg",
        };
        const sourceLabel = categoryLabels[category] || category;
        const detectedLabel = categoryLabels[detected] || detected;
        categoryMismatch = `Ordner: ${sourceLabel}, erkannt: ${detectedLabel}`;
        console.log(`Category mismatch detected: folder=${category}, OCR=${detected}`);
      }
    }

    // Also check if the OCR-detected date month differs from the endpoint month
    let monthMismatch: string | null = null;
    if (docType !== "statement" && extractedData.date) {
      const detectedMonth = new Date(extractedData.date).getMonth() + 1;
      if (detectedMonth !== month && !isNaN(detectedMonth)) {
        const monthNames = [
          "",
          "Januar",
          "Februar",
          "März",
          "April",
          "Mai",
          "Juni",
          "Juli",
          "August",
          "September",
          "Oktober",
          "November",
          "Dezember",
        ];
        monthMismatch = `Ordner: ${monthNames[month]}, Dokument: ${monthNames[detectedMonth]}`;
        console.log(`Month mismatch detected: folder=${month}, document=${detectedMonth}`);
      }
    }

    // Build combined warning message
    const warnings: string[] = [];
    if (categoryMismatch) warnings.push(categoryMismatch);
    if (monthMismatch) warnings.push(monthMismatch);
    if (verificationWarning) warnings.push(verificationWarning);
    const warningMessage = warnings.length > 0 ? warnings.join(" | ") : null;

    // ===== BUILD FINAL FILENAME & RENAME =====
    let finalFileName: string;
    let finalStoragePath: string;

    if (docType !== "statement") {
      const issuer = sanitizeForFilename(extractedData.issuer || "Unbekannt");
      const date = extractedData.date || `${year}-${String(month).padStart(2, "0")}-01`;
      // Keep storage keys URL-safe and deterministic (no commas or locale separators).
      const amount = Math.abs(extractedData.amount || 0)
        .toFixed(2)
        .replace(".", "_");
      const currency = sanitizeForFilename(extractedData.currency || "EUR");
      finalFileName = `${date}_${issuer}_${amount}${currency}.${extension}`;
    } else {
      const summary = extractedData.summary || extractedData;
      const bank = sanitizeForFilename(summary.bank || "Bank");
      const date = summary.date || `${year}-${String(month).padStart(2, "0")}-01`;
      finalFileName = `${date}_${bank}_Kontoauszug.${extension}`;
    }

    // Kein Storage-Move: Die Datei bleibt unter tempStoragePath im Bucket
    // liegen. Die UI zeigt aber finalFileName (aus OCR berechnet) — das ist
    // in `file_name` des invoices-Records und im ingestion_log gespeichert.
    // Frueher versuchten wir supabase.storage.move() um die Datei physikalisch
    // umzubenennen; das scheiterte sporadisch und fiel dann auf Temp-Namen
    // zurueck. Da der User den Storage-Pfad nie zu Gesicht bekommt (nur die
    // gerenderte file_name in den Listen), ist das rein physikalische
    // Umbenennen unnoetig. Kollisionen sind so ebenfalls ausgeschlossen — die
    // Storage-Pfade sind per Timestamp im tempFileName garantiert eindeutig.
    finalStoragePath = tempStoragePath;

    // Get public URL (zeigt auf den Storage-Pfad; nur fuer PDF-Preview/Download).
    const { data: urlData } = supabase.storage.from("documents").getPublicUrl(finalStoragePath);
    const fileUrl = urlData?.publicUrl || "";

    // ===== CREATE DATABASE RECORD =====
    let documentId: string | null = null;

    if (docType !== "statement") {
      const invoiceDate = extractedData.date || `${year}-${String(month).padStart(2, "0")}-01`;
      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          user_id: userId,
          file_name: finalFileName,
          file_url: fileUrl,
          date: invoiceDate,
          year: year,
          month: month,
          issuer: extractedData.issuer || "Unbekannt",
          amount: Math.abs(extractedData.amount || 0),
          currency: extractedData.currency || "EUR",
          type:
            category === "eingang"
              ? "outgoing"
              : category === "ausgang"
                ? "incoming"
                : category === "provision"
                  ? "incoming"
                  : "outgoing",
          payment_method: categoryToPayment[category] || "bank",
          invoice_number: extractedData.invoiceNumber || null,
          status: "processing",
          source_endpoint: `n8n/${category}`,
          file_hash: fileHash,
        })
        .select("id")
        .single();

      if (invoiceError) {
        console.error("Invoice insert error:", invoiceError);
      } else {
        documentId = invoice?.id || null;
        console.log("Invoice created:", documentId);

        // For Kasse (cash) invoices, create a synthetic bank transaction that is already confirmed
        if (category === "kasse" && documentId) {
          const kasseDate = extractedData.date || `${year}-${String(month).padStart(2, "0")}-01`;
          const { error: kasseTxError } = await supabase.from("bank_transactions").insert({
            user_id: userId,
            date: kasseDate,
            description: `Kasse: ${extractedData.issuer || "Barzahlung"}`,
            amount: Math.abs(extractedData.amount || 0),
            transaction_type: "debit",
            matched_invoice_id: documentId,
            match_status: "confirmed",
            match_confidence: 100,
          });

          if (kasseTxError) {
            console.error("Kasse synthetic transaction error:", kasseTxError);
          } else {
            console.log("Kasse synthetic transaction created for invoice:", documentId);
          }
        }
      }
    } else {
      // Bank statement
      const summary = extractedData.summary || extractedData;
      const statementDate = summary.date || `${year}-${String(month).padStart(2, "0")}-01`;

      const { data: statement, error: statementError } = await supabase
        .from("bank_statements")
        .insert({
          user_id: userId,
          file_name: finalFileName,
          file_url: fileUrl,
          date: statementDate,
          year: year,
          month: month,
          bank: summary.bank || "Unbekannt",
          bank_type: summary.bankType || categoryToBankType[category] || "volksbank",
          account_number: summary.accountNumber || "Unbekannt",
          opening_balance: summary.openingBalance || 0,
          closing_balance: summary.closingBalance || 0,
          // Kontoauszüge werden nicht manuell bestätigt — der zweite OCR-Pass
          // oben hat die Transaktionen bereits gegengeprüft. Direkt auf "ready",
          // damit sie nicht im "Zur Überprüfung"-Zähler hängen bleiben.
          // Ausnahme: Verifikations-Pass lief ins 45s-Timeout → status auf
          // pending_manual_review, damit Alex die Liste ansieht bevor das
          // Matching darauf losgeht.
          status: verificationTimedOut ? "pending_manual_review" : "ready",
          source_endpoint: `n8n/${category}`,
        })
        .select("id")
        .single();

      if (statementError) {
        console.error("Statement insert error:", statementError);
      } else {
        documentId = statement?.id || null;
        console.log("Bank statement created:", documentId);

        // Insert transactions if available
        const transactions = extractedData.transactions || [];
        if (transactions.length > 0 && documentId) {
          const txRows = transactions.map((tx: any, idx: number) => ({
            user_id: userId,
            bank_statement_id: documentId,
            date: tx.date || statementDate,
            description: tx.description || "",
            amount: Math.abs(tx.amount || 0),
            transaction_type: tx.type || "debit",
            original_currency: tx.originalCurrency || null,
            match_status: "unmatched",
            // Reihenfolge aus dem Kontoauszug (Verifikations-Pass): exakt so
            // wie die Zeilen im PDF untereinander stehen.
            statement_order: idx,
          }));

          const { error: txError } = await supabase.from("bank_transactions").insert(txRows);

          if (txError) {
            console.error("Transactions insert error:", txError);
          } else {
            console.log(`Inserted ${transactions.length} transactions`);
          }
        }
      }
    }

    // Update ingestion log with result. Move-Fehler wird an die Warnung
    // angehaengt, damit der User im Portal sieht, warum die Datei den
    // Temp-Namen behaelt.
    if (logEntry) {
      const combinedWarning = warningMessage;
      await supabase
        .from("document_ingestion_log")
        .update({
          status: documentId ? "completed" : "error",
          document_id: documentId,
          file_name: finalFileName,
          error_message: documentId ? null : "Failed to create DB record",
          warning_message: combinedWarning,
        })
        .eq("id", logEntry.id);
    }

    // Mark as processed if drive_file_id provided
    if (driveFileId) {
      await supabase.from("processed_drive_files").insert({
        user_id: userId,
        drive_file_id: driveFileId,
        file_name: finalFileName,
        folder_type: category,
      });
    }

    console.log("=== WORKFLOW COMPLETE ===");

    return new Response(
      JSON.stringify({
        success: true,
        message: "File processed successfully",
        documentId: documentId || null,
        documentType: docType,
        fileName: finalFileName,
        fileSize: fileSize,
        extractedData:
          docType !== "statement"
            ? {
                date: extractedData.date,
                issuer: extractedData.issuer,
                amount: extractedData.amount,
                type: extractedData.type,
              }
            : {
                bank: extractedData.summary?.bank,
                date: extractedData.summary?.date,
                transactions: (extractedData.transactions || []).length,
              },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
