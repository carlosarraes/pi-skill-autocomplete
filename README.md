# pi-skill-autocomplete

Mid-line skill autocomplete and expansion for [Pi](https://github.com/mariozechner/pi-mono).

Built-in pi only triggers `/skill:` autocomplete when it's at the very start of the line, and only expands the skill if the *entire* message starts with `/skill:`. This plugin lifts both restrictions:

- **Autocomplete fires anywhere**: type `please review with /skill:pi-rev` and you'll get suggestions on `/skill:pi-rev` mid-sentence.
- **Skill expansion works mid-prompt**: any `/skill:foo` reference in your message gets expanded to the same `<skill>...</skill>` envelope built-in pi produces, so the agent invokes the skill identically regardless of position.
- **Multi-skill, dedup-aware**: `/skill:foo /skill:bar` loads both. `/skill:foo ... /skill:foo` loads once.

## Install

```sh
pi install git:https://github.com/<your-user>/pi-skill-autocomplete
```
