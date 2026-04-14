import { IngestionTracker } from "@/components/upload/IngestionTracker";
import { ProcessingBanner } from "@/components/upload/ProcessingBanner";
import { ReviewQueue } from "@/components/upload/ReviewQueue";

export default function UploadPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Dokumente Einspeisung
        </h1>
        <p className="mt-1 text-muted-foreground">
          Dokumente werden automatisch über n8n eingespeist
        </p>
      </div>

      {/* Live-Status aller laufenden Drive-Uploads */}
      <div className="animate-fade-in">
        <ProcessingBanner />
      </div>

      {/* Review Queue - Documents pending review */}
      <div className="animate-fade-in">
        <ReviewQueue />
      </div>

      {/* Ingestion Tracker */}
      <div className="animate-fade-in">
        <IngestionTracker />
      </div>
    </div>
  );
}
