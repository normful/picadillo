---
name: run-in-tmux
description: Use when the user wants to run commands in a new tmux session with split panes. Triggers on requests like "run X in tmux", "start a dev environment in tmux", or "open multiple terminals in tmux".
---

# run-in-tmux

Creates a tmux session with one or more commands running in separate split panes. Automatically detects the git repository root and generates a unique session name.

## When to use

- User wants to run development commands (e.g., `npm run dev`, `cargo watch`)
- User needs multiple terminal panes running different commands
- User wants to start a background process that persists after terminal closes

## How to run

The script is located at `scripts/run-in-tmux`. Execute it using `uv run`:

```bash
uv run scripts/run-in-tmux -c "npm run dev"
```

## Usage

```bash
# Single command (JSON output)
uv run scripts/run-in-tmux -c "npm run dev" --json

# Multiple commands (each gets its own pane)
uv run scripts/run-in-tmux -c "npm run dev" -c "npm test" --json
```

## Options

| Flag | Description |
|------|-------------|
| `-c, --command` | Command to run (required, repeatable) |
| `--json` | Output JSON to stdout |
| `--plain` | Line-based plain text output |
| `-q, --quiet` | Suppress non-essential output |
| `-v, --verbose` | Show debug details |
| `--no-color` | Disable colored output |
| `--version` | Show version and exit |

## Output

### JSON format (`--json`)
```bash
uv run scripts/run-in-tmux -c "echo hello" -c "echo world" --json
```
```json
{
  "success": true,
  "session_name": "picadillo-1f4f1afa",
  "commands": ["echo hello", "echo world"],
  "panes": 2,
  "working_directory": "/Users/norman/code/picadillo",
  "attach_command": "tmux attach -t picadillo-1f4f1afa",
  "peek_commands": [
    "tmux capture-pane -t picadillo-1f4f1afa.0 -p",
    "tmux capture-pane -t picadillo-1f4f1afa.1 -p"
  ],
  "kill_command": "tmux kill-session -t picadillo-1f4f1afa"
}
```

## Session naming

Session names follow the pattern `<repo-slug>-<hash>`:
- `repo-slug`: First 8 characters of the git repository basename
- `hash`: 8-character MD5 hash of the repo path + commands

This ensures unique sessions for different commands in the same repo.

## Requirements

- Python 3.10+
- tmux installed and running
- Must be in a git repository
- Dependencies: `typer`, `rich` (auto-installed via uv)
