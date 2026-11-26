/**
 * 日期友好格式化——旧版 moment 实现的原生 Date 等价版，行为逐字对齐。
 * 全部用本地日期计算，不引入 moment 依赖。
 */

const DAY_MS = 86_400_000;

/** 今天的本地日期，格式 YYYY-MM-DD。 */
export function todayIso(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/** 解析 YYYY-MM-DD 为本地中午的 Date（中午可规避 DST 跨日边界），非法返回 null。 */
function parseIso(iso: string | null | undefined): Date | null {
  if (typeof iso !== "string" || !iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/** 取今天本地中午的 Date，用于天数差计算。 */
function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0, 0);
}

/** a 与 b 相差的天数（a - b），四舍五入规避 DST 误差。 */
function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

/** 旧版 fullDate：合法返回 YYYY-MM-DD，否则原样返回。 */
export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return parseIso(iso) ? iso : iso;
}

/** 起始日期友好格式：今天/明天/昨天/N天后/M月D日/YYYY年M月D日。 */
export function fmtStartDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parseIso(iso);
  if (!d) return "";
  const today = startOfToday();
  const diff = diffDays(d, today);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === -1) return "昨天";
  if (diff > 1 && diff < 7) return `${diff}天后`;
  if (diff < -1) return `${d.getMonth() + 1}月${d.getDate()}日`;
  if (d.getFullYear() === today.getFullYear())
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 完成日期友好格式：今天完成/昨天完成/M月D日完成/YYYY年M月D日完成。 */
export function fmtCompleted(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return "";
  const today = startOfToday();
  const diff = diffDays(today, d);
  if (diff <= 0) return "今天完成";
  if (diff === 1) return "昨天完成";
  if (d.getFullYear() === today.getFullYear())
    return `${d.getMonth() + 1}月${d.getDate()}日完成`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日完成`;
}
