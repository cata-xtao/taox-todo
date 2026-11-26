/* ---------- 常量 ---------- */

/** 数据块格式版本号。 */
export const TODO_VERSION = 1;

/** 无分组时自动创建的默认分组名。 */
export const DEFAULT_GROUP_NAME = "未分组";

/** 可选的分组颜色 key（不含空值；空值表示无色）。 */
export const COLOR_KEYS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

/** 分组颜色：某个颜色 key，或空字符串（无色）。 */
export type GroupColor = ColorKey | "";

export const COLOR_LABELS: Record<ColorKey, string> = {
  red: "红",
  orange: "橙",
  yellow: "黄",
  green: "绿",
  blue: "蓝",
  purple: "紫",
};

/** 任务优先级 key。 */
export const PRIORITY_KEYS = ["none", "low", "med", "high"] as const;

export type Priority = (typeof PRIORITY_KEYS)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  none: "无",
  low: "低",
  med: "中",
  high: "高",
};

/* ---------- 接口定义 ---------- */

export interface TaoxTodoGroup {
  id: string;
  name: string;
  color: GroupColor;
  collapsed: boolean;
  order: number;
}

export interface TaoxTodoTask {
  id: string;
  title: string;
  group: string;
  subgroup: string;
  priority: Priority;
  notes: string;
  done: boolean;
  archived: boolean;
  order: number;
  startDate: string | null;
  completedAt: string | null;
}

export interface TaoxTodoBlock {
  version: number;
  title: string;
  groups: TaoxTodoGroup[];
  tasks: TaoxTodoTask[];
  /** 顶层未知字段，原样保留以实现向前兼容。 */
  _extra: Record<string, unknown>;
}

/* ---------- 内部工具（纯函数，不导出） ---------- */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isColorKey(v: unknown): v is ColorKey {
  return typeof v === "string" && (COLOR_KEYS as readonly string[]).includes(v);
}

function isPriority(v: unknown): v is Priority {
  return (
    typeof v === "string" && (PRIORITY_KEYS as readonly string[]).includes(v)
  );
}

/** 生成短 id，prefix 后接时间戳末 6 位（36 进制）+ 4 位随机（36 进制）。 */
function uid(prefix?: string): string {
  return (
    (prefix || "") +
    Date.now().toString(36).slice(-6) +
    Math.random().toString(36).slice(2, 6)
  );
}

/** 返回今天的本地日期，格式 YYYY-MM-DD。 */
function isoToday(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * 严格解析 YYYY-MM-DD / YYYY-M-D，合法则归一化为 YYYY-MM-DD，否则返回 null。
 * 用原生 Date 校验日历合法性，等价于旧版 moment(v, ['YYYY-MM-DD','YYYY-M-D'], true)。
 */
function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return (
    year +
    "-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}

/* ---------- 归一化（清洗输入 → 强类型模型） ---------- */

export function normalizeGroup(raw: unknown, i: number): TaoxTodoGroup {
  const r = isRecord(raw) ? raw : {};
  return {
    id: typeof r.id === "string" && r.id ? r.id : uid("g_"),
    name: typeof r.name === "string" && r.name ? r.name : DEFAULT_GROUP_NAME,
    color: isColorKey(r.color) ? r.color : "",
    collapsed: !!r.collapsed,
    order: typeof r.order === "number" ? r.order : i,
  };
}

export function normalizeTask(raw: unknown, i: number): TaoxTodoTask {
  const r = isRecord(raw) ? raw : {};
  const startDate = toIsoDate(r.startDate) || toIsoDate(r.createdAt) || null;
  const done = !!r.done;
  return {
    id: typeof r.id === "string" && r.id ? r.id : uid("t_"),
    title: typeof r.title === "string" ? r.title : "",
    group: typeof r.group === "string" ? r.group : "",
    subgroup: typeof r.subgroup === "string" ? r.subgroup.trim() : "",
    priority: isPriority(r.priority) ? r.priority : "none",
    notes: typeof r.notes === "string" ? r.notes : "",
    done,
    archived: !!r.archived,
    order: typeof r.order === "number" ? r.order : i,
    startDate,
    completedAt: toIsoDate(r.completedAt) || (done ? isoToday() : null),
  };
}

export function normalizeTodoBlock(parsed: unknown): TaoxTodoBlock {
  const m = isRecord(parsed) ? parsed : {};

  // 保留所有未知顶层字段，向前兼容。
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(m)) {
    if (!["version", "title", "groups", "tasks"].includes(k)) {
      extra[k] = m[k];
    }
  }

  const groups: TaoxTodoGroup[] = Array.isArray(m.groups)
    ? m.groups.map((g, idx) => normalizeGroup(g, idx))
    : [];
  const tasks: TaoxTodoTask[] = Array.isArray(m.tasks)
    ? m.tasks.map((t, idx) => normalizeTask(t, idx))
    : [];

  // 兜底：至少有一个分组。
  if (groups.length === 0) {
    groups.push({
      id: uid("g_"),
      name: DEFAULT_GROUP_NAME,
      color: "",
      collapsed: false,
      order: 0,
    });
  }

  // 任务的 group 若指向不存在的分组，则归入第一个分组。
  const groupIds = new Set(groups.map((g) => g.id));
  for (const t of tasks) {
    if (!groupIds.has(t.group)) t.group = groups[0].id;
  }

  // 排序并顺序重排 order。
  groups.sort((a, b) => a.order - b.order);
  groups.forEach((g, idx) => {
    g.order = idx;
  });
  tasks.sort((a, b) => a.order - b.order);
  tasks.forEach((t, idx) => {
    t.order = idx;
  });

  return {
    version: TODO_VERSION,
    title: typeof m.title === "string" ? m.title : "",
    groups,
    tasks,
    _extra: extra,
  };
}

/* ---------- 序列化（强类型模型 → 紧凑 JSON 字符串） ---------- */

/** 仅保留非默认/非空字段，保持写入代码块的 JSON 简洁。 */
export function cleanGroup(g: TaoxTodoGroup): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: g.id,
    name: g.name,
    order: g.order,
  };
  if (g.color) o.color = g.color;
  if (g.collapsed) o.collapsed = true;
  return o;
}

export function cleanTask(t: TaoxTodoTask): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: t.id,
    title: t.title,
    group: t.group,
    done: t.done,
    order: t.order,
  };
  if (t.startDate) o.startDate = t.startDate;
  if (t.subgroup) o.subgroup = t.subgroup;
  if (t.priority && t.priority !== "none") o.priority = t.priority;
  if (t.notes) o.notes = t.notes;
  if (t.completedAt) o.completedAt = t.completedAt;
  if (t.archived) o.archived = true;
  return o;
}

/** 把模型序列化为代码块内的格式化 JSON 字符串。 */
export function serializeTodoBlock(model: TaoxTodoBlock): string {
  const extra = model._extra || {};
  const lines: string[] = ["{", `  "version": ${TODO_VERSION},`];

  for (const k of Object.keys(extra)) {
    if (["version", "title", "groups", "tasks"].includes(k)) continue;
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(extra[k])},`);
  }
  if (model.title) {
    lines.push(`  "title": ${JSON.stringify(model.title)},`);
  }

  lines.push('  "groups": [');
  if (model.groups.length === 0) {
    lines.push("  ],");
  } else {
    model.groups.forEach((g, i) => {
      lines.push(
        `    ${JSON.stringify(cleanGroup(g))}${
          i === model.groups.length - 1 ? "" : ","
        }`
      );
    });
    lines.push("  ],");
  }

  lines.push('  "tasks": [');
  if (model.tasks.length === 0) {
    lines.push("  ]");
  } else {
    model.tasks.forEach((t, i) => {
      lines.push(
        `    ${JSON.stringify(cleanTask(t))}${
          i === model.tasks.length - 1 ? "" : ","
        }`
      );
    });
    lines.push("  ]");
  }

  lines.push("}");
  return lines.join("\n");
}
