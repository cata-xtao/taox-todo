import { MarkdownRenderChild, Plugin } from "obsidian";
import { FENCE, clearRenderers } from "./services/storage";
import { TaoxTodoRenderer } from "./views/renderer";

export default class TaoxTodoPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerMarkdownCodeBlockProcessor(FENCE, (source, el, ctx) => {
      const child = new MarkdownRenderChild(el);
      ctx.addChild(child);

      const renderer = new TaoxTodoRenderer(this.app, el, ctx, source);
      child.register(() => renderer.destroy());

      try {
        renderer.render();
      } catch (e) {
        console.error("taox todo: render failed", e);
        el.setText(
          "taox todo: " + (e instanceof Error ? e.message : String(e))
        );
      }
    });
  }

  onunload(): void {
    clearRenderers();
  }
}
