import { readFileSync } from "node:fs";
import {
	type ExtensionAPI,
	type ExtensionContext,
	loadSkills,
	type Skill,
	stripFrontmatter,
} from "@earendil-works/pi-coding-agent";
import {
	fuzzyFilter,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

const SKILL_PREFIX = "/skill:";

// Pi skill names are validated as /^[a-z0-9-]+$/ (skills.ts validateName).
// Boundary char before /skill: must be start-of-string or whitespace, so we
// don't accidentally match URLs ("http://skill:...") or other paths.
const SKILL_REF_RE = /(^|\s)\/skill:([a-z0-9-]+)/g;

let skillsCache: Skill[] = [];

// Skill names chosen in the palette. Injected into the next message, then
// cleared — selections never persist past the turn they apply to.
const queued = new Set<string>();

function refreshSkills(cwd: string): void {
	try {
		const result = loadSkills({ cwd, skillPaths: [], includeDefaults: true });
		skillsCache = result.skills;
	} catch {
		skillsCache = [];
	}
}

function findSkill(name: string): Skill | undefined {
	return skillsCache.find((s) => s.name === name);
}

function buildSkillBlock(skill: Skill): string | null {
	try {
		const content = readFileSync(skill.filePath, "utf-8");
		const body = stripFrontmatter(content).trim();
		return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
	} catch {
		return null;
	}
}

function expandSkillsInText(text: string): { text: string; changed: boolean } {
	if (!text.includes(SKILL_PREFIX)) return { text, changed: false };

	const seen = new Set<string>();
	const blocks: string[] = [];

	for (const match of text.matchAll(SKILL_REF_RE)) {
		const name = match[2];
		if (seen.has(name)) continue;
		const skill = findSkill(name);
		if (!skill) continue;
		const block = buildSkillBlock(skill);
		if (!block) continue;
		seen.add(name);
		blocks.push(block);
	}

	if (blocks.length === 0) return { text, changed: false };
	return { text: `${blocks.join("\n\n")}\n\n${text}`, changed: true };
}

// ── Palette overlay ─────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const dim = (s: string) => `\x1b[2m${s}${RESET}`;
const cyan = (s: string) => `\x1b[36m${s}${RESET}`;
const green = (s: string) => `\x1b[32m${s}${RESET}`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const italic = (s: string) => `\x1b[3m${s}\x1b[23m`;

const MAX_VISIBLE = 8;

// Multi-select skill picker rendered as a centered overlay. Space toggles the
// row under the cursor, enter resolves with every chosen name, esc cancels.
class SkillPalette {
	private filtered: Skill[];
	private cursor = 0;
	private query = "";
	private readonly picked: Set<string>;

	constructor(
		private readonly all: Skill[],
		initial: Set<string>,
		private readonly done: (result: string[] | null) => void,
	) {
		this.filtered = all;
		this.picked = new Set(initial);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) return this.done(null);
		if (matchesKey(data, "enter")) return this.done([...this.picked]);

		if (matchesKey(data, "up")) {
			if (this.filtered.length > 0) {
				this.cursor = this.cursor === 0 ? this.filtered.length - 1 : this.cursor - 1;
			}
			return;
		}
		if (matchesKey(data, "down")) {
			if (this.filtered.length > 0) {
				this.cursor = this.cursor === this.filtered.length - 1 ? 0 : this.cursor + 1;
			}
			return;
		}

		if (matchesKey(data, "space")) {
			const skill = this.filtered[this.cursor];
			if (skill) {
				if (this.picked.has(skill.name)) this.picked.delete(skill.name);
				else this.picked.add(skill.name);
			}
			return;
		}

		if (matchesKey(data, "backspace")) {
			if (this.query.length > 0) {
				this.query = this.query.slice(0, -1);
				this.refilter();
			}
			return;
		}

		// Printable character → extend the filter query.
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.query += data;
			this.refilter();
		}
	}

	private refilter(): void {
		this.filtered = this.query ? fuzzyFilter(this.all, this.query, (s) => s.name) : this.all;
		this.cursor = 0;
	}

	render(width: number): string[] {
		const innerW = Math.max(20, width - 2);
		const lines: string[] = [];
		const row = (content: string) => dim("│") + truncateToWidth(` ${content}`, innerW, "…", true) + dim("│");

		// Title border.
		const title = " Skills ";
		const rest = Math.max(0, innerW - visibleWidth(title));
		const left = Math.floor(rest / 2);
		lines.push(dim(`╭${"─".repeat(left)}`) + bold(title) + dim(`${"─".repeat(rest - left)}╮`));

		// Filter input.
		const q = this.query
			? `${this.query}${cyan("▏")}`
			: `${cyan("▏")}${dim(italic("type to filter…"))}`;
		lines.push(row(`${dim("◎")}  ${q}`));
		lines.push(dim(`├${"─".repeat(innerW)}┤`));

		if (this.filtered.length === 0) {
			lines.push(row(dim(italic("no matching skills"))));
		} else {
			const start = Math.max(
				0,
				Math.min(this.cursor - Math.floor(MAX_VISIBLE / 2), this.filtered.length - MAX_VISIBLE),
			);
			const end = Math.min(start + MAX_VISIBLE, this.filtered.length);
			for (let i = start; i < end; i++) {
				const skill = this.filtered[i];
				const isCursor = i === this.cursor;
				const isPicked = this.picked.has(skill.name);
				const pointer = isCursor ? cyan("▸") : " ";
				const box = isPicked ? green("◉") : dim("◯");
				const name = isCursor ? bold(cyan(skill.name)) : isPicked ? cyan(skill.name) : skill.name;
				const room = innerW - visibleWidth(skill.name) - 12;
				const desc = room > 4 ? `  ${dim("—")}  ${dim(truncateToWidth(skill.description, room, "…"))}` : "";
				lines.push(row(`${pointer} ${box} ${name}${desc}`));
			}
			if (this.filtered.length > MAX_VISIBLE) {
				lines.push(row(dim(`${this.cursor + 1}/${this.filtered.length}`)));
			}
		}

		// Footer.
		lines.push(dim(`├${"─".repeat(innerW)}┤`));
		const count = this.picked.size > 0 ? green(`${this.picked.size} selected`) : dim("none selected");
		lines.push(
			row(`${dim(`${italic("space")} toggle  ${italic("enter")} confirm  ${italic("esc")} cancel`)}  ${count}`),
		);
		lines.push(dim(`╰${"─".repeat(innerW)}╯`));
		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}

function updateIndicators(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	if (queued.size === 0) {
		ctx.ui.setStatus("skills", undefined);
		ctx.ui.setWidget("skills", undefined);
		return;
	}
	const names = [...queued];
	ctx.ui.setStatus("skills", `📚 ${names.length}`);
	ctx.ui.setWidget("skills", [`${dim("📚 next message →")} ${cyan(names.join(", "))}`]);
}

async function openPalette(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI || ctx.mode !== "tui") {
		ctx.ui.notify("The skill palette requires interactive mode", "error");
		return;
	}
	refreshSkills(ctx.cwd);
	if (skillsCache.length === 0) {
		ctx.ui.notify("No skills found", "warning");
		return;
	}

	const result = await ctx.ui.custom<string[] | null>(
		(_tui, _theme, _keybindings, done) => new SkillPalette(skillsCache, queued, done),
		{ overlay: true, overlayOptions: { anchor: "center", width: 72 } },
	);
	if (result === null) return; // cancelled — keep the prior selection untouched

	queued.clear();
	for (const name of result) queued.add(name);
	updateIndicators(ctx);
}

export default (pi: ExtensionAPI) => {
	pi.on("session_start", async (_event, ctx) => {
		refreshSkills(ctx.cwd);
	});

	pi.registerShortcut("ctrl+e", {
		description: "Open the skill palette",
		handler: (ctx) => openPalette(ctx),
	});

	pi.registerCommand("skills", {
		description: "Open the skill palette to add skills to your next message",
		handler: (_args, ctx) => openPalette(ctx),
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (queued.size === 0) return;

		const blocks: string[] = [];
		for (const name of queued) {
			// Skip skills the user also typed inline (already expanded into the prompt).
			if (event.prompt.includes(`<skill name="${name}"`)) continue;
			const skill = findSkill(name);
			if (!skill) continue;
			const block = buildSkillBlock(skill);
			if (block) blocks.push(block);
		}

		queued.clear();
		updateIndicators(ctx);
		if (blocks.length === 0) return;

		return {
			message: {
				customType: "skill-context",
				content: blocks.join("\n\n"),
				display: true,
			},
		};
	});

	pi.on("input", (event) => {
		const result = expandSkillsInText(event.text);
		if (!result.changed) return;
		return { action: "transform", text: result.text, images: event.images };
	});
};
