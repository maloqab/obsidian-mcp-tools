import { z } from "zod";

// --- Link Types ---
export const LinkTypeEnum = z.enum(["wiki", "markdown", "embed"]);
export type LinkType = z.infer<typeof LinkTypeEnum>;

export const LinkSchema = z.object({
  sourcePath: z.string(),
  targetPath: z.string(),
  type: LinkTypeEnum,
  line: z.number(),
  displayText: z.string().optional(),
  anchor: z.string().optional(),
});
export type Link = z.infer<typeof LinkSchema>;

// --- Inline Field Types ---
export const InlineFieldTypeEnum = z.enum(["string", "number", "date", "list", "boolean"]);
export type InlineFieldType = z.infer<typeof InlineFieldTypeEnum>;

export const InlineFieldSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  type: InlineFieldTypeEnum,
  line: z.number(),
});
export type InlineField = z.infer<typeof InlineFieldSchema>;

// --- Task Types ---
export const TaskStatusEnum = z.enum(["incomplete", "complete", "in-progress", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskSchema = z.object({
  text: z.string(),
  status: TaskStatusEnum,
  line: z.number(),
  tags: z.array(z.string()).default([]),
});
export type Task = z.infer<typeof TaskSchema>;

// --- Tag Types ---
export const TagSchema = z.object({
  name: z.string(),
  source: z.enum(["frontmatter", "inline"]),
  line: z.number().optional(),
});
export type Tag = z.infer<typeof TagSchema>;

// --- Note Types ---
export const NoteSchema = z.object({
  path: z.string(),
  content: z.string().default(""),
  frontmatter: z.record(z.unknown()).default({}),
  links: z.array(LinkSchema).default([]),
  tags: z.array(z.string()).default([]),
  inlineFields: z.array(InlineFieldSchema).default([]),
  tasks: z.array(TaskSchema).default([]),
  checksum: z.string(),
});
export type Note = z.infer<typeof NoteSchema>;

// --- Parsed Note (result of parsing a file) ---
export interface ParsedNote {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  links: Link[];
  tags: Tag[];
  inlineFields: InlineField[];
  tasks: Task[];
}

// --- Search Result Types ---
export interface SearchResult {
  path: string;
  score: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  line: number;
  text: string;
  highlights: [number, number][];
}

// --- Graph Types ---
export interface GraphNode {
  path: string;
  title: string;
  tags: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  type: LinkType;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- Canvas Types ---
export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  label?: string;
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// --- Config Types ---
export interface Config {
  search: {
    weights: { fts: number; trigram: number; vector: number };
    embeddingProvider: "local" | "openai" | "cohere" | "custom";
    embeddingModel: string;
    embeddingApiKey?: string;
    embeddingBaseUrl?: string;
  };
  index: {
    watchMode: boolean;
    excludePaths: string[];
    excludePatterns: string[];
  };
  templates: {
    folder: string;
  };
  notes: {
    trashInsteadOfDelete: boolean;
    trashFolder: string;
    autoUpdateLinks: boolean;
  };
  dataview: {
    enableJsQueries: boolean;
  };
}
