import { useState, useCallback } from "react";
import { Upload, FileText, Image, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  acceptedTypes?: string;
  multiple?: boolean;
}

export function UploadZone({ 
  onFilesSelected, 
  acceptedTypes = ".pdf,.png,.jpg,.jpeg",
  multiple = true 
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    setSelectedFiles(prev => [...prev, ...files]);
    onFilesSelected(files);
  }, [onFilesSelected]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(prev => [...prev, ...files]);
    onFilesSelected(files);
  }, [onFilesSelected]);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return Image;
    return FileText;
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "upload-zone cursor-pointer",
          isDragging && "drag-over animate-pulse-glow"
        )}
      >
        <input
          type="file"
          accept={acceptedTypes}
          multiple={multiple}
          onChange={handleFileInput}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
        
        <div className={cn(
          "mb-4 flex h-16 w-16 items-center justify-center rounded-full transition-all duration-300",
          isDragging 
            ? "bg-primary/20 text-primary" 
            : "bg-muted text-muted-foreground"
        )}>
          <Upload className="h-8 w-8" />
        </div>
        
        <h3 className="font-heading text-lg font-semibold text-foreground">
          {isDragging ? "Dateien hier ablegen" : "Dokumente hochladen"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Ziehen Sie Dateien hierher oder klicken Sie zum Auswählen
        </p>
        <p className="mt-2 text-xs text-muted-foreground/70">
          PDF, PNG, JPG bis 10MB
        </p>
      </div>

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-foreground">
            Ausgewählte Dateien ({selectedFiles.length})
          </h4>
          <div className="grid gap-2">
            {selectedFiles.map((file, index) => {
              const FileIcon = getFileIcon(file);
              return (
                <div
                  key={`${file.name}-${index}`}
                  className="glass-card flex items-center gap-3 p-3 animate-fade-in"
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <FileIcon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFile(index)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
