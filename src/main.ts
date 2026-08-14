import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { scanVault } from "./adapter.ts";
import { LinkCheckView, VIEW_TYPE_LINK_CHECK } from "./view.ts";
import {
	DEFAULT_SETTINGS,
	VaultLinkCheckSettingTab,
	type VaultLinkCheckSettings,
} from "./settings.ts";

export default class VaultLinkCheckPlugin extends Plugin {
	settings: VaultLinkCheckSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_LINK_CHECK,
			(leaf) => new LinkCheckView(leaf, this),
		);

		this.addRibbonIcon("unlink", "Vault link check", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "scan-vault",
			name: "Scan vault for broken links",
			callback: () => this.runScan(),
		});

		this.addCommand({
			id: "open-report",
			name: "Open report pane",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new VaultLinkCheckSettingTab(this.app, this));
	}

	onunload(): void {
		// Leaves are detached by Obsidian on unload; nothing to clean up here.
	}

	async activateView(): Promise<LinkCheckView> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null =
			workspace.getLeavesOfType(VIEW_TYPE_LINK_CHECK)[0] ?? null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_LINK_CHECK, active: true });
		}
		if (leaf) await workspace.revealLeaf(leaf);
		return leaf?.view as LinkCheckView;
	}

	/** Run a scan and push the result into the report pane. */
	async runScan(): Promise<void> {
		const view = await this.activateView();
		const report = scanVault(this.app, this.settings.excludedFolders);
		view.setReport(report);
		const issues = report.nearMisses.length + report.planned.length;
		new Notice(
			issues === 0
				? "Vault link check: all links resolve."
				: `Vault link check: ${report.nearMisses.length} near-misses, ${report.planned.length} planned notes.`,
		);
	}

	/** Re-render the open report pane after a settings change (no re-scan). */
	refreshView(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LINK_CHECK)) {
			(leaf.view as LinkCheckView).render();
		}
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<VaultLinkCheckSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
