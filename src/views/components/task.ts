import { setIcon } from "obsidian";
import type { TaoxTodoTask } from "../../services/model";
import type { RenderContext } from "./context";
import { renderMarkdownSafe } from "./markdown";
import { fmtCompleted, fmtStartDate, fullDate, todayIso } from "./format";

/**
 * 渲染单个任务行：拖拽手柄 / 优先级色条 / 勾选框 / 标题 / 备注图标 / 日期，
 * 以及 detailed 模式下的备注 Markdown。
 * 已绑定：勾选点击、行点击编辑、右键菜单、HTML5 原生拖拽。
 */
export function renderTask(
  parent: HTMLElement,
  t: TaoxTodoTask,
  ctx: RenderContext
): void {
  const row = parent.createDiv({ cls: "st-task" + (t.done ? " is-done" : "") });
  row.dataset.tid = t.id;
  // 仅任务行可拖拽（HTML5 原生 DnD）；顶栏搜索框不在任务行内，不受影响。
  row.draggable = true;

  const main = row.createDiv({ cls: "st-task-main" });

  main.createSpan({ cls: "st-drag-handle", text: "⋮⋮" });
  if (t.priority !== "none") {
    main.createSpan({ cls: `st-prio st-prio-${t.priority}` });
  }

  const check = main.createSpan({ cls: "st-check" });
  if (t.done) setIcon(check, "check");
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.onToggleTask(t, row);
  });

  main.createSpan({ cls: "st-task-title", text: t.title || "(无标题)" });

  if (t.notes) {
    const note = main.createSpan({ cls: "st-task-note-icon" });
    setIcon(note, "file-text");
    note.setAttribute("title", "查看备注");
  }

  if (t.startDate || t.done) {
    const dateEl = main.createSpan({ cls: "st-task-date" });
    if (t.done) {
      const completedAt = t.completedAt || todayIso();
      dateEl.setText(fmtCompleted(completedAt));
      dateEl.setAttribute("title", "完成于 " + fullDate(completedAt));
    } else {
      dateEl.setText(fmtStartDate(t.startDate));
      dateEl.setAttribute("title", "起始日期：" + fullDate(t.startDate));
    }
  }

  // detailed 模式下把备注 Markdown 渲染到任务详情区。
  if (ctx.uiState.displayMode === "detailed" && t.notes) {
    const detail = row.createDiv({ cls: "st-task-detail" });
    renderMarkdownSafe(
      ctx.app,
      t.notes,
      detail,
      ctx.sourcePath,
      ctx.component
    );
  }

  // 行点击（排除勾选框/拖拽手柄/备注图标/链接/图片）打开编辑模态框。
  row.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(".st-check") ||
      target?.closest(".st-drag-handle") ||
      target?.closest(".st-task-note-icon") ||
      target?.closest("a") ||
      target?.closest("img")
    ) {
      return;
    }
    ctx.onEditTask(t);
  });

  // 右键：弹出任务上下文菜单（拦截原生菜单）。
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.onContextMenuTask(e, t);
  });

  // 拖拽生命周期：开始/结束都委托给 renderer，由其统一管理视觉态与数据。
  row.addEventListener("dragstart", (e) => ctx.onDragStartTask(t, row, e));
  row.addEventListener("dragend", () => ctx.onDragEndTask(row));
}
