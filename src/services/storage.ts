import { App, Notice, TFile } from "obsidian";
import type { MarkdownSectionInformation } from "obsidian";
import { serializeTodoBlock, type TaoxTodoBlock } from "./model";

/* ---------- 代码块围栏（供处理器注册与写入校验共用） ---------- */

export const FENCE = "todo";
export const FENCE_OPEN = /^\s*(?:`{3,}|~{3,})\s*todo\b/i;
export const FENCE_CLOSE = /^\s*(?:`{3,}|~{3,})\s*$/;

/* ---------- 防抖与重试常量 ---------- */

const PERSIST_DEBOUNCE_MS = 150;
const PERSIST_MAX_RETRIES = 20;

/** 写入时发现代码块已移动/失效，触发重试的标记错误。 */
class StaleBlockError extends Error {
  readonly __stale = true;
  constructor(message: string) {
    super(message);
    this.name = "StaleBlockError";
  }
}

/* ---------- 渲染器注册表（liveSelf 实例自恢复） ---------- */

/**
 * 一个已注册的存活渲染器所需的最小接口。
 * 不依赖具体视图实现，后续由渲染器/视图层实现并注册进来。
 */
export interface RegisteredRenderer {
  /** 渲染器所在笔记的路径。 */
  sourcePath: string;
  /** 渲染器的根 DOM 元素。 */
  el: HTMLElement;
  /** 取该元素对应的 Markdown 区块信息（lineStart/lineEnd），拿不到时返回 null。 */
  getSectionInfo(): MarkdownSectionInformation | null;
  /** 该渲染器实例是否仍然存活（未销毁且元素仍挂载）。 */
  isLive(): boolean;
}

const renderers = new Set<RegisteredRenderer>();

/** 注册一个渲染器实例（渲染器创建时调用）。 */
export function registerRenderer(r: RegisteredRenderer): void {
  renderers.add(r);
}

/** 注销一个渲染器实例（渲染器销毁时调用）。 */
export function unregisterRenderer(r: RegisteredRenderer): void {
  renderers.delete(r);
}

/** 清空注册表（插件 onunload 时调用）。 */
export function clearRenderers(): void {
  renderers.clear();
}

/**
 * 找到与 self 指向同一个代码块（同笔记 + 同起始行）的当前存活实例。
 * 若 self 自身仍存活则直接返回；否则在已注册实例中查找匹配项，找不到则回退返回 self。
 * 对应旧版 liveSelf 机制，用于模态框编辑后写回最新实例。
 */
export function findLiveRenderer(self: RegisteredRenderer): RegisteredRenderer {
  if (self.isLive()) return self;
  const selfInfo = self.getSectionInfo();
  if (!selfInfo) return self;
  for (const other of renderers) {
    if (other === self || !other.isLive()) continue;
    if (other.sourcePath !== self.sourcePath) continue;
    const otherInfo = other.getSectionInfo();
    if (otherInfo && otherInfo.lineStart === selfInfo.lineStart) return other;
  }
  return self;
}

/* ---------- 代码块持久化（防抖 + 原子写 + 重试） ---------- */

/** 持久化一个代码块所需的上下文。 */
export interface BlockContext {
  app: App;
  sourcePath: string;
  el: HTMLElement;
  getSectionInfo(): MarkdownSectionInformation | null;
  /** 返回当前待序列化的模型。 */
  getModel(): TaoxTodoBlock;
}

/**
 * 单个代码块的持久化器：负责防抖调度、写入校验、原子写与失败重试。
 * 每个渲染器持有一个实例。
 */
export class BlockPersistor {
  private ctx: BlockContext;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private dirty = false;
  private destroyed = false;

  constructor(ctx: BlockContext) {
    this.ctx = ctx;
  }

  /** 标记数据变更并调度一次防抖写入。 */
  schedulePersist(): void {
    this.retries = 0;
    this.dirty = true;
    this.arm();
  }

  private arm(): void {
    if (this.destroyed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.persist().catch((e) => console.error(e));
    }, PERSIST_DEBOUNCE_MS);
  }

  /** 立即冲刷待写入数据（渲染器销毁前调用）。 */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) {
      try {
        await this.persist();
      } catch (e) {
        console.error("taox todo: flush failed", e);
      }
    }
  }

  /** 销毁：停止计时器，不再调度。 */
  destroy(): void {
    this.destroyed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async persist(): Promise<void> {
    const file = this.ctx.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    const info = this.ctx.getSectionInfo();
    if (!info) {
      if (this.retries++ < PERSIST_MAX_RETRIES) {
        this.arm();
        return;
      }
      this.retries = 0;
      if (!this.destroyed) {
        new Notice(
          "taox todo：无法自动保存（未找到代码块位置）。请尝试切换到阅读模式后再编辑。",
          8000
        );
      }
      return;
    }

    const json = serializeTodoBlock(this.ctx.getModel());

    const apply = (content: string): string => {
      const lines = content.split("\n");
      if (
        !FENCE_OPEN.test(lines[info.lineStart] || "") ||
        !FENCE_CLOSE.test(lines[info.lineEnd] || "")
      ) {
        throw new StaleBlockError("block moved");
      }
      return lines
        .slice(0, info.lineStart + 1)
        .concat(json.split("\n"), lines.slice(info.lineEnd))
        .join("\n");
    };

    try {
      if (this.ctx.app.vault.process) {
        await this.ctx.app.vault.process(file, apply);
      } else {
        await this.ctx.app.vault.modify(
          file,
          apply(await this.ctx.app.vault.read(file))
        );
      }
      this.retries = 0;
      this.dirty = false;
    } catch (e) {
      if (e instanceof StaleBlockError) {
        if (this.retries++ < PERSIST_MAX_RETRIES) {
          this.arm();
          return;
        }
        this.retries = 0;
        if (!this.destroyed) {
          new Notice("taox todo：代码块已移动，保存失败。请手动重试。", 8000);
        }
        return;
      }
      throw e;
    }
  }
}
