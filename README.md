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

## Install

```bash
pi install https://github.com/normful/picadillo
```

Configure what you don't want with `pi config`. It will modify
`~/.pi/agent/settings.json`

## Dependencies

- [`uv`](https://github.com/astral-sh/uv) — Required runtime dependency for running Python scripts

## Skills

### run-in-tmux

Run commands in a new tmux session with split panes. Useful for dev
environments, parallel processes, and persistent background tasks.

### mulch

Usage examples showing how to use [mulch](https://github.com/jayminwest/mulch)
to record and retrieve structured project
learnings.

## Extensions

### parrot

Opens the last AI response in an external text editor (respects `$VISUAL` or
`$EDITOR`), then sends your edited content back to the chat. Useful for editing
AI responses before re-sending, copying output to a full-featured editor, or
iterating with custom edits.

Usage: `/parrot` or `Alt+R`

### gastown

Hooks to automatically run `gt prime` and `gt mail` from [gastown](https://github.com/steveyegge/gastown)

### mulch

Hooks to automatically run [mulch](https://github.com/jayminwest/mulch) for
recording and retrieving structured project learnings.

### overstory

Hooks to automatically run `overstory prime` and `overstory mail check` from
[overstory](https://github.com/jayminwest/overstory/), along with logging tool
start/end, session end events, and integration with mulch for learning.

## Parrot Extension Demo

[![asciicast](https://asciinema.org/a/788693.svg)](https://asciinema.org/a/788693)

## Uninstall

```bash
pi remove https://github.com/normful/picadillo
```
