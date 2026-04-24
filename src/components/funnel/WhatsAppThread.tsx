import { format } from "date-fns";
import { de as deLocale } from "date-fns/locale";
import { Loader2, MessageSquare, Smartphone } from "lucide-react";
import { useWaMessages } from "@/hooks/useLeads";
import type { WaMessage } from "@/types/leads";
import { cn } from "@/lib/utils";

// Thread-Anzeige fuer einen Lead. Reine Read-only-View — der Compose-Input
// liegt in InboxPage, weil er dort einen anderen Kontext hat (Selektion
// zwischen Leads) als im LeadDetail (wo der Lead fest ist).
//
// Props:
//   leadId: string | undefined
//   heading (optional): Ueberschrift ueber den Bubbles. Default: "WhatsApp-
//     Konversation". Kann explizit auf null gesetzt werden, um den Header
//     ganz zu unterdruecken (Inbox-Layout hat schon einen eigenen Header).
//   className (optional): fuer Layout-Anpassung in Containern, die scrollen.
interface WhatsAppThreadProps {
  leadId: string | undefined;
  heading?: string | null;
  className?: string;
}

export function WhatsAppThread({
  leadId,
  heading = "WhatsApp-Konversation",
  className,
}: WhatsAppThreadProps) {
  const { data: messages = [], isLoading } = useWaMessages(leadId);

  return (
    <div className={cn("space-y-4", className)}>
      {heading !== null && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-heading text-base sm:text-lg font-semibold text-foreground inline-flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary shrink-0" />
            <span className="truncate">{heading}</span>
          </h2>
          <span className="text-xs text-muted-foreground">
            {messages.length}{" "}
            {messages.length === 1 ? "Nachricht" : "Nachrichten"}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : messages.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Noch keine WhatsApp-Konversation.
        </p>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <ChatBubble key={m.id} message={m} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatBubble({ message }: { message: WaMessage }) {
  const isOutbound = message.direction === "outbound";
  const timestamp = (() => {
    try {
      return format(new Date(message.created_at), "dd.MM.yyyy · HH:mm", {
        locale: deLocale,
      });
    } catch {
      return message.created_at;
    }
  })();

  const content =
    message.template_name && !message.body ? (
      <span className="inline-flex items-center gap-1 italic">
        <Smartphone className="h-3 w-3" />
        Template: {message.template_name}
      </span>
    ) : (
      <span className="whitespace-pre-wrap break-words">
        {message.body || "(leer)"}
      </span>
    );

  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-4 py-2 text-sm shadow-sm",
          isOutbound
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm",
        )}
      >
        <div>{content}</div>
        <div
          className={cn(
            "mt-1 text-[10px]",
            isOutbound
              ? "text-primary-foreground/70"
              : "text-muted-foreground",
          )}
        >
          {timestamp}
        </div>
      </div>
    </div>
  );
}
