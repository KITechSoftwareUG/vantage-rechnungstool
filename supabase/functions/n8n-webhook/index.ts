import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// German to English category mapping
const CATEGORY_ALIASES: Record<string, string> = {
  // German names
  "eingang": "incoming",
  "ausgang": "outgoing",
  "vrbank": "volksbank",
  "vr-bank": "volksbank",
  "provision": "commission",
  "kasse": "cash",
  // English names (passthrough)
  "incoming": "incoming",
  "outgoing": "outgoing",
  "volksbank": "volksbank",
  "amex": "amex",
  "commission": "commission",
  "cash": "cash",
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
          error: "Ungültiger Pfad. Erwartet: /n8n-webhook/{kategorie}/{jahr} oder /n8n-webhook/{kategorie}/{jahr}/{monat}",
          gueltigeKategorien: Object.keys(CATEGORY_ALIASES),
          beispiel: "/n8n-webhook/eingang/2026/1",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawCategory = relevantParts[0].toLowerCase();
    const year = parseInt(relevantParts[1], 10);
    const month = relevantParts[2] ? parseInt(relevantParts[2], 10) : null;

    // Map category alias to canonical name
    const category = CATEGORY_ALIASES[rawCategory];
    
    if (!category) {
      return new Response(
        JSON.stringify({ 
          error: `Unbekannte Kategorie: ${rawCategory}`,
          gueltigeKategorien: Object.keys(CATEGORY_ALIASES),
          beispiele: {
            "eingang": "Eingangsrechnungen (Ausgaben)",
            "ausgang": "Ausgangsrechnungen (Einnahmen)",
            "volksbank": "VR-Bank Kontoauszüge",
            "amex": "American Express Auszüge",
            "provision": "Provisionsabrechnungen",
            "kasse": "Kassenbuch",
          },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = CATEGORY_CONFIG[category];

    // Validate year
    if (isNaN(year) || year < 2020 || year > 2100) {
      return new Response(
        JSON.stringify({ error: `Ungültiges Jahr: ${relevantParts[1]}. Muss zwischen 2020-2100 liegen.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate month for invoice categories
    if (config.requiresMonth) {
      if (month === null || isNaN(month) || month < 1 || month > 12) {
        return new Response(
          JSON.stringify({ 
            error: `Kategorie ${rawCategory} benötigt einen gültigen Monat (1-12). Pfad: /n8n-webhook/${rawCategory}/${year}/{monat}` 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get API key from header or query param (OPTIONAL now, but recommended)
    const apiKey = req.headers.get("x-api-key") || url.searchParams.get("api_key");
    const validApiKey = Deno.env.get("N8N_API_KEY");
    
    // Only validate API key if N8N_API_KEY is configured AND a key was provided
    if (validApiKey && validApiKey.length > 0) {
      if (apiKey && apiKey !== validApiKey) {
        return new Response(
          JSON.stringify({ error: "Ungültiger API-Key." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Note: If no API key is provided but one is configured, we still allow the request
      // This makes the API key optional for easier n8n setup
    }

    // Initialize Supabase with service role for inserting data
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the user ID from query param (required for multi-user setup)
    const userId = url.searchParams.get("user_id");
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Fehlender user_id Query-Parameter." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get optional drive_file_id for deduplication with Google Drive Sync
    const driveFileId = url.searchParams.get("drive_file_id");

    // If drive_file_id provided, check if already processed
    if (driveFileId) {
      const { data: existingFile } = await supabase
        .from("processed_drive_files")
        .select("id")
        .eq("user_id", userId)
        .eq("drive_file_id", driveFileId)
        .maybeSingle();

      if (existingFile) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Datei bereits verarbeitet (Duplikat)", 
            deduplicated: true,
            drive_file_id: driveFileId,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Parse the request body - expecting multipart/form-data with file
    const contentType = req.headers.get("content-type") || "";
    
    let fileData: Uint8Array | null = null;
    let fileName = "unknown";
    let mimeType = "application/pdf";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      // n8n sends file as 'data', but also accept 'file' as fallback
      const file = (formData.get("data") || formData.get("file")) as File | null;
      
      if (!file) {
        // Log available fields for debugging
        const availableFields: string[] = [];
        formData.forEach((_, key) => availableFields.push(key));
        
        return new Response(
          JSON.stringify({ 
            error: "Keine Datei im Form-Data gefunden.", 
            hinweis: "Verwende das Feld 'data' oder 'file'.",
            gefundeneFelder: availableFields,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      fileName = file.name || "uploaded_file.pdf";
      mimeType = file.type || "application/pdf";
      fileData = new Uint8Array(await file.arrayBuffer());
    } else if (contentType.includes("application/json")) {
      // Accept base64 encoded file
      const body = await req.json();
      
      if (!body.file_content || !body.file_name) {
        return new Response(
          JSON.stringify({ error: "JSON-Body muss 'file_content' (base64) und 'file_name' enthalten." }),
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
        JSON.stringify({ error: "Content-Type muss multipart/form-data oder application/json sein." }),
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
        JSON.stringify({ error: `Upload fehlgeschlagen: ${uploadError.message}` }),
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
          JSON.stringify({ error: `Rechnung konnte nicht erstellt werden: ${invoiceError.message}` }),
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
          JSON.stringify({ error: `Kontoauszug konnte nicht erstellt werden: ${statementError.message}` }),
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

    // If drive_file_id provided, mark as processed for deduplication
    if (driveFileId) {
      await supabase
        .from("processed_drive_files")
        .insert({
          user_id: userId,
          drive_file_id: driveFileId,
          file_name: fileName,
          folder_type: category,
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Dokument empfangen über ${endpointId}`,
        document_id: documentId,
        document_type: config.documentType,
        file_name: fileName,
        drive_file_id: driveFileId || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Webhook error:", error);
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
