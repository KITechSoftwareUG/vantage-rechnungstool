import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Folders with monthly subfolders
const FOLDERS_WITH_MONTHS = ["incoming", "outgoing"];

// Month subfolder names
const MONTH_FOLDERS = [
  "01 Januar", "02 Februar", "03 März", "04 April",
  "05 Mai", "06 Juni", "07 Juli", "08 August",
  "09 September", "10 Oktober", "11 November", "12 Dezember"
];

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
  "image/jpg",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
}

async function getAccessToken(supabase: any, userId: string): Promise<string | null> {
  const { data: tokenData, error } = await supabase
    .from("google_drive_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !tokenData) {
    return null;
  }

  const expiresAt = new Date(tokenData.expires_at);
  const now = new Date();

  if (expiresAt <= now) {
    // Refresh token
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

    const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const newTokens = await refreshResponse.json();

    if (newTokens.error) {
      await supabase
        .from("google_drive_tokens")
        .delete()
        .eq("user_id", userId);
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

  return tokenData.access_token;
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

async function getSubfolders(accessToken: string, parentId: string): Promise<Array<{id: string, name: string}>> {
  const query = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  return data.files || [];
}

async function getFilesInFolder(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const mimeTypeQuery = SUPPORTED_MIME_TYPES.map(m => `mimeType='${m}'`).join(" or ");
  const query = `'${folderId}' in parents and (${mimeTypeQuery}) and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,parents)`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  return data.files || [];
}

// Get files from folder, including month subfolders if applicable
async function getFilesWithMonthInfo(
  accessToken: string, 
  folderId: string, 
  folderType: string
): Promise<Array<DriveFile & { month?: number }>> {
  // Check if this folder type has month subfolders
  if (FOLDERS_WITH_MONTHS.includes(folderType)) {
    const subfolders = await getSubfolders(accessToken, folderId);
    const allFiles: Array<DriveFile & { month?: number }> = [];
    
    for (const subfolder of subfolders) {
      // Extract month number from folder name (e.g., "01 Januar" -> 1)
      const monthMatch = subfolder.name.match(/^(\d{2})\s/);
      const month = monthMatch ? parseInt(monthMatch[1], 10) : null;
      
      const files = await getFilesInFolder(accessToken, subfolder.id);
      allFiles.push(...files.map(f => ({ ...f, month: month || undefined })));
    }
    
    return allFiles;
  } else {
    // No subfolders, get files directly
    const files = await getFilesInFolder(accessToken, folderId);
    return files.map(f => ({ ...f, month: undefined }));
  }
}

async function downloadFile(accessToken: string, fileId: string): Promise<ArrayBuffer> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.arrayBuffer();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error("User not found");
    }

    const { folderType } = await req.json();

    // Get Google access token
    const accessToken = await getAccessToken(supabase, user.id);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ connected: false, message: "Google Drive not connected" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find the folder
    const folderName = FOLDER_MAPPING[folderType];
    if (!folderName) {
      throw new Error(`Unknown folder type: ${folderType}`);
    }

    const folderId = await findFolderByName(accessToken, folderName);
    if (!folderId) {
      return new Response(
        JSON.stringify({ 
          connected: true, 
          newFiles: [], 
          message: `Folder "${folderName}" not found` 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get files in folder (including month subfolders for incoming/outgoing)
    const allFiles = await getFilesWithMonthInfo(accessToken, folderId, folderType);

    // Get already processed files
    const { data: processedFiles } = await supabase
      .from("processed_drive_files")
      .select("drive_file_id")
      .eq("user_id", user.id)
      .eq("folder_type", folderType);

    const processedIds = new Set(processedFiles?.map(f => f.drive_file_id) || []);

    // Filter to only new files
    const newFiles = allFiles.filter(f => !processedIds.has(f.id));

    // Download and return new files with their content (including month info)
    const filesWithContent = await Promise.all(
      newFiles.slice(0, 10).map(async (file) => { // Limit to 10 files per sync
        try {
          const content = await downloadFile(accessToken, file.id);
          const base64 = btoa(String.fromCharCode(...new Uint8Array(content)));
          return {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            content: base64,
            month: file.month, // Include month from subfolder
          };
        } catch (e) {
          console.error(`Failed to download ${file.name}:`, e);
          return null;
        }
      })
    );

    const validFiles = filesWithContent.filter(f => f !== null);

    return new Response(
      JSON.stringify({
        connected: true,
        newFiles: validFiles,
        totalInFolder: allFiles.length,
        alreadyProcessed: processedIds.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
