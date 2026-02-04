import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { 
  Cloud, 
  CloudOff, 
  Loader2, 
  FolderSync, 
  CheckCircle2, 
  AlertCircle,
  RefreshCw,
  Folder
} from "lucide-react";

// Mapping of folder types to Google Drive folder names
const FOLDER_MAPPING: Record<string, string> = {
  incoming: "Eingangsrechnungen",
  outgoing: "Ausgangsrechnungen",
  volksbank: "03 VR-Bank Kontoauszüge",
  amex: "04 AMEX Kontoauszüge",
  commission: "05 Provisionsabrechnung",
  cash: "06 Kasse",
};

interface SyncStatus {
  isConnected: boolean;
  isLoading: boolean;
  lastSync: Date | null;
  totalFiles: number;
  processedFiles: number;
  newFilesCount: number;
}

export function GoogleDriveSyncCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>({
    isConnected: false,
    isLoading: true,
    lastSync: null,
    totalFiles: 0,
    processedFiles: 0,
    newFilesCount: 0,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Check connection status
  const checkConnection = useCallback(async () => {
    if (!user) {
      setStatus(prev => ({ ...prev, isLoading: false, isConnected: false }));
      return;
    }

    try {
      const response = await supabase.functions.invoke("google-drive-auth", {
        body: { action: "get-access-token" },
      });

      if (response.error) {
        setStatus(prev => ({ ...prev, isLoading: false, isConnected: false }));
        return;
      }

      setStatus(prev => ({
        ...prev,
        isLoading: false,
        isConnected: response.data?.connected ?? false,
      }));
    } catch (error) {
      console.error("Connection check failed:", error);
      setStatus(prev => ({ ...prev, isLoading: false, isConnected: false }));
    }
  }, [user]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (code) {
      window.history.replaceState({}, document.title, window.location.pathname);
      handleCallback(code);
    }
  }, []);

  const handleCallback = async (code: string) => {
    setIsConnecting(true);
    try {
      const redirectUri = localStorage.getItem("google_drive_redirect_uri");
      if (!redirectUri) {
        throw new Error("Missing redirect URI");
      }

      const response = await supabase.functions.invoke("google-drive-auth", {
        body: { action: "exchange-code", code, redirectUri },
      });

      if (response.error) {
        throw response.error;
      }

      localStorage.removeItem("google_drive_redirect_uri");
      
      toast({
        title: "Google Drive verbunden",
        description: "Du kannst jetzt Dokumente synchronisieren.",
      });

      await checkConnection();
    } catch (error: any) {
      toast({
        title: "Verbindung fehlgeschlagen",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/upload`;
      localStorage.setItem("google_drive_redirect_uri", redirectUri);

      const response = await supabase.functions.invoke("google-drive-auth", {
        body: { action: "get-auth-url", redirectUri },
      });

      if (response.error) {
        throw response.error;
      }

      window.location.href = response.data.authUrl;
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message,
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const response = await supabase.functions.invoke("google-drive-auth", {
        body: { action: "disconnect" },
      });

      if (response.error) {
        throw response.error;
      }

      setStatus(prev => ({ ...prev, isConnected: false }));
      toast({
        title: "Verbindung getrennt",
        description: "Google Drive wurde getrennt.",
      });
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleSyncAll = async () => {
    setIsSyncing(true);
    let totalNew = 0;

    try {
      // Sync all folder types
      for (const folderType of Object.keys(FOLDER_MAPPING)) {
        const response = await supabase.functions.invoke("sync-google-drive", {
          body: { folderType },
        });

        if (response.data?.newFiles?.length > 0) {
          totalNew += response.data.newFiles.length;

          // Process the files by sending them to the n8n webhook
          for (const file of response.data.newFiles) {
            // Mark file as processed
            await supabase.from("processed_drive_files").insert({
              user_id: user!.id,
              drive_file_id: file.id,
              file_name: file.name,
              folder_type: folderType,
            });
          }
        }
      }

      setStatus(prev => ({
        ...prev,
        lastSync: new Date(),
        newFilesCount: totalNew,
      }));

      toast({
        title: totalNew > 0 ? `${totalNew} neue Datei(en) importiert` : "Synchronisierung abgeschlossen",
        description: totalNew > 0 
          ? "Die Dokumente werden jetzt verarbeitet."
          : "Keine neuen Dateien gefunden.",
      });
    } catch (error: any) {
      toast({
        title: "Sync fehlgeschlagen",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  if (status.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${status.isConnected ? 'bg-primary/10' : 'bg-muted'}`}>
              <Cloud className={`h-5 w-5 ${status.isConnected ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <CardTitle className="text-lg">Google Drive</CardTitle>
              <CardDescription>
                {status.isConnected 
                  ? "Verbunden - Dokumente können synchronisiert werden"
                  : "Nicht verbunden"}
              </CardDescription>
            </div>
          </div>
          {status.isConnected && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Verbunden
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!status.isConnected ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Verbinde dein Google Drive um Dokumente automatisch zu importieren. 
              Folgende Ordner werden überwacht:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {Object.values(FOLDER_MAPPING).map((folder) => (
                <div key={folder} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Folder className="h-3 w-3" />
                  <span className="truncate">{folder}</span>
                </div>
              ))}
            </div>
            <Button 
              onClick={handleConnect} 
              disabled={isConnecting}
              className="w-full gap-2"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verbinde...
                </>
              ) : (
                <>
                  <Cloud className="h-4 w-4" />
                  Mit Google Drive verbinden
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Folder list */}
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(FOLDER_MAPPING).map(([key, folder]) => (
                <div key={key} className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1.5 rounded">
                  <Folder className="h-3 w-3 text-primary" />
                  <span className="truncate">{folder}</span>
                </div>
              ))}
            </div>

            {/* Last sync info */}
            {status.lastSync && (
              <p className="text-xs text-muted-foreground">
                Letzte Synchronisierung: {status.lastSync.toLocaleTimeString("de-DE")}
                {status.newFilesCount > 0 && ` (${status.newFilesCount} neue Dateien)`}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button 
                onClick={handleSyncAll} 
                disabled={isSyncing}
                className="flex-1 gap-2"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Synchronisiere...
                  </>
                ) : (
                  <>
                    <FolderSync className="h-4 w-4" />
                    Jetzt synchronisieren
                  </>
                )}
              </Button>
              <Button 
                variant="outline" 
                onClick={handleConnect}
                disabled={isConnecting}
                title="Erneut anmelden"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                onClick={handleDisconnect}
                title="Verbindung trennen"
              >
                <CloudOff className="h-4 w-4" />
              </Button>
            </div>

            {/* Info about cron */}
            <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Im Hintergrund läuft ein automatischer Sync alle 60 Sekunden. 
                Du kannst jederzeit manuell synchronisieren.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
