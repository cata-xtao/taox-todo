import { App, PluginSettingTab } from "obsidian";
import type TaoxTodoPlugin from "../main";

export class TaoxTodoSettingTab extends PluginSettingTab {
  plugin: TaoxTodoPlugin;

  constructor(app: App, plugin: TaoxTodoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    // Placeholder: declarative settings definitions will be added here later.
  }
}
