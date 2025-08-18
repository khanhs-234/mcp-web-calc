export interface WikiSummary {
  lang: string;
  title: string;
  url: string;
  description?: string;
  extract?: string;
  thumbnailUrl?: string;
}

// Single entry point: get summary for a Wikipedia title
export async function wikiGetSummary(title: string, lang: string = "vi"): Promise<WikiSummary> {
  const base = `https://${lang}.wikipedia.org`;
  const sumUrl = new URL(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  const sres = await fetch(sumUrl);
  if (!sres.ok) {
    return { lang, title, url: `${base}/wiki/${encodeURIComponent(title)}` };
  }
  const s = await sres.json() as any;
  return {
    lang,
    title: s.title ?? title,
    url: s.content_urls?.desktop?.page ?? `${base}/wiki/${encodeURIComponent(title)}`,
    description: s.description,
    extract: s.extract,
    thumbnailUrl: s.thumbnail?.source
  };
}
