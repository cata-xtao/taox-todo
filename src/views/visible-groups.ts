import type {
  TaoxTodoBlock,
  TaoxTodoGroup,
  TaoxTodoTask,
} from "../services/model";
import type { BlockUiState } from "../services/ui-state";

/**
 * 可见分组树（纯数据结构，不含 DOM）。
 * 由 buildVisibleGroups 产出，供 group.ts / task.ts 渲染消费。
 */
export interface SubgroupNode {
  name: string;
  tasks: TaoxTodoTask[];
}

export interface VisibleGroupNode {
  group: TaoxTodoGroup;
  /** 子组，按首次出现顺序排列（保持旧版 Map 插入序行为）。 */
  subgroups: SubgroupNode[];
  /** 无子组的直属任务。 */
  direct: TaoxTodoTask[];
  /** 未完成任务数（用于分组头角标）。 */
  openCount: number;
  /** 可见任务总数（用于判断是否显示该分组）。 */
  totalCount: number;
}

interface FilterContext {
  search: string;
  groupNames: Record<string, string>;
}

/** 旧版 _passFilter 的等价纯函数：单条任务是否通过当前视图状态的筛选。 */
function passFilter(
  t: TaoxTodoTask,
  state: BlockUiState,
  ctx: FilterContext
): boolean {
  if (state.activeTab === "archive") {
    if (!t.archived) return false;
  } else {
    if (t.archived) return false;
  }

  if (!state.showCompleted && t.done) return false;
  // 顶栏 Tab：未完成 → 排除已完成；已完成 → 只保留已完成。纯视图筛选，不改 model。
  if (state.completionFilter === "active" && t.done) return false;
  if (state.completionFilter === "done" && !t.done) return false;
  if (state.priorityFilter.length && !state.priorityFilter.includes(t.priority))
    return false;
  if (state.hasDateFilter === "withDate" && !t.startDate) return false;
  if (state.hasDateFilter === "withoutDate" && t.startDate) return false;

  if (ctx.search) {
    const hay = [t.title, t.notes, t.subgroup, ctx.groupNames[t.group] || ""]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(ctx.search)) return false;
  }
  return true;
}

type TaskSorter = (a: TaoxTodoTask, b: TaoxTodoTask) => number;

/**
 * 旧版 buildVisibleGroups 的等价纯函数：
 * 根据当前 uiState 过滤、排序任务，并按「分组 → 子组/直属」组织成可渲染树。
 * 只包含存在可见任务的分组（totalCount > 0）。
 */
export function buildVisibleGroups(
  model: TaoxTodoBlock,
  state: BlockUiState
): VisibleGroupNode[] {
  const sorter: TaskSorter =
    state.sortMode === "dateAsc"
      ? (a, b) => {
          if (!a.startDate) return 1;
          if (!b.startDate) return -1;
          return a.startDate.localeCompare(b.startDate) || a.order - b.order;
        }
      : state.sortMode === "dateDesc"
        ? (a, b) => {
            if (!a.startDate) return 1;
            if (!b.startDate) return -1;
            return (
              b.startDate.localeCompare(a.startDate) || a.order - b.order
            );
          }
        : (a, b) => a.order - b.order;

  const ctx: FilterContext = {
    search: state.search.trim().toLowerCase(),
    groupNames: Object.fromEntries(model.groups.map((g) => [g.id, g.name])),
  };

  const tree = new Map<string, VisibleGroupNode>();
  // 用 Map 暂存子组，保证插入顺序与旧版一致。
  const subgroupMaps = new Map<string, Map<string, TaoxTodoTask[]>>();
  for (const g of model.groups) {
    tree.set(g.id, {
      group: g,
      subgroups: [],
      direct: [],
      openCount: 0,
      totalCount: 0,
    });
    subgroupMaps.set(g.id, new Map());
  }

  for (const t of model.tasks) {
    if (!passFilter(t, state, ctx)) continue;
    const node = tree.get(t.group);
    if (!node) continue;
    node.totalCount++;
    if (!t.done) node.openCount++;
    if (t.subgroup) {
      const sm = subgroupMaps.get(t.group)!;
      if (!sm.has(t.subgroup)) sm.set(t.subgroup, []);
      sm.get(t.subgroup)!.push(t);
    } else {
      node.direct.push(t);
    }
  }

  const arr: VisibleGroupNode[] = [];
  for (const node of tree.values()) {
    node.direct.sort(sorter);
    const sm = subgroupMaps.get(node.group.id)!;
    for (const [name, tasks] of sm) {
      tasks.sort(sorter);
      node.subgroups.push({ name, tasks });
    }
    if (node.totalCount > 0) arr.push(node);
  }
  return arr;
}
