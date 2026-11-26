import {
  Component,
  Notice,
  setIcon,
  type App,
  type MarkdownPostProcessorContext,
} from "obsidian";
import {
  normalizeGroup,
  normalizeTask,
  normalizeTodoBlock,
  type TaoxTodoBlock,
  type TaoxTodoGroup,
  type TaoxTodoTask,
} from "../services/model";
import {
  BlockPersistor,
  findLiveRenderer,
  registerRenderer,
  unregisterRenderer,
  type RegisteredRenderer,
} from "../services/storage";
import {
  createDefaultUiState,
  loadUiState,
  saveUiState,
  type BlockUiState,
  type CompletionFilter,
} from "../services/ui-state";
import { buildVisibleGroups } from "./visible-groups";
import { renderGroup } from "./components/group";
import { renderHeader } from "./components/header";
import { todayIso } from "./components/format";
import type { RenderContext } from "./components/context";
import {
  TaskModal,
  type TaskModalHost,
  type TaskPatch,
} from "../modals/task-modal";
import {
  GroupModal,
  type GroupModalHost,
  type GroupPatch,
} from "../modals/group-modal";
import {
  closeContextMenu,
  openContextMenu,
  type ContextMenuItem,
} from "./context-menu";

/** 勾选完成动画时长（毫秒），与旧版一致。 */
const COMPLETE_ANIM_MS = 400;
/** 删除撤销提示的停留时长（毫秒）。 */
const UNDO_NOTICE_MS = 5000;

/** 拖拽落点信息：在某任务之前/之后插入，或落入某分组末尾。 */
type DropInfo =
  | { type: "before" | "after"; tid: string }
  | { type: "in"; gid: string };

/**
 * 单个 ```todo 代码块的渲染器（外壳骨架）。
 *
 * 容器结构：
 *   .simple-todo -> .st-window -> .st-clip
 *     ├─ header  （静态标题 + 未完成数）
 *     ├─ body    （分组 / 子组 / 任务行 + 空状态，静态渲染）
 *     └─ footer  （占位）
 *
 * 实现 RegisteredRenderer 接口，实例化时注册进注册表，供 liveSelf 与持久化复用。
 */
export class TaoxTodoRenderer
  implements RegisteredRenderer, TaskModalHost, GroupModalHost
{
  readonly app: App;
  readonly sourcePath: string;
  readonly el: HTMLElement;

  private ctx: MarkdownPostProcessorContext;
  private model: TaoxTodoBlock;
  private uiState: BlockUiState;
  private parseError: string | null = null;
  private rawSource = "";
  private destroyed = false;
  /** MarkdownRenderer 渲染备注的挂载组件：每次 render 重建，destroy 时卸载。 */
  private mdComponent: Component;
  /** 代码块持久化器：数据变更时防抖写回文件，destroy 时冲刷。 */
  private persistor: BlockPersistor;
  /** 搜索防抖定时器句柄（window.setTimeout 返回的 number）。 */
  private searchTimer: number | null = null;
  /** 当前正在拖拽的任务 id；null 表示无拖拽会话。 */
  private dragTaskId: string | null = null;
  /** 拖拽悬停目标（dragover 时计算，drop 时消费）。 */
  private dropInfo: DropInfo | null = null;

  constructor(
    app: App,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    source: string
  ) {
    this.app = app;
    this.el = el;
    this.ctx = ctx;
    this.sourcePath = ctx.sourcePath;
    this.uiState = createDefaultUiState();
    // 视图状态在构造时加载一次；后续变更通过 persistUiState 写回，
    // render 时不再重载，避免 Tab / 搜索的内存态被覆盖。
    Object.assign(
      this.uiState,
      loadUiState(this.sourcePath, this.getSectionInfo()?.lineStart)
    );
    this.mdComponent = new Component();
    this.mdComponent.load();

    const trimmed = (source || "").trim();
    if (!trimmed) {
      this.model = normalizeTodoBlock({});
    } else {
      try {
        this.model = normalizeTodoBlock(JSON.parse(trimmed));
      } catch (e) {
        this.parseError = e instanceof Error ? e.message : String(e);
        this.rawSource = source;
        this.model = normalizeTodoBlock({});
      }
    }

    registerRenderer(this);

    this.persistor = new BlockPersistor({
      app: this.app,
      sourcePath: this.sourcePath,
      el: this.el,
      getSectionInfo: () => this.getSectionInfo(),
      getModel: () => this.model,
    });
  }

  /* ---------- RegisteredRenderer 接口实现 ---------- */

  getSectionInfo() {
    return this.ctx.getSectionInfo(this.el);
  }

  isLive(): boolean {
    return !this.destroyed && this.el.isConnected;
  }

  /* ---------- 统一渲染入口 ---------- */

  render(): void {
    if (this.parseError) {
      this.renderError();
      return;
    }

    // 重建 Markdown 渲染组件，避免多次重渲染累积子节点造成内存泄漏。
    this.refreshMdComponent();

    // 视图状态已在构造时加载一次，render 不重载，避免覆盖内存中的 Tab/搜索。

    // 稳定插槽：清空根元素后重建固定容器结构。
    this.el.empty();
    this.el.addClass("simple-todo");

    const win = this.el.createDiv({ cls: "st-window" });
    const clip = win.createDiv({ cls: "st-clip" });

    this.buildHeader(clip);
    const body = clip.createDiv({ cls: "st-body" });
    this.buildBodyInto(body);
    this.buildFooter(clip);
  }

  /* ---------- 各区域构建（本轮仅骨架） ---------- */

  private buildHeader(parent: HTMLElement): void {
    const open = this.model.tasks.filter(
      (t) => !t.done && !t.archived
    ).length;
    const allCollapsed =
      this.model.groups.length > 0 &&
      this.model.groups.every((g) => g.collapsed);
    renderHeader(parent, this.buildRenderContext(), { open }, allCollapsed);
  }

  private buildFooter(parent: HTMLElement): void {
    parent.createDiv({ cls: "st-footer" });
  }

  /* ---------- 主体：分组 / 任务静态渲染 ---------- */

  private refreshMdComponent(): void {
    this.mdComponent.unload();
    this.mdComponent = new Component();
    this.mdComponent.load();
  }

  /** 构造渲染上下文：注入所有组件回调，供 header / body 共用。 */
  private buildRenderContext(): RenderContext {
    return {
      app: this.app,
      sourcePath: this.sourcePath,
      uiState: this.uiState,
      component: this.mdComponent,
      onToggleTask: (task, row) => this.animateToggle(row, task),
      onEditTask: (task) => this.openTaskEditor(task),
      onContextMenuTask: (evt, task) => this.openTaskContextMenu(evt, task),
      onContextMenuGroup: (evt, group) =>
        this.openGroupContextMenu(evt, group),
      onCreateTask: () => this.handleCreateTask(),
      onSwitchTab: (tab) => this.handleSwitchTab(tab),
      onSearch: (keyword) => this.handleSearch(keyword),
      onToggleCollapseAll: () => this.handleToggleCollapseAll(),
      onDragStartTask: (task, row, evt) =>
        this.onDragStartTask(task, row, evt),
      onDragEndTask: (row) => this.onDragEndTask(row),
      onBeginInlineAdd: (addRowEl, groupId, subgroup) =>
        this.onBeginInlineAdd(addRowEl, groupId, subgroup),
    };
  }

  private buildBodyInto(body: HTMLElement): void {
    // 日历视图尚未迁移，先给一个明确提示，避免区块空白。
    if (this.uiState.displayMode === "calendar") {
      body.createDiv({
        cls: "st-empty-hint",
        text: "日历视图将在下一轮迁移。",
      });
      return;
    }

    const visibleGroups = buildVisibleGroups(this.model, this.uiState);
    if (visibleGroups.length === 0) {
      const msg =
        this.uiState.activeTab === "archive"
          ? "归档箱是空的"
          : this.model.tasks.length === 0
            ? "还没有任务。点右上角新建，或下方的「添加任务」开始。"
            : "没有匹配当前筛选的任务（试试调整搜索或筛选）。";
      body.createDiv({ cls: "st-empty-hint", text: msg });
      return;
    }

    const ctx = this.buildRenderContext();
    for (const g of visibleGroups) renderGroup(body, g, ctx);
    // 在 body 上委托绑定 dragover/drop（同一 body 元素重绘时不重复绑定）。
    this.bindBodyDragHandlers(body);
  }

  /* ---------- 任务变更与交互 ---------- */

  /** 标记数据变更并调度一次防抖写回文件。 */
  schedulePersist(): void {
    this.persistor.schedulePersist();
  }

  /** 把当前视图状态写回 localStorage（Tab 等偏好；search 为纯内存态，不写入）。 */
  private persistUiState(): void {
    saveUiState(
      this.sourcePath,
      this.getSectionInfo()?.lineStart,
      this.uiState
    );
  }

  private findTask(id: string): TaoxTodoTask | undefined {
    return this.model.tasks.find((t) => t.id === id);
  }

  /** 翻转任务完成状态，并维护 completedAt（旧版 toggleTaskDone）。 */
  toggleTaskDone(id: string): void {
    const t = this.findTask(id);
    if (!t) return;
    t.done = !t.done;
    t.completedAt = t.done ? todayIso() : null;
    this.schedulePersist();
  }

  /**
   * TaskModalHost 实现：应用模态框保存的字段。
   * 先 findLiveRenderer 拿到最新存活实例，再改模型 → 重渲染 → 调度持久化，
   * 避免模态框打开期间代码块被重渲染导致写到过期实例。
   */
  commitTaskEdit(taskId: string, patch: TaskPatch): boolean {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    const idx = live.model.tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return false;
    const updated = normalizeTask(
      { ...live.model.tasks[idx], ...patch },
      idx
    );
    live.model.tasks[idx] = updated;
    live.render();
    live.schedulePersist();
    return true;
  }

  /**
   * TaskModalHost 实现：新建任务。顶栏「+」按钮以 null 打开 TaskModal，
   * 行内添加也复用此方法（传入 groupId 归入指定分组）。
   * 保存时分配新 id、计算 order，重渲染 + 持久化。
   */
  addTask(patch: TaskPatch, groupId?: string, subgroup?: string): void {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    const target = groupId
      ? live.model.groups.find((g) => g.id === groupId)
      : undefined;
    const resolvedGroupId = (target ?? live.model.groups[0])?.id ?? "";
    const maxOrder = live.model.tasks.reduce(
      (m, t) => Math.max(m, t.order ?? 0),
      -1
    );
    const task = normalizeTask(
      {
        ...patch,
        group: resolvedGroupId,
        subgroup: subgroup ?? "",
        done: false,
        archived: false,
        order: maxOrder + 1,
      },
      live.model.tasks.length
    );
    live.model.tasks.push(task);
    live.reorderAllTasks();
    live.render();
    live.schedulePersist();
  }

  /** 勾选动画：立即切换视觉状态，400ms 后真正改数据并重渲染（旧版 animateToggle）。 */
  private animateToggle(row: HTMLElement, t: TaoxTodoTask): void {
    if (row.classList.contains("is-toggling")) return;
    const willBeDone = !t.done;
    row.addClass("is-toggling");
    row.toggleClass("is-done", willBeDone);
    const check = row.querySelector(".st-check");
    if (check) {
      (check as HTMLElement).empty();
      if (willBeDone) setIcon(check as HTMLElement, "check");
    }
    window.setTimeout(() => {
      const live = findLiveRenderer(this) as TaoxTodoRenderer;
      live.toggleTaskDone(t.id);
      live.render();
    }, COMPLETE_ANIM_MS);
  }

  /** 行点击入口：打开任务编辑模态框（旧版 openTaskEditor）。 */
  private openTaskEditor(task: TaoxTodoTask): void {
    new TaskModal(this.app, this, task).open();
  }

  /** 分组右键「重命名分组」入口：打开分组编辑模态框。 */
  private openGroupEditor(group: TaoxTodoGroup): void {
    new GroupModal(this.app, this, group).open();
  }

  /** GroupModalHost 实现：应用分组名称/颜色变更。 */
  commitGroupEdit(groupId: string, patch: GroupPatch): boolean {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    const idx = live.model.groups.findIndex((g) => g.id === groupId);
    if (idx < 0) return false;
    live.model.groups[idx] = normalizeGroup(
      { ...live.model.groups[idx], ...patch },
      idx
    );
    live.render();
    live.schedulePersist();
    return true;
  }

  /** 按分组顺序重排所有任务的 order（删除/撤销后调用，保持顺序紧凑）。 */
  private reorderAllTasks(): void {
    let counter = 0;
    for (const g of this.model.groups) {
      for (const t of this.model.tasks) {
        if (t.group === g.id) t.order = counter++;
      }
    }
  }

  /* ---------- 顶栏交互（搜索 / Tab / 新建 / 折叠全部） ---------- */

  /**
   * 仅重绘 body，不重建 header——用于搜索防抖后的刷新，
   * 避免搜索框被销毁导致失焦 / 丢字。找不到稳定插槽时回退到全量 render。
   */
  private rerenderBody(): void {
    const clip = this.el.querySelector(".st-clip") as HTMLElement | null;
    const body = clip?.querySelector(":scope > .st-body") as
      | HTMLElement
      | null;
    if (!clip || !body) {
      this.render();
      return;
    }
    this.refreshMdComponent();
    body.empty();
    this.buildBodyInto(body);
  }

  /**
   * 搜索框输入：关键字写进 uiState.search（纯内存，不持久化、不改 model），
   * 200ms 防抖后只重绘 body。连续输入只触发最后一次重绘，保住搜索框焦点。
   */
  private handleSearch(keyword: string): void {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    live.uiState.search = keyword;
    if (live.searchTimer != null) window.clearTimeout(live.searchTimer);
    live.searchTimer = window.setTimeout(() => {
      live.searchTimer = null;
      if (!live.isLive()) return;
      live.rerenderBody();
    }, 200);
  }

  /** Tab 切换：更新 completionFilter，持久化到 localStorage（不写 model 文件），全量重渲染。 */
  private handleSwitchTab(tab: CompletionFilter): void {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    live.uiState.completionFilter = tab;
    live.persistUiState();
    live.render();
  }

  /** 新建任务：以 null 打开 TaskModal（新建模式），保存时由 addTask 分配 id / order。 */
  private handleCreateTask(): void {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    new TaskModal(live.app, live, null).open();
  }

  /** 折叠/展开全部分组：切换每个 group.collapsed 并持久化（collapsed 是 model 合法字段）。 */
  private handleToggleCollapseAll(): void {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    const allCollapsed =
      live.model.groups.length > 0 &&
      live.model.groups.every((g) => g.collapsed);
    for (const g of live.model.groups) g.collapsed = !allCollapsed;
    live.render();
    live.schedulePersist();
  }

  /* ---------- 拖拽排序（HTML5 原生 DnD） ---------- */

  /** 清除所有拖拽指示线 / 目标高亮。 */
  private clearDropIndicators(): void {
    const nodes = this.el.querySelectorAll(
      ".st-drop-before, .st-drop-after, .st-drop-in"
    );
    nodes.forEach((n) => {
      n.classList.remove("st-drop-before", "st-drop-after", "st-drop-in");
    });
  }

  /** RenderContext 回调：任务行开始拖拽，记录源 id 并设置视觉态。 */
  onDragStartTask(task: TaoxTodoTask, row: HTMLElement, evt: DragEvent): void {
    this.dragTaskId = task.id;
    this.dropInfo = null;
    row.addClass("is-dragging");
    row.ownerDocument.body.addClass("st-drag-active");
    if (evt.dataTransfer) {
      evt.dataTransfer.effectAllowed = "move";
      // Firefox 要求 setData 才会启动拖拽。
      evt.dataTransfer.setData("text/plain", task.id);
    }
  }

  /** RenderContext 回调：任务行拖拽结束，清理视觉态与指示线。 */
  onDragEndTask(row: HTMLElement): void {
    row.removeClass("is-dragging");
    row.ownerDocument.body.removeClass("st-drag-active");
    this.clearDropIndicators();
    this.dropInfo = null;
    this.dragTaskId = null;
  }

  /**
   * 在 body 上委托绑定 dragover / drop / dragleave。
   * 用 dataset 标记防重复：rerenderBody 复用同一 body 元素时不再重复绑定。
   */
  private bindBodyDragHandlers(body: HTMLElement): void {
    if (body.dataset.dragBound) return;
    body.dataset.dragBound = "1";
    body.addEventListener("dragover", (e) => this.onBodyDragOver(e));
    body.addEventListener("drop", (e) => this.onBodyDrop(e));
    body.addEventListener("dragleave", (e) => this.onBodyDragLeave(body, e));
  }

  /** dragover：计算落点并显示指示线（任务前/后，或分组内末尾）。 */
  private onBodyDragOver(evt: DragEvent): void {
    if (!this.dragTaskId) return;
    evt.preventDefault(); // 允许 drop
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
    this.clearDropIndicators();

    const target = evt.target as HTMLElement | null;
    if (!target) {
      this.dropInfo = null;
      return;
    }

    // 落在某任务行上 → 按鼠标在该行的上/下半判定 before / after。
    const taskEl = target.closest(".st-task") as HTMLElement | null;
    if (taskEl && taskEl.dataset.tid !== this.dragTaskId) {
      const rect = taskEl.getBoundingClientRect();
      const isBefore = evt.clientY < rect.top + rect.height / 2;
      taskEl.addClass(isBefore ? "st-drop-before" : "st-drop-after");
      this.dropInfo = {
        type: isBefore ? "before" : "after",
        tid: taskEl.dataset.tid!,
      };
      return;
    }

    // 落在分组空白 / 末尾 → 高亮分组，drop 时追加到该组末尾。
    const groupEl = target.closest(".st-group") as HTMLElement | null;
    if (groupEl) {
      groupEl.addClass("st-drop-in");
      this.dropInfo = { type: "in", gid: groupEl.dataset.gid! };
      return;
    }

    this.dropInfo = null;
  }

  /** dragleave：仅当离开整个 body 时才清除指示线。 */
  private onBodyDragLeave(body: HTMLElement, evt: DragEvent): void {
    const related = evt.relatedTarget as Node | null;
    if (related && body.contains(related)) return;
    this.clearDropIndicators();
    this.dropInfo = null;
  }

  /**
   * drop：不直接操作 DOM，只计算目标位置、更新 model.tasks 的 order / group，
   * 然后 schedulePersist + 重渲染。支持同组排序与跨组移动。
   */
  private onBodyDrop(evt: DragEvent): void {
    evt.preventDefault();
    evt.stopPropagation();
    const draggedId = this.dragTaskId;
    const info = this.dropInfo;
    this.clearDropIndicators();
    this.dropInfo = null;
    this.dragTaskId = null;
    this.el.ownerDocument.body.removeClass("st-drag-active");
    if (!draggedId || !info) return;
    this.handleDrop(draggedId, info);
  }

  private handleDrop(taskId: string, info: DropInfo): void {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    const t = live.model.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const arr = live.model.tasks;

    if (info.type === "in") {
      const targetGroup = live.model.groups.find((g) => g.id === info.gid);
      if (!targetGroup) return;
      if (t.group === info.gid) return; // 同组无变化
      const from = arr.indexOf(t);
      if (from >= 0) arr.splice(from, 1);
      t.group = info.gid;
      t.subgroup = "";
      arr.push(t); // 数组末尾 → reorderAllTasks 后置为该组最后一个
    } else {
      const target = arr.find((x) => x.id === info.tid);
      if (!target || target.id === t.id) return;
      const from = arr.indexOf(t);
      if (from >= 0) arr.splice(from, 1);
      const to = arr.indexOf(target);
      if (to < 0) {
        arr.push(t);
      } else {
        arr.splice(info.type === "before" ? to : to + 1, 0, t);
      }
      t.group = target.group;
      t.subgroup = target.subgroup;
    }

    // 用稳定 id 查找后，统一重排 order，再渲染 + 持久化（不直接改 DOM）。
    live.reorderAllTasks();
    live.render();
    live.schedulePersist();
  }

  /* ---------- 行内快速添加任务 ---------- */

  /**
   * RenderContext 回调：点击「添加任务」行，在该行内展开输入框。
   * 回车 → 新建（复用 addTask，归入该组）并重开输入框以便连续添加；
   * Esc 或失焦（焦点离开本行）→ 取消。
   */
  onBeginInlineAdd(
    addRowEl: HTMLElement,
    groupId: string,
    subgroup: string
  ): void {
    if (addRowEl.classList.contains("is-editing")) return;
    const live = findLiveRenderer(this) as TaoxTodoRenderer;

    addRowEl.addClass("is-editing");
    addRowEl.empty();
    const input = addRowEl.createEl("input", {
      cls: "st-inline-input",
      attr: { type: "text", placeholder: "任务标题，回车提交…" },
    });
    input.focus();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const val = input.value.trim();
      if (!val) {
        live.render();
        return;
      }
      live.addTask(
        { title: val, priority: "none", notes: "", startDate: null },
        groupId,
        subgroup
      );
      // 连续添加：重渲染后重新打开该组的输入框。
      requestAnimationFrame(() => {
        const row = live.el.querySelector(
          `.st-group[data-gid="${groupId}"] .st-add-row`
        ) as HTMLElement | null;
        if (row) row.click();
      });
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        committed = true;
        live.render();
      }
    });

    // 失焦处理：焦点仍在本行内则重新聚焦（避免一点击就消失）；
    // 离开本行则取消。已 commit 时直接跳过，避免重复提交。
    input.addEventListener("blur", (e) => {
      if (committed) return;
      const related = e.relatedTarget as Node | null;
      if (related && addRowEl.contains(related)) {
        input.focus();
        return;
      }
      committed = true;
      live.render();
    });
  }

  /* ---------- 右键菜单 ---------- */

  /** 任务行右键菜单：编辑 / 完成切换 / 移到其他分组(子菜单) / 删除。 */
  openTaskContextMenu(evt: MouseEvent, task: TaoxTodoTask): void {
    // 每次点击菜单项时重新取最新存活实例，避免菜单打开期间代码块被重渲染。
    const L = () => findLiveRenderer(this) as TaoxTodoRenderer;
    const groups = L().model.groups;
    // 多于一个分组时才提供「移到其他分组」；当前所在分组置灰（不可移入自身）。
    const moveItem: ContextMenuItem =
      groups.length > 1
        ? {
            label: "移到其他分组",
            submenu: groups.map((g) => ({
              label: g.name,
              disabled: g.id === task.group,
              onClick: () => L().moveTaskToGroup(task.id, g.id),
            })),
          }
        : { label: "移到其他分组", disabled: true };
    openContextMenu(evt, [
      { label: "编辑任务", onClick: () => L().openTaskEditor(task) },
      {
        label: task.done ? "取消完成" : "标记完成",
        onClick: () => {
          L().toggleTaskDone(task.id);
          L().render();
        },
      },
      moveItem,
      { label: "删除任务", onClick: () => L().deleteTaskWithUndo(task) },
    ]);
  }

  /** 右键「移到其他分组」：把任务归入指定分组，重排 order 后渲染 + 持久化。 */
  moveTaskToGroup(taskId: string, groupId: string): void {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    const t = live.model.tasks.find((x) => x.id === taskId);
    if (!t || t.group === groupId) return;
    t.group = groupId;
    t.subgroup = "";
    live.reorderAllTasks();
    live.render();
    live.schedulePersist();
  }

  /** 分组标题右键菜单：重命名 / 删除。 */
  openGroupContextMenu(evt: MouseEvent, group: TaoxTodoGroup): void {
    const L = () => findLiveRenderer(this) as TaoxTodoRenderer;
    openContextMenu(evt, [
      { label: "重命名分组", onClick: () => L().openGroupEditor(group) },
      { label: "删除分组", onClick: () => L().deleteGroupWithUndo(group) },
    ]);
  }

  /** 删除任务，弹出带「撤销」的 Notice（旧版 deleteTaskWithUndo）。 */
  deleteTaskWithUndo(task: TaoxTodoTask): void {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    const idx = live.model.tasks.findIndex((t) => t.id === task.id);
    if (idx < 0) return;
    const removed = live.model.tasks.splice(idx, 1)[0];
    live.reorderAllTasks();
    live.render();
    live.schedulePersist();

    const notice = new Notice("已删除任务", UNDO_NOTICE_MS);
    const undo = notice.noticeEl.createEl("button", {
      cls: "st-btn",
      text: "撤销",
    });
    undo.addEventListener("click", () => {
      notice.hide();
      const l = findLiveRenderer(this) as TaoxTodoRenderer;
      l.model.tasks.push(removed);
      l.reorderAllTasks();
      l.render();
      l.schedulePersist();
    });
  }

  /** 删除分组及其所有任务，弹出带「撤销」的 Notice（旧版 deleteGroupWithUndo）。 */
  deleteGroupWithUndo(group: TaoxTodoGroup): void {
    const live = findLiveRenderer(this) as TaoxTodoRenderer;
    const gIdx = live.model.groups.findIndex((g) => g.id === group.id);
    if (gIdx < 0) return;

    const removedGroup = live.model.groups.splice(gIdx, 1)[0];
    const removedTasks = live.model.tasks.filter((t) => t.group === group.id);
    live.model.tasks = live.model.tasks.filter((t) => t.group !== group.id);

    // 删光分组时补一个默认分组（与 normalizeTodoBlock 行为一致）。
    let addedDefaultId: string | null = null;
    if (live.model.groups.length === 0) {
      const def = normalizeGroup({ name: "默认分组", color: "" }, 0);
      addedDefaultId = def.id;
      live.model.groups.push(def);
    }

    live.reorderAllTasks();
    live.render();
    live.schedulePersist();

    const notice = new Notice("已删除分组", UNDO_NOTICE_MS);
    const undo = notice.noticeEl.createEl("button", {
      cls: "st-btn",
      text: "撤销",
    });
    undo.addEventListener("click", () => {
      notice.hide();
      const l = findLiveRenderer(this) as TaoxTodoRenderer;
      // 撤销时移除刚才补的空默认分组。
      if (addedDefaultId) {
        const di = l.model.groups.findIndex((g) => g.id === addedDefaultId);
        if (di >= 0) l.model.groups.splice(di, 1);
      }
      l.model.groups.push(removedGroup);
      l.model.tasks.push(...removedTasks);
      l.reorderAllTasks();
      l.render();
      l.schedulePersist();
    });
  }

  /* ---------- 错误兜底 ---------- */

  private renderError(): void {
    this.el.empty();
    this.el.addClass("simple-todo", "st-error");
    this.el.createDiv({
      cls: "st-error-msg",
      text: "这个 todo 块里的 JSON 无效，无法显示。",
    });
    this.el.createEl("pre", {
      cls: "st-error-raw",
      text: (this.rawSource || "").slice(0, 600),
    });
    const btn = this.el.createEl("button", {
      cls: "st-btn st-danger",
      text: "重置块",
    });
    btn.addEventListener("click", () => {
      this.parseError = null;
      this.rawSource = "";
      this.model = normalizeTodoBlock({});
      this.render();
      this.schedulePersist();
    });
  }

  /* ---------- 生命周期 ---------- */

  destroy(): void {
    this.destroyed = true;
    closeContextMenu();
    this.el.ownerDocument.body.removeClass("st-drag-active");
    if (this.searchTimer != null) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.dragTaskId = null;
    this.dropInfo = null;
    this.mdComponent.unload();
    void this.persistor.flush();
    this.persistor.destroy();
    unregisterRenderer(this);
  }
}
