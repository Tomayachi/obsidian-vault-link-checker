/*
 * Pure link classifier — no Obsidian imports, no DOM, no I/O.
 *
 * Ported from the web version's `findNearMiss` and its helpers. Inside
 * Obsidian we already get a correct resolved/unresolved split for free from
 * `metadataCache` (it has parsed every wikilink, alias, heading ref and block
 * ref), so the only thing worth porting is the part that made the tool useful:
 * deciding whether an *unresolved* link is a near-miss (a real note under a
 * slightly different name) or a planned note (points at nothing yet).
 *
 * Keep this file free of Obsidian/DOM imports so it stays unit-testable with a
 * plain `node --test` run.
 */

/** A file in the vault that a link could resolve to. */
export interface VaultFile {
	/** Vault-relative path, e.g. "Projects/Roadmap.md". */
	path: string;
	/** Filename without extension, e.g. "Roadmap". */
	stem: string;
}

/** A frontmatter alias declared on some note. */
export interface VaultAlias {
	alias: string;
	path: string;
	stem: string;
}

/** One unresolved link occurrence: `source` links to missing `target`. */
export interface UnresolvedLink {
	/** Path of the note containing the link. */
	source: string;
	/** The link target text as written (no `#heading`, `^block` or `|alias`). */
	target: string;
}

export interface ScanInput {
	/** Every file in the vault (all are potential link targets). */
	files: VaultFile[];
	/** Frontmatter aliases across the vault. */
	aliases: VaultAlias[];
	/** Unresolved link occurrences. */
	unresolved: UnresolvedLink[];
	/** Total count of resolved link instances (for the summary percentage). */
	resolvedCount: number;
}

export type MatchType = "similar name" | "possible match";

export interface NearMiss {
	source: string;
	target: string;
	/** Path of the file this link probably meant. */
	match: string;
	matchType: MatchType;
}

export interface PlannedNote {
	source: string;
	target: string;
	/**
	 * True when the same target is linked from more than one note — the
	 * "past-you filed this idea twice" signal that separates a recurring
	 * planned note from a one-off typo.
	 */
	recurring: boolean;
}

export interface ScanReport {
	resolvedCount: number;
	nearMisses: NearMiss[];
	planned: PlannedNote[];
	/** resolvedCount + nearMisses.length + planned.length. */
	total: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers — ported verbatim from the web version so behaviour stays identical.
// ─────────────────────────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	if (a.length > b.length) {
		const t = a;
		a = b;
		b = t;
	}
	const row = Array.from({ length: a.length + 1 }, (_, i) => i);
	for (let j = 1; j <= b.length; j++) {
		let prev = row[0];
		row[0] = j;
		for (let i = 1; i <= a.length; i++) {
			const val = Math.min(
				row[i] + 1,
				row[i - 1] + 1,
				prev + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			prev = row[i];
			row[i] = val;
		}
	}
	return row[a.length];
}

export function normalize(s: string): string {
	return s.replace(/[\s\-_.,;:!?'"(){}[\]#/\\]/g, "").toLowerCase();
}

export function tokenize(s: string): string[] {
	return s.split(/[\s\-_]+/).filter(Boolean);
}

export function isSubset(a: string[], b: string[]): boolean {
	const bSet = new Set(b);
	return a.every((t) => bSet.has(t));
}

// ─────────────────────────────────────────────────────────────────────────
// Index + near-miss matcher.
// ─────────────────────────────────────────────────────────────────────────

interface Stem {
	path: string;
	stem: string;
	key: string; // lowercased stem (or alias)
}

interface VaultIndex {
	normalizedIndex: Map<string, Stem[]>;
	allStems: Stem[];
}

function buildIndex(files: VaultFile[], aliases: VaultAlias[]): VaultIndex {
	const allStems: Stem[] = files.map((f) => ({
		path: f.path,
		stem: f.stem,
		key: f.stem.toLowerCase(),
	}));

	const normalizedIndex = new Map<string, Stem[]>();
	for (const s of allStems) {
		const n = normalize(s.key);
		if (!normalizedIndex.has(n)) normalizedIndex.set(n, []);
		normalizedIndex.get(n)!.push(s);
	}
	// Aliases participate in normalized matching, same as the web version.
	for (const a of aliases) {
		const entry: Stem = {
			path: a.path,
			stem: a.stem,
			key: a.alias.toLowerCase(),
		};
		const n = normalize(entry.key);
		if (!normalizedIndex.has(n)) normalizedIndex.set(n, []);
		normalizedIndex.get(n)!.push(entry);
	}

	return { normalizedIndex, allStems };
}

/**
 * Decide whether an unresolved `target` is a near-miss for an existing file.
 * Returns the matched file path + match type, or null if nothing is close.
 * Ported from the web version's `findNearMiss`.
 */
export function findNearMiss(
	target: string,
	index: VaultIndex,
): { match: string; type: MatchType } | null {
	const targetLower = target.toLowerCase();
	const normTarget = normalize(targetLower);

	// 1. Exact normalized match (spaces / hyphens / punctuation differ).
	const normMatches = index.normalizedIndex.get(normTarget);
	if (normMatches && normMatches.length) {
		return { match: normMatches[0].path, type: "similar name" };
	}

	// 2. Fuzzy: Levenshtein ≤ 2 against all stems.
	let bestDist = Infinity;
	let bestMatch: Stem | null = null;
	for (const s of index.allStems) {
		if (Math.abs(s.key.length - targetLower.length) > 2) continue;
		const d = levenshtein(targetLower, s.key);
		if (d <= 2 && d < bestDist) {
			bestDist = d;
			bestMatch = s;
		}
	}
	if (bestMatch) {
		return { match: bestMatch.path, type: "possible match" };
	}

	// 3. Token subset: tokens of one are a subset of the other.
	const targetTokens = tokenize(targetLower);
	if (targetTokens.length >= 2) {
		for (const s of index.allStems) {
			const stemTokens = tokenize(s.key);
			if (stemTokens.length < 2) continue;
			if (isSubset(targetTokens, stemTokens) || isSubset(stemTokens, targetTokens)) {
				return { match: s.path, type: "possible match" };
			}
		}
	}

	return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level classifier.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Classify every unresolved link into a near-miss or a planned note.
 * `resolvedCount` is passed through for the summary percentage.
 */
export function classify(input: ScanInput): ScanReport {
	const index = buildIndex(input.files, input.aliases);

	// Count how many distinct source notes reference each target, so we can
	// flag "recurring" planned notes (linked from >1 note).
	const sourcesByTarget = new Map<string, Set<string>>();
	for (const u of input.unresolved) {
		const key = normalize(u.target);
		if (!sourcesByTarget.has(key)) sourcesByTarget.set(key, new Set());
		sourcesByTarget.get(key)!.add(u.source);
	}

	const nearMisses: NearMiss[] = [];
	const planned: PlannedNote[] = [];

	for (const u of input.unresolved) {
		if (!u.target) continue;
		const nm = findNearMiss(u.target, index);
		if (nm) {
			nearMisses.push({
				source: u.source,
				target: u.target,
				match: nm.match,
				matchType: nm.type,
			});
		} else {
			const sources = sourcesByTarget.get(normalize(u.target));
			planned.push({
				source: u.source,
				target: u.target,
				recurring: !!sources && sources.size > 1,
			});
		}
	}

	return {
		resolvedCount: input.resolvedCount,
		nearMisses,
		planned,
		total: input.resolvedCount + nearMisses.length + planned.length,
	};
}

/** Filename without extension, e.g. "a/b/Note.md" → "Note". */
export function filenameStem(path: string): string {
	const name = path.split("/").pop() ?? path;
	const dotIdx = name.lastIndexOf(".");
	return dotIdx > 0 ? name.slice(0, dotIdx) : name;
}
