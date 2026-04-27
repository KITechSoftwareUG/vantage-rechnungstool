// Supabase/PostgREST begrenzt Selects standardmaessig auf 1000 Rows. Ohne
// Pagination verschwinden bei >1000 Eintraegen die aeltesten lautlos aus der
// UI. Diese Helferin paginiert via .range() solange, bis eine Page < 1000 Rows
// zurueckkommt. Mirror der gleichnamigen Funktion in der
// auto-match-transactions Edge Function.
export async function fetchAllPaginated<T>(makeQuery: () => any): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}
