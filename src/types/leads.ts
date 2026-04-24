// Typen fuer das Zahnfunnel-Lead-UI.
//
// Alle `meta`-Felder sind optional, weil die Landingpage bis jetzt nicht
// garantieren kann, dass jedes Feld immer geliefert wird. Frontend muss
// defensiv parsen.

export type LeadStatus = "new" | "contacted" | "closed";

export type WaDirection = "inbound" | "outbound";

export interface LeadTracking {
  form_started_at?: string;
  form_completed_at?: string;
  duration_seconds?: number;
  page_url?: string;
  referrer?: string;
  user_agent?: string;
  language?: string;
  screen?: string;
  viewport?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

export interface LeadMeta {
  anliegen_summary?: string;
  tracking?: LeadTracking;
  laufende_behandlungen?: string;
  geplante_behandlungen?: string;
  hkp_erstellt?: string;
  behandlung_begonnen?: string;
  fehlende_zaehne?: string;
  ersatz_typ?: string;
  fehlend_seit?: string;
  parodontitis_behandelt?: string;
  zahnfleischerkrankung?: string;
  kieferfehlstellung?: string;
  kfo_angeraten?: string;
  einverstaendnis?: string;
  gesundheitsdaten_einwilligung?: boolean;
  // offen fuer zukuenftige Felder ohne Types-Regen
  [key: string]: unknown;
}

export interface Lead {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  source: string;
  meta: LeadMeta;
  status: LeadStatus;
  message_count: number;
  last_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface WaMessage {
  id: string;
  lead_id: string | null;
  phone: string;
  direction: WaDirection;
  body: string | null;
  template_name: string | null;
  wa_message_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}
