import fs from "fs";
import path from "path";
import type { Config } from "./types.js";
import { DEFAULT_CONFIG } from "./config.js";

export class Vault {
  private _rootPath: string;
  private config: Config;
  // Maps lowercase basename (without extension) -> relative path
  private fileIndex: Map<string, string> = new Map();

  constructor(rootPath: string, config?: Config) {
    this._rootPath = rootPath;
    this.config = config ?? DEFAULT_CONFIG;
    this.refreshIndex();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** The absolute root path of this vault. */
  get rootPath(): string {
    return this._rootPath;
  }

  /** Recursively list all files, excluding configured paths / patterns. */
  listAllFiles(): string[] {
    return this._walk(this._rootPath, "");
  }

  /** List only .md files. */
  listMarkdownFiles(): string[] {
    return this.listAllFiles().filter((f) => f.endsWith(".md"));
  }

  /** List only .canvas files. */
  listCanvasFiles(): string[] {
    return this.listAllFiles().filter((f) => f.endsWith(".canvas"));
  }

  /** Read file content as UTF-8. */
  readFile(relativePath: string): string {
    return fs.readFileSync(this.getAbsolutePath(relativePath), "utf-8");
  }

  /** Write file content, creating directories if needed. */
  writeFile(relativePath: string, content: string): void {
    const abs = this.getAbsolutePath(relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
    this.refreshIndex();
  }

  /** Delete a file. */
  deleteFile(relativePath: string): void {
    fs.unlinkSync(this.getAbsolutePath(relativePath));
    this.refreshIndex();
  }

  /** Move / rename a file, creating destination directories if needed. */
  moveFile(fromPath: string, toPath: string): void {
    const absFrom = this.getAbsolutePath(fromPath);
    const absTo = this.getAbsolutePath(toPath);
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    fs.renameSync(absFrom, absTo);
    this.refreshIndex();
  }

  /** Check whether a relative path exists inside the vault. */
  exists(relativePath: string): boolean {
    return fs.existsSync(this.getAbsolutePath(relativePath));
  }

  /**
   * Resolve a wikilink target to its relative vault path.
   *
   * Resolution order:
   * 1. Try `target + ".md"` as a direct relative path.
   * 2. Lookup the lowercase basename (without extension) in the file index.
   * 3. Return null if unresolvable.
   */
  resolveLink(target: string): string | null {
    // Strip any anchor fragment (e.g. "Note#Section" → "Note")
    const cleanTarget = target.split("#")[0].trim();

    // 1. Direct path match: add .md if not already present
    const directPath = cleanTarget.endsWith(".md") ? cleanTarget : `${cleanTarget}.md`;
    if (this.exists(directPath)) {
      return directPath;
    }

    // 2. Basename lookup (case-insensitive)
    const baseName = path.basename(cleanTarget).toLowerCase();
    if (this.fileIndex.has(baseName)) {
      return this.fileIndex.get(baseName)!;
    }

    return null;
  }

  /** Return the absolute path for a relative vault path. */
  getAbsolutePath(relativePath: string): string {
    return path.join(this._rootPath, relativePath);
  }

  /** Rebuild the internal basename → relative-path index. */
  refreshIndex(): void {
    this.fileIndex = new Map();
    const files = this._walk(this._rootPath, "");
    for (const rel of files) {
      if (rel.endsWith(".md")) {
        // Key is lowercase basename without the .md extension
        const key = path.basename(rel, ".md").toLowerCase();
        // Only store the first match (prevents duplicates from shadowing)
        if (!this.fileIndex.has(key)) {
          this.fileIndex.set(key, rel);
        }
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _walk(absDir: string, relDir: string): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

      // Check exclusions against the top-level segment (e.g. ".obsidian")
      if (this._isExcluded(relPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        results.push(...this._walk(path.join(absDir, entry.name), relPath));
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }

    return results;
  }

  private _isExcluded(relPath: string): boolean {
    const { excludePaths, excludePatterns } = this.config.index;

    // Split path into segments and check if any leading segment matches excludePaths
    const segments = relPath.split("/");
    if (excludePaths.some((ex) => segments[0] === ex)) {
      return true;
    }

    // Check glob-style patterns (simple prefix/suffix matching via regex)
    if (excludePatterns.length > 0) {
      for (const pattern of excludePatterns) {
        const regex = new RegExp(
          "^" +
            pattern
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, ".") +
            "$"
        );
        if (regex.test(relPath)) {
          return true;
        }
      }
    }

    return false;
  }
}
