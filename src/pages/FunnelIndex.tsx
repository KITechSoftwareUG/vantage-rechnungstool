import { Link } from "react-router-dom";
import { Construction, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function FunnelIndex() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30">
        <Construction className="h-8 w-8 text-emerald-500" />
      </div>
      <h1 className="font-heading text-3xl font-bold">Funnelanalytics</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        Das Zahnfunnel-Modul wird gerade aufgebaut. Lead-Liste, WhatsApp-Inbox
        und Tracking-Details folgen in den nächsten Schritten.
      </p>
      <Button asChild variant="outline" className="mt-6 gap-2">
        <Link to="/">
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Übersicht
        </Link>
      </Button>
    </div>
  );
}
