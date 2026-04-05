import { useState, memo } from "react";
import { FileText, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UrlDocumentPreviewProps {
  fileUrl: string;
  fileName: string;
  className?: string;
}

export function UrlDocumentPreview({ fileUrl, fileName, className }: UrlDocumentPreviewProps) {
  const [zoom, setZoom] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const isPdf = fileName.toLowerCase().endsWith(".pdf") || fileUrl.includes(".pdf");
  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 25, 200));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 25, 50));

  if (!fileUrl) {
    return (
      <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-8", className)}>
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Keine Vorschau verfügbar</p>
      </div>
    );
  }

  const PreviewContent = ({ isFullscreen = false }: { isFullscreen?: boolean }) => (
    <div className={cn(
      "relative flex flex-col rounded-lg border border-border bg-muted/30 overflow-hidden",
      isFullscreen ? "h-full" : className
    )}>
      <div className="flex items-center justify-between border-b border-border bg-background/80 px-3 py-2 backdrop-blur-sm">
        <span className="text-xs font-medium text-muted-foreground truncate max-w-[150px]">
          {fileName}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} disabled={zoom <= 50}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-[3rem] text-center text-xs text-muted-foreground">{zoom}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} disabled={zoom >= 200}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          {!isFullscreen && (
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-1" onClick={() => setFullscreen(true)}>
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className={cn(
        "flex-1 overflow-auto p-2",
        isFullscreen ? "min-h-0" : "min-h-[300px] max-h-[500px]"
      )}>
        <div
          className="flex items-start justify-center"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
        >
          {isPdf ? (
            <iframe
              src={`${fileUrl}#toolbar=0&navpanes=0`}
              className={cn("border-0 bg-white rounded shadow-sm", isFullscreen ? "w-full h-[80vh]" : "w-full h-[450px]")}
              title="PDF Vorschau"
            />
          ) : isImage ? (
            <img src={fileUrl} alt="Dokumentvorschau" className="max-w-full rounded shadow-sm" />
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <FileText className="h-16 w-16 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">Vorschau nicht verfügbar</p>
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 text-sm text-primary underline">
                Dokument öffnen
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PreviewContent />
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="truncate">{fileName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 p-4">
            <PreviewContent isFullscreen />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
