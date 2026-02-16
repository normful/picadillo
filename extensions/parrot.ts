/**
 * Parrot Command Extension
 *
 * Opens the last AI response in an external text editor (respects $VISUAL
 * or $EDITOR environment variables). When you save and exit the editor,
 * the edited content is automatically sent back to the chat as your next
 * message.
 *
 * This is useful for:
 *   - Editing AI responses before re-sending them
 *   - Copying AI output to a full-featured editor
 *   - Iterating on AI responses with custom edits
 *
 * Usage:
 *   /parrot         - Open last AI message in external editor
 *   Alt+R          - Keyboard shortcut for the same action
 *
 * The extension preserves the original message content, opens it in your
 * preferred editor, and sends your edited version back to the chat.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type {
  ExtensionContext,
  ExtensionUIContext,
} from "@mariozechner/pi-coding-agent";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { TextContent } from "@mariozechner/pi-ai";
import { Key } from "@mariozechner/pi-tui";

export const PARROT_DESCRIPTION =
  "Open last AI message in external editor, then send edited message after you save and exit external editor";

export const PARROT_DEFAULT_KEYBOARD_SHORTCUT = Key.alt("r");
export const PARROT_CUSTOM_MESSAGE_TYPE = "🦜 parrot squawking";

/**
 * Find the last assistant message text on the current branch.
 * Excludes thinking content, returns only user-visible text.
 */
export function findLastAssistantMessage(
  sessionEntry: SessionEntry[],
): string | undefined {
  for (let i = sessionEntry.length - 1; i >= 0; i--) {
    const entry = sessionEntry[i];
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

export function getEditorCommand(): string {
  return process.env.VISUAL || process.env.EDITOR || "";
}

/**
 * Result from running the external editor
 */
export interface EditorResult {
  content: string | null;
  error: string | null;
  exitCode: number | null;
}

export function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

/**
 * Run the external editor on the given file path.
 * Handles TUI suspension, terminal setup, and result parsing.
 */
export function runEditor(filePath: string): EditorResult {
  clearScreen();

  const editorCmd = getEditorCommand();
  if (!editorCmd) {
    return {
      content: null,
      error:
        "No editor configured. Set $VISUAL or $EDITOR environment variable.",
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

/**
 * Handle the result from running the editor and decide what to notify/send
 */
export function handleEditorResult(
  result: EditorResult,
  ui: ExtensionUIContext,
  sendMessage: ExtensionAPI["sendMessage"],
): void {
  const { content, error, exitCode } = result;

  if (error) {
    ui.notify(`nvim error: ${error}`, "error");
    return;
  }

  if (exitCode !== null && exitCode !== 0) {
    const editorCmd = getEditorCommand();

    ui.notify(
      `'${editorCmd}' exited with code ${exitCode}. Not sending message`,
      "warning",
    );
    return;
  }

  if (!content) {
    ui.notify("No message to send", "info");
    return;
  }

  sendMessage(
    {
      customType: PARROT_CUSTOM_MESSAGE_TYPE,
      content,
      display: true,
    },
    { triggerTurn: true, deliverAs: "steer" },
  );
}

export async function parrotHandler(pi: ExtensionAPI, ctx: ExtensionContext) {
  if (!ctx.hasUI) {
    ctx.ui.notify("parrot requires interactive mode", "error");
    return;
  }

  const branch = ctx.sessionManager.getBranch();
  const lastAssistantText = findLastAssistantMessage(branch);

  if (!lastAssistantText) {
    ctx.ui.notify("No assistant messages found", "error");
    return;
  }

  const tmpFile = path.join(os.tmpdir(), `pi-parrot-${Date.now()}.md`);
  try {
    fs.writeFileSync(tmpFile, lastAssistantText, "utf-8");
  } catch (err) {
    ctx.ui.notify(`Failed to create temp file: ${err}`, "error");
    return;
  }

  const result = await ctx.ui.custom<EditorResult>((tui, _theme, _kb, done) => {
    tui.stop();

    const editorResult = runEditor(tmpFile);

    tui.start();
    tui.requestRender(true);

    try {
      fs.unlinkSync(tmpFile);
    } catch (err) {
      ctx.ui.notify(`Failed to delete ${tmpFile}: ${err}`, "error");
    }

    done(editorResult);

    return { render: () => [], invalidate: () => {} };
  });

  handleEditorResult(result, ctx.ui, pi.sendMessage);
}

export default function (pi: ExtensionAPI) {
  pi.registerShortcut(PARROT_DEFAULT_KEYBOARD_SHORTCUT, {
    description: PARROT_DESCRIPTION,
    handler: async (ctx: ExtensionContext) => {
      await parrotHandler(pi, ctx);
    },
  });

  pi.registerCommand("parrot", {
    description: PARROT_DESCRIPTION,
    handler: async (_args: string, ctx: ExtensionContext) => {
      await parrotHandler(pi, ctx);
    },
  });
}
