import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Convert ArrayBuffer to base64 in chunks to avoid stack overflow
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunks
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binary);
}

// Retry fetch with exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelay = 1000
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Retry on 502, 503, 504 errors - DON'T consume the body, just check status
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        console.log(`Attempt ${attempt + 1}: Got ${response.status}, retrying...`);
        lastError = new Error(`AI Gateway error: ${response.status}`);
        
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        // Last attempt failed with gateway error - throw error instead of returning consumed response
        throw lastError;
      }
      
      return response;
    } catch (error) {
      console.log(`Attempt ${attempt + 1}: Network error, retrying...`, error);
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error("Max retries exceeded");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const documentType = formData.get("type") as string; // "invoice" or "statement"

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Convert file to base64 using chunked approach
    const arrayBuffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const mimeType = file.type || "application/pdf";

    let prompt = "";
    if (documentType === "invoice") {
      prompt = `Analysiere dieses Dokument als Rechnung und extrahiere folgende Informationen im JSON-Format:
      - date: Rechnungsdatum im Format YYYY-MM-DD
      - issuer: Name des Ausstellers/Unternehmens
      - amount: Gesamtbetrag als Zahl (ohne Währungssymbol)
      - type: "incoming" wenn es eine Eingangsrechnung ist (Geld kommt rein), "outgoing" wenn es eine Ausgangsrechnung ist (Geld geht raus)
      
      Antworte NUR mit dem JSON-Objekt, keine andere Erklärung.
      Beispiel: {"date": "2024-01-15", "issuer": "Firma GmbH", "amount": 1250.50, "type": "incoming"}`;
    } else {
      // Bank statement - extract BOTH summary AND individual transactions
      prompt = `Analysiere diesen Kontoauszug und extrahiere folgende Informationen im JSON-Format:

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
      - amount: Betrag als positive Zahl in EUR (der finale abgerechnete Betrag in Euro)
      - type: "credit" für Gutschriften/Einzahlungen, "debit" für Abbuchungen/Ausgaben
      - originalCurrency: SEHR WICHTIG für Währungsumrechnungen (besonders bei American Express):
        Wenn die Transaktion ursprünglich in einer Fremdwährung war (USD, GBP, CHF etc.) und dann in EUR umgerechnet wurde:
        Gib den KOMPLETTEN Original-Text der Umrechnung an, z.B. "Foreign Spend Amount: 5.95 US Dollars Commission Amount: 0.1 Currency Exchange Rate: 1.1531"
        oder wenn nur der Originalbetrag verfügbar ist: "5.95 USD"
        Wenn keine Umrechnung stattfand (also originär EUR), dann null.
        Suche nach Spalten wie "Fremdwährung", "Originalbetrag", "Foreign Spend Amount", etc.

      Antworte NUR mit dem JSON-Objekt, keine andere Erklärung.
      
      Beispiel:
      {
        "summary": {
          "bank": "American Express",
          "bankType": "amex",
          "accountNumber": "XXXX-123456",
          "date": "2024-01-31",
          "openingBalance": 0,
          "closingBalance": 1450.00
        },
        "transactions": [
          {"date": "2024-01-05", "description": "OPENAI SAN FRANCISCO", "amount": 5.26, "type": "debit", "originalCurrency": "Foreign Spend Amount: 5.95 US Dollars Commission Amount: 0.1 Currency Exchange Rate: 1.1531"},
          {"date": "2024-01-10", "description": "Hotel London", "amount": 410.00, "type": "debit", "originalCurrency": "350.00 GBP"},
          {"date": "2024-01-15", "description": "Restaurant München", "amount": 85.00, "type": "debit", "originalCurrency": null}
        ]
      }`;
    }

    console.log(`Processing ${documentType} OCR for file: ${file.name}, size: ${arrayBuffer.byteLength} bytes`);

    const response = await fetchWithRetry(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${base64}`,
                  },
                },
              ],
            },
          ],
        }),
      },
      3, // max retries
      2000 // base delay 2 seconds
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    console.log("AI Response:", content);

    // Parse JSON from response
    let extractedData;
    try {
      // Try to find JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      // Return default values if parsing fails
      if (documentType === "invoice") {
        extractedData = {
          date: new Date().toISOString().split("T")[0],
          issuer: "Unbekannt",
          amount: 0,
          type: "outgoing",
        };
      } else {
        extractedData = {
          summary: {
            bank: "Unbekannt",
            bankType: "volksbank",
            accountNumber: "Unbekannt",
            date: new Date().toISOString().split("T")[0],
            openingBalance: 0,
            closingBalance: 0,
          },
          transactions: [],
        };
      }
    }

    // For backward compatibility with old statement format
    if (documentType === "statement" && !extractedData.summary) {
      extractedData = {
        summary: {
          bank: extractedData.bank || "Unbekannt",
          bankType: extractedData.bankType || "volksbank",
          accountNumber: extractedData.accountNumber || "Unbekannt",
          date: extractedData.date || new Date().toISOString().split("T")[0],
          openingBalance: extractedData.openingBalance || 0,
          closingBalance: extractedData.closingBalance || 0,
        },
        transactions: extractedData.transactions || [],
      };
    }

    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("OCR processing error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "OCR processing failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
