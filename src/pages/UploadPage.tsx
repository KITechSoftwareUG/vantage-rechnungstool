import { IngestionTracker } from "@/components/upload/IngestionTracker";

export default function UploadPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Dokumente Einspeisung
        </h1>
        <p className="mt-1 text-muted-foreground">
          Dokumente werden automatisch über n8n Workflows eingespeist
        </p>
      </div>

      {/* Ingestion Tracker - Full Width */}
      <div className="animate-fade-in">
        <IngestionTracker />
      </div>
    </div>
  );
}