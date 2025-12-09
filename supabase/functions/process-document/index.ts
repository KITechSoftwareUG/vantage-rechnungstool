import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
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
      prompt = `Analysiere diesen Kontoauszug und extrahiere folgende Informationen im JSON-Format:
      - bank: Name der Bank
      - accountNumber: Kontonummer oder IBAN
      - date: Datum des Auszugs im Format YYYY-MM-DD
      - openingBalance: Anfangssaldo als Zahl
      - closingBalance: Endsaldo als Zahl
      
      Antworte NUR mit dem JSON-Objekt, keine andere Erklärung.
      Beispiel: {"bank": "Deutsche Bank", "accountNumber": "DE89 3704 0044 0532 0130 00", "date": "2024-01-31", "openingBalance": 12500.00, "closingBalance": 14250.00}`;
    }

    console.log(`Processing ${documentType} OCR for file: ${file.name}`);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
    });

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
          bank: "Unbekannt",
          accountNumber: "Unbekannt",
          date: new Date().toISOString().split("T")[0],
          openingBalance: 0,
          closingBalance: 0,
        };
      }
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
