import { Database } from "../index/sqlite.js";
import { Vault } from "../core/vault.js";

export interface VaultStats {
  noteCount: number;
  uniqueTagCount: number;
  linkCount: number;
  inlineFieldCount: number;
  canvasCount: number;
  vaultPath: string;
}

export function vaultStats(db: Database, vault: Vault): VaultStats {
  const noteCount = (db.raw.prepare("SELECT COUNT(*) as c FROM notes").get() as { c: number }).c;
  const uniqueTagCount = (db.raw.prepare("SELECT COUNT(DISTINCT tag) as c FROM tags").get() as { c: number }).c;
  const linkCount = (db.raw.prepare("SELECT COUNT(*) as c FROM links").get() as { c: number }).c;
  const inlineFieldCount = (db.raw.prepare("SELECT COUNT(*) as c FROM inline_fields").get() as { c: number }).c;
  const canvasCount = vault.listCanvasFiles().length;
  return { noteCount, uniqueTagCount, linkCount, inlineFieldCount, canvasCount, vaultPath: vault.rootPath };
}

export interface ListFilesOptions {
  glob?: string;
  extension?: string;
  maxDepth?: number;
}

export function listFiles(vault: Vault, options: ListFilesOptions): string[] {
  let files = vault.listAllFiles();

  if (options.extension) {
    const ext = options.extension.startsWith(".") ? options.extension : `.${options.extension}`;
    files = files.filter((f) => f.endsWith(ext));
  }

  if (options.maxDepth !== undefined) {
    files = files.filter((f) => f.split("/").length <= options.maxDepth!);
  }

  if (options.glob) {
    // Simple glob matching
    const globParts = options.glob.split("/");
    files = files.filter((f) => {
      const fileParts = f.split("/");
      if (globParts.length > fileParts.length) return false;
      for (let i = 0; i < globParts.length; i++) {
        const gp = globParts[i];
        if (gp === "**") return true;
        if (gp === "*") continue;
        if (gp.startsWith("*.")) {
          const ext = gp.slice(1);
          if (i === globParts.length - 1) return fileParts[fileParts.length - 1].endsWith(ext);
          continue;
        }
        if (gp !== fileParts[i]) return false;
      }
      return true;
    });
  }

  return files.sort();
}
