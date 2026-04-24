// Types fuer das app_config-Dashboard.
//
// Die Tabelle `app_config` ist ein key/value-Store fuer Zahnfunnel-Settings
// (WhatsApp-Tokens, Anthropic-Key, Gmail-OAuth, Berater-Texte, etc.).
// Edge Functions lesen on-demand via getConfig(supabase, key), also greifen
// Aenderungen sofort ohne Function-Redeploy.

export interface ConfigEntry {
  key: string;
  value: string | null;
  is_secret: boolean;
  description: string | null;
  updated_at: string;
}
