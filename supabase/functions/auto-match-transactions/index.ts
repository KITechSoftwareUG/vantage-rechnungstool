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

    const { bankType } = await req.json();

    // Get unmatched transactions
    const { data: transactions, error: transError } = await supabaseClient
      .from("bank_transactions")
      .select("*, bank_statements!inner(bank_type)")
      .eq("match_status", "unmatched")
      .eq("bank_statements.bank_type", bankType);

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

    // Process transactions in batches for AI matching
    for (const transaction of transactions) {
      // Find potential matches based on amount similarity
      const potentialMatches = invoices.filter((inv: any) => {
        const amountDiff = Math.abs(Math.abs(transaction.amount) - inv.amount);
        const percentDiff = amountDiff / Math.max(Math.abs(transaction.amount), inv.amount);
        return percentDiff < 0.1; // Within 10% of amount
      });

      if (potentialMatches.length === 0) continue;

      if (LOVABLE_API_KEY && potentialMatches.length > 1) {
        // Use AI to find the best match
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
                  - Amount similarity
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
                  - Amount: ${Math.abs(transaction.amount)} EUR
                  
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
                // Extract JSON from response
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

      // Fallback: Simple amount-based matching
      if (potentialMatches.length === 1) {
        const match = potentialMatches[0];
        const amountDiff = Math.abs(Math.abs(transaction.amount) - match.amount);
        const percentDiff = amountDiff / Math.max(Math.abs(transaction.amount), match.amount);
        const confidence = Math.round((1 - percentDiff) * 100);

        if (confidence >= 95) {
          await supabaseClient
            .from("bank_transactions")
            .update({
              matched_invoice_id: match.id,
              match_status: "matched",
              match_confidence: confidence,
            })
            .eq("id", transaction.id);

          matchedCount++;
        }
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
