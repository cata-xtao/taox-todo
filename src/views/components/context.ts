import type { App, Component } from "obsidian";
import type { BlockUiState, CompletionFilter } from "../../services/ui-state";
import type { TaoxTodoGroup, TaoxTodoTask } from "../../services/model";

/**
 * 渲染上下文：在 group.ts / task.ts 之间传递渲染所需的依赖与事件回调，
 * 避免层层传参。事件回调由 renderer 注入，组件只负责绑定，不感知实现。
 */
export interface RenderContext {
  app: App;
  sourcePath: string;
  uiState: BlockUiState;
  /** MarkdownRenderer 渲染备注时挂载用的组件（由 renderer 拥有并在销毁时卸载）。 */
  component: Component;
  /** 勾选框被点击：播放完成动画后翻转 done 状态并重渲染。 */
  onToggleTask(task: TaoxTodoTask, row: HTMLElement): void;
  /** 任务行（非勾选区）被点击：打开任务编辑模态框。 */
  onEditTask(task: TaoxTodoTask): void;
  /** 任务行被右键：弹出任务上下文菜单。 */
  onContextMenuTask(evt: MouseEvent, task: TaoxTodoTask): void;
  /** 分组标题被右键：弹出分组上下文菜单。 */
  onContextMenuGroup(evt: MouseEvent, group: TaoxTodoGroup): void;
  /** 顶栏「新建任务」按钮：打开新建任务模态框（复用 TaskModal，传空数据）。 */
  onCreateTask(): void;
  /** 顶栏 Tab 切换：全部 / 未完成 / 已完成。 */
  onSwitchTab(tab: CompletionFilter): void;
  /** 顶栏搜索框输入（renderer 内部做 200ms 防抖，组件不直接重渲染）。 */
  onSearch(keyword: string): void;
  /** 顶栏「折叠/展开全部分组」快捷开关。 */
  onToggleCollapseAll(): void;
  /** 任务行开始拖拽（HTML5 原生 DnD）：记录拖拽源、设置视觉态。 */
  onDragStartTask(task: TaoxTodoTask, row: HTMLElement, evt: DragEvent): void;
  /** 任务行拖拽结束：清理视觉态与指示线。 */
  onDragEndTask(row: HTMLElement): void;
  /** 点击「添加任务」行：在该行内展开输入框，供行内快速新建。 */
  onBeginInlineAdd(addRowEl: HTMLElement, groupId: string, subgroup: string): void;
}
