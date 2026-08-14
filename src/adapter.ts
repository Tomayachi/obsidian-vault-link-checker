import { App, parseFrontMatterAliases } from "obsidian";
import { classify } from "./scan.ts";
import type { ScanInput, ScanReport, VaultAlias, UnresolvedLink } from "./scan.ts";

/** True when `path` sits inside one of the excluded folders. */
export function isExcluded(path: string, excludedFolders: string[]): boolean {
	if (!excludedFolders.length) return false;
	const p = path.toLowerCase();
	return excludedFolders.some((folder) => {
		const f = folder.toLowerCase().replace(/\/+$/, "");
		if (!f) return false;
		return p === f || p.startsWith(f + "/");
	});
}

/**
 * Read the live vault index out of `metadataCache` and classify it. This is
 * the only place that touches the Obsidian runtime; all the interesting logic
 * lives in the pure `classify` (see scan.ts).
 */
export function scanVault(app: App, excludedFolders: string[] = []): ScanReport {
	const files = app.vault.getFiles().map((f) => ({
		path: f.path,
		stem: f.basename,
	}));

	const aliases: VaultAlias[] = [];
	for (const f of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(f);
		if (!cache?.frontmatter) continue;
		const list = parseFrontMatterAliases(cache.frontmatter);
		if (!list) continue;
		for (const alias of list) {
			if (alias) aliases.push({ alias, path: f.path, stem: f.basename });
		}
	}

	const unresolved: UnresolvedLink[] = [];
	const unresolvedLinks = app.metadataCache.unresolvedLinks ?? {};
	for (const source of Object.keys(unresolvedLinks)) {
		if (isExcluded(source, excludedFolders)) continue;
		const targets = unresolvedLinks[source];
		for (const target of Object.keys(targets)) {
			if (targets[target] > 0 && target) {
				unresolved.push({ source, target });
			}
		}
	}

	let resolvedCount = 0;
	const resolvedLinks = app.metadataCache.resolvedLinks ?? {};
	for (const source of Object.keys(resolvedLinks)) {
		if (isExcluded(source, excludedFolders)) continue;
		const targets = resolvedLinks[source];
		for (const target of Object.keys(targets)) {
			resolvedCount += targets[target];
		}
	}

	const input: ScanInput = { files, aliases, unresolved, resolvedCount };
	return classify(input);
}
