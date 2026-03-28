import type { Database } from "./sqlite.js";

// ── EmbeddingProvider Interface ──────────────────────────────────────────────

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  initialize?(): Promise<void>;
}

// ── Local Embedding Provider ─────────────────────────────────────────────────
// Uses @huggingface/transformers with gte-small (~30MB model).
// The package is loaded dynamically so the tool still works if it is not
// installed -- vector search simply stays disabled.

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private extractor: any | null = null;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.extractor) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Dynamic import -- allows the rest of the package to work
        // even if @huggingface/transformers is not installed.
        // Use a variable to prevent TypeScript from resolving the module statically.
        const moduleName = "@huggingface/transformers";
        const transformers = await (Function(
          "m",
          "return import(m)",
        )(moduleName) as Promise<any>);
        // Disable local-only model check so it can download from the hub
        if (transformers.env) {
          transformers.env.allowLocalModels = false;
        }
        this.extractor = await transformers.pipeline(
          "feature-extraction",
          "Xenova/gte-small",
          { dtype: "fp32" },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to load local embedding model. Install @huggingface/transformers or use an API provider. Error: ${msg}`,
        );
      }
    })();

    return this.initPromise;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) await this.initialize();
    const output = await this.extractor!(text, {
      pooling: "mean",
      normalize: true,
    });
    return new Float32Array(output.data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ── API Embedding Provider ───────────────────────────────────────────────────
// Works with OpenAI, Cohere, or any OpenAI-compatible embeddings endpoint.

export class ApiEmbeddingProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;

  constructor(baseUrl: string, model: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = resolveEnvVar(apiKey);
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const url = `${this.baseUrl}/embeddings`;
    const body = JSON.stringify({
      input: texts,
      model: this.model,
    });

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error");
      throw new Error(
        `Embedding API request failed (${resp.status}): ${errText}`,
      );
    }

    const json = (await resp.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to preserve order
    const sorted = json.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => new Float32Array(d.embedding));
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export interface EmbeddingConfig {
  embeddingProvider: "local" | "openai" | "cohere" | "custom";
  embeddingModel: string;
  embeddingApiKey?: string;
  embeddingBaseUrl?: string;
}

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  cohere: "https://api.cohere.ai/v1",
};

export function createEmbeddingProvider(
  config: EmbeddingConfig,
): EmbeddingProvider {
  switch (config.embeddingProvider) {
    case "local":
      return new LocalEmbeddingProvider();
    case "openai":
    case "cohere": {
      const baseUrl =
        config.embeddingBaseUrl ??
        PROVIDER_BASE_URLS[config.embeddingProvider];
      if (!baseUrl) {
        throw new Error(
          `No base URL configured for provider ${config.embeddingProvider}`,
        );
      }
      if (!config.embeddingApiKey) {
        throw new Error(
          `API key required for ${config.embeddingProvider} embedding provider`,
        );
      }
      return new ApiEmbeddingProvider(
        baseUrl,
        config.embeddingModel,
        config.embeddingApiKey,
      );
    }
    case "custom": {
      if (!config.embeddingBaseUrl) {
        throw new Error("Custom embedding provider requires embeddingBaseUrl");
      }
      return new ApiEmbeddingProvider(
        config.embeddingBaseUrl,
        config.embeddingModel,
        config.embeddingApiKey ?? "",
      );
    }
    default:
      throw new Error(
        `Unknown embedding provider: ${config.embeddingProvider}`,
      );
  }
}

// ── Vector Store ─────────────────────────────────────────────────────────────

export function storeEmbedding(
  db: Database,
  noteId: number,
  vector: Float32Array,
  modelName: string,
): void {
  const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  db.raw
    .prepare(
      `INSERT INTO embeddings (note_id, vector, model_name) VALUES (?, ?, ?)`,
    )
    .run(noteId, buffer, modelName);
}

export function searchByVector(
  db: Database,
  queryVector: Float32Array,
  limit: number = 50,
): { noteId: number; path: string; score: number }[] {
  const rows = db.raw
    .prepare(
      `SELECT e.note_id, n.path, e.vector
       FROM embeddings e
       JOIN notes n ON n.id = e.note_id
       ORDER BY e.note_id`,
    )
    .all() as Array<{ note_id: number; path: string; vector: Buffer }>;

  if (rows.length === 0) return [];

  const results: { noteId: number; path: string; score: number }[] = [];

  for (const row of rows) {
    const stored = new Float32Array(
      row.vector.buffer,
      row.vector.byteOffset,
      row.vector.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
    const score = cosineSimilarity(queryVector, stored);
    results.push({ noteId: row.note_id, path: row.path, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── Cosine Similarity ────────────────────────────────────────────────────────

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveEnvVar(value: string): string {
  if (value.startsWith("env:")) {
    return process.env[value.slice(4)] ?? "";
  }
  return value;
}
