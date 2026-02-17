import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import {
  findLastAssistantMessage,
  handleEditorResult,
  runEditor,
  getEditorCommand,
  PARROT_DESCRIPTION,
  PARROT_DEFAULT_KEYBOARD_SHORTCUT,
  PARROT_CUSTOM_MESSAGE_TYPE,
  type EditorResult,
} from "../../extensions/parrot";

describe("findLastAssistantMessage", () => {
  const createMessageEntry = (
    role: "user" | "assistant" | "toolResult",
    content: { type: "text"; text: string }[],
  ): SessionEntry =>
    ({
      id: `msg-${Math.random()}`,
      type: "message",
      message: {
        role,
        content: content as any,
      },
    }) as SessionEntry;

  const createThinkingEntry = (): SessionEntry =>
    ({
      id: `thinking-${Math.random()}`,
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think about this..." },
          { type: "text", text: "Here is my response." },
        ] as any,
      },
    }) as SessionEntry;

  test("returns text from last assistant message", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("user", [{ type: "text", text: "Hello" }]),
      createMessageEntry("assistant", [
        { type: "text", text: "First response" },
      ]),
      createMessageEntry("user", [{ type: "text", text: "Another question" }]),
      createMessageEntry("assistant", [{ type: "text", text: "Last response" }]),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBe("Last response");
  });

  test("excludes thinking content", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("user", [{ type: "text", text: "Hello" }]),
      createThinkingEntry(),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBe("Here is my response.");
  });

  test("returns undefined when no assistant messages", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("user", [{ type: "text", text: "Hello" }]),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBeUndefined();
  });

  test("returns undefined for empty branch", () => {
    const result = findLastAssistantMessage([]);
    expect(result).toBeUndefined();
  });

  test("skips non-message entries", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("user", [{ type: "text", text: "Hello" }]),
      { id: "custom-1", type: "custom", customType: "foo", data: {} } as unknown as SessionEntry,
      createMessageEntry("assistant", [{ type: "text", text: "Found it" }]),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBe("Found it");
  });

  test("joins multiple text parts with double newlines", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("assistant", [
        { type: "text", text: "Part one" },
        { type: "text", text: "Part two" },
      ]),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBe("Part one\n\nPart two");
  });

  test("returns last assistant message, not first", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("assistant", [{ type: "text", text: "First" }]),
      createMessageEntry("assistant", [{ type: "text", text: "Second" }]),
      createMessageEntry("assistant", [{ type: "text", text: "Third (last)" }]),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBe("Third (last)");
  });

  test("handles mixed content blocks with thinking, text, and toolResult", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("assistant", [
        { type: "thinking", thinking: "Analyzing..." },
        { type: "text", text: "My answer" },
        { type: "toolResult", toolName: "test", toolCallId: "call-1", content: "tool output" },
      ] as any),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBe("My answer");
  });

  test("handles assistant message with only toolResult content", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("assistant", [
        { type: "toolResult", toolName: "test", toolCallId: "call-1", content: "tool output" },
      ] as any),
    ];

    const result = findLastAssistantMessage(branch);
    // When there's only toolResult (no text type), returns undefined
    expect(result).toBeUndefined();
  });

  test("handles empty text content in message", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("assistant", [
        { type: "text", text: "" },
        { type: "text", text: "Non-empty" },
      ]),
    ];

    const result = findLastAssistantMessage(branch);
    // Empty strings are kept and joined with "\n\n"
    expect(result).toBe("\n\nNon-empty");
  });

  test("handles content with leading/trailing whitespace", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("assistant", [
        { type: "text", text: "  spaces around  " },
      ]),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBe("  spaces around  ");
  });

  test("handles content with newlines and tabs", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("assistant", [
        { type: "text", text: "line1\n\nline2\n\ttabbed" },
      ]),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBe("line1\n\nline2\n\ttabbed");
  });

  test("skips entries that are not message type", () => {
    const branch: SessionEntry[] = [
      { id: "custom-1", type: "custom", customType: "foo", data: {} } as unknown as SessionEntry,
      { id: "branch-1", type: "branch", branchId: "branch-1" } as unknown as SessionEntry,
      createMessageEntry("assistant", [{ type: "text", text: "Found in message" }]),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBe("Found in message");
  });

  test("returns undefined when all assistant messages have no text", () => {
    const branch: SessionEntry[] = [
      createMessageEntry("assistant", [
        { type: "toolResult", toolName: "test", toolCallId: "call-1", content: "tool output" },
      ] as any),
      createMessageEntry("assistant", [
        { type: "thinking", thinking: "Just thinking" },
      ] as any),
    ];

    const result = findLastAssistantMessage(branch);
    expect(result).toBeUndefined();
  });
});

describe("handleEditorResult", () => {
  const createMockContext = () => ({
    ui: {
      notify: mock(() => {}),
    } as unknown as ExtensionUIContext,
    sendMessage: mock(() => {}),
  });

  const expectSendMessage = (ctx: ReturnType<typeof createMockContext>, content: string) => {
    expect(ctx.sendMessage).toHaveBeenCalledWith(
      {
        customType: PARROT_CUSTOM_MESSAGE_TYPE,
        content,
        display: true,
      },
      { triggerTurn: true, deliverAs: "steer" },
    );
  };

  test("notifies error when editor returns error", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: null,
      error: "nvim not found",
      exitCode: 1,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "nvim error: nvim not found",
      "error",
    );
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  test("sends message when content is returned with exit code 0", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: "Edited content",
      error: null,
      exitCode: 0,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expectSendMessage(ctx, "Edited content");
  });

  test("warns and does not send content when non-zero exit code but content exists", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: "Edited content",
      error: null,
      exitCode: 1,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "'nvim' exited with code 1. Not sending message",
      "warning",
    );
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  test("warns when non-zero exit code and no content", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: null,
      error: null,
      exitCode: 1,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "'nvim' exited with code 1. Not sending message",
      "warning",
    );
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  test("notifies info when no content and exit code 0", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: null,
      error: null,
      exitCode: 0,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    expect(ctx.ui.notify).toHaveBeenCalledWith("No message to send", "info");
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  test("handles error with content present", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: "Some content",
      error: "warning: some issue",
      exitCode: 0,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    // Error is present, so notify error
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "nvim error: warning: some issue",
      "error",
    );
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  test("handles empty string content", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: "",
      error: null,
      exitCode: 0,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    // Empty string is falsy in JS, so treated as no content
    expect(ctx.ui.notify).toHaveBeenCalledWith("No message to send", "info");
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  test("handles whitespace-only content", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: "   \n\t  ",
      error: null,
      exitCode: 0,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    // Whitespace-only is truthy, so it gets sent
    expectSendMessage(ctx, "   \n\t  ");
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  test("error takes precedence over exit code warning", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: "content",
      error: "fatal error",
      exitCode: 1,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "nvim error: fatal error",
      "error",
    );
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });

  test("notifies error on non-zero exit with null content", () => {
    const ctx = createMockContext();
    const result: EditorResult = {
      content: null,
      error: null,
      exitCode: 2,
    };

    handleEditorResult(result, ctx.ui, ctx.sendMessage);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "'nvim' exited with code 2. Not sending message",
      "warning",
    );
    expect(ctx.sendMessage).not.toHaveBeenCalled();
  });
});

describe("runEditor", () => {
  const testFile = "/tmp/test-parrot-file.md";
  const zzzvimPath = "/tmp/zzzvim";

  beforeEach(() => {
    // Create a test file before each test
    fs.writeFileSync(testFile, "initial content", "utf-8");
  });

  afterEach(() => {
    // Clean up test file after each test
    try {
      fs.unlinkSync(testFile);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  test("returns error when no VISUAL or EDITOR env var set", () => {
    // Save original env vars
    const originalVisual = process.env.VISUAL;
    const originalEditor = process.env.EDITOR;

    // Unset both env vars
    delete process.env.VISUAL;
    delete process.env.EDITOR;

    const result = runEditor(testFile);

    expect(result.error).toBe(
      "No editor configured. Set $VISUAL or $EDITOR environment variable.",
    );
    expect(result.content).toBeNull();
    expect(result.exitCode).toBeNull();

    // Restore env vars
    process.env.VISUAL = originalVisual;
    process.env.EDITOR = originalEditor;
  });

  test("returns error when editor command not found", () => {
    const originalEditor = process.env.EDITOR;
    process.env.EDITOR = "nonexistent-editor-12345";

    const result = runEditor(testFile);

    // Either error message or non-zero exit code indicates failure
    expect(result.error || result.exitCode).toBeTruthy();

    process.env.EDITOR = originalEditor;
  });

  test("returns content with exit code 0 on successful edit", () => {
    const originalEditor = process.env.EDITOR;
    process.env.EDITOR = zzzvimPath;

    const result = runEditor(testFile);

    expect(result.error).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.content).toBe("initial content");

    process.env.EDITOR = originalEditor;
  });

  test("returns content even when exit code is non-zero", () => {
    const originalEditor = process.env.EDITOR;
    // Create a zzzvim that exits non-zero
    const nonZeroZzzvim = "/tmp/zzzvim-nonzero";
    fs.writeFileSync(nonZeroZzzvim, "#!/bin/sh\nexit 1\n", "utf-8");
    fs.chmodSync(nonZeroZzzvim, 0o755);
    process.env.EDITOR = nonZeroZzzvim;

    const result = runEditor(testFile);

    // Should still return content even with non-zero exit code
    expect(result.content).toBe("initial content");
    expect(result.exitCode).toBe(1);

    process.env.EDITOR = originalEditor;
    fs.unlinkSync(nonZeroZzzvim);
  });

  test("strips trailing newline from content", () => {
    const originalEditor = process.env.EDITOR;
    process.env.EDITOR = zzzvimPath;

    // Write file with trailing newline
    fs.writeFileSync(testFile, "content with newline\n", "utf-8");

    const result = runEditor(testFile);

    expect(result.content).toBe("content with newline");

    process.env.EDITOR = originalEditor;
  });

  test("returns error when file cannot be read", () => {
    const originalEditor = process.env.EDITOR;
    process.env.EDITOR = zzzvimPath;

    // File doesn't exist - should return error
    const nonexistentFile = "/tmp/nonexistent-parrot-file-12345.md";
    const result = runEditor(nonexistentFile);

    expect(result.error).toBeTruthy();
    expect(result.content).toBeNull();

    process.env.EDITOR = originalEditor;
  });
});

describe("getEditorCommand", () => {
  afterEach(() => {
    // Clean up env vars after each test
    delete process.env.VISUAL;
    delete process.env.EDITOR;
  });

  test("returns VISUAL when set", () => {
    process.env.VISUAL = "vim";
    process.env.EDITOR = "nano";
    expect(getEditorCommand()).toBe("vim");
  });

  test("returns EDITOR when VISUAL is not set", () => {
    delete process.env.VISUAL;
    process.env.EDITOR = "nano";
    expect(getEditorCommand()).toBe("nano");
  });

  test("prefers VISUAL over EDITOR", () => {
    process.env.VISUAL = "vim";
    process.env.EDITOR = "nano";
    expect(getEditorCommand()).toBe("vim");
  });

  test("returns empty string when neither VISUAL nor EDITOR is set", () => {
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    expect(getEditorCommand()).toBe("");
  });
});

describe("constants", () => {
  test("PARROT_DESCRIPTION is a non-empty string", () => {
    expect(typeof PARROT_DESCRIPTION).toBe("string");
    expect(PARROT_DESCRIPTION.length).toBeGreaterThan(0);
  });

  test("PARROT_DEFAULT_KEYBOARD_SHORTCUT is defined", () => {
    expect(PARROT_DEFAULT_KEYBOARD_SHORTCUT).toBeDefined();
  });

  test("PARROT_CUSTOM_MESSAGE_TYPE is a non-empty string", () => {
    expect(typeof PARROT_CUSTOM_MESSAGE_TYPE).toBe("string");
    expect(PARROT_CUSTOM_MESSAGE_TYPE.length).toBeGreaterThan(0);
  });
});
