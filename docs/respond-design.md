# Respond Extension - High-Level Design

## Overview

**Extension Name:** `respond`
**Command:** `/respond`
**Shortcuts:**
- `Alt+R` - Full pipeline (Q&A → Editor → Send)
- `Alt+D` - Q&A only (skip editor review)
- `Alt+E` - Editor only (skip Q&A extraction)

**Purpose:** Combine answer.ts (LLM-powered Q&A extraction) with parrot.ts (external editor integration) into a unified response workflow.

**Key Feature:** Smart fallback - if no questions are detected, automatically skips to editor mode.

---

## Design Philosophy

1. **Zero typing for common case** - Just press `Ctrl+.` and the system handles the rest
2. **Power user overrides** - Shortcuts to skip directly to preferred mode
3. **Graceful fallbacks** - No questions → Editor; No editor → send directly

---

## Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    /respond (or Alt+R)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  1. LLM extracts questions    │
              │     from last AI message      │
              └───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ Questions found │             │ No questions   │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ 2. Q&A TUI mode │             │ 2b. Skip to     │
    │ (interactive)   │             │    Editor       │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ 3. Open in      │             │ 3. Open in      │
    │ external editor │             │ external editor │
    │ (final review)  │             │ (final review)  │
    └─────────────────┘             └─────────────────┘
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ 4. Send result  │             │ 4. Send result  │
    └─────────────────┘             └─────────────────┘
```

---

## Shortcuts

**Command:** `/respond`

| Shortcut | Mode | Command Argument | Behavior |
|----------|------|------------------|----------|
| `Alt+R` | `full` | (none) | Extract → Q&A → Editor → Send |
| `Alt+D` | `tui-only` | `--tui` / `-t` | Extract → Q&A → Send (skip editor) |
| `Alt+E` | `editor-only` | `--editor` / `-e` | Editor → Send (skip Q&A extraction) |

---

## File Structure

```
extensions/
  respond.ts         # Main entry point (single file for simplicity)
```

The extension is a **single file** combining:
- Types and constants (from answer.ts)
- Helper functions (from both sources)
- Q&A TUI Component (from answer.ts)
- Main handler logic (orchestrator)
- Registration (commands + shortcuts)

---

## Dependencies

### From answer.ts
- `complete`, `type Model`, `type Api`, `type UserMessage` from `@mariozechner/pi-ai`
- `BorderedLoader` from `@mariozechner/pi-coding-agent`
- TUI types: `Component`, `Editor`, `EditorTheme`, `Key`, `matchesKey`, `truncateToWidth`, `TUI`, `visibleWidth`, `wrapTextWithAnsi`

### From parrot.ts
- `spawnSync` from `node:child_process`
- `fs`, `os`, `path` from `node:*`

### Shared
- `ExtensionAPI`, `ExtensionContext` from `@mariozechner/pi-coding-agent`
- `SessionEntry`, `TextContent` types

---

## Key Design Decisions

### 1. Single File vs Multi-File

**Decision:** Single file (`respond.ts`)

**Rationale:**
- Simpler to copy/paste and test
- Both source extensions are self-contained
- Easier to maintain in picadillo's extensions folder

### 2. Model Selection

**Decision:** Single model `cc-glm-5` with no fallback

**Rationale:**
- Explicit control over which model handles extraction
- Errors clearly if model not found in registry
- Simpler than managing fallback chain

### 3. Message Types

**Decision:** Use different custom message types based on mode

- `full` or `tui-only` → `answers` (from answer.ts)
- `editor-only` → `🦜 parrot squawking` (from parrot.ts)

**Rationale:** Preserves existing behavior for downstream tools/renderers that may depend on these message types.

### 3. Temp File Naming

**Decision:** Use `pi-respond-{timestamp}.md`

**Rationale:** Distinct from parrot's `pi-parrot-{timestamp}.md` to avoid conflicts if both extensions are loaded.

### 4. Editor Handling in custom()

**Decision:** Use `tui.stop()` before spawning editor, `tui.start()` after

**Rationale:** Required to properly suspend/resume the TUI while an external editor takes over the terminal.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No assistant messages found | `ctx.ui.notify("No assistant messages found", "error")` + return |
| Extraction model not found | `ctx.ui.notify("Model 'cc-glm-5' not found in registry", "error")` + return |
| No API key for model | `ctx.ui.notify("No API key for 'cc-glm-5'", "error")` + return |
| LLM extraction fails (network error) | Show error, allow retry or fall back to editor |
| Extraction returns no questions | Automatically skip to editor mode |
| No external editor configured ($VISUAL/$EDITOR) | Skip editor step, send directly |
| Editor exits with non-zero | Show warning, don't send |
| User cancels at any stage | `ctx.ui.notify("Cancelled", "info")` + return |
| Empty answers submitted | Allow (same as answer.ts current behavior) |

---

## Testing Checklist

- [ ] **Full pipeline works** - Last message has questions → Q&A TUI appears → answered → Editor opens → Send works
- [ ] **No questions → Editor fallback** - Last message has no questions → Editor opens directly → Send works
- [ ] **Q&A only mode** - `Alt+D` → Q&A TUI → answered → Sent directly (no editor)
- [ ] **Editor only mode** - `Alt+E` → Editor opens → Send works (no Q&A)
- [ ] **No editor configured** - Full pipeline with no $EDITOR → Skip editor, send directly
- [ ] **Cancel at Q&A stage** - Escape during Q&A → Nothing sent, no error
- [ ] **Cancel at Editor stage** - Exit editor without saving → Nothing sent, no error
- [ ] **Command argument parsing** - `/respond --tui`, `/respond -t`, `/respond --editor`, `/respond -e` all work

---

## Implementation Phases

See `docs/respond-implementation.md` for detailed code.

### Phase 1: Types & Constants
### Phase 2: Helper Functions
### Phase 3: Q&A TUI Component
### Phase 4: Main Handler Logic
### Phase 5: Entry Point & Registration
