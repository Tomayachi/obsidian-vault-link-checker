import { ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type VaultLinkCheckPlugin from "./main.ts";
import { filenameStem } from "./scan.ts";
import type { NearMiss, PlannedNote, ScanReport } from "./scan.ts";

export const VIEW_TYPE_LINK_CHECK = "vault-link-check-report";

export class LinkCheckView extends ItemView {
	plugin: VaultLinkCheckPlugin;
	report: ScanReport | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: VaultLinkCheckPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LINK_CHECK;
	}

	getDisplayText(): string {
		return "Vault link check";
	}

	getIcon(): string {
		return "unlink";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	setReport(report: ScanReport): void {
		this.report = report;
		this.render();
	}

	private openNote(path: string): void {
		this.app.workspace.openLinkText(path, "", false);
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("vlc-view");

		const toolbar = root.createDiv({ cls: "vlc-toolbar" });
		const scanBtn = toolbar.createEl("button", {
			cls: "mod-cta vlc-scan-btn",
			text: "Scan vault",
		});
		scanBtn.addEventListener("click", () => this.plugin.runScan());

		if (!this.report) {
			const empty = root.createDiv({ cls: "vlc-empty" });
			empty.createEl("p", {
				text: "Scan your vault to find broken links and forgotten ideas.",
			});
			return;
		}

		const { resolvedCount, nearMisses, planned } = this.report;
		const nag = this.plugin.settings.nagAboutPlanned;

		// Resolve rate. When planned notes are treated as fine (default) they
		// don't count against the rate — only near-misses do.
		const denom = resolvedCount + nearMisses.length + (nag ? planned.length : 0);
		const pct = denom ? ((resolvedCount / denom) * 100).toFixed(1) : "100.0";

		const hero = root.createDiv({ cls: "vlc-hero" });
		hero.createDiv({ cls: "vlc-hero-pct", text: pct + "%" });
		hero.createDiv({
			cls: "vlc-hero-label",
			text: `${resolvedCount.toLocaleString()} of ${denom.toLocaleString()} links resolved`,
		});

		const stats = root.createDiv({ cls: "vlc-stats" });
		this.stat(stats, "resolved", resolvedCount, "Resolved");
		this.stat(stats, "nearmiss", nearMisses.length, "Near-misses");
		this.stat(stats, "planned", planned.length, "Planned");

		const actions = root.createDiv({ cls: "vlc-actions" });
		const copyBtn = actions.createEl("button", { text: "Copy report as Markdown" });
		copyBtn.addEventListener("click", () => this.copyReport());

		if (nearMisses.length === 0 && planned.length === 0) {
			const clear = root.createDiv({ cls: "vlc-all-clear" });
			clear.createEl("strong", { text: "All links resolve." });
			clear.appendText(" Every note you referenced exists.");
			return;
		}

		if (this.plugin.settings.showNearMisses && nearMisses.length > 0) {
			this.renderNearMisses(root, nearMisses);
		}
		if (this.plugin.settings.showPlanned && planned.length > 0) {
			this.renderPlanned(root, planned, !nag);
		}
	}

	private stat(parent: HTMLElement, kind: string, count: number, label: string): void {
		const el = parent.createDiv({ cls: `vlc-stat vlc-stat--${kind}` });
		el.createDiv({ cls: "vlc-stat-count", text: count.toLocaleString() });
		el.createDiv({ cls: "vlc-stat-label", text: label });
	}

	private section(
		root: HTMLElement,
		kind: string,
		count: number,
		title: string,
		hint: string,
		open: boolean,
	): HTMLElement {
		const details = root.createEl("details", {
			cls: `vlc-section vlc-section--${kind}`,
		});
		details.open = open;
		const summary = details.createEl("summary", { cls: "vlc-summary" });
		summary.createSpan({ cls: "vlc-badge", text: String(count) });
		summary.createSpan({ cls: "vlc-summary-title", text: title });
		summary.createSpan({ cls: "vlc-summary-hint", text: hint });
		return details.createDiv({ cls: "vlc-section-body" });
	}

	private renderNearMisses(root: HTMLElement, items: NearMiss[]): void {
		const body = this.section(
			root,
			"nearmiss",
			items.length,
			"Near-misses",
			"likely exist under a different name",
			true,
		);
		const groups = groupBy(items, (i) => i.source);
		for (const [source, entries] of groups) {
			const group = body.createDiv({ cls: "vlc-group" });
			this.groupHeader(group, source);
			for (const e of entries) {
				const row = group.createDiv({ cls: "vlc-row" });
				row.createEl("code", { cls: "vlc-link", text: `[[${e.target}]]` });
				row.createSpan({ cls: "vlc-arrow", text: "→" });
				const match = row.createEl("code", {
					cls: "vlc-target vlc-clickable",
					text: filenameStem(e.match),
				});
				match.setAttr("aria-label", e.match);
				match.addEventListener("click", () => this.openNote(e.match));
				row.createSpan({ cls: "vlc-matchtype", text: e.matchType });
			}
		}
	}

	private renderPlanned(root: HTMLElement, items: PlannedNote[], open: boolean): void {
		const body = this.section(
			root,
			"planned",
			items.length,
			"Planned notes",
			"links that point at nothing yet",
			open,
		);
		const caveat = body.createEl("p", { cls: "vlc-caveat" });
		caveat.setText(
			"Usually notes you meant to write and never did. A few may be typos the matcher missed, or notes you have since deleted.",
		);
		const groups = groupBy(items, (i) => i.source);
		for (const [source, entries] of groups) {
			const group = body.createDiv({ cls: "vlc-group" });
			this.groupHeader(group, source);
			for (const e of entries) {
				const row = group.createDiv({ cls: "vlc-row" });
				row.createEl("code", { cls: "vlc-link", text: `[[${e.target}]]` });
				if (e.recurring) {
					const tag = row.createSpan({ cls: "vlc-recurring", text: "recurring" });
					tag.setAttr("aria-label", "Linked from more than one note");
				}
			}
		}
	}

	private groupHeader(group: HTMLElement, source: string): void {
		const header = group.createDiv({ cls: "vlc-group-header vlc-clickable" });
		const icon = header.createSpan({ cls: "vlc-group-icon" });
		setIcon(icon, "file-text");
		header.createSpan({ text: source });
		header.addEventListener("click", () => this.openNote(source));
	}

	private async copyReport(): Promise<void> {
		if (!this.report) return;
		const { resolvedCount, nearMisses, planned, total } = this.report;
		const pct = total ? ((resolvedCount / total) * 100).toFixed(1) : "100.0";

		let md = "# Vault link check report\n\n";
		md += `**${pct}%** resolved (${resolvedCount} of ${total}) · `;
		md += `${nearMisses.length} near-misses · ${planned.length} planned notes\n\n---\n\n`;

		if (nearMisses.length > 0) {
			md += "## Cleanup checklist\n\n";
			md += "Links that exist under a different name. Repair these:\n\n";
			for (const nm of nearMisses) {
				md += `- [ ] [[${filenameStem(nm.source)}]] → \`[[${nm.target}]]\``;
				md += ` — likely [[${filenameStem(nm.match)}]]\n`;
			}
			md += "\n";
		}

		if (planned.length > 0) {
			if (nearMisses.length > 0) md += "---\n\n";
			md += "## Ideas backlog\n\n";
			md +=
				"Notes you linked to but never wrote. Some may be typos or deleted notes, but most are ideas worth revisiting:\n\n";
			for (const p of planned) {
				md += `- [ ] \`[[${p.target}]]\` — linked from [[${filenameStem(p.source)}]]`;
				md += p.recurring ? " (recurring)\n" : "\n";
			}
			md += "\n";
		}

		await navigator.clipboard.writeText(md);
		new Notice("Report copied to clipboard");
	}
}

function groupBy<T>(items: T[], key: (i: T) => string): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		if (!map.has(k)) map.set(k, []);
		map.get(k)!.push(item);
	}
	return map;
}
