import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultLinkCheckPlugin from "./main.ts";

export interface VaultLinkCheckSettings {
	/** Folder path prefixes to skip (case-insensitive), one per line in the UI. */
	excludedFolders: string[];
	/** Show the near-misses section. */
	showNearMisses: boolean;
	/** Show the planned notes section. */
	showPlanned: boolean;
	/**
	 * When false (default), planned notes are treated as fine: the section
	 * starts collapsed and the summary doesn't frame them as problems. The
	 * philosophy is that a planned note is a dropped idea, not an error.
	 */
	nagAboutPlanned: boolean;
}

export const DEFAULT_SETTINGS: VaultLinkCheckSettings = {
	excludedFolders: [],
	showNearMisses: true,
	showPlanned: true,
	nagAboutPlanned: false,
};

export class VaultLinkCheckSettingTab extends PluginSettingTab {
	plugin: VaultLinkCheckPlugin;

	constructor(app: App, plugin: VaultLinkCheckPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc(
				"Ignore links inside these folders. One folder path per line, for example Templates or Archive/2023.",
			)
			.addTextArea((text) => {
				text
					.setPlaceholder("Templates\nArchive")
					.setValue(this.plugin.settings.excludedFolders.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.excludedFolders = value
							.split("\n")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 4;
			});

		new Setting(containerEl)
			.setName("Show near-misses")
			.setDesc("List links that probably meant a note under a slightly different name.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showNearMisses)
					.onChange(async (value) => {
						this.plugin.settings.showNearMisses = value;
						await this.plugin.saveSettings();
						this.plugin.refreshView();
					}),
			);

		new Setting(containerEl)
			.setName("Show planned notes")
			.setDesc("List links that point at notes you never wrote.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showPlanned)
					.onChange(async (value) => {
						this.plugin.settings.showPlanned = value;
						await this.plugin.saveSettings();
						this.plugin.refreshView();
					}),
			);

		new Setting(containerEl)
			.setName("Treat planned notes as problems")
			.setDesc(
				"Off by default. When off, planned notes start collapsed and aren't counted against your resolve rate — they're dropped ideas, not errors.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.nagAboutPlanned)
					.onChange(async (value) => {
						this.plugin.settings.nagAboutPlanned = value;
						await this.plugin.saveSettings();
						this.plugin.refreshView();
					}),
			);
	}
}
