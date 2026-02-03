import { EndpointUrlsCard } from "@/components/upload/EndpointUrlsCard";
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

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2 animate-fade-in">
        {/* Endpoint URLs */}
        <EndpointUrlsCard />

        {/* Ingestion Tracker */}
        <IngestionTracker />
      </div>
    </div>
  );
}