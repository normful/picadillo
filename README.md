# Picadillo

<p align="center">
  <img src="https://media.githubusercontent.com/media/normful/picadillo/refs/heads/main/logo.png" alt="Picadillo" width="800">
</p>

**picadillo**
*noun*  \ˌpē-kə-ˈdē-(ˌ)yō\

1.  A ground meat dish cooked with tomatoes and seasonings, sometimes with
    potatoes, olives, or raisins; served on its own or as a filling.

2. *(tech slang)* A mix of [`pi`](https://github.com/badlogic/pi-mono) coding agent extensions,
   skills, and commands combined into one cohesive workflow; modular,
   interoperable, and—depending on the build—
   - occasionally containing undocumented features
   - prone to “seasonal” bugs
   - held together by optimism and duct taped tokens

**Etymology:** From Spanish *picar* (“to mince, to chop”), from Vulgar Latin
*piccare* (“to pierce”). Folk etymology proposes a secondary meaning: “to
repeatedly poke reality until it tastes better.”

**Usage note:** May contain olives, raisins, or side effects.

## Install

```bash
pi install https://github.com/normful/picadillo
```

Configure what you don't want with `pi config`. It will modify `~/.pi/agent/settings.json`

## Dependencies

- [`uv`](https://github.com/astral-sh/uv) — Required runtime dependency for running Python scripts

## Skills

| Skill | Description |
|-------|-------------|
| [run-in-tmux](skills/run-in-tmux/) | Run commands in a new tmux session with split panes. Useful for dev environments, parallel processes, and persistent background tasks. |


## Extensions

| Extension | Description |
|-----------|-------------|
| [parrot](extensions/parrot.ts) | Opens the last AI response in an external text editor (respects `$VISUAL` or `$EDITOR`), then sends your edited content back to the chat. Useful for editing AI responses before re-sending, copying output to a full-featured editor, or iterating with custom edits. Usage: `/parrot` or `Alt+R` |

[![asciicast](https://asciinema.org/a/788693.svg)](https://asciinema.org/a/788693)

## Uninstall

```bash
pi remove https://github.com/normful/picadillo
```
