// Turns a Claude web search response into sources (docs/INTEGRATIONS.md §3.4).
// Plain data in, plain data out, so it is tested on recorded responses.
//
// Only two things are taken from the response, and nothing the model wrote:
// - the pages the search tool returned (URL, title, page age);
// - the passages the API cited from them (cited_text, verbatim from the page).
// A citation pointing at a URL the search did not return is dropped, so a
// source can't be invented.

import { MAX_EXCERPT_CHARACTERS, parseWebUrl } from "@/lib/domain/research";
import type { SearchSource } from "./types";

type Block = {
  type: string;
  content?: unknown;
  citations?: { type: string; url?: string; cited_text?: string }[] | null;
};

export function sourcesFromContent(blocks: Block[]): SearchSource[] {
  const pages = new Map<string, SearchSource>();
  for (const block of blocks) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const r of block.content as { type?: string; url?: unknown; title?: unknown; page_age?: unknown }[]) {
      if (r.type !== "web_search_result" || typeof r.url !== "string" || !parseWebUrl(r.url)) continue;
      if (!pages.has(r.url))
        pages.set(r.url, {
          url: r.url,
          title: typeof r.title === "string" ? r.title.slice(0, 500) : "",
          pageAge: typeof r.page_age === "string" ? r.page_age.slice(0, 100) : null,
          excerpts: [],
        });
    }
  }
  for (const block of blocks) {
    if (block.type !== "text") continue;
    for (const c of block.citations ?? []) {
      if (c.type !== "web_search_result_location" || !c.url || !c.cited_text) continue;
      const page = pages.get(c.url);
      const text = c.cited_text.replace(/\s+/g, " ").trim();
      if (page && text && !page.excerpts.includes(text)) page.excerpts.push(text);
    }
  }
  return [...pages.values()]
    .filter((p) => p.excerpts.length > 0)
    .map((p) => ({ ...p, excerpts: capExcerpts(p.excerpts) }));
}

function capExcerpts(excerpts: string[]): string[] {
  const kept: string[] = [];
  let length = 0;
  for (const e of excerpts) {
    if (length + e.length > MAX_EXCERPT_CHARACTERS) break;
    kept.push(e);
    length += e.length + 1;
  }
  return kept;
}
