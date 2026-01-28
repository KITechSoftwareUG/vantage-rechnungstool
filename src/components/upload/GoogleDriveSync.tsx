import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useGoogleDrive } from "@/hooks/useGoogleDrive";
import { useToast } from "@/hooks/use-toast";
import { Cloud, CloudOff, Loader2, FolderSync, Check } from "lucide-react";

// Mapping of upload categories to Google Drive folder names
const FOLDER_MAPPING: Record<string, string> = {
  incoming: "01 Eingang (Provisionsabrechnungen, etc...)",
  outgoing: "02 Ausgang (Rechnungen, Belege, etc...)",
  volksbank: "03 VR-Bank Kontoauszüge",
  amex: "04 AMEX Kontoauszüge",
  commission: "05 Provisionsabrechnung",
  cash: "06 Kasse",
};

interface GoogleDriveSyncProps {
  category: "incoming" | "outgoing" | "volksbank" | "amex" | "commission" | "cash";
  onFilesImported: (files: File[]) => void;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

interface DriveFolder {
  id: string;
  name: string;
}

export function GoogleDriveSync({ category, onFilesImported }: GoogleDriveSyncProps) {
  const { toast } = useToast();
  const { isConnected, isLoading, accessToken, connect, disconnect, handleCallback } = useGoogleDrive();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncComplete, setSyncComplete] = useState(false);

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
            description: "Du kannst jetzt Dateien synchronisieren.",
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
    try {
      await disconnect();
      toast({
        title: "Verbindung getrennt",
        description: "Google Drive wurde erfolgreich getrennt.",
      });
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const findFolder = async (folderName: string): Promise<DriveFolder | null> => {
    if (!accessToken) return null;

    try {
      const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!response.ok) throw new Error("Fehler beim Suchen des Ordners");

      const data = await response.json();
      return data.files?.[0] || null;
    } catch (error) {
      console.error("Error finding folder:", error);
      return null;
    }
  };

  const listFilesInFolder = async (folderId: string): Promise<DriveFile[]> => {
    if (!accessToken) return [];

    try {
      // Get supported file types for the category
      const mimeTypes = [
        "application/pdf",
        "image/png",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
      ];

      const mimeFilter = mimeTypes.map(t => `mimeType='${t}'`).join(" or ");
      const query = `'${folderId}' in parents and (${mimeFilter}) and trashed=false`;

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size)&orderBy=name`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!response.ok) throw new Error("Fehler beim Laden der Dateien");

      const data = await response.json();
      return data.files || [];
    } catch (error) {
      console.error("Error listing files:", error);
      return [];
    }
  };

  const downloadFile = async (file: DriveFile): Promise<File | null> => {
    if (!accessToken) return null;

    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!response.ok) throw new Error(`Fehler beim Download von ${file.name}`);

      const blob = await response.blob();
      return new File([blob], file.name, { type: file.mimeType });
    } catch (error) {
      console.error("Error downloading file:", error);
      return null;
    }
  };

  const handleSync = async () => {
    if (!accessToken) return;

    setIsSyncing(true);
    setSyncComplete(false);

    try {
      const folderName = FOLDER_MAPPING[category];
      
      toast({
        title: "Suche Ordner...",
        description: `Suche "${folderName}" in Google Drive`,
      });

      const folder = await findFolder(folderName);

      if (!folder) {
        toast({
          title: "Ordner nicht gefunden",
          description: `Der Ordner "${folderName}" wurde nicht gefunden. Bitte stelle sicher, dass er in Google Drive existiert.`,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Lade Dateien...",
        description: `Hole Dateien aus "${folderName}"`,
      });

      const driveFiles = await listFilesInFolder(folder.id);

      if (driveFiles.length === 0) {
        toast({
          title: "Keine Dateien gefunden",
          description: `Der Ordner "${folderName}" enthält keine unterstützten Dateien.`,
        });
        return;
      }

      toast({
        title: "Importiere Dateien...",
        description: `${driveFiles.length} Datei(en) werden heruntergeladen`,
      });

      const downloadedFiles: File[] = [];

      for (const driveFile of driveFiles) {
        const file = await downloadFile(driveFile);
        if (file) {
          downloadedFiles.push(file);
        }
      }

      if (downloadedFiles.length > 0) {
        onFilesImported(downloadedFiles);
        setSyncComplete(true);
        
        toast({
          title: "Sync abgeschlossen",
          description: `${downloadedFiles.length} Datei(en) aus "${folderName}" importiert`,
        });

        // Reset sync complete indicator after 3 seconds
        setTimeout(() => setSyncComplete(false), 3000);
      }
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
    <div className="flex gap-2">
      <Button
        variant={syncComplete ? "default" : "outline"}
        onClick={handleSync}
        disabled={isSyncing}
        className="gap-2"
      >
        {isSyncing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Synchronisiere...
          </>
        ) : syncComplete ? (
          <>
            <Check className="h-4 w-4" />
            Synchronisiert
          </>
        ) : (
          <>
            <FolderSync className="h-4 w-4" />
            Von Google Drive
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
