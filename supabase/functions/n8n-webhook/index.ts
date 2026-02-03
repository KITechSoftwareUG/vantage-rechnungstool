import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Valid categories and their document types
const CATEGORY_CONFIG: Record<string, { documentType: "invoice" | "statement"; requiresMonth: boolean }> = {
  "incoming": { documentType: "invoice", requiresMonth: true },
  "outgoing": { documentType: "invoice", requiresMonth: true },
  "volksbank": { documentType: "statement", requiresMonth: false },
  "amex": { documentType: "statement", requiresMonth: false },
  "commission": { documentType: "statement", requiresMonth: false },
  "cash": { documentType: "statement", requiresMonth: false },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    
    // Expected path: /n8n-webhook/{category}/{year}[/{month}]
    // After removing "n8n-webhook", we get: [{category}, {year}, {month}?]
    const relevantParts = pathParts.slice(pathParts.indexOf("n8n-webhook") + 1);
    
    if (relevantParts.length < 2) {
      return new Response(
        JSON.stringify({ 
          error: "Invalid path. Expected: /n8n-webhook/{category}/{year} or /n8n-webhook/{category}/{year}/{month}",
          validCategories: Object.keys(CATEGORY_CONFIG),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const category = relevantParts[0];
    const year = parseInt(relevantParts[1], 10);
    const month = relevantParts[2] ? parseInt(relevantParts[2], 10) : null;

    // Validate category
    if (!CATEGORY_CONFIG[category]) {
      return new Response(
        JSON.stringify({ 
          error: `Invalid category: ${category}`,
          validCategories: Object.keys(CATEGORY_CONFIG),
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = CATEGORY_CONFIG[category];

    // Validate year
    if (isNaN(year) || year < 2020 || year > 2100) {
      return new Response(
        JSON.stringify({ error: `Invalid year: ${relevantParts[1]}. Must be between 2020-2100.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate month for invoice categories
    if (config.requiresMonth) {
      if (month === null || isNaN(month) || month < 1 || month > 12) {
        return new Response(
          JSON.stringify({ 
            error: `Category ${category} requires a valid month (1-12). Path: /n8n-webhook/${category}/${year}/{month}` 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get API key from header or query param
    const apiKey = req.headers.get("x-api-key") || url.searchParams.get("api_key");
    
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing API key. Provide via x-api-key header or api_key query param." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase with service role for inserting data
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify API key (stored as user profile setting or a dedicated table)
    // For now, we use the LOVABLE_API_KEY secret as a shared key
    const validApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (apiKey !== validApiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid API key." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the user ID from query param (required for multi-user setup)
    const userId = url.searchParams.get("user_id");
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Missing user_id query parameter." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the request body - expecting multipart/form-data with file
    const contentType = req.headers.get("content-type") || "";
    
    let fileData: Uint8Array | null = null;
    let fileName = "unknown";
    let mimeType = "application/pdf";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      
      if (!file) {
        return new Response(
          JSON.stringify({ error: "No file provided in form data. Use 'file' field." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      fileName = file.name;
      mimeType = file.type || "application/pdf";
      fileData = new Uint8Array(await file.arrayBuffer());
    } else if (contentType.includes("application/json")) {
      // Accept base64 encoded file
      const body = await req.json();
      
      if (!body.file_content || !body.file_name) {
        return new Response(
          JSON.stringify({ error: "JSON body must include 'file_content' (base64) and 'file_name'." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      fileName = body.file_name;
      mimeType = body.mime_type || "application/pdf";
      
      // Decode base64
      const binary = atob(body.file_content);
      fileData = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        fileData[i] = binary.charCodeAt(i);
      }
    } else {
      return new Response(
        JSON.stringify({ error: "Content-Type must be multipart/form-data or application/json." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate endpoint identifier
    const endpointId = month 
      ? `${category}/${year}/${String(month).padStart(2, "0")}`
      : `${category}/${year}`;

    // Log the ingestion attempt
    const { data: logEntry, error: logError } = await supabase
      .from("document_ingestion_log")
      .insert({
        user_id: userId,
        endpoint_category: category,
        endpoint_year: year,
        endpoint_month: month,
        file_name: fileName,
        document_type: config.documentType,
        status: "processing",
      })
      .select()
      .single();

    if (logError) {
      console.error("Log error:", logError);
    }

    // Upload file to storage
    const storagePath = config.documentType === "invoice" 
      ? `${userId}/invoices/${Date.now()}_${fileName}`
      : `${userId}/statements/${Date.now()}_${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, fileData, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      // Update log with error
      if (logEntry) {
        await supabase
          .from("document_ingestion_log")
          .update({ status: "error", error_message: uploadError.message })
          .eq("id", logEntry.id);
      }
      
      return new Response(
        JSON.stringify({ error: `Upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("documents")
      .getPublicUrl(storagePath);
    const fileUrl = urlData.publicUrl;

    // Create document record
    let documentId: string | null = null;

    if (config.documentType === "invoice") {
      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          user_id: userId,
          file_name: fileName,
          file_url: fileUrl,
          date: `${year}-${String(month || 1).padStart(2, "0")}-01`,
          year,
          month: month || 1,
          issuer: "n8n Import - Zur Überprüfung",
          amount: 0,
          type: category, // "incoming" or "outgoing"
          status: "pending",
          source_endpoint: endpointId,
        })
        .select()
        .single();

      if (invoiceError) {
        if (logEntry) {
          await supabase
            .from("document_ingestion_log")
            .update({ status: "error", error_message: invoiceError.message })
            .eq("id", logEntry.id);
        }
        
        return new Response(
          JSON.stringify({ error: `Invoice creation failed: ${invoiceError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      documentId = invoice?.id;
    } else {
      // Bank statement
      const bankNames: Record<string, string> = {
        volksbank: "Volksbank",
        amex: "American Express",
        commission: "Provisionsabrechnung",
        cash: "Kasse",
      };

      const { data: statement, error: statementError } = await supabase
        .from("bank_statements")
        .insert({
          user_id: userId,
          file_name: fileName,
          file_url: fileUrl,
          date: `${year}-01-01`,
          year,
          month: month || 1,
          bank: bankNames[category] || category,
          bank_type: category,
          account_number: "n8n Import",
          opening_balance: 0,
          closing_balance: 0,
          status: "pending",
          source_endpoint: endpointId,
        })
        .select()
        .single();

      if (statementError) {
        if (logEntry) {
          await supabase
            .from("document_ingestion_log")
            .update({ status: "error", error_message: statementError.message })
            .eq("id", logEntry.id);
        }
        
        return new Response(
          JSON.stringify({ error: `Statement creation failed: ${statementError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      documentId = statement?.id;
    }

    // Update log with success
    if (logEntry) {
      await supabase
        .from("document_ingestion_log")
        .update({ status: "success", document_id: documentId })
        .eq("id", logEntry.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Document received via ${endpointId}`,
        document_id: documentId,
        document_type: config.documentType,
        file_name: fileName,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Webhook error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});