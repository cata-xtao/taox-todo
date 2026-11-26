import { setIcon } from "obsidian";
import type { CompletionFilter } from "../../services/ui-state";
import type { RenderContext } from "./context";

/** 顶栏 Tab 定义：全部 / 未完成 / 已完成。 */
const HEADER_TABS: { key: CompletionFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "未完成" },
  { key: "done", label: "已完成" },
];

export interface HeaderStats {
  /** 未完成（未归档）任务数，显示在标题右侧。 */
  open: number;
}

/**
 * 顶栏渲染：标题 + 未完成数、搜索框、完成状态 Tab、折叠/展开全部、新建任务按钮。
 *
 * 纯展示 + 事件绑定：所有行为通过 RenderContext 回调交由 renderer 实现，
 * 组件本身不触碰 model、不调度持久化，保持 renderer.ts 干净。
 *
 * 注意：搜索框的 value 直接取自 ctx.uiState.search（renderer 在 render 时已加载），
 * 这样即使整栏重建，已输入的关键字也能回填，不会丢字。
 */
export function renderHeader(
  parent: HTMLElement,
  ctx: RenderContext,
  stats: HeaderStats,
  allCollapsed: boolean
): void {
  const head = parent.createDiv({ cls: "st-header" });

  // 标题
  head.createDiv({ cls: "st-title", text: "taox todo" });

  // 搜索框：input 事件交给 renderer 防抖处理，组件本身不重渲染。
  const search = head.createEl("input", {
    cls: "st-search-input",
    attr: {
      type: "text",
      placeholder: "搜索任务…",
      value: ctx.uiState.search,
      "aria-label": "搜索任务",
    },
  });
  search.addEventListener("input", () => ctx.onSearch(search.value));

  // Tab：全部 / 未完成 / 已完成
  const tabWrap = head.createDiv({ cls: "st-tabs" });
  for (const t of HEADER_TABS) {
    const active = ctx.uiState.completionFilter === t.key;
    const btn = tabWrap.createEl("button", {
      cls: "st-tab-btn" + (active ? " is-active" : ""),
      text: t.label,
      attr: { type: "button" },
    });
    btn.addEventListener("click", () => ctx.onSwitchTab(t.key));
  }

  // 未完成数（margin-left:auto 推到右侧）
  head.createDiv({
    cls: "st-header-stats",
    text: `${stats.open} 个未完成`,
  });

  // 折叠/展开全部分组
  const collapseBtn = head.createEl("button", {
    cls: "st-icon-btn",
    attr: {
      type: "button",
      "aria-label": allCollapsed ? "展开全部分组" : "折叠全部分组",
    },
  });
  setIcon(collapseBtn, allCollapsed ? "chevron-down" : "chevron-up");
  collapseBtn.addEventListener("click", () => ctx.onToggleCollapseAll());

  // 新建任务（+）
  const addBtn = head.createEl("button", {
    cls: "st-icon-btn st-add-btn-icon",
    attr: { type: "button", "aria-label": "新建任务" },
  });
  setIcon(addBtn, "plus");
  addBtn.addEventListener("click", () => ctx.onCreateTask());
}
