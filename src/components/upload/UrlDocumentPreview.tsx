import { useState, memo, useRef, useEffect } from "react";
import { FileText, ZoomIn, ZoomOut, Maximize2, Loader2 } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

interface UrlDocumentPreviewProps {
  fileUrl: string;
  fileName: string;
  className?: string;
}

function normalizeDocumentUrl(fileUrl: string) {
  if (!fileUrl) return fileUrl;

  try {
    const url = new URL(fileUrl);
    url.pathname = url.pathname
      .split("/")
      .map((segment) => {
        if (!segment) return segment;
        return encodeURIComponent(decodeURIComponent(segment));
      })
      .join("/");

    return url.toString();
  } catch {
    return encodeURI(fileUrl);
  }
}

function useMeasuredWidth<T extends HTMLElement>(dependencyKey: string) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateWidth = () => {
      setWidth(Math.max(240, Math.floor(element.clientWidth)));
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, [dependencyKey]);

  return [ref, width] as const;
}

export const UrlDocumentPreview = memo(function UrlDocumentPreview({ fileUrl, fileName, className }: UrlDocumentPreviewProps) {
  const [zoom, setZoom] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const inlineScrollRef = useRef<HTMLDivElement>(null);
  const fullscreenScrollRef = useRef<HTMLDivElement>(null);
  const [inlineMeasureRef, inlineWidth] = useMeasuredWidth<HTMLDivElement>(`${fileUrl}-inline`);
  const [fullscreenMeasureRef, fullscreenWidth] = useMeasuredWidth<HTMLDivElement>(`${fileUrl}-${fullscreen ? "fullscreen" : "inline"}`);

  const normalizedFileUrl = normalizeDocumentUrl(fileUrl);
  const isPdf = fileName.toLowerCase().endsWith(".pdf") || normalizedFileUrl.toLowerCase().includes(".pdf");
  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);

  const resetScrollPosition = () => {
    inlineScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    fullscreenScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  useEffect(() => {
    setZoom(100);
    setNumPages(0);
    resetScrollPosition();

    const frameId = window.requestAnimationFrame(() => {
      resetScrollPosition();
    });
    const timeoutId = window.setTimeout(() => {
      resetScrollPosition();
    }, 80);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [normalizedFileUrl, fullscreen]);

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

  const renderDocumentFallback = (message: string) => (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <FileText className="h-16 w-16 text-muted-foreground" />
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <a href={normalizedFileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 text-sm text-primary underline">
        Dokument öffnen
      </a>
    </div>
  );

  const renderPdf = (isFullscreen: boolean) => {
    const baseWidth = isFullscreen ? (fullscreenWidth || 960) : (inlineWidth || 620);
    const pageWidth = Math.max(240, Math.floor((baseWidth - 16) * (zoom / 100)));

    return (
      <Document
        key={`${normalizedFileUrl}-${isFullscreen ? "fullscreen" : "inline"}`}
        file={normalizedFileUrl}
        loading={
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            PDF wird geladen…
          </div>
        }
        noData={renderDocumentFallback("Keine PDF verfügbar")}
        error={renderDocumentFallback("PDF konnte nicht geladen werden")}
        onLoadSuccess={({ numPages: loadedPages }) => {
          setNumPages(loadedPages);
          resetScrollPosition();
        }}
      >
        <div className="space-y-4">
          {Array.from({ length: numPages }, (_, index) => (
            <div key={`page-${index + 1}`} className="mx-auto w-fit overflow-hidden rounded-md bg-background shadow-sm">
              <Page
                pageNumber={index + 1}
                width={pageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Seite {index + 1} wird geladen…
                  </div>
                }
              />
            </div>
          ))}
        </div>
      </Document>
    );
  };

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
      <div
        ref={isFullscreen ? fullscreenScrollRef : inlineScrollRef}
        className={cn(
          "flex-1 overflow-auto p-2",
          isFullscreen ? "min-h-0" : "min-h-[300px] max-h-[500px]"
        )}
      >
        <div ref={isFullscreen ? fullscreenMeasureRef : inlineMeasureRef} className="min-h-full">
          {isPdf ? (
            renderPdf(isFullscreen)
          ) : isImage ? (
            <div
              className="flex items-start justify-center"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
            >
              <img src={normalizedFileUrl} alt="Dokumentvorschau" className="max-w-full rounded shadow-sm" />
            </div>
          ) : (
            renderDocumentFallback("Vorschau nicht verfügbar")
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
});
