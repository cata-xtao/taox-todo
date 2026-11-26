import { MarkdownRenderer, type App, type Component } from "obsidian";

/**
 * MarkdownRenderer 的兼容封装（对齐旧版 renderMd）：
 * 优先用新版 MarkdownRenderer.render，回退旧版 renderMarkdown。
 * 备注内容为空时直接返回，避免空渲染。
 */
export function renderMarkdownSafe(
  app: App,
  md: string,
  el: HTMLElement,
  sourcePath: string,
  component: Component
): void {
  if (!md) return;

  const renderer = MarkdownRenderer as unknown as {
    render?: (
      app: App,
      markdown: string,
      el: HTMLElement,
      sourcePath: string,
      component: Component
    ) => Promise<void>;
    renderMarkdown?: (
      markdown: string,
      el: HTMLElement,
      sourcePath: string,
      component: Component
    ) => Promise<void>;
  };

  if (typeof renderer.render === "function") {
    void renderer.render(app, md, el, sourcePath, component);
  } else if (typeof renderer.renderMarkdown === "function") {
    void renderer.renderMarkdown(md, el, sourcePath, component);
  }
}
