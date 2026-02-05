import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Map German month names to numbers
const monthMap: Record<string, number> = {
  januar: 1, februar: 2, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

// Map category to document type
const categoryMap: Record<string, string> = {
  eingang: "incoming",
  ausgang: "outgoing",
  vrbank: "vrbank",
  provision: "provision",
  kasse: "cash",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    
    // Expected path: /n8n-webhook/{category}/{year}/{month}
    // pathParts: ["n8n-webhook", "eingang", "2026", "januar"]
    const category = pathParts[1]?.toLowerCase();
    const year = parseInt(pathParts[2], 10);
    const monthName = pathParts[3]?.toLowerCase();
    const month = monthMap[monthName];

    const userId = url.searchParams.get("user_id");
    const driveFileId = url.searchParams.get("drive_file_id");
    const contentType = req.headers.get("content-type") || "";

    console.log("=== N8N WEBHOOK ===");
    console.log("Path:", url.pathname);
    console.log("Category:", category, "→", categoryMap[category]);
    console.log("Year:", year, "Month:", month);
    console.log("User ID:", userId);
    console.log("Content-Type:", contentType);

    // Validate required parameters
    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing user_id parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!category || !categoryMap[category]) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid category: ${category}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!year || !month) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid year or month in path" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Read the file from request body (n8n sends as raw binary)
    const fileBuffer = await req.arrayBuffer();
    const fileSize = fileBuffer.byteLength;

    if (fileSize === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Empty file received" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("File size:", fileSize, "bytes");

    // Generate filename based on timestamp
    const timestamp = Date.now();
    const extension = contentType.includes("pdf") ? "pdf" : "bin";
    const fileName = `n8n_${category}_${year}_${month}_${timestamp}.${extension}`;

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
        return new Response(
          JSON.stringify({ success: true, message: "File already processed", duplicate: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Upload file to Supabase Storage
    const storagePath = `${userId}/${year}/${month}/${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, fileBuffer, {
        contentType: contentType || "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({ success: false, error: `Upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from("documents").getPublicUrl(storagePath);
    const fileUrl = urlData?.publicUrl;

    console.log("File uploaded:", storagePath);

    // Log ingestion
    const { error: logError } = await supabase.from("document_ingestion_log").insert({
      user_id: userId,
      file_name: fileName,
      document_type: categoryMap[category],
      endpoint_category: category,
      endpoint_year: year,
      endpoint_month: month,
      status: "received",
    });

    if (logError) {
      console.error("Log error:", logError);
    }

    // Mark as processed if drive_file_id provided
    if (driveFileId) {
      await supabase.from("processed_drive_files").insert({
        user_id: userId,
        drive_file_id: driveFileId,
        file_name: fileName,
        folder_type: category,
      });
    }

    console.log("=== SUCCESS ===");

    return new Response(
      JSON.stringify({
        success: true,
        message: "File received and stored",
        fileName: fileName,
        fileSize: fileSize,
        storagePath: storagePath,
        fileUrl: fileUrl,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
