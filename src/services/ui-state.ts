import { PRIORITY_KEYS, type Priority } from "./model";

/* ---------- 重命名：localStorage key 前缀从 simple-todo:: 改为 taox-todo:: ---------- */

export const STORAGE_PREFIX = "taox-todo::";

/* ---------- 视图状态（仅持久化子集；search 为纯内存态，不写入 localStorage） ---------- */

export const ACTIVE_TABS = ["todo", "archive"] as const;
export type ActiveTab = (typeof ACTIVE_TABS)[number];

export const SORT_MODES = ["manual", "dateAsc", "dateDesc"] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const HAS_DATE_FILTERS = ["all", "withDate", "withoutDate"] as const;
export type HasDateFilter = (typeof HAS_DATE_FILTERS)[number];

export const DISPLAY_MODES = ["simple", "detailed", "calendar"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

export const COMPLETION_FILTERS = ["all", "active", "done"] as const;
export type CompletionFilter = (typeof COMPLETION_FILTERS)[number];

/** 持久化到 localStorage 的代码块视图状态。注意：不包含 search（仅内存）。 */
export interface BlockUiState {
  activeTab: ActiveTab;
  showCompleted: boolean;
  sortMode: SortMode;
  priorityFilter: Priority[];
  hasDateFilter: HasDateFilter;
  displayMode: DisplayMode;
  /** 顶栏 Tab：全部 / 未完成 / 已完成。纯视图筛选，不修改 model。 */
  completionFilter: CompletionFilter;
  calendarAnchor: string;
  selectedDate: string;
  /** 搜索关键字：仅内存态，不写入 localStorage（load 不读、save 不写）。 */
  search: string;
}

/* ---------- 内部工具 ---------- */

function todayIso(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function isOneOf<T extends string>(
  v: unknown,
  allowed: readonly T[]
): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

/* ---------- key 计算 ---------- */

export function stateStorageKey(sourcePath: string, lineStart: number): string {
  return STORAGE_PREFIX + sourcePath + "::" + lineStart;
}

/* ---------- 反序列化：从 localStorage 读取并校验，返回可合并的局部状态 ---------- */

export function loadUiState(
  sourcePath: string,
  lineStart: number | null | undefined
): Partial<BlockUiState> {
  if (lineStart == null) return {};
  try {
    const raw = localStorage.getItem(stateStorageKey(sourcePath, lineStart));
    if (!raw) return {};
    const s = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<BlockUiState> = {};

    if (isOneOf(s.activeTab, ACTIVE_TABS)) out.activeTab = s.activeTab;
    if (typeof s.showCompleted === "boolean")
      out.showCompleted = s.showCompleted;
    if (isOneOf(s.sortMode, SORT_MODES)) out.sortMode = s.sortMode;
    if (Array.isArray(s.priorityFilter)) {
      out.priorityFilter = (s.priorityFilter as unknown[]).filter(
        (p): p is Priority =>
          typeof p === "string" &&
          (PRIORITY_KEYS as readonly string[]).includes(p)
      );
    }
    if (isOneOf(s.hasDateFilter, HAS_DATE_FILTERS))
      out.hasDateFilter = s.hasDateFilter;
    if (isOneOf(s.displayMode, DISPLAY_MODES))
      out.displayMode = s.displayMode;
    if (isOneOf(s.completionFilter, COMPLETION_FILTERS))
      out.completionFilter = s.completionFilter;
    if (typeof s.calendarAnchor === "string" && s.calendarAnchor)
      out.calendarAnchor = s.calendarAnchor;
    if (typeof s.selectedDate === "string" && s.selectedDate)
      out.selectedDate = s.selectedDate;

    return out;
  } catch {
    return {};
  }
}

/* ---------- 序列化：写入 localStorage（忽略失败，如隐私模式） ---------- */

export function saveUiState(
  sourcePath: string,
  lineStart: number | null | undefined,
  state: BlockUiState
): void {
  if (lineStart == null) return;
  try {
    localStorage.setItem(
      stateStorageKey(sourcePath, lineStart),
      JSON.stringify({
        activeTab: state.activeTab,
        showCompleted: state.showCompleted,
        sortMode: state.sortMode,
        priorityFilter: state.priorityFilter,
        hasDateFilter: state.hasDateFilter,
        displayMode: state.displayMode,
        completionFilter: state.completionFilter,
        calendarAnchor: state.calendarAnchor,
        selectedDate: state.selectedDate,
      })
    );
  } catch {
    // localStorage 不可用时静默忽略（如隐私模式）。
  }
}

/* ---------- 默认状态工厂（供渲染器初始化时调用） ---------- */

export function createDefaultUiState(
  hideCompletedByDefault = false
): BlockUiState {
  const today = todayIso();
  return {
    activeTab: "todo",
    showCompleted: !hideCompletedByDefault,
    sortMode: "manual",
    priorityFilter: [],
    hasDateFilter: "all",
    displayMode: "simple",
    completionFilter: "all",
    calendarAnchor: today,
    selectedDate: today,
    search: "",
  };
}
