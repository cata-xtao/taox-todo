import { setIcon } from "obsidian";
import type { VisibleGroupNode } from "../visible-groups";
import type { RenderContext } from "./context";
import { renderTask } from "./task";

/**
 * 渲染单个分组：分组头（折叠箭头 / 色点 / 名称 / 未完成数 / 编辑按钮）
 * + 直属任务 + 子组 + 「添加任务」行。
 * 已绑定：分组头右键菜单（折叠/编辑/添加在后续轮次迁移）。
 * 折叠状态仍由数据驱动：group.collapsed 为 true 时只渲染分组头。
 */
export function renderGroup(
  parent: HTMLElement,
  node: VisibleGroupNode,
  ctx: RenderContext
): void {
  const { group, subgroups, direct } = node;
  const wrap = parent.createDiv({ cls: "st-group" });
  wrap.dataset.gid = group.id;

  const head = wrap.createDiv({ cls: "st-group-head" });

  const arrow = head.createSpan({ cls: "st-group-arrow" });
  setIcon(arrow, group.collapsed ? "chevron-right" : "chevron-down");

  if (group.color) {
    head.createSpan({ cls: `st-group-dot st-c-${group.color}` });
  }
  head.createSpan({ cls: "st-group-name", text: group.name });
  if (node.openCount > 0) {
    head.createSpan({ cls: "st-group-count", text: String(node.openCount) });
  }

  const actions = head.createDiv({ cls: "st-group-actions" });
  const editBtn = actions.createSpan({
    cls: "st-group-action",
    attr: { "aria-label": "编辑分组" },
  });
  setIcon(editBtn, "pencil");

  // 分组头右键：弹出分组上下文菜单（拦截原生菜单）。
  head.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.onContextMenuGroup(e, group);
  });

  // 折叠时仅渲染分组头（与旧版一致）。
  if (group.collapsed) return;

  for (const t of direct) renderTask(wrap, t, ctx);

  for (const sub of subgroups) {
    const subHead = wrap.createDiv({ cls: "st-subgroup-head" });
    subHead.createSpan({ cls: "st-subgroup-name", text: sub.name });
    subHead.createSpan({
      cls: "st-subgroup-count",
      text: String(sub.tasks.filter((x) => !x.done).length),
    });
    for (const t of sub.tasks) renderTask(wrap, t, ctx);
  }

  // 归档页不显示「添加任务」行（与旧版一致）。
  if (ctx.uiState.activeTab !== "archive") {
    renderAddRow(wrap, group.id, ctx);
  }
}

/** 渲染「添加任务」行：点击后在该行内展开输入框，回车连续新建。 */
export function renderAddRow(
  parent: HTMLElement,
  groupId: string,
  ctx: RenderContext
): void {
  const addRow = parent.createDiv({ cls: "st-add-row" });
  addRow.createSpan({ cls: "st-add-icon", text: "＋" });
  addRow.createSpan({ cls: "st-add-label", text: "添加任务" });
  addRow.addEventListener("click", (e) => {
    // 避免点击行内输入框时冒泡重复触发。
    if ((e.target as HTMLElement).closest(".st-inline-input")) return;
    ctx.onBeginInlineAdd(addRow, groupId, "");
  });
}
