import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      throw new Error("Not authenticated");
    }

    // Get all unmatched transactions (no bank type filter needed)
    const { data: transactions, error: transError } = await supabaseClient
      .from("bank_transactions")
      .select("*, bank_statements(bank_type)")
      .eq("match_status", "unmatched");

    if (transError) throw transError;

    // Get all invoices that are NOT already matched to a transaction
    const { data: matchedInvoiceIds, error: matchedError } = await supabaseClient
      .from("bank_transactions")
      .select("matched_invoice_id")
      .not("matched_invoice_id", "is", null);
    
    if (matchedError) throw matchedError;
    
    const alreadyMatchedIds = new Set((matchedInvoiceIds || []).map((t: any) => t.matched_invoice_id));
    
    const { data: allInvoices, error: invError } = await supabaseClient
      .from("invoices")
      .select("*");

    if (invError) throw invError;
    
    // Filter out already matched invoices
    const invoices = (allInvoices || []).filter((inv: any) => !alreadyMatchedIds.has(inv.id));

    if (!transactions || transactions.length === 0 || !invoices || invoices.length === 0) {
      return new Response(
        JSON.stringify({ success: true, matchedCount: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use Lovable AI Gateway for intelligent matching
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    // Confidence-Schwellen für die zweistufige Auto-Confirm-Logik:
    // - >= AUTO_CONFIRM_THRESHOLD → direkt als bestätigt speichern (vollautomatisch)
    // - >= SUGGEST_THRESHOLD       → als Vorschlag (matched) speichern, User bestätigt manuell
    // - <  SUGGEST_THRESHOLD       → ignoriert (kein Match)
    const AUTO_CONFIRM_THRESHOLD = 95;
    const SUGGEST_THRESHOLD = 60;

    let matchedCount = 0;
    let autoConfirmedCount = 0;

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
        const amountStr = foreignSpendMatch[1].replace(',', '.');
        const amount = parseFloat(amountStr);
        if (!isNaN(amount)) {
          console.log(`Extracted Foreign Spend Amount: ${amount}`);
          return amount;
        }
      }
      
      // Try simple "X.XX CURRENCY" format (e.g., "5.95 USD", "350.00 GBP")
      const simpleMatch = originalCurrency.match(/^([\d,.]+)\s*[A-Z]{3}/i);
      if (simpleMatch) {
        const amountStr = simpleMatch[1].replace(',', '.');
        const amount = parseFloat(amountStr);
        if (!isNaN(amount)) {
          console.log(`Extracted simple amount: ${amount}`);
          return amount;
        }
      }
      
      // Try to find any number followed by currency code
      const anyMatch = originalCurrency.match(/([\d,.]+)\s*(?:US Dollars|USD|EUR|GBP|CHF|JPY)/i);
      if (anyMatch) {
        const amountStr = anyMatch[1].replace(',', '.');
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
        transaction.bank_statements?.bank_type === "amex" && 
        transaction.original_currency !== null;
      
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
          // Check word-by-word matching
          const issuerWords = issuerLower.split(/[\s,.-]+/).filter((w: string) => w.length > 2);
          const descWords = transactionDesc.split(/[\s,.-]+/).filter((w: string) => w.length > 2);
          
          let matchedWords = 0;
          for (const issuerWord of issuerWords) {
            for (const descWord of descWords) {
              if (descWord.includes(issuerWord) || issuerWord.includes(descWord)) {
                matchedWords++;
                break;
              }
            }
          }
          
          if (issuerWords.length > 0) {
            nameScore = (matchedWords / issuerWords.length) * 80;
          }
        }
        
        // Amount matching with tolerance for currency differences (up to 10% difference)
        const amountDiff = Math.abs(matchAmount - inv.amount);
        const amountTolerance = Math.max(matchAmount, inv.amount) * 0.10; // 10% tolerance
        const exactMatch = amountDiff < 0.01;
        const closeMatch = amountDiff <= amountTolerance;
        
        let amountScore = 0;
        if (exactMatch) {
          amountScore = 100;
        } else if (closeMatch) {
          amountScore = 80 - (amountDiff / amountTolerance * 30); // 50-80 for close matches
        }
        
        // Combined score: prioritize name matches, use amount as validation
        const combinedScore = (nameScore * 0.6) + (amountScore * 0.4);
        
        return {
          invoice: inv,
          nameScore,
          amountScore,
          combinedScore,
          exactAmountMatch: exactMatch,
          closeAmountMatch: closeMatch
        };
      });
      
      // Filter potential matches: good name match OR exact amount match
      potentialMatches = invoicesWithScores
        .filter((item: any) => item.nameScore >= 50 || item.exactAmountMatch)
        .sort((a: any, b: any) => b.combinedScore - a.combinedScore)
        .map((item: any) => item.invoice);
      
      if (potentialMatches.length === 0) {
        // Fallback: exact amount match only
        potentialMatches = invoices.filter((inv: any) => {
          return Math.abs(matchAmount - inv.amount) < 0.01;
        });
      }

      if (potentialMatches.length === 0) continue;

      if (LOVABLE_API_KEY && potentialMatches.length >= 1) {
        // Use AI for intelligent matching - now also for single candidates with name matching
        try {
          const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-pro",
              messages: [
                {
                  role: "system",
                  content: `Du bist ein präziser Finanz-Matching-Assistent. Du ordnest Banktransaktionen den richtigen Rechnungen zu.

KRITERIEN (in dieser Reihenfolge gewichtet):

1. AUSSTELLER vs. VERWENDUNGSZWECK (höchste Priorität):
   - Der Aussteller-Name der Rechnung sollte im Verwendungszweck der Transaktion auftauchen.
   - Firmennamen variieren stark: "OpenAI" → "OPENAI SAN FRANCISCO CA", "Google Cloud" → "GOOGLE CLOUD EMEA LTD", "Hetzner" → "HETZNER ONLINE GMBH NUERNBE".
   - Abkürzungen, Standorte, Rechtsformen (GmbH, Ltd, Inc.) ignorieren.
   - Wenn der Kern-Name übereinstimmt → starkes Signal.

2. BETRAG MIT WÄHRUNGS-TOLERANZ:
   - Idealfall: exakte Übereinstimmung (±0.01€).
   - WICHTIG bei Fremdwährungen: Wenn die Rechnung z.B. in USD ist und der Betrag stimmt nahe mit dem Foreign Spend Amount der Transaktion überein, ist das ein sehr starker Treffer.
   - Bei SEPA-Überweisungen einer USD-Rechnung kann der EUR-Betrag um den Wechselkurs abweichen — bis zu ~10% sind plausibel wenn die Currency-Conversion durch eine Bank lief.
   - Reine Betrags-Matches OHNE Name-Match sind schwach (Confidence max. 70%).

3. DATUM-PLAUSIBILITÄT:
   - Rechnungsdatum liegt typischerweise 0-30 Tage VOR der Transaktion.
   - Bei Abos/wiederkehrend kann es exakter Tag oder ±wenige Tage sein.
   - Datum NACH der Transaktion ist verdächtig (außer bei Vorab-Rechnungen).

CONFIDENCE-SKALA:
- 95-100: Aussteller-Match perfekt + exakter Betrag (oder validierter USD/EUR-Match) + plausibles Datum
- 80-94: Aussteller-Match klar + Betrag passt mit Currency-Toleranz, oder Aussteller-Match perfekt + Datum etwas off
- 60-79: Aussteller-Match nur teilweise, oder reiner Betragstreffer ohne Name
- < 60:  Unsicher / kein guter Match — gib null zurück

WENN MEHRERE RECHNUNGEN PASSEN könnten: Wähle die mit der besten Aussteller-Übereinstimmung. Wenn keine eindeutig besser ist, wähle die mit Datum am nächsten zur Transaktion.

ANTWORT-FORMAT (NUR JSON, sonst nichts):
{ "matchedInvoiceId": "uuid oder null", "confidence": 0-100, "reason": "knappe Begründung in einem Satz" }`,
                },
                {
                  role: "user",
                  content: `Ordne diese Transaktion der besten Rechnung zu:

Transaktion:
- Datum: ${transaction.date}
- Verwendungszweck: ${transaction.description}
- Betrag (zur Match-Prüfung): ${matchAmount}${isAmexWithCurrencyConversion ? " (Foreign Spend Amount aus AMEX-Umrechnung)" : " EUR"}
- EUR-Betrag laut Bank: ${transactionAmount} EUR
${transaction.original_currency ? `- Original-Currency-Info: ${transaction.original_currency}` : ""}

Mögliche Rechnungen (vorgefiltert nach Name/Betrag):
${potentialMatches.map((inv: any) => `- ID: ${inv.id} | Aussteller: ${inv.issuer} | Betrag: ${inv.amount} ${inv.currency || "EUR"} | Datum: ${inv.date}`).join("\n")}`,
                },
              ],
            }),
          });

          if (response.ok) {
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;

            if (content) {
              try {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const result = JSON.parse(jsonMatch[0]);

                  if (result.matchedInvoiceId && result.confidence >= SUGGEST_THRESHOLD) {
                    // Hohe Confidence → automatisch als bestätigt setzen.
                    // Niedrigere Confidence → nur als Vorschlag, User bestätigt manuell.
                    const isAutoConfirm = result.confidence >= AUTO_CONFIRM_THRESHOLD;
                    const newStatus = isAutoConfirm ? "confirmed" : "matched";

                    await supabaseClient
                      .from("bank_transactions")
                      .update({
                        matched_invoice_id: result.matchedInvoiceId,
                        match_status: newStatus,
                        match_confidence: result.confidence,
                        match_reason: result.reason ?? null,
                      })
                      .eq("id", transaction.id);

                    console.log(
                      `${isAutoConfirm ? "AUTO-CONFIRMED" : "Matched"} transaction ${transaction.id} → invoice ${result.matchedInvoiceId} (${result.confidence}%): ${result.reason}`
                    );
                    matchedCount++;
                    if (isAutoConfirm) autoConfirmedCount++;
                    continue;
                  }
                }
              } catch (parseError) {
                console.error("Failed to parse AI response:", parseError);
              }
            }
          }
        } catch (aiError) {
          console.error("AI matching error:", aiError);
        }
      }

      // Fallback: Wenn KI nicht erreichbar war oder kein Match liefert,
      // und es genau EINEN Treffer mit exaktem Betrag gibt, gilt das als auto-bestätigt.
      const exactMatches = invoices.filter((inv: any) => Math.abs(matchAmount - inv.amount) < 0.01);
      if (exactMatches.length === 1) {
        const match = exactMatches[0];

        await supabaseClient
          .from("bank_transactions")
          .update({
            matched_invoice_id: match.id,
            match_status: "confirmed",
            match_confidence: 100,
            match_reason: "Exakter Betragstreffer (eindeutig)",
          })
          .eq("id", transaction.id);

        matchedCount++;
        autoConfirmedCount++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, matchedCount, autoConfirmedCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Auto-match error:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
