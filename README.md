# pi-skill-autocomplete

A multi-select **skill palette** plus mid-prompt `/skill:` expansion for [Pi](https://github.com/mariozechner/pi-mono).

Built-in pi only triggers `/skill:` at the very start of a line, and only expands a skill if the
*entire* message starts with `/skill:`. This plugin replaces that with a fast palette you open with a
keybind, and keeps a mid-prompt typing path for when you already know the name.

## Features

- **Skill palette** — press **Ctrl-E** (or run **/skills**) to open a searchable overlay. Type to
  fuzzy-filter, **space** to toggle, **enter** to confirm, **esc** to cancel. A widget above the editor
  shows what's queued.
- **Multi-skill** — select as many skills as you want in one pass. Each is injected into your **next
  message** as the same `<skill>…</skill>` envelope built-in pi produces, then the queue clears.
- **Mid-prompt expansion** — still type `/skill:foo` anywhere in a prompt (e.g. `please review with
  /skill:pi-rev`) and it expands on send. Multi-skill and dedup-aware: `/skill:foo /skill:bar` loads
  both; repeats load once. A skill you both queue *and* type is injected only once.

> **No "ghost text".** Pi's TUI input renders plain text with no inline/dimmed suggestion overlay
> (Copilot/zsh-style), so a shadow autocomplete isn't possible on the platform. The palette is the
> reliable replacement for the old mid-line popup.

## Keys

| Key / command | Action |
| --- | --- |
| `Ctrl-E` or `/skills` | Open the skill palette |
| `↑` / `↓` | Move the cursor |
| `space` | Toggle the highlighted skill |
| `enter` | Confirm selection (queues for the next message) |
| `esc` | Cancel (keeps the previous selection) |
| type | Fuzzy-filter the list |

To clear queued skills, open the palette, deselect everything, and press `enter`.

## Install

```sh
pi install git:github.com/carlosarraes/pi-skill-autocomplete
```
