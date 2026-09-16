import { execFileSync } from "child_process";
import { writeFileSync } from "fs";

const TYPE_LABELS = {
	feat: "Features",
	fix: "Bug Fixes",
	perf: "Performance Improvements",
	revert: "Reverts",
	docs: "Documentation",
	style: "Styles",
	refactor: "Code Refactoring",
	test: "Tests",
	build: "Build System",
	ci: "Continuous Integration",
	chore: "Chores",
};

const TYPE_ORDER = [
	"feat",
	"fix",
	"perf",
	"revert",
	"refactor",
	"docs",
	"style",
	"test",
	"build",
	"ci",
	"chore",
];

const COMMIT_RE =
	/^(?<type>[a-z]+)(\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/;

function git(args) {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function previousTag(currentTag) {
	const tags = git(["tag", "--sort=-v:refname"]).split("\n").filter(Boolean);
	const index = tags.indexOf(currentTag);
	if (index === -1 || index === tags.length - 1) return null;
	return tags[index + 1];
}

function parseCommits(range) {
	const separator = "\x1e";
	const fieldSep = "\x1f";
	const log = git([
		"log",
		range,
		`--pretty=format:%s${fieldSep}%b${separator}`,
	]);
	if (!log) return [];

	return log
		.split(separator)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const [subject, body = ""] = entry.split(fieldSep);
			return { subject: subject.trim(), body: body.trim() };
		});
}

function candidateLines(subject, body) {
	const lines = [subject];
	for (const line of body.split("\n")) {
		const bullet = line.match(/^[-*]\s+(.+)$/);
		if (bullet) lines.push(bullet[1].trim());
	}
	return lines;
}

function buildNotes(commits) {
	const sections = new Map();
	const breaking = [];

	for (const { subject, body } of commits) {
		for (const line of candidateLines(subject, body)) {
			const match = line.match(COMMIT_RE);
			if (!match) continue;

			const { type, scope, breaking: bangBreaking, description } = match.groups;
			if (!TYPE_LABELS[type]) continue;

			const entry = scope ? `**${scope}:** ${description}` : description;

			if (bangBreaking) breaking.push(entry);

			if (!sections.has(type)) sections.set(type, []);
			sections.get(type).push(entry);
		}

		for (const footerMatch of body.matchAll(/^BREAKING CHANGE:\s*(.+)$/gm)) {
			breaking.push(footerMatch[1].trim());
		}
	}

	const lines = [];

	if (breaking.length > 0) {
		lines.push("### ⚠ BREAKING CHANGES", "");
		for (const entry of breaking) lines.push(`- ${entry}`);
		lines.push("");
	}

	for (const type of TYPE_ORDER) {
		const entries = sections.get(type);
		if (!entries || entries.length === 0) continue;
		lines.push(`### ${TYPE_LABELS[type]}`, "");
		for (const entry of entries) lines.push(`- ${entry}`);
		lines.push("");
	}

	if (lines.length === 0)
		return "_No conventional commits found for this release._\n";

	return lines.join("\n").trim() + "\n";
}

const currentTag = process.argv[2];
const outPath = process.argv[3] ?? "release-notes.md";

if (!currentTag) {
	console.error("Usage: node generate-release-notes.mjs <tag> [outPath]");
	process.exit(1);
}

const prevTag = previousTag(currentTag);
const range = prevTag ? `${prevTag}..${currentTag}` : currentTag;

const commits = parseCommits(range);
const notes = buildNotes(commits);

writeFileSync(outPath, notes);
console.log(
	`Release notes for ${currentTag} (range ${range}) written to ${outPath}:\n`,
);
console.log(notes);
