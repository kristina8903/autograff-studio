// The research provider boundary (docs/INTEGRATIONS.md §3). Code outside
// lib/providers/research never imports a search vendor's SDK.

import type { Usage } from "@/lib/providers/llm/types";

export type SearchRequest = {
  query: string;
  /** The model that runs the searches (the cheaper "extract" model). */
  model: string;
  allowedDomains: string[];
  blockedDomains: string[];
  maxSearches: number;
};

/**
 * One source as the provider returned it. Every field is untrusted web data.
 * `excerpts` are verbatim passages of the page chosen by the provider (for
 * the Claude web search tool: its citations), never text a model wrote.
 */
export type SearchSource = {
  url: string;
  title: string;
  /** The provider's date for the page, as given (e.g. "March 4, 2026"); for Claude, when the page was last updated. */
  pageAge: string | null;
  excerpts: string[];
};

export type SearchResult = {
  sources: SearchSource[];
  searches: number;
  /** Token and search costs together. */
  usage: Usage;
  servedModel: string;
};

export interface ResearchProvider {
  readonly name: "anthropic" | "fake";
  search(request: SearchRequest): Promise<SearchResult>;
}
