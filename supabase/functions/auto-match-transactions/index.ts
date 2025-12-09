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
      
      // Always match by exact amount (within 1 cent tolerance)
      potentialMatches = invoices.filter((inv: any) => {
        return Math.abs(matchAmount - inv.amount) < 0.01;
      });

      if (potentialMatches.length === 0) continue;

      if (LOVABLE_API_KEY && potentialMatches.length > 1) {
        // Use AI to find the best match when multiple candidates
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
                  content: `You are a financial matching assistant. Match bank transactions to invoices based on:
                  - Amount matching (already pre-filtered)
                  - Date proximity (invoice date should be close to or before transaction date)
                  - Description matching (company names, reference numbers)
                  
                  Return ONLY a JSON object with: { "matchedInvoiceId": "id or null", "confidence": 0-100, "reason": "brief explanation" }`,
                },
                {
                  role: "user",
                  content: `Match this transaction to the best invoice:
                  
                  Transaction:
                  - Date: ${transaction.date}
                  - Description: ${transaction.description}
                  - Amount: ${matchAmount} EUR
                  
                  Possible invoices:
                  ${potentialMatches.map((inv: any) => `- ID: ${inv.id}, Issuer: ${inv.issuer}, Amount: ${inv.amount} EUR, Date: ${inv.date}`).join("\n")}`,
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
                  
                  if (result.matchedInvoiceId && result.confidence >= 70) {
                    await supabaseClient
                      .from("bank_transactions")
                      .update({
                        matched_invoice_id: result.matchedInvoiceId,
                        match_status: "matched",
                        match_confidence: result.confidence,
                      })
                      .eq("id", transaction.id);

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

      // Fallback: If only one match, use it with 100% confidence (exact amount match)
      if (potentialMatches.length === 1) {
        const match = potentialMatches[0];

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
