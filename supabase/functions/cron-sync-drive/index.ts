import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Default year for cron sync
const DEFAULT_YEAR = 2026;

const FOLDER_MAPPING: Record<string, string> = {
  "incoming": "01 Eingang",
  "outgoing": "02 Ausgang",
  "commission": "03 Provisionsabrechnung",
  "volksbank": "04 VR-Bank Kontoauszüge",
  "amex": "05 AMEX Kontoauszüge",
  "cash": "06 Kasse",
};

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/csv",
];

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

async function refreshAccessToken(supabase: any, userId: string, refreshToken: string): Promise<string | null> {
  const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const newTokens = await refreshResponse.json();

  if (newTokens.error) {
    console.error(`Token refresh failed for user ${userId}:`, newTokens.error);
    await supabase.from("google_drive_tokens").delete().eq("user_id", userId);
    return null;
  }

  const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

  await supabase
    .from("google_drive_tokens")
    .update({
      access_token: newTokens.access_token,
      expires_at: newExpiresAt.toISOString(),
    })
    .eq("user_id", userId);

  return newTokens.access_token;
}

async function findFolderByName(accessToken: string, folderName: string, parentId?: string): Promise<string | null> {
  let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  return data.files?.[0]?.id || null;
}

async function getFilesInFolder(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const mimeTypeQuery = SUPPORTED_MIME_TYPES.map(m => `mimeType='${m}'`).join(" or ");
  const query = `'${folderId}' in parents and (${mimeTypeQuery}) and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  return data.files || [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("Cron sync started at:", new Date().toISOString());

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all users with Google Drive tokens
    const { data: tokens, error: tokensError } = await supabase
      .from("google_drive_tokens")
      .select("*");

    if (tokensError || !tokens || tokens.length === 0) {
      console.log("No connected Google Drive accounts found");
      return new Response(
        JSON.stringify({ message: "No accounts to sync", synced: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalNewFiles = 0;

    for (const tokenData of tokens) {
      const userId = tokenData.user_id;
      console.log(`Processing user: ${userId}`);

      // Check if token needs refresh
      let accessToken = tokenData.access_token;
      const expiresAt = new Date(tokenData.expires_at);

      if (expiresAt <= new Date()) {
        accessToken = await refreshAccessToken(supabase, userId, tokenData.refresh_token);
        if (!accessToken) {
          console.log(`Skipping user ${userId} - token refresh failed`);
          continue;
        }
      }

      // First find the year folder
      const yearFolderId = await findFolderByName(accessToken, DEFAULT_YEAR.toString());
      if (!yearFolderId) {
        console.log(`Year folder "${DEFAULT_YEAR}" not found for user ${userId}`);
        continue;
      }

      // Process each folder within the year folder
      for (const [folderType, folderName] of Object.entries(FOLDER_MAPPING)) {
        const folderId = await findFolderByName(accessToken, folderName, yearFolderId);
        if (!folderId) {
          console.log(`Folder "${folderName}" not found in ${DEFAULT_YEAR} for user ${userId}`);
          continue;
        }

        const allFiles = await getFilesInFolder(accessToken, folderId);

        // Get already processed files
        const { data: processedFiles } = await supabase
          .from("processed_drive_files")
          .select("drive_file_id")
          .eq("user_id", userId)
          .eq("folder_type", folderType);

        const processedIds = new Set(processedFiles?.map(f => f.drive_file_id) || []);
        const newFiles = allFiles.filter(f => !processedIds.has(f.id));

        if (newFiles.length > 0) {
          console.log(`Found ${newFiles.length} new files in "${folderName}" for user ${userId}`);
          totalNewFiles += newFiles.length;

          // Mark files as detected (processing will happen client-side)
          // We just track that they exist for background monitoring
        }
      }
    }

    console.log(`Cron sync completed. Total new files detected: ${totalNewFiles}`);

    return new Response(
      JSON.stringify({ 
        message: "Cron sync completed", 
        newFilesDetected: totalNewFiles,
        usersProcessed: tokens.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Cron sync error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
