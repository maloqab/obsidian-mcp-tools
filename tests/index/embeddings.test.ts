import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import {
  storeEmbedding,
  searchByVector,
  cosineSimilarity,
  ApiEmbeddingProvider,
  createEmbeddingProvider,
} from "../../src/index/embeddings.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/embeddings-test.db");

describe("embeddings", () => {
  let db: Database;

  beforeAll(() => {
    db = new Database(TEST_DB);
    const vault = new Vault(FIXTURE_VAULT);
    const indexer = new Indexer(db, vault);
    indexer.indexAll();
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const v = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it("returns 0 for orthogonal vectors", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it("returns -1 for opposite vectors", () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });

    it("handles non-unit vectors correctly", () => {
      const a = new Float32Array([3, 4, 0]);
      const b = new Float32Array([3, 4, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
    });

    it("returns 0 for zero vectors", () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it("throws on dimension mismatch", () => {
      const a = new Float32Array([1, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(() => cosineSimilarity(a, b)).toThrow("dimension mismatch");
    });
  });

  describe("storeEmbedding + searchByVector", () => {
    it("stores and retrieves embeddings", () => {
      const noteId = db.getNoteByPath("Welcome.md")!.id;
      const vector = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      storeEmbedding(db, noteId, vector, "test-model");

      const queryVec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const results = searchByVector(db, queryVec);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toBe("Welcome.md");
      expect(results[0].score).toBeCloseTo(1.0, 1);
    });

    it("ranks similar vectors higher", () => {
      const note1 = db.getNoteByPath("Projects/Alpha.md")!.id;
      const note2 = db.getNoteByPath("Orphan.md")!.id;

      // Clear previous test embeddings
      db.raw.prepare("DELETE FROM embeddings").run();

      storeEmbedding(db, note1, new Float32Array([0.9, 0.1, 0.0, 0.0]), "test");
      storeEmbedding(db, note2, new Float32Array([0.0, 0.0, 0.9, 0.1]), "test");

      const query = new Float32Array([0.8, 0.2, 0.0, 0.0]); // similar to note1
      const results = searchByVector(db, query);
      expect(results[0].path).toBe("Projects/Alpha.md");
    });

    it("respects limit parameter", () => {
      db.raw.prepare("DELETE FROM embeddings").run();

      const notes = db.getAllNotes();
      for (let i = 0; i < Math.min(notes.length, 5); i++) {
        const vec = new Float32Array(4);
        vec[i % 4] = 1.0;
        storeEmbedding(db, notes[i].id, vec, "test");
      }

      const query = new Float32Array([1, 0, 0, 0]);
      const results = searchByVector(db, query, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("returns empty array when no embeddings exist", () => {
      db.raw.prepare("DELETE FROM embeddings").run();
      const query = new Float32Array([1, 0, 0, 0]);
      const results = searchByVector(db, query);
      expect(results).toEqual([]);
    });
  });

  describe("createEmbeddingProvider", () => {
    it("creates a local provider", () => {
      const provider = createEmbeddingProvider({
        embeddingProvider: "local",
        embeddingModel: "gte-small",
      });
      expect(provider).toBeDefined();
    });

    it("creates an openai provider with api key", () => {
      const provider = createEmbeddingProvider({
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        embeddingApiKey: "test-key",
      });
      expect(provider).toBeInstanceOf(ApiEmbeddingProvider);
    });

    it("throws for openai without api key", () => {
      expect(() =>
        createEmbeddingProvider({
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
        }),
      ).toThrow("API key required");
    });

    it("throws for custom without base url", () => {
      expect(() =>
        createEmbeddingProvider({
          embeddingProvider: "custom",
          embeddingModel: "my-model",
        }),
      ).toThrow("embeddingBaseUrl");
    });

    it("creates custom provider with base url", () => {
      const provider = createEmbeddingProvider({
        embeddingProvider: "custom",
        embeddingModel: "my-model",
        embeddingBaseUrl: "http://localhost:8080/v1",
      });
      expect(provider).toBeInstanceOf(ApiEmbeddingProvider);
    });
  });
});
