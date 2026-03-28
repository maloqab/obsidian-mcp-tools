import vm from "vm";
import { Database } from "../../index/sqlite.js";
import { Vault } from "../../core/vault.js";
import path from "path";

export function createDvApi(db: Database, vault: Vault) {
  return {
    pages: (source?: string) => {
      let notePaths: string[];
      if (source && source.startsWith("#")) {
        const tag = source.slice(1);
        const rows = db.raw.prepare(
          "SELECT DISTINCT n.path FROM tags t JOIN notes n ON t.note_id = n.id WHERE t.tag = ?"
        ).all(tag) as { path: string }[];
        notePaths = rows.map(r => r.path);
      } else if (source && source.startsWith('"') && source.endsWith('"')) {
        const folder = source.slice(1, -1);
        const rows = db.raw.prepare(
          "SELECT path FROM notes WHERE path LIKE ?"
        ).all(`${folder}/%`) as { path: string }[];
        notePaths = rows.map(r => r.path);
      } else {
        notePaths = db.getAllNotes().map(n => n.path);
      }

      return notePaths.map(p => {
        const note = db.getNoteByPath(p);
        if (!note) return null;
        const fm = JSON.parse(note.frontmatter_json);
        const name = path.basename(p, ".md");
        return {
          file: {
            name,
            path: p,
            folder: path.dirname(p),
            ...fm,
          },
          ...fm,
        };
      }).filter(Boolean);
    },
    page: (notePath: string) => {
      const resolved = vault.resolveLink(notePath);
      if (!resolved) return null;
      const note = db.getNoteByPath(resolved);
      if (!note) return null;
      const fm = JSON.parse(note.frontmatter_json);
      return { file: { name: path.basename(resolved, ".md"), path: resolved }, ...fm };
    },
    array: (arr: unknown[]) => arr,
  };
}

export function executeDvScript(
  script: string,
  dvApi: ReturnType<typeof createDvApi>,
  timeout: number = 5000,
): unknown {
  // Wrap in a function so 'return' works
  const wrappedScript = `(function() { ${script} })()`;

  const context = vm.createContext({
    dv: dvApi,
    console: { log: () => {}, warn: () => {}, error: () => {} },
  });

  return vm.runInContext(wrappedScript, context, { timeout });
}
