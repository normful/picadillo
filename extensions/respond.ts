// @ts-nocheck
/**
 * Respond Extension
 *
 * Unified response workflow combining:
 * 1. Q&A extraction - Uses LLM to extract questions from last assistant message
 * 2. Interactive Q&A - TUI for answering questions
 * 3. External editor - Review in $VISUAL/$EDITOR before sending
 *
 * Shortcuts:
 *   Alt+R - Full pipeline (Q&A → Editor → Send)
 *   Alt+D - Q&A only (skip editor)
 *   Alt+E - Editor only (skip Q&A extraction)
 *
 * Commands:
 *   /respond       - Full pipeline
 *   /respond --tui - Q&A only
 *   /respond --editor - Editor only
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { complete, type Model, type Api, type UserMessage, type TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
import {
	type Component,
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	truncateToWidth,
	type TUI,
} from "@mariozechner/pi-tui";

// =============================================================================
// Types & Constants
// =============================================================================

interface ExtractedQuestion {
	question: string;
	context?: string;
}

interface ExtractionResult {
	questions: ExtractedQuestion[];
}

interface EditorResult {
	content: string | null;
	error: string | null;
	exitCode: number | null;
}

type RespondMode = "full" | "tui-only" | "editor-only";

const EXTRACTION_MODEL_ID = "cc-glm-5";

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

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find the extraction model from registry. Throws if not found or no API key.
 */
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
				"Please ensure the model is installed.",
		);
	}

	const apiKey = await modelRegistry.getApiKey(extractionModel);
	if (!apiKey) {
		throw new Error(
			`No API key configured for '${EXTRACTION_MODEL_ID}'. ` +
				"Please configure your API key in settings.",
		);
	}

	return extractionModel;
}

/**
 * Parse JSON from LLM response, handling markdown code blocks.
 */
function parseExtractionResult(text: string): ExtractionResult | null {
	try {
		let jsonStr = text;
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			jsonStr = jsonMatch![1].trim();
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

/**
 * Find the last assistant message text on the current branch.
 */
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

/**
 * Get the external editor command from environment.
 */
function getEditorCommand(): string {
	return process.env.VISUAL || process.env.EDITOR || "";
}

/**
 * Clear terminal screen before launching editor.
 */
function clearScreen() {
	process.stdout.write("\x1b[2J\x1b[H");
}

/**
 * Run the external editor on the given file path.
 */
function runEditor(filePath: string): EditorResult {
	clearScreen();

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

/**
 * Compile Q&A answers into formatted text.
 */
function compileAnswers(questions: ExtractedQuestion[], answers: string[]): string {
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

// =============================================================================
// Q&A TUI Component
// =============================================================================

class QnAComponent implements Component {
	private questions: ExtractedQuestion[];
	private theme: any;
	private onDone: (result: string | null) => void;
	private currentIndex = 0;
	private answers: string[] = [];
	private inputMode = false;
	private editor: Editor;
	private cachedLines: string[] | undefined;

	constructor(
		questions: ExtractedQuestion[],
		tui: TUI,
		theme: EditorTheme,
		onDone: (result: string | null) => void,
	) {
		this.questions = questions;
		this.theme = theme;
		this.onDone = onDone;
		this.answers = new Array(questions.length).fill("");

		this.editor = new Editor(tui, {
			borderColor: (s) => this.theme.fg("accent", s),
			selectList: {
				selectedPrefix: (t) => this.theme.fg("accent", t),
				selectedText: (t) => this.theme.fg("accent", t),
				description: (t) => this.theme.fg("muted", t),
				scrollInfo: (t) => this.theme.fg("dim", t),
				noMatch: (t) => this.theme.fg("warning", t),
			},
		});

		this.editor.onSubmit = (value) => {
			this.answers[this.currentIndex] = value;
			this.inputMode = false;
			this.editor.setText("");
			this.invalidate();
			this.advance();
		};
	}

	invalidate() {
		this.cachedLines = undefined;
	}

	private advance() {
		if (this.currentIndex < this.questions.length - 1) {
			this.currentIndex++;
		} else {
			// All questions answered - show confirmation
			this.currentIndex = this.questions.length;
		}
		this.invalidate();
	}

	private allAnswered(): boolean {
		return this.questions.every((_, i) => this.answers[i].trim().length > 0);
	}

	render(width: number): string[] {
		if (this.cachedLines) return this.cachedLines;

		const lines: string[] = [];
		const theme = this.theme;

		// Progress indicator
		const progress = `${this.currentIndex + 1}/${this.questions.length}`;
		lines.push(theme.fg("accent", "─".repeat(width)));
		lines.push(theme.fg("text", ` Questions (${progress}) `));
		lines.push(theme.fg("accent", "─".repeat(width)));

		// Tab bar
		const tabs: string[] = [" "];
		for (let i = 0; i < this.questions.length; i++) {
			const isActive = i === this.currentIndex;
			const isAnswered = this.answers[i].trim().length > 0;
			const box = isAnswered ? "■" : "□";
			const color = isAnswered ? "success" : isActive ? "accent" : "dim";
			const text = ` ${box} Q${i + 1} `;
			const styled = isActive
				? theme.bg("selectedBg", theme.fg("text", text))
				: theme.fg(color, text);
			tabs.push(styled);
		}
		const canSubmit = this.allAnswered();
		const isSubmitTab = this.currentIndex === this.questions.length;
		const submitText = " ✓ Submit ";
		const submitStyled = isSubmitTab
			? theme.bg("selectedBg", theme.fg("text", submitText))
			: theme.fg(canSubmit ? "success" : "dim", submitText);
		tabs.push(` ${submitStyled}`);
		lines.push(tabs.join(""));
		lines.push("");

		if (this.inputMode) {
			// Input mode - show question and editor
			const q = this.questions[this.currentIndex];
			lines.push(theme.fg("text", ` ${q.question}`));
			if (q.context) {
				lines.push(theme.fg("muted", ` > ${q.context}`));
			}
			lines.push("");
			lines.push(theme.fg("muted", " Your answer:"));
			for (const line of this.editor.render(width - 2)) {
				lines.push(` ${line}`);
			}
			lines.push("");
			lines.push(theme.fg("dim", " Enter to submit • Esc to cancel"));
		} else if (this.currentIndex === this.questions.length) {
			// Confirmation screen
			lines.push(theme.fg("accent", theme.bold(" Ready to submit ")));
			lines.push("");
			for (let i = 0; i < this.questions.length; i++) {
				const q = this.questions[i];
				const a = this.answers[i].trim() || "(no answer)";
				lines.push(theme.fg("muted", ` Q${i + 1}: ${q.question}`));
				lines.push(theme.fg("text", `   → ${truncateToWidth(a, width - 4)}`));
				lines.push("");
			}
			if (this.allAnswered()) {
				lines.push(theme.fg("success", " Press Enter to submit"));
			} else {
				lines.push(theme.fg("warning", " Answer all questions to submit"));
			}
		} else {
			// Question display
			const q = this.questions[this.currentIndex];
			lines.push(theme.fg("text", ` ${q.question}`));
			if (q.context) {
				lines.push(theme.fg("muted", ` > ${q.context}`));
			}
			lines.push("");
			lines.push(theme.fg("dim", " Press Enter to type your answer"));
			lines.push(theme.fg("dim", " Press Tab to skip to next question"));
		}

		lines.push("");
		lines.push(theme.fg("accent", "─".repeat(width)));

		this.cachedLines = lines;
		return lines;
	}

	handleInput(data: string): void {
		// Escape - cancel
		if (matchesKey(data, Key.escape)) {
			this.onDone(null);
			return;
		}

		// Input mode - route to editor
		if (this.inputMode) {
			if (matchesKey(data, Key.escape)) {
				this.inputMode = false;
				this.editor.setText("");
				this.invalidate();
				return;
			}
			this.editor.handleInput(data);
			this.invalidate();
			return;
		}

		// Submit confirmation
		if (this.currentIndex === this.questions.length) {
			if (matchesKey(data, Key.enter) && this.allAnswered()) {
				const result = compileAnswers(this.questions, this.answers);
				this.onDone(result);
			}
			return;
		}

		// Tab - skip to next question
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
			this.advance();
			return;
		}

		// Enter - start answering
		if (matchesKey(data, Key.enter)) {
			this.inputMode = true;
			this.editor.setText(this.answers[this.currentIndex]);
			this.invalidate();
			return;
		}
	}
}

// =============================================================================
// Main Handler
// =============================================================================

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
	let doExtraction = mode !== "editor-only";

	let extractedResult: ExtractionResult | null = null;
	let compiledAnswers: string | null = null;

	if (doExtraction) {
		// === Step 1: Extract questions via LLM ===
		let extractionModel: Model<Api>;

		try {
			extractionModel = await selectExtractionModel(ctx.modelRegistry);
		} catch (err) {
			ctx.ui.notify(err instanceof Error ? err.message : "Model error", "error");
			return;
		}

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
			doExtraction = false;
		}
	}

	// === Step 2/3: Q&A TUI or prepare for editor ===
	if (doExtraction && extractedResult && extractedResult.questions.length > 0) {
		// Run Q&A component
		compiledAnswers = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			return new QnAComponent(extractedResult!.questions, tui, theme, done);
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
	const doEditor =
 "full";

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

// =============================================================================
// Entry Point & Registration
// =============================================================================

/**
 * Parse mode from command arguments.
 */
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
