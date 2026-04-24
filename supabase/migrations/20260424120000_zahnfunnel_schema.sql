-- Zahnfunnel-Integration ins Matching Tool.
--
-- Neue Tabellen:
--   leads        — eingehende Leads aus der Landingpage und aus WhatsApp
--   app_config   — Key/Value-Store fuer Zahnfunnel-Settings + Secrets,
--                  editierbar ueber das ENV-Dashboard, wird von Edge
--                  Functions on-demand gelesen (kein Restart noetig).
--   wa_messages  — WhatsApp-Konversationen (inbound + outbound)
--
-- RLS-Konvention wie fuer den Rest des Tools: authenticated sees all
-- (Single-User-Setup, Alex + Entwickler-Account, keine Multi-Tenant-Logik).
-- Edge Functions greifen via service_role am RLS vorbei.


-- ===================================================================
-- LEADS
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'closed')),
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads (created_at DESC);


-- ===================================================================
-- APP_CONFIG
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);


-- ===================================================================
-- WA_MESSAGES
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.wa_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT,
  template_name TEXT,
  wa_message_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_lead_id ON public.wa_messages (lead_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone ON public.wa_messages (phone);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created_at ON public.wa_messages (created_at DESC);


-- ===================================================================
-- RLS
-- ===================================================================
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;

-- leads
CREATE POLICY "Authenticated users can view all leads" ON public.leads
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create leads" ON public.leads
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update leads" ON public.leads
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete leads" ON public.leads
  FOR DELETE USING (auth.role() = 'authenticated');

-- app_config
CREATE POLICY "Authenticated users can view app_config" ON public.app_config
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create app_config" ON public.app_config
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can update app_config" ON public.app_config
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete app_config" ON public.app_config
  FOR DELETE USING (auth.role() = 'authenticated');

-- wa_messages
CREATE POLICY "Authenticated users can view wa_messages" ON public.wa_messages
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can create wa_messages" ON public.wa_messages
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');


-- ===================================================================
-- updated_at-Trigger (nutzt bereits existierende Funktion)
-- ===================================================================
CREATE TRIGGER update_leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_app_config_updated_at
BEFORE UPDATE ON public.app_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


-- ===================================================================
-- Seed: alle Zahnfunnel-Config-Keys als leere Eintraege anlegen,
-- damit das kommende ENV-Dashboard sie direkt anzeigen kann.
-- is_secret=true -> UI maskiert den Wert (nur letzte 4 Zeichen sichtbar).
-- ===================================================================
INSERT INTO public.app_config (key, value, is_secret, description) VALUES
  ('FORM_API_KEY', NULL, true,
   'Shared Secret zwischen Landingpage (VITE_FORM_API_KEY) und /webhook/form'),
  ('WA_PHONE_NUMBER_ID', NULL, false,
   'Meta-interne ID der WhatsApp-Business-Nummer (15-stellig)'),
  ('WA_ACCESS_TOKEN', NULL, true,
   'Meta System-User Permanent-Token'),
  ('WA_APP_SECRET', NULL, true,
   'Meta App Secret fuer HMAC-Signatur-Validierung'),
  ('WA_VERIFY_TOKEN', NULL, true,
   'Frei waehlbar, fuer GET-Webhook-Verifikation'),
  ('WA_TEMPLATE_NAME', 'lead_intro_de', false,
   'Name des genehmigten WhatsApp-Templates'),
  ('WA_TEMPLATE_LANG', 'de', false,
   'Template-Sprache (ISO-Code)'),
  ('WA_GRAPH_API_VERSION', 'v21.0', false,
   'Meta Graph API Version'),
  ('ANTHROPIC_API_KEY', NULL, true,
   'API-Key fuer personalisierte WhatsApp- und Mail-Texte'),
  ('ANTHROPIC_MODEL', 'claude-sonnet-4-5', false,
   'Anthropic-Modell'),
  ('GMAIL_CREDENTIALS_JSON', NULL, true,
   'OAuth-Client-Credentials-JSON (Inhalt der credentials.json)'),
  ('GMAIL_TOKEN_JSON', NULL, true,
   'OAuth-Refresh-Token-JSON (Inhalt der token.json)'),
  ('GMAIL_FROM_ADDRESS', NULL, false,
   'Absender-E-Mail fuer Gmail-Fallback'),
  ('GMAIL_FROM_NAME', NULL, false,
   'Absender-Name'),
  ('BERATER_NAME', 'Alexander Fuertbauer', false,
   'Name des Beraters (fuer Personalisierung)'),
  ('BERATER_FIRMA', 'ExpatVantage', false,
   'Firmenname'),
  ('BERATER_TYP', 'Zahnzusatzversicherungen', false,
   'Beratungsfeld'),
  ('CONTACT_DELAY_MINUTES', '3', false,
   'Verzoegerung bis WhatsApp/Mail-Send nach Lead-Eingang')
ON CONFLICT (key) DO NOTHING;
