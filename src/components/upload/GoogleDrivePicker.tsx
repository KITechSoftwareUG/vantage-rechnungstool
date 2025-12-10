import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useGoogleDrive } from "@/hooks/useGoogleDrive";
import { useToast } from "@/hooks/use-toast";
import { Cloud, CloudOff, Loader2, FolderOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GoogleDrivePickerProps {
  onFilesSelected: (files: File[]) => void;
  acceptedTypes?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
}

export function GoogleDrivePicker({ onFilesSelected, acceptedTypes }: GoogleDrivePickerProps) {
  const { toast } = useToast();
  const { isConnected, isLoading, accessToken, connect, disconnect, handleCallback } = useGoogleDrive();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [downloadingFiles, setDownloadingFiles] = useState(false);

  // Handle OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (code) {
      // Remove code from URL
      window.history.replaceState({}, document.title, window.location.pathname);

      handleCallback(code)
        .then(() => {
          toast({
            title: "Google Drive verbunden",
            description: "Du kannst jetzt Dateien aus Google Drive importieren.",
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

  const loadDriveFiles = async () => {
    if (!accessToken) return;

    setLoadingFiles(true);
    try {
      // Build query for accepted file types
      let mimeTypeFilter = "";
      if (acceptedTypes) {
        const mimeTypes: string[] = [];
        if (acceptedTypes.includes(".pdf")) mimeTypes.push("application/pdf");
        if (acceptedTypes.includes(".png")) mimeTypes.push("image/png");
        if (acceptedTypes.includes(".jpg") || acceptedTypes.includes(".jpeg")) mimeTypes.push("image/jpeg");
        if (acceptedTypes.includes(".xlsx")) mimeTypes.push("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        if (acceptedTypes.includes(".xls")) mimeTypes.push("application/vnd.ms-excel");
        if (acceptedTypes.includes(".csv")) mimeTypes.push("text/csv");

        if (mimeTypes.length > 0) {
          mimeTypeFilter = mimeTypes.map(t => `mimeType='${t}'`).join(" or ");
        }
      }

      const query = mimeTypeFilter ? `(${mimeTypeFilter}) and trashed=false` : "trashed=false";

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size)&orderBy=modifiedTime desc&pageSize=50`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Fehler beim Laden der Dateien");
      }

      const data = await response.json();
      setDriveFiles(data.files || []);
    } catch (error: any) {
      toast({
        title: "Fehler beim Laden",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoadingFiles(false);
    }
  };

  const openPicker = () => {
    setIsPickerOpen(true);
    setSelectedFiles(new Set());
    loadDriveFiles();
  };

  const toggleFileSelection = (fileId: string) => {
    const newSelection = new Set(selectedFiles);
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId);
    } else {
      newSelection.add(fileId);
    }
    setSelectedFiles(newSelection);
  };

  const downloadAndProcessFiles = async () => {
    if (!accessToken || selectedFiles.size === 0) return;

    setDownloadingFiles(true);
    try {
      const files: File[] = [];

      for (const fileId of selectedFiles) {
        const driveFile = driveFiles.find(f => f.id === fileId);
        if (!driveFile) continue;

        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Fehler beim Herunterladen von ${driveFile.name}`);
        }

        const blob = await response.blob();
        const file = new File([blob], driveFile.name, { type: driveFile.mimeType });
        files.push(file);
      }

      setIsPickerOpen(false);
      setSelectedFiles(new Set());
      onFilesSelected(files);

      toast({
        title: "Dateien importiert",
        description: `${files.length} Datei(en) von Google Drive importiert.`,
      });
    } catch (error: any) {
      toast({
        title: "Fehler beim Import",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setDownloadingFiles(false);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isLoading) {
    return (
      <Button variant="outline" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Lädt...
      </Button>
    );
  }

  return (
    <>
      {isConnected ? (
        <div className="flex gap-2">
          <Button variant="outline" onClick={openPicker} className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Von Google Drive
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDisconnect} title="Google Drive trennen">
            <CloudOff className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={handleConnect} className="gap-2">
          <Cloud className="h-4 w-4" />
          Mit Google Drive verbinden
        </Button>
      )}

      <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Dateien aus Google Drive auswählen
            </DialogTitle>
            <DialogDescription>
              Wähle die Dateien aus, die du importieren möchtest.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {loadingFiles ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : driveFiles.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                Keine passenden Dateien gefunden
              </div>
            ) : (
              <div className="space-y-1">
                {driveFiles.map((file) => (
                  <div
                    key={file.id}
                    onClick={() => toggleFileSelection(file.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedFiles.has(file.id)
                        ? "bg-primary/10 border border-primary"
                        : "hover:bg-muted border border-transparent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(file.id)}
                      onChange={() => {}}
                      className="h-4 w-4"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size ? Number(file.size) : undefined)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              {selectedFiles.size} Datei(en) ausgewählt
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsPickerOpen(false)}>
                Abbrechen
              </Button>
              <Button
                onClick={downloadAndProcessFiles}
                disabled={selectedFiles.size === 0 || downloadingFiles}
              >
                {downloadingFiles ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Importiere...
                  </>
                ) : (
                  `${selectedFiles.size} Datei(en) importieren`
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
