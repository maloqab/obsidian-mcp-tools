# obsidian-mcp-tools

The complete Obsidian MCP server -- 43 tools for search, graph, tags, Dataview, frontmatter, canvas, templates, and more.

> One server. Every tool. No Obsidian app required.

## Why This Exists

There are 22+ Obsidian MCP servers. Each does one thing well. None does everything. `obsidian-mcp-tools` combines every feature into a single, zero-config package.

## Quick Start

```bash
npx obsidian-mcp-tools /path/to/your/vault
```

### Claude Code

```bash
claude mcp add -s user obsidian -- npx obsidian-mcp-tools ~/path/to/vault
```

### Global Install

```bash
npm install -g obsidian-mcp-tools
obsidian-mcp-tools ~/Documents/MyVault
```

## 43 Tools, 9 Modules

### Notes (8 tools)
| Tool | Description |
|------|-------------|
| `read_note` | Read a note's content (raw markdown or parsed sections) |
| `create_note` | Create a new note with optional template and frontmatter |
| `edit_note` | Replace full content or patch a specific section by heading |
| `delete_note` | Delete a note (with optional trash instead of permanent delete) |
| `move_note` | Move/rename a note, auto-update all backlinks across vault |
| `split_note` | Split a note into multiple notes by heading |
| `merge_notes` | Combine multiple notes into one, preserving links |
| `duplicate_note` | Copy a note with a new name |

### Search (5 tools)
| Tool | Description |
|------|-------------|
| `search_vault` | Hybrid search: FTS5 + trigram + vector. Merged ranking |
| `search_replace` | Find and replace across vault (string or regex) |
| `search_by_date` | Find notes by created/modified date ranges |
| `search_by_frontmatter` | Query notes by frontmatter field values |
| `search_similar` | Find semantically similar notes via vector similarity |

### Graph (6 tools)
| Tool | Description |
|------|-------------|
| `get_backlinks` | All notes that link TO a given note, with line context |
| `get_outlinks` | All notes a given note links TO |
| `get_graph` | Full or filtered link graph as adjacency list |
| `find_path` | Shortest path between two notes through links |
| `get_orphans` | Notes with zero inbound, outbound, or both links |
| `get_neighbors` | Notes within N link-hops of a given note |

### Tags (5 tools)
| Tool | Description |
|------|-------------|
| `list_tags` | All tags in the vault with counts |
| `add_tag` | Add tag to a note (frontmatter or inline) |
| `remove_tag` | Remove tag from a note |
| `rename_tag` | Rename a tag across the entire vault |
| `merge_tags` | Merge multiple tags into one across vault |

### Frontmatter (4 tools)
| Tool | Description |
|------|-------------|
| `get_frontmatter` | Get all or specific frontmatter keys from a note |
| `set_frontmatter` | Set/update frontmatter keys atomically |
| `delete_frontmatter` | Remove specific frontmatter keys |
| `frontmatter_schema` | List all frontmatter keys used across vault with types |

### Canvas (4 tools)
| Tool | Description |
|------|-------------|
| `read_canvas` | Read a .canvas file, return nodes and edges |
| `create_canvas` | Create a new canvas with nodes/edges |
| `edit_canvas` | Add/remove/update nodes and edges |
| `canvas_to_notes` | Extract text nodes from a canvas into individual notes |

### Dataview (3 tools)
| Tool | Description |
|------|-------------|
| `dataview_query` | Execute full DQL (TABLE, LIST, TASK, CALENDAR) |
| `dataview_fields` | List all inline fields across vault |
| `dataview_eval` | Evaluate a Dataview expression against a note |

### Vault Management (5 tools)
| Tool | Description |
|------|-------------|
| `vault_stats` | Vault statistics (note count, tag count, link count) |
| `list_files` | List files with filters (glob, extension, depth) |
| `list_vaults` | List all configured vaults |
| `create_directory` | Create a directory |
| `reindex` | Force a full re-index |

### Templates (3 tools)
| Tool | Description |
|------|-------------|
| `list_templates` | List available templates |
| `apply_template` | Create a note from a template with variable substitution |
| `create_template` | Create a new template |

## Search

Triple-threat search combining three engines:

- **FTS5** -- exact keyword matching with BM25 ranking
- **Trigram** -- fuzzy/typo-tolerant matching
- **Vector** -- semantic similarity (optional, local embeddings)

Results are normalized, weighted, and merged into a single ranked list.

## Dataview Compatible

Full DQL engine built from scratch:

```
TABLE file.name, rating, genre
FROM #books AND "Reading"
WHERE rating >= 4
SORT rating DESC
GROUP BY genre
LIMIT 10
```

Supports TABLE, LIST, TASK, CALENDAR queries with WHERE, SORT, GROUP BY, FLATTEN, LIMIT. Includes all built-in functions (contains, startswith, sum, average, etc.) and JavaScript inline queries via sandboxed execution.

## Configuration

Optional `.obsidian-mcp-tools.json` in vault root:

```json
{
  "search": {
    "weights": { "fts": 0.4, "trigram": 0.2, "vector": 0.4 }
  },
  "index": {
    "excludePaths": [".obsidian", ".trash"],
    "excludePatterns": ["*.excalidraw.md"]
  },
  "notes": {
    "trashInsteadOfDelete": true,
    "autoUpdateLinks": true
  },
  "dataview": {
    "enableJsQueries": false
  }
}
```

## How It Works

- Reads your vault directly from the filesystem (no Obsidian app required)
- Indexes all notes into a local SQLite database
- Watches for file changes and re-indexes incrementally
- Communicates via stdio (standard MCP transport)

## Multiple Vaults

```bash
npx obsidian-mcp-tools /path/to/vault1 /path/to/vault2
```

## Requirements

- Node.js >= 18

## License

MIT
