import chokidar, { FSWatcher } from "chokidar";
import path from "path";
import { Indexer } from "../index/indexer.js";
import { Vault } from "./vault.js";

export class FileWatcher {
  private watcher: FSWatcher | null = null;

  constructor(
    private vault: Vault,
    private indexer: Indexer,
    private excludePaths: string[],
    private quiet: boolean = false,
  ) {}

  start(): void {
    const watchPath = this.vault.rootPath;
    const ignored = this.excludePaths.map((p) => path.join(watchPath, p));

    this.watcher = chokidar.watch(watchPath, {
      ignored: [...ignored, /(^|[/\\])\./],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher
      .on("add", (filePath: string) => this.handleChange(filePath))
      .on("change", (filePath: string) => this.handleChange(filePath))
      .on("unlink", (filePath: string) => this.handleDelete(filePath));

    if (!this.quiet) console.error("[obsidian-mcp-tools] File watcher started");
  }

  private handleChange(absPath: string): void {
    const relative = path.relative(this.vault.rootPath, absPath);
    if (!relative.endsWith(".md")) return;
    if (!this.quiet) console.error(`[obsidian-mcp-tools] Changed: ${relative}`);
    try {
      this.vault.refreshIndex();
      this.indexer.indexSingleFile(relative);
    } catch (err) {
      console.error(`[obsidian-mcp-tools] Error indexing ${relative}:`, err);
    }
  }

  private handleDelete(absPath: string): void {
    const relative = path.relative(this.vault.rootPath, absPath);
    if (!relative.endsWith(".md")) return;
    if (!this.quiet) console.error(`[obsidian-mcp-tools] Deleted: ${relative}`);
    try {
      this.indexer.removeFile(relative);
    } catch (err) {
      console.error(`[obsidian-mcp-tools] Error removing ${relative}:`, err);
    }
  }

  stop(): void {
    this.watcher?.close();
  }
}
