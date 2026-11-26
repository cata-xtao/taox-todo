import { Modal, setIcon, type App } from "obsidian";
import { findLiveRenderer, type RegisteredRenderer } from "../services/storage";
import {
  PRIORITY_KEYS,
  PRIORITY_LABELS,
  type Priority,
  type TaoxTodoTask,
} from "../services/model";

/* ---------- 宿主接口（解耦 modal 与具体 renderer，避免循环依赖） ---------- */

/** 任务编辑后可写回的字段（本轮核心四字段）。 */
export interface TaskPatch {
  title: string;
  priority: Priority;
  notes: string;
  startDate: string | null;
}

/**
 * TaskModal 对渲染器的最小依赖契约。
 * 继承 RegisteredRenderer（sourcePath/el/getSectionInfo/isLive）以便 findLiveRenderer 定位最新实例，
 * 额外暴露 commitTaskEdit 供保存时写回。renderer 的 model 保持 private，不放进接口。
 */
export interface TaskModalHost extends RegisteredRenderer {
  /** 应用任务字段更新，并重渲染 + 调度持久化；任务不存在返回 false。 */
  commitTaskEdit(taskId: string, patch: TaskPatch): boolean;
  /** 新建任务：分配 id / order 后写入 model，重渲染 + 持久化。可指定归入分组。 */
  addTask(patch: TaskPatch, groupId?: string, subgroup?: string): void;
}

/* ---------- 任务编辑模态框 ---------- */

/**
 * 任务编辑弹窗：标题、优先级、备注、起始日期。
 * 本轮不包含分组/子组/完成于/归档/删除（后续轮次迁移）。
 */
export class TaskModal extends Modal {
  private host: TaskModalHost;
  private task: TaoxTodoTask | null;
  private isNew: boolean;

  constructor(app: App, host: TaskModalHost, task: TaoxTodoTask | null) {
    super(app);
    this.host = host;
    this.task = task;
    this.isNew = task == null;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass("st-modal");
    if (this.modalEl) this.modalEl.addClass("st-modal-el");
    titleEl.setText(this.isNew ? "新建任务" : "编辑任务");

    const src = this.task ?? ({} as Partial<TaoxTodoTask>);
    const state = {
      title: src.title || "",
      priority: PRIORITY_KEYS.includes(src.priority as Priority)
        ? (src.priority as Priority)
        : "none",
      notes: src.notes || "",
      startDate: src.startDate || "",
    };

    // 标题
    const r1 = contentEl.createDiv({ cls: "st-row" });
    r1.createSpan({ cls: "st-row-label", text: "标题" });
    const titleInput = r1.createEl("input", {
      cls: "st-in st-grow",
      attr: { type: "text", value: state.title, placeholder: "任务标题" },
    });
    titleInput.addEventListener("input", () => {
      state.title = titleInput.value;
    });
    requestAnimationFrame(() => titleInput.focus());

    // 优先级
    const r2 = contentEl.createDiv({ cls: "st-row" });
    r2.createSpan({ cls: "st-row-label", text: "优先级" });
    const prioWrap = r2.createDiv({ cls: "st-prio-picker" });
    const prioBtns: { btn: HTMLElement; key: Priority }[] = [];
    PRIORITY_KEYS.forEach((p) => {
      const btn = prioWrap.createSpan({
        cls:
          "st-prio-btn st-prio-btn-" + p +
          (state.priority === p ? " is-on" : ""),
        text: PRIORITY_LABELS[p],
      });
      prioBtns.push({ btn, key: p });
      btn.addEventListener("click", () => {
        state.priority = p;
        prioBtns.forEach(({ btn: b, key }) =>
          b.toggleClass("is-on", key === p)
        );
      });
    });

    // 起始日期
    const r3 = contentEl.createDiv({ cls: "st-row" });
    r3.createSpan({ cls: "st-row-label", text: "起始日期" });
    const startInput = r3.createEl("input", {
      cls: "st-in",
      attr: { type: "date", value: state.startDate },
    });
    startInput.addEventListener("change", () => {
      state.startDate = startInput.value || "";
      updateClearBtn();
    });

    const clearWrap = r3.createSpan({ cls: "st-clear-date-wrap" });
    const updateClearBtn = () => {
      clearWrap.empty();
      if (state.startDate) {
        const clearBtn = clearWrap.createEl("button", {
          cls: "st-icon-btn st-clear-date-btn",
          attr: { "aria-label": "清除日期", type: "button" },
        });
        setIcon(clearBtn, "x");
        clearBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          state.startDate = "";
          startInput.value = "";
          updateClearBtn();
        });
      }
    };
    updateClearBtn();
    r3.createSpan({ cls: "st-hint", text: "可选" });

    // 备注
    const r4 = contentEl.createDiv({ cls: "st-row st-row-top" });
    r4.createSpan({ cls: "st-row-label", text: "备注" });
    const notesInput = r4.createEl("textarea", {
      cls: "st-in st-grow",
      attr: { rows: "4", placeholder: "可选，支持 Markdown" },
    });
    notesInput.value = state.notes;
    notesInput.addEventListener("input", () => {
      state.notes = notesInput.value;
    });

    // 底部按钮
    const foot = contentEl.createDiv({ cls: "st-modal-foot" });
    foot.createDiv({ cls: "st-foot-spacer" });
    foot
      .createEl("button", { cls: "st-btn-cancel", text: "取消" })
      .addEventListener("click", () => this.close());
    const save = foot.createEl("button", {
      cls: "st-btn-save mod-cta",
      text: "保存",
    });

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;

      const patch: TaskPatch = {
        title: state.title.trim() || "(无标题)",
        priority: state.priority,
        notes: state.notes.trim(),
        startDate: state.startDate || null,
      };

      this.close();
      // 延迟到下一帧，等模态框关闭动画释放滚动锁后再重渲染。
      requestAnimationFrame(() => {
        const live = findLiveRenderer(this.host) as TaskModalHost;
        if (this.isNew) {
          live.addTask(patch);
        } else {
          live.commitTaskEdit(this.task!.id, patch);
        }
      });
    };

    save.addEventListener("click", commit);
    contentEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "TEXTAREA") return;
      if (tag === "INPUT" && target.getAttribute("type") === "date") return;
      e.preventDefault();
      commit();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
