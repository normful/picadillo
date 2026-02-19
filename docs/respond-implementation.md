# Respond Extension - Detailed Implementation

This document provides the complete code implementation. Read `respond-design.md` first for high-level context.

---

## Phase 1: Types & Constants

```typescript
// Structured output format for question extraction
interface ExtractedQuestion {
  question: string;
  context?: string;
}

interface ExtractionResult {
  questions: ExtractedQuestion[];
}

// Result type from external editor
interface EditorResult {
  content: string | null;
  error: string | null;
  exitCode: number | null;
}

// Pipeline mode enum
type RespondMode = "full" | "tui-only" | "editor-only";

// LLM prompt for extraction
const SYSTEM_PROMPT = `You are a question extractor. Given text from a conversation, extract any questions that need answering.

Output a JSON object with this structure:
{
  "questions": [
    {
      "question": "The question text",
      "context": "Optional context that helps answer the question"
    }
  ]
}

Rules:
- Extract all questions that require user input
- Keep questions in the order they appeared
- Be concise with question text
- Include context only when it provides essential information for answering
- If no questions are found, return {"questions": []}`;

// Model for question extraction (no fallback - errors if not found)
const EXTRACTION_MODEL_ID = "cc-glm-5";
```

---

## Phase 2: Helper Functions

### 2.1 LLM Model Selection

```typescript
import { complete, type Model, type Api, type UserMessage } from "@mariozechner/pi-ai";

async function selectExtractionModel(
  modelRegistry: {
    find: (provider: string, modelId: string) => Model<Api> | undefined;
    getApiKey: (model: Model<Api>) => Promise<string | undefined>;
  },
): Promise<Model<Api>> {
  const extractionModel = modelRegistry.find("openai-codex", EXTRACTION_MODEL_ID);
  if (!extractionModel) {
    throw new Error(
      `Extraction model '${EXTRACTION_MODEL_ID}' not found in model registry. ` +
      `Please ensure the model is installed.`
    );
  }

  const apiKey = await modelRegistry.getApiKey(extractionModel);
  if (!apiKey) {
    throw new Error(
      `No API key configured for '${EXTRACTION_MODEL_ID}'. ` +
      `Please configure your API key in settings.`
    );
  }

  return extractionModel;
}
```

### 2.2 JSON Parsing

```typescript
function parseExtractionResult(text: string): ExtractionResult | null {
  try {
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    const parsed = JSON.parse(jsonStr);
    if (parsed && Array.isArray(parsed.questions)) {
      return parsed as ExtractionResult;
    }
    return null;
  } catch {
    return null;
  }
}
```

### 2.3 Find Last Assistant Message

```typescript
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { TextContent } from "@mariozechner/pi-ai";

function findLastAssistantMessage(entries: SessionEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || entry.type !== "message") continue;

    const msg = entry.message;
    if (!msg || msg.role !== "assistant") continue;

    const textParts = msg.content
      .filter((c): c is TextContent => c.type === "text")
      .map((c) => c.text);

    if (textParts.length > 0) {
      return textParts.join("\n\n");
    }
  }
  return undefined;
}
```

### 2.4 Editor Command Detection

```typescript
function getEditorCommand(): string {
  return process.env.VISUAL || process.env.EDITOR || "";
}
```

### 2.5 Run External Editor

```typescript
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function runEditor(filePath: string): EditorResult {
  // Clear screen before launching editor
  process.stdout.write("\x1b[2J\x1b[H");

  const editorCmd = getEditorCommand();
  if (!editorCmd) {
    return {
      content: null,
      error: "No editor configured. Set $VISUAL or $EDITOR environment variable.",
      exitCode: null,
    };
  }

  let exitCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    const result = spawnSync(editorCmd, [filePath], {
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
    exitCode = result.status;

    if (result.error) {
      errorMessage = result.error.message;
    }

    if (result.signal) {
      errorMessage = `Killed by signal: ${result.signal}`;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (errorMessage) {
    return { content: null, error: errorMessage, exitCode };
  }

  // Read the edited content
  try {
    const content = fs.readFileSync(filePath, "utf-8").replace(/\n$/, "");
    return { content, error: null, exitCode };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      content: null,
      error: `Could not read edited file: ${error}`,
      exitCode,
    };
  }
}
```

### 2.6 Compile Q&A Answers to Text

```typescript
function compileAnswers(
  questions: ExtractedQuestion[],
  answers: string[],
): string {
  const parts: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = answers[i]?.trim() || "(no answer)";
    parts.push(`Q: ${q.question}`);
    if (q.context) {
      parts.push(`> ${q.context}`);
    }
    parts.push(`A: ${a}`);
    parts.push("");
  }
  return parts.join("\n").trim();
}
```

---

## Phase 3: Q&A TUI Component

Copy the `QnAComponent` class from answer.ts **exactly as-is**. This component:
- Displays questions one at a time with progress indicator
- Uses the Editor component for inline answering
- Handles navigation (Tab/Shift+Tab, arrow keys)
- Shows confirmation dialog before submitting
- Returns compiled answers via `done` callback

Key signature:
```typescript
class QnAComponent implements Component {
  constructor(
    questions: ExtractedQuestion[],
    tui: TUI,
    onDone: (result: string | null) => void,
  ) { ... }
}
```

---

## Phase 4: Main Handler Logic

```typescript
async function respondHandler(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  mode: RespondMode,
): Promise<void> {
  // === Pre-flight checks ===
  if (!ctx.hasUI) {
    ctx.ui.notify("respond requires interactive mode", "error");
    return;
  }

  if (!ctx.model) {
    ctx.ui.notify("No model selected", "error");
    return;
  }

  // === Get last assistant message ===
  const branch = ctx.sessionManager.getBranch();
  const lastAssistantText = findLastAssistantMessage(branch);

  if (!lastAssistantText) {
    ctx.ui.notify("No assistant messages found", "error");
    return;
  }

  // === Determine if we should do Q&A extraction ===
  // Q&A if: mode is "full" or "tui-only"
  // Skip to editor if: mode is "editor-only"
  const doExtraction = mode !== "editor-only";

  let extractedResult: ExtractionResult | null = null;
  let compiledAnswers: string | null = null;

  if (doExtraction) {
    // === Step 1: Extract questions via LLM ===
    const extractionModel = await selectExtractionModel(ctx.modelRegistry);

    extractedResult = await ctx.ui.custom<ExtractionResult | null>((tui, theme, _kb, done) => {
      const loader = new BorderedLoader(
        tui,
        theme,
        `Extracting questions using ${extractionModel.id}...`,
      );
      loader.onAbort = () => done(null);

      const doExtract = async () => {
        const apiKey = await ctx.modelRegistry.getApiKey(extractionModel);
        const userMessage: UserMessage = {
          role: "user",
          content: [{ type: "text", text: lastAssistantText! }],
          timestamp: Date.now(),
        };

        const response = await complete(
          extractionModel,
          { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
          { apiKey, signal: loader.signal },
        );

        if (response.stopReason === "aborted") {
          return null;
        }

        const responseText = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        return parseExtractionResult(responseText);
      };

      doExtract().then(done).catch(() => done(null));
      return loader;
    });

    // Handle extraction cancellation
    if (extractedResult === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    // === Step 2: If no questions found, skip to editor ===
    if (extractedResult.questions.length === 0) {
      // No questions - fall through to editor mode
      doExtraction = false; // Mark that we're skipping Q&A
    }
  }

  // === Step 2/3: Q&A TUI or prepare for editor ===
  if (doExtraction && extractedResult && extractedResult.questions.length > 0) {
    // Run Q&A component
    compiledAnswers = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
      return new QnAComponent(extractedResult!.questions, tui, done);
    });

    // Handle Q&A cancellation
    if (compiledAnswers === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }
  } else {
    // No Q&A - prepare content for editor
    compiledAnswers = lastAssistantText;
  }

  // === Step 3/4: External editor review (if enabled) ===
  // Only run editor if mode is "full" (not "tui-only")
  const doEditor = mode === "full";

  if (doEditor) {
    const editorCmd = getEditorCommand();

    // If no editor configured, skip to send
    if (!editorCmd) {
      ctx.ui.notify("No $EDITOR configured, skipping editor review", "info");
    } else {
      // Write content to temp file
      const tmpFile = path.join(os.tmpdir(), `pi-respond-${Date.now()}.md`);

      try {
        fs.writeFileSync(tmpFile, compiledAnswers!, "utf-8");
      } catch (err) {
        ctx.ui.notify(`Failed to create temp file: ${err}`, "error");
        return;
      }

      // Run editor
      const editorResult = await ctx.ui.custom<EditorResult>((tui, _theme, _kb, done) => {
        tui.stop(); // Suspend TUI

        const result = runEditor(tmpFile);

        tui.start(); // Resume TUI
        tui.requestRender(true);

        // Cleanup temp file
        try {
          fs.unlinkSync(tmpFile);
        } catch (err) {
          ctx.ui.notify(`Failed to delete temp file: ${err}`, "warning");
        }

        done(result);
        return { render: () => [], invalidate: () => {} };
      });

      // Handle editor errors
      if (editorResult.error) {
        ctx.ui.notify(`Editor error: ${editorResult.error}`, "error");
        return;
      }

      if (editorResult.exitCode !== null && editorResult.exitCode !== 0) {
        ctx.ui.notify(
          `'${editorCmd}' exited with code ${editorResult.exitCode}. Not sending message`,
          "warning",
        );
        return;
      }

      if (!editorResult.content) {
        ctx.ui.notify("No message to send", "info");
        return;
      }

      // Update compiled answers with editor result
      compiledAnswers = editorResult.content;
    }
  }

  // === Step 4/5: Send the result ===
  // Determine message type based on mode
  const messageType = mode === "editor-only" ? "🦜 parrot squawking" : "answers";

  pi.sendMessage(
    {
      customType: messageType,
      content: "I answered your questions in the following way:\n\n" + compiledAnswers,
      display: true,
    },
    { triggerTurn: true },
  );
}
```

---

## Phase 5: Entry Point & Registration

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Full pipeline (Q&A → Editor)
  pi.registerShortcut(Key.alt("r"), {
    description: "Extract questions, answer in TUI, review in editor, then send",
    handler: async (ctx: ExtensionContext) => {
      await respondHandler(pi, ctx, "full");
    },
  });

  pi.registerCommand("respond", {
    description: "Full pipeline: Q&A extraction + interactive answer + optional editor review",
    handler: async (args: string, ctx: ExtensionContext) => {
      const mode = parseMode(args);
      await respondHandler(pi, ctx, mode);
    },
  });

  // Q&A only (skip editor)
  pi.registerShortcut(Key.alt("d"), {
    description: "Extract questions and answer in TUI only (skip editor)",
    handler: async (ctx: ExtensionContext) => {
      await respondHandler(pi, ctx, "tui-only");
    },
  });

  pi.registerCommand("respond-tui", {
    description: "Q&A extraction + interactive answer only (no editor)",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await respondHandler(pi, ctx, "tui-only");
    },
  });

  // Editor only (skip Q&A extraction)
  pi.registerShortcut(Key.alt("e"), {
    description: "Open last AI message in external editor (skip Q&A)",
    handler: async (ctx: ExtensionContext) => {
      await respondHandler(pi, ctx, "editor-only");
    },
  });

  pi.registerCommand("respond-editor", {
    description: "Open last AI message in external editor (no Q&A extraction)",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await respondHandler(pi, ctx, "editor-only");
    },
  });
}

// Helper to parse mode from command args
function parseMode(args: string): RespondMode {
  const trimmed = args.trim().toLowerCase();
  if (trimmed === "--tui" || trimmed === "-t") {
    return "tui-only";
  }
  if (trimmed === "--editor" || trimmed === "-e") {
    return "editor-only";
  }
  return "full"; // default
}
```

---

## Imports Summary

```typescript
// node:*
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// @mariozechner/pi-ai
import { complete, type Model, type Api, type UserMessage, type TextContent } from "@mariozechner/pi-ai";

// @mariozechner/pi-coding-agent
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

// @mariozechner/pi-tui
import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  truncateToWidth,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
```

---

## Notes

1. **QnAComponent** - Copy from answer.ts, no modifications needed
2. **Key ordering** - Ensure `Key.ctrl(".")` comes before `Key.ctrlShift(".")` to avoid conflicts
3. **Message types** - Keep `🦜 parrot squawking` for editor-only to maintain compatibility with any tools expecting parrot's format
4. **Error messages** - Always use `ctx.ui.notify()` for errors, not console.log
