import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGoogleDrive } from "@/hooks/useGoogleDrive";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Cloud, CloudOff, Loader2, FolderSync, Check, Radio } from "lucide-react";

// Mapping of upload categories to Google Drive folder names
const FOLDER_MAPPING: Record<string, string> = {
  incoming: "01 Eingang (Provisionsabrechnungen, etc...)",
  outgoing: "02 Ausgang (Rechnungen, Belege, etc...)",
  volksbank: "03 VR-Bank Kontoauszüge",
  amex: "04 AMEX Kontoauszüge",
  commission: "05 Provisionsabrechnung",
  cash: "06 Kasse",
};

const POLL_INTERVAL = 10000; // 10 seconds

interface GoogleDriveSyncProps {
  category: "incoming" | "outgoing" | "volksbank" | "amex" | "commission" | "cash";
  onFilesImported: (files: File[]) => void;
}

interface SyncResult {
  connected: boolean;
  newFiles?: Array<{
    id: string;
    name: string;
    mimeType: string;
    content: string; // base64
  }>;
  totalInFolder?: number;
  alreadyProcessed?: number;
  message?: string;
  error?: string;
}

export function GoogleDriveSync({ category, onFilesImported }: GoogleDriveSyncProps) {
  const { toast } = useToast();
  const { isConnected, isLoading, connect, disconnect, handleCallback } = useGoogleDrive();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [stats, setStats] = useState<{ total: number; processed: number } | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (code) {
      window.history.replaceState({}, document.title, window.location.pathname);

      handleCallback(code)
        .then(() => {
          toast({
            title: "Google Drive verbunden",
            description: "Auto-Sync ist jetzt aktiv (alle 10 Sekunden).",
          });
        })
        .catch((error) => {
          toast({
            title: "Verbindung fehlgeschlagen",
            description: error.message,
            variant: "destructive",
          });
        });
    }
  }, [handleCallback, toast]);

  const syncFiles = useCallback(async (showToasts = false): Promise<number> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return 0;

      const response = await supabase.functions.invoke("sync-google-drive", {
        body: { folderType: category },
      });

      if (response.error) {
        console.error("Sync error:", response.error);
        return 0;
      }

      const result: SyncResult = response.data;

      if (!result.connected) {
        return 0;
      }

      setStats({
        total: result.totalInFolder || 0,
        processed: result.alreadyProcessed || 0,
      });

      if (result.newFiles && result.newFiles.length > 0) {
        // Convert base64 content to File objects
        const files: File[] = result.newFiles.map((f) => {
          const binary = atob(f.content);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return new File([bytes], f.name, { type: f.mimeType });
        });

        // Mark files as processed
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("processed_drive_files").insert(
            result.newFiles.map((f) => ({
              user_id: user.id,
              drive_file_id: f.id,
              file_name: f.name,
              folder_type: category,
            }))
          );
        }

        onFilesImported(files);

        if (showToasts || files.length > 0) {
          toast({
            title: `${files.length} neue Datei(en)`,
            description: `Aus "${FOLDER_MAPPING[category]}" importiert`,
          });
        }

        return files.length;
      }

      return 0;
    } catch (error) {
      console.error("Sync failed:", error);
      return 0;
    }
  }, [category, onFilesImported, toast]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const count = await syncFiles(true);
      setLastSync(new Date());
      if (count === 0) {
        toast({
          title: "Keine neuen Dateien",
          description: "Alle Dateien wurden bereits verarbeitet.",
        });
      }
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-polling when connected
  useEffect(() => {
    if (isConnected && !isLoading) {
      // Initial sync
      syncFiles(false).then(() => setLastSync(new Date()));

      // Start polling
      setIsPolling(true);
      pollIntervalRef.current = setInterval(async () => {
        await syncFiles(false);
        setLastSync(new Date());
      }, POLL_INTERVAL);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setIsPolling(false);
      };
    }
  }, [isConnected, isLoading, syncFiles]);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsPolling(false);

    try {
      await disconnect();
      toast({
        title: "Verbindung getrennt",
        description: "Google Drive Auto-Sync wurde deaktiviert.",
      });
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <Button variant="outline" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Lädt...
      </Button>
    );
  }

  if (!isConnected) {
    return (
      <Button variant="outline" onClick={handleConnect} className="gap-2">
        <Cloud className="h-4 w-4" />
        Mit Google Drive verbinden
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        {isPolling && (
          <Badge variant="secondary" className="gap-1 animate-pulse">
            <Radio className="h-3 w-3" />
            Live
          </Badge>
        )}
        {stats && (
          <span className="text-xs text-muted-foreground">
            {stats.processed}/{stats.total} verarbeitet
          </span>
        )}
      </div>
      
      <Button
        variant="outline"
        size="sm"
        onClick={handleManualSync}
        disabled={isSyncing}
        className="gap-2"
      >
        {isSyncing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sync...
          </>
        ) : (
          <>
            <FolderSync className="h-4 w-4" />
            Jetzt prüfen
          </>
        )}
      </Button>
      
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDisconnect}
        title="Google Drive trennen"
      >
        <CloudOff className="h-4 w-4" />
      </Button>
    </div>
  );
}
