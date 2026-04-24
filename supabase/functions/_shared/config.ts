// Lese Werte aus der `app_config`-Tabelle.
//
// app_config ist der zentrale Key/Value-Store fuer Zahnfunnel-Settings +
// Secrets. Edge Functions lesen ihn on-demand, damit Aenderungen am Dashboard
// ohne Function-Redeploy greifen.

// deno-lint-ignore no-explicit-any
export async function getConfig(supabase: any, key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.error(`getConfig('${key}') error:`, error.message);
    return null;
  }

  const value = data?.value;
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}
