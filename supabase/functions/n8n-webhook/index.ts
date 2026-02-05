import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const contentType = req.headers.get("content-type") || "";
    
    console.log("=== N8N WEBHOOK TEST ===");
    console.log("URL:", url.pathname);
    console.log("Method:", req.method);
    console.log("Content-Type:", contentType);
    console.log("Query Params:", Object.fromEntries(url.searchParams));
    
    // Log all headers
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    console.log("Headers:", JSON.stringify(headers));

    let fileInfo = null;
    let formFieldNames: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      console.log("Parsing multipart/form-data...");
      
      const formData = await req.formData();
      
      // Log all form field names
      formData.forEach((value, key) => {
        formFieldNames.push(key);
        if (value instanceof File) {
          console.log(`Field "${key}": File - name="${value.name}", size=${value.size}, type="${value.type}"`);
          fileInfo = {
            fieldName: key,
            fileName: value.name,
            fileSize: value.size,
            fileType: value.type,
          };
        } else {
          console.log(`Field "${key}": ${typeof value} - "${String(value).substring(0, 100)}"`);
        }
      });
    } else {
      console.log("Not multipart/form-data, raw body size:", (await req.clone().text()).length);
    }

    console.log("=== END TEST ===");

    // Return simple primitive response
    return new Response(
      JSON.stringify({
        success: true,
        message: "Test erfolgreich - Anfrage empfangen!",
        receivedAt: new Date().toISOString(),
        path: url.pathname,
        formFields: formFieldNames,
        fileReceived: fileInfo !== null,
        fileInfo: fileInfo,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
