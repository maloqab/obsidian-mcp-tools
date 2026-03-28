import crypto from "crypto";
import { Database } from "./sqlite.js";
import { Vault } from "../core/vault.js";
import { parseNote } from "../core/parser.js";

export class Indexer {
  constructor(private db: Database, private vault: Vault) {}

  private computeChecksum(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  indexAll(): { indexed: number; skipped: number; removed: number } {
    let indexed = 0;
    let skipped = 0;

    const mdFiles = this.vault.listMarkdownFiles();
    const existingPaths = new Set(mdFiles);

    // Remove notes no longer in vault
    const dbNotes = this.db.getAllNotes();
    let removed = 0;
    for (const note of dbNotes) {
      if (!existingPaths.has(note.path)) {
        this.db.deleteNoteByPath(note.path);
        removed++;
      }
    }

    // Index each file
    for (const filePath of mdFiles) {
      const content = this.vault.readFile(filePath);
      const checksum = this.computeChecksum(content);

      const existingChecksum = this.db.getChecksumByPath(filePath);
      if (existingChecksum === checksum) {
        skipped++;
        continue;
      }

      this.indexFile(filePath, content, checksum);
      indexed++;
    }

    return { indexed, skipped, removed };
  }

  indexFile(filePath: string, content: string, checksum?: string): void {
    const hash = checksum ?? this.computeChecksum(content);
    const parsed = parseNote(filePath, content);

    this.db.upsertNote({
      path: filePath,
      content,
      frontmatterJson: JSON.stringify(parsed.frontmatter),
      checksum: hash,
    });

    const note = this.db.getNoteByPath(filePath);
    if (!note) return;
    const id = note.id;

    this.db.clearNoteMetadata(id);

    for (const tag of parsed.tags) {
      this.db.insertTag(id, tag.name, tag.source);
    }

    for (const link of parsed.links) {
      this.db.insertLink(id, link.targetPath, link.type, link.line);
    }

    for (const field of parsed.inlineFields) {
      this.db.insertInlineField(id, field.key, String(field.value), field.type, field.line);
    }
  }

  indexSingleFile(filePath: string): void {
    const content = this.vault.readFile(filePath);
    this.indexFile(filePath, content);
  }

  removeFile(filePath: string): void {
    this.db.deleteNoteByPath(filePath);
  }
}
