import { FtsIndex, FtsResult } from "./fts.js";
import { TrigramIndex, TrigramResult } from "./trigram.js";
import { searchByVector } from "./embeddings.js";
import type { EmbeddingProvider } from "./embeddings.js";
import type { Database } from "./sqlite.js";

export type { EmbeddingProvider } from "./embeddings.js";

export interface HybridResult {
  noteId: number;
  path: string;
  score: number;
  snippet?: string;
}

export interface HybridWeights {
  fts: number;
  trigram: number;
  vector: number;
}

export type SearchMode = "hybrid" | "fts" | "trigram" | "semantic";

export interface HybridSearchOptions {
  mode?: SearchMode;
  weights?: Partial<HybridWeights>;
  limit?: number;
  filterPaths?: string[];
}

const DEFAULT_WEIGHTS: HybridWeights = {
  fts: 0.6,
  trigram: 0.3,
  vector: 0.1,
};

function normalizeScores<T extends { score: number }>(results: T[]): T[] {
  if (results.length === 0) return results;
  const max = Math.max(...results.map((r) => r.score));
  const min = Math.min(...results.map((r) => r.score));
  const range = max - min;
  if (range === 0) {
    return results.map((r) => ({ ...r, score: 1 }));
  }
  return results.map((r) => ({ ...r, score: (r.score - min) / range }));
}

export class HybridSearch {
  private fts: FtsIndex;
  private trigram: TrigramIndex;
  private vector: EmbeddingProvider | null;
  private db: Database | null;

  constructor(
    fts: FtsIndex,
    trigram: TrigramIndex,
    vector: EmbeddingProvider | null,
    db?: Database,
  ) {
    this.fts = fts;
    this.trigram = trigram;
    this.vector = vector;
    this.db = db ?? null;
  }

  async search(
    query: string,
    options: HybridSearchOptions = {},
  ): Promise<HybridResult[]> {
    const {
      mode = "hybrid",
      weights: weightsOverride = {},
      limit = 50,
      filterPaths,
    } = options;

    const weights: HybridWeights = {
      ...DEFAULT_WEIGHTS,
      ...weightsOverride,
    };

    // Map: path -> { noteId, score, snippet }
    const merged = new Map<
      string,
      { noteId: number; score: number; snippet?: string }
    >();

    const applyResults = (
      normalized: Array<{ noteId: number; path: string; score: number; snippet?: string }>,
      weight: number,
    ) => {
      for (const r of normalized) {
        if (filterPaths && !filterPaths.includes(r.path)) continue;
        const existing = merged.get(r.path);
        if (existing) {
          existing.score += r.score * weight;
          if (!existing.snippet && r.snippet) {
            existing.snippet = r.snippet;
          }
        } else {
          merged.set(r.path, {
            noteId: r.noteId,
            score: r.score * weight,
            snippet: r.snippet,
          });
        }
      }
    };

    // FTS layer
    if (mode === "hybrid" || mode === "fts") {
      if (weights.fts > 0) {
        const ftsRaw: FtsResult[] = this.fts.search(query, limit * 2);
        const ftsNorm = normalizeScores(ftsRaw);
        applyResults(ftsNorm, weights.fts);
      }
    }

    // Trigram layer
    if (mode === "hybrid" || mode === "trigram") {
      if (weights.trigram > 0) {
        const triRaw: TrigramResult[] = this.trigram.search(query, limit * 2);
        const triNorm = normalizeScores(triRaw);
        applyResults(triNorm, weights.trigram);
      }
    }

    // Vector layer (skip if provider is null or db is null)
    if ((mode === "hybrid" || mode === "semantic") && this.vector !== null && this.db !== null) {
      if (weights.vector > 0) {
        const queryVector = await this.vector.embed(query);
        const vecResults = searchByVector(this.db, queryVector, limit * 2);
        // Convert cosine similarity [-1,1] to [0,1] range before normalization
        const adjusted = vecResults.map((r) => ({
          ...r,
          score: (r.score + 1) / 2,
        }));
        const vecNorm = normalizeScores(adjusted);
        applyResults(vecNorm, weights.vector);
      }
    }

    // If no results yet and mode is hybrid, fall back to trigram only
    if (merged.size === 0 && mode === "hybrid") {
      const triRaw = this.trigram.search(query, limit * 2);
      const triNorm = normalizeScores(triRaw);
      applyResults(triNorm, 1.0);
    }

    const results: HybridResult[] = [];
    for (const [path, { noteId, score, snippet }] of merged) {
      results.push({ noteId, path, score, snippet });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }
}
