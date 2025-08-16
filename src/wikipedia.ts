export interface WikiSummary {
  lang: string;
  title: string;
  url: string;
  description?: string;
  extract?: string;
  thumbnailUrl?: string;
}

export async function wikiSearchWithSummaries(query: string, langs: string[], limit = 3): Promise<WikiSummary[]> {
  const lc = langs.length ? langs : ["en"];
  const out: WikiSummary[] = [];
  for (const lang of lc) {
    const base = `https://${lang}.wikipedia.org`;
    const searchUrl = new URL(`${base}/w/rest.php/v1/search/title`);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("limit", String(limit));
    const res = await fetch(searchUrl.toString());
    if (!res.ok) continue;
    const js = await res.json() as any;
    const pages = js.pages ?? [];
    for (const p of pages) {
      const title = p.title as string;
      const sumUrl = `${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const sres = await fetch(sumUrl);
      if (!sres.ok) continue;
      const s = await sres.json() as any;
      out.push({
        lang,
        title: s.title ?? title,
        url: s.content_urls?.desktop?.page ?? `${base}/wiki/${encodeURIComponent(title)}`,
        description: s.description,
        extract: s.extract,
        thumbnailUrl: s.thumbnail?.source
      });
    }
  }
  return out;
}
