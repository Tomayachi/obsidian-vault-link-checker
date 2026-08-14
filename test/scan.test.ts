import { test } from "node:test";
import assert from "node:assert/strict";
import {
	classify,
	findNearMiss,
	levenshtein,
	normalize,
	tokenize,
	isSubset,
	filenameStem,
	type ScanInput,
	type VaultFile,
	type VaultAlias,
} from "../src/scan.ts";

// A small fixture vault. `files` are all potential link targets; `aliases`
// are frontmatter aliases; `unresolved` are the broken links Obsidian would
// hand us. It exercises every bucket the plugin classifies.
const files: VaultFile[] = [
	{ path: "Roadmap.md", stem: "Roadmap" },
	{ path: "Projects/Alpha Project Notes.md", stem: "Alpha Project Notes" },
	{ path: "People/María García.md", stem: "María García" },
	{ path: "Assets/diagram.png", stem: "diagram" },
	{ path: "Daily/2026-08-14.md", stem: "2026-08-14" },
];

const aliases: VaultAlias[] = [
	{ alias: "MOC", path: "Roadmap.md", stem: "Roadmap" },
];

function input(unresolved: { source: string; target: string }[]): ScanInput {
	return { files, aliases, unresolved, resolvedCount: 100 };
}

test("levenshtein basics", () => {
	assert.equal(levenshtein("kitten", "kitten"), 0);
	assert.equal(levenshtein("kitten", "sitten"), 1);
	assert.equal(levenshtein("kitten", "sitting"), 3);
	assert.equal(levenshtein("", "abc"), 3);
});

test("normalize strips separators and case", () => {
	assert.equal(normalize("My-Note_v2.md"), "mynotev2md");
	assert.equal(normalize("Alpha Project"), "alphaproject");
});

test("tokenize and isSubset", () => {
	assert.deepEqual(tokenize("alpha-project notes"), ["alpha", "project", "notes"]);
	assert.equal(isSubset(["alpha", "project"], ["alpha", "project", "notes"]), true);
	assert.equal(isSubset(["alpha", "gamma"], ["alpha", "project", "notes"]), false);
});

test("filenameStem", () => {
	assert.equal(filenameStem("a/b/Note.md"), "Note");
	assert.equal(filenameStem("Note"), "Note");
	assert.equal(filenameStem("Assets/diagram.png"), "diagram");
});

test("bucket: near-miss via similar name (normalized)", () => {
	const r = classify(input([{ source: "Index.md", target: "road map" }]));
	assert.equal(r.nearMisses.length, 1);
	assert.equal(r.planned.length, 0);
	assert.equal(r.nearMisses[0].match, "Roadmap.md");
	assert.equal(r.nearMisses[0].matchType, "similar name");
});

test("bucket: near-miss via Levenshtein (renamed/typo target)", () => {
	const r = classify(input([{ source: "Index.md", target: "Roadmpa" }]));
	assert.equal(r.nearMisses.length, 1);
	assert.equal(r.nearMisses[0].match, "Roadmap.md");
	assert.equal(r.nearMisses[0].matchType, "possible match");
});

test("bucket: near-miss via alias (normalized alias match)", () => {
	const r = classify(input([{ source: "Index.md", target: "moc" }]));
	assert.equal(r.nearMisses.length, 1);
	assert.equal(r.nearMisses[0].match, "Roadmap.md");
	// Matched via a frontmatter alias, not a spelling-similar filename — labelled so.
	assert.equal(r.nearMisses[0].matchType, "alias match");
});

test("similar-name label wins over alias when a real filename also matches", () => {
	// A file literally named "MOC" should be reported as a similar-name match,
	// not relabelled just because an alias with the same normalized key exists.
	const withMocFile: VaultFile[] = [...files, { path: "MOC.md", stem: "MOC" }];
	const r = classify({
		files: withMocFile,
		aliases,
		unresolved: [{ source: "Index.md", target: "m.o.c" }],
		resolvedCount: 0,
	});
	assert.equal(r.nearMisses.length, 1);
	assert.equal(r.nearMisses[0].match, "MOC.md");
	assert.equal(r.nearMisses[0].matchType, "similar name");
});

test("bucket: near-miss via token subset", () => {
	const r = classify(input([{ source: "Index.md", target: "alpha project" }]));
	assert.equal(r.nearMisses.length, 1);
	assert.equal(r.nearMisses[0].match, "Projects/Alpha Project Notes.md");
	assert.equal(r.nearMisses[0].matchType, "possible match");
});

test("bucket: image-style target matches a non-markdown file", () => {
	const r = classify(input([{ source: "Index.md", target: "diagramm" }]));
	assert.equal(r.nearMisses.length, 1);
	assert.equal(r.nearMisses[0].match, "Assets/diagram.png");
});

test("bucket: unicode filename near-miss", () => {
	const r = classify(input([{ source: "Index.md", target: "maria garcia" }]));
	assert.equal(r.nearMisses.length, 1);
	assert.equal(r.nearMisses[0].match, "People/María García.md");
});

test("bucket: planned note (no match) is not a near-miss", () => {
	const r = classify(input([{ source: "Index.md", target: "Quantum Gardening" }]));
	assert.equal(r.nearMisses.length, 0);
	assert.equal(r.planned.length, 1);
	assert.equal(r.planned[0].recurring, false);
});

test("bucket: recurring planned note flagged when linked from >1 note", () => {
	const r = classify(
		input([
			{ source: "A.md", target: "Quantum Gardening" },
			{ source: "B.md", target: "quantum-gardening" },
		]),
	);
	assert.equal(r.planned.length, 2);
	assert.ok(r.planned.every((p) => p.recurring));
});

test("totals and pass-through", () => {
	const r = classify(
		input([
			{ source: "A.md", target: "Roadmpa" }, // near-miss
			{ source: "A.md", target: "Quantum Gardening" }, // planned
		]),
	);
	assert.equal(r.resolvedCount, 100);
	assert.equal(r.total, 102);
});

// ── Parity oracle ──────────────────────────────────────────────────────────
// Verbatim copy of the deployed web version's matcher
// (https://vault-link-checker.vercel.app, index.html) — the receipt whose
// sha256 is 4d6056e0…6961d1b. The plugin's findNearMiss must agree with it on
// every target, or the difference is a regression to investigate.

function webLevenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	if (a.length > b.length) { const t = a; a = b; b = t; }
	const row = Array.from({ length: a.length + 1 }, (_, i) => i);
	for (let j = 1; j <= b.length; j++) {
		let prev = row[0];
		row[0] = j;
		for (let i = 1; i <= a.length; i++) {
			const val = Math.min(row[i] + 1, row[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = row[i];
			row[i] = val;
		}
	}
	return row[a.length];
}
function webNormalize(s: string): string {
	return s.replace(/[\s\-_.,;:!?'"(){}[\]#/\\]/g, "").toLowerCase();
}
function webTokenize(s: string): string[] {
	return s.split(/[\s\-_]+/).filter(Boolean);
}
function webIsSubset(a: string[], b: string[]): boolean {
	const bSet = new Set(b);
	return a.every((t) => bSet.has(t));
}
function webFindNearMiss(target: string, allStems: { path: string; stem: string; key: string }[], normalizedIndex: Map<string, { path: string; stem: string; key: string }[]>) {
	const targetLower = target.toLowerCase();
	const normTarget = webNormalize(targetLower);
	const normMatches = normalizedIndex.get(normTarget);
	if (normMatches && normMatches.length) return { match: normMatches[0].path, type: "similar name" };
	let bestDist = Infinity;
	let bestMatch = null as null | { path: string; stem: string; key: string };
	for (const s of allStems) {
		if (Math.abs(s.key.length - targetLower.length) > 2) continue;
		const d = webLevenshtein(targetLower, s.key);
		if (d <= 2 && d < bestDist) { bestDist = d; bestMatch = s; }
	}
	if (bestMatch) return { match: bestMatch.path, type: "possible match" };
	const targetTokens = webTokenize(targetLower);
	if (targetTokens.length >= 2) {
		for (const s of allStems) {
			const stemTokens = webTokenize(s.key);
			if (stemTokens.length < 2) continue;
			if (webIsSubset(targetTokens, stemTokens) || webIsSubset(stemTokens, targetTokens)) {
				return { match: s.path, type: "possible match" };
			}
		}
	}
	return null;
}

test("parity: plugin findNearMiss agrees with the deployed web version", () => {
	const allStems = files.map((f) => ({ path: f.path, stem: f.stem, key: f.stem.toLowerCase() }));
	const normalizedIndex = new Map<string, { path: string; stem: string; key: string }[]>();
	for (const s of allStems) {
		const n = webNormalize(s.key);
		if (!normalizedIndex.has(n)) normalizedIndex.set(n, []);
		normalizedIndex.get(n)!.push(s);
	}
	for (const a of aliases) {
		const e = { path: a.path, stem: a.stem, key: a.alias.toLowerCase() };
		const n = webNormalize(e.key);
		if (!normalizedIndex.has(n)) normalizedIndex.set(n, []);
		normalizedIndex.get(n)!.push(e);
	}

	const probes = [
		"road map", "Roadmpa", "moc", "alpha project", "diagramm",
		"maria garcia", "Quantum Gardening", "2026-08-13", "totally unrelated xyz",
		"alpha project notes extra", "MARÍA GARCÍA",
	];

	// buildIndex is internal to scan.ts; call findNearMiss which builds it.
	const pluginIndex = { files, aliases };
	for (const p of probes) {
		const web = webFindNearMiss(p, allStems, normalizedIndex);
		// findNearMiss takes the plugin's own index; rebuild via classify path.
		const mine = classify(input([{ source: "x.md", target: p }]));
		const pluginResult = mine.nearMisses[0]
			? { match: mine.nearMisses[0].match, type: mine.nearMisses[0].matchType }
			: null;
		if (pluginResult && web && pluginResult.type === "alias match") {
			// Intentional divergence: the plugin relabels alias-only matches (the web
			// version calls them "similar name"). The matched *file* must still agree;
			// only the label is upgraded. Not a regression.
			assert.equal(pluginResult.match, web.match, `path mismatch on "${p}"`);
			assert.equal(web.type, "similar name", `alias probe "${p}" should be a normalized match on the web side`);
		} else {
			assert.deepEqual(pluginResult, web, `mismatch on target "${p}"`);
		}
	}
	void pluginIndex;
	void findNearMiss;
});
