import { readFileSync } from "node:fs";
import {
	type ExtensionAPI,
	loadSkills,
	type Skill,
	stripFrontmatter,
} from "@mariozechner/pi-coding-agent";
import {
	type AutocompleteProvider,
	fuzzyFilter,
} from "@mariozechner/pi-tui";

const SKILL_PREFIX = "/skill:";

// Pi skill names are validated as /^[a-z0-9-]+$/ (skills.ts validateName).
// Boundary char before /skill: must be start-of-string or whitespace, so we
// don't accidentally match URLs ("http://skill:...") or other paths.
const SKILL_REF_RE = /(^|\s)\/skill:([a-z0-9-]+)/g;

let skillsCache: Skill[] = [];
let providerRegistered = false;

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

// Trigger mid-line autocomplete only when /skill: is preceded by whitespace
// (not part of a URL, code, etc.) and the partial token sits at the cursor.
const MID_LINE_TOKEN_RE = /(?:^|\s)(\/skill:[a-z0-9-]*)$/;

function extractMidLineSkillToken(before: string): string | null {
	const m = before.match(MID_LINE_TOKEN_RE);
	return m ? m[1] : null;
}

function makeWrapper(base: AutocompleteProvider): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol);

			if (before.startsWith("/")) {
				return base.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const token = extractMidLineSkillToken(before);
			if (!token) {
				return base.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const namePrefix = token.slice(SKILL_PREFIX.length);
			const filtered = namePrefix
				? fuzzyFilter(skillsCache, namePrefix, (s) => s.name)
				: skillsCache;
			if (filtered.length === 0) return null;

			return {
				items: filtered.map((s) => ({
					value: `skill:${s.name}`,
					label: `skill:${s.name}`,
					description: s.description,
				})),
				prefix: token,
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!prefix.startsWith(SKILL_PREFIX)) {
				return base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - prefix.length);
			if (before.length === 0) {
				return base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const after = line.slice(cursorCol);
			const newToken = `/${item.value} `;
			const newLine = `${before}${newToken}${after}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;
			return {
				lines: newLines,
				cursorLine,
				cursorCol: before.length + newToken.length,
			};
		},

		shouldTriggerFileCompletion: base.shouldTriggerFileCompletion?.bind(base),
	};
}

export default (pi: ExtensionAPI) => {
	pi.on("session_start", async (_event, ctx) => {
		refreshSkills(ctx.cwd);
		if (ctx.hasUI && !providerRegistered) {
			ctx.ui.addAutocompleteProvider(makeWrapper);
			providerRegistered = true;
		}
	});

	pi.on("input", (event) => {
		const result = expandSkillsInText(event.text);
		if (!result.changed) return;
		return { action: "transform", text: result.text, images: event.images };
	});
};
