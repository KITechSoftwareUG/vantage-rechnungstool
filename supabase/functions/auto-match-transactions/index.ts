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

    // Get all unmatched invoices
    const { data: invoices, error: invError } = await supabaseClient
      .from("invoices")
      .select("*");

    if (invError) throw invError;

    if (!transactions || transactions.length === 0 || !invoices || invoices.length === 0) {
      return new Response(
        JSON.stringify({ success: true, matchedCount: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use Lovable AI Gateway for intelligent matching
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    let matchedCount = 0;

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
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: `Du bist ein Finanz-Matching-Assistent. Ordne Banktransaktionen zu Rechnungen zu basierend auf:
                  
                  1. NAMEN-MATCHING (HÖCHSTE PRIORITÄT):
                     - Vergleiche den Aussteller der Rechnung mit dem Verwendungszweck der Transaktion
                     - Firmen können leicht unterschiedliche Namen haben (z.B. "OpenAI" vs "OPENAI SAN FRANCISCO")
                     - Auch Abkürzungen und verschiedene Schreibweisen berücksichtigen
                  
                  2. BETRAG (WICHTIG, ABER MIT TOLERANZ):
                     - Beträge sollten ungefähr übereinstimmen
                     - Bei Währungsumrechnungen kann es Abweichungen bis zu 10% geben
                     - Exakte Betragsübereinstimmung ist ein gutes Zeichen, aber nicht zwingend erforderlich
                  
                  3. DATUM:
                     - Rechnungsdatum sollte vor oder nahe am Transaktionsdatum liegen
                  
                  Antworte NUR mit einem JSON-Objekt: { "matchedInvoiceId": "id oder null", "confidence": 0-100, "reason": "kurze Begründung" }`,
                },
                {
                  role: "user",
                  content: `Ordne diese Transaktion der besten Rechnung zu:
                  
                  Transaktion:
                  - Datum: ${transaction.date}
                  - Verwendungszweck: ${transaction.description}
                  - Betrag: ${matchAmount} EUR
                  ${transaction.original_currency ? `- Originalwährung: ${transaction.original_currency}` : ''}
                  
                  Mögliche Rechnungen:
                  ${potentialMatches.map((inv: any) => `- ID: ${inv.id}, Aussteller: ${inv.issuer}, Betrag: ${inv.amount} EUR, Datum: ${inv.date}`).join("\n")}`,
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
                  
                  if (result.matchedInvoiceId && result.confidence >= 60) {
                    await supabaseClient
                      .from("bank_transactions")
                      .update({
                        matched_invoice_id: result.matchedInvoiceId,
                        match_status: "matched",
                        match_confidence: result.confidence,
                      })
                      .eq("id", transaction.id);

                    console.log(`Matched transaction ${transaction.id} to invoice ${result.matchedInvoiceId} with ${result.confidence}% confidence: ${result.reason}`);
                    matchedCount++;
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

      // Fallback: If only one match with exact amount, use it
      const exactMatches = invoices.filter((inv: any) => Math.abs(matchAmount - inv.amount) < 0.01);
      if (exactMatches.length === 1) {
        const match = exactMatches[0];

        await supabaseClient
          .from("bank_transactions")
          .update({
          matched_invoice_id: match.id,
          match_status: "matched",
          match_confidence: 100,
          })
          .eq("id", transaction.id);

        matchedCount++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, matchedCount }),
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
