/**
 * 通用右键菜单：绝对定位（fixed）、视口边缘自动翻转、
 * 点击菜单外部 / 按 Esc 关闭，并自动清理 DOM 事件监听。
 *
 * 支持一级子菜单（submenu）：父项 hover 展开二级菜单，
 * 子菜单与父菜单之间留有小延迟，鼠标移动时不会误关闭。
 *
 * 全局同一时刻只保留一套菜单（打开新菜单前先关闭旧的）。
 */

export interface ContextMenuItem {
  label: string;
  /** 禁用态：仅展示 UI，不响应点击。 */
  disabled?: boolean;
  /** 二级菜单：提供后该项变为父项，不直接触发 onClick。 */
  submenu?: ContextMenuItem[];
  /** 叶子项的点击回调；父项（有 submenu）可不提供。 */
  onClick?: () => void;
}

const MENU_SELECTOR = ".st-ctx-menu";
const VIEWPORT_MARGIN = 8;
/** 子菜单与父项之间的间距（px）。 */
const SUBMENU_GAP = 2;
/** 鼠标离开父项 / 子菜单后，延迟关闭子菜单的时间（ms），用于跨越间隙。 */
const SUBMENU_CLOSE_DELAY = 150;

interface MenuHandle {
  menu: HTMLElement;
  doc: Document;
  onDocClick: (e: MouseEvent) => void;
  onDocKey: (e: KeyboardEvent) => void;
}

let current: MenuHandle | null = null;
let submenu: HTMLElement | null = null;
let submenuCloseTimer: number | null = null;

/** 移除当前子菜单并取消其延迟关闭定时器（幂等）。 */
function removeSubmenu(): void {
  if (submenuCloseTimer != null) {
    window.clearTimeout(submenuCloseTimer);
    submenuCloseTimer = null;
  }
  if (submenu) {
    submenu.remove();
    submenu = null;
  }
}

/** 关闭当前菜单（含子菜单）并清理它注册的全局事件（幂等）。 */
export function closeContextMenu(): void {
  removeSubmenu();
  if (!current) return;
  const { menu, doc, onDocClick, onDocKey } = current;
  menu.remove();
  doc.removeEventListener("click", onDocClick, true);
  doc.removeEventListener("keydown", onDocKey, true);
  current = null;
}

/** 延迟关闭子菜单：给鼠标从父项移到子菜单留出跨越间隙的时间。 */
function scheduleCloseSubmenu(): void {
  if (submenuCloseTimer != null) window.clearTimeout(submenuCloseTimer);
  submenuCloseTimer = window.setTimeout(() => {
    submenuCloseTimer = null;
    removeSubmenu();
  }, SUBMENU_CLOSE_DELAY);
}

/**
 * 在 anchor 元素右侧展开子菜单；测量后视口边缘自动翻转（向左 / 向上）。
 */
function openSubmenu(items: ContextMenuItem[], anchor: HTMLElement): void {
  if (!current) return;
  removeSubmenu();

  const doc = current.doc;
  const sub = doc.body.createDiv({ cls: "st-ctx-menu st-ctx-submenu" });

  for (const item of items) {
    const el = sub.createDiv({
      cls: "st-ctx-item" + (item.disabled ? " is-disabled" : ""),
      text: item.label,
    });
    if (item.disabled) continue;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      closeContextMenu();
      item.onClick?.();
    });
  }

  const rect = anchor.getBoundingClientRect();
  sub.style.left = `${rect.right + SUBMENU_GAP}px`;
  sub.style.top = `${rect.top}px`;

  // 鼠标进入子菜单：取消延迟关闭；离开：重新排程关闭。
  sub.addEventListener("mouseenter", () => {
    if (submenuCloseTimer != null) {
      window.clearTimeout(submenuCloseTimer);
      submenuCloseTimer = null;
    }
  });
  sub.addEventListener("mouseleave", scheduleCloseSubmenu);

  submenu = sub;

  // 下一帧测量尺寸，超出视口则翻转。
  requestAnimationFrame(() => {
    if (submenu !== sub) return; // 已被关闭
    const r = sub.getBoundingClientRect();
    if (r.right > window.innerWidth - VIEWPORT_MARGIN) {
      sub.style.left = `${rect.left - r.width - SUBMENU_GAP}px`;
    }
    if (r.bottom > window.innerHeight - VIEWPORT_MARGIN) {
      sub.style.top = `${window.innerHeight - r.height - VIEWPORT_MARGIN}px`;
    }
  });
}

/**
 * 在鼠标位置弹出菜单。
 * @param evt 触发的 contextmenu 事件（已由调用方 preventDefault）。
 */
export function openContextMenu(
  evt: MouseEvent,
  items: ContextMenuItem[]
): void {
  const target = evt.target as Node | null;
  const doc = target?.ownerDocument ?? document;

  // 先关闭已有菜单（包括别的 document 上的）。
  closeContextMenu();

  const menu = doc.body.createDiv({ cls: "st-ctx-menu" });
  for (const item of items) {
    const hasSub = !!(item.submenu && item.submenu.length > 0);
    const el = menu.createDiv({
      cls:
        "st-ctx-item" +
        (item.disabled ? " is-disabled" : "") +
        (hasSub ? " has-submenu" : ""),
      text: item.label,
    });

    if (hasSub) {
      el.createSpan({ cls: "st-ctx-chevron", text: "›" });
      el.addEventListener("mouseenter", () =>
        openSubmenu(item.submenu!, el)
      );
      el.addEventListener("mouseleave", scheduleCloseSubmenu);
      // 父项点击仅阻止冒泡（保持菜单不被外部点击关闭），展开靠 hover。
      el.addEventListener("click", (e) => e.stopPropagation());
      continue;
    }

    if (item.disabled) continue;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      closeContextMenu();
      item.onClick?.();
    });
  }

  menu.style.left = `${evt.clientX}px`;
  menu.style.top = `${evt.clientY}px`;

  const handle: MenuHandle = {
    menu,
    doc,
    onDocClick: (e: MouseEvent) => {
      const t = e.target as Node | null;
      // 点击发生在主菜单或子菜单内部则不关闭。
      if (t && (menu.contains(t) || (submenu && submenu.contains(t)))) return;
      closeContextMenu();
    },
    onDocKey: (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    },
  };
  current = handle;

  // 延迟到下一事件循环注册，避免当前 contextmenu 事件链上的 click 立刻关闭菜单。
  window.setTimeout(() => {
    doc.addEventListener("click", handle.onDocClick, true);
    doc.addEventListener("keydown", handle.onDocKey, true);
  }, 0);

  // 下一帧测量尺寸，若超出视口则向反方向翻转，保证不超出屏幕。
  requestAnimationFrame(() => {
    if (current !== handle) return; // 已被关闭
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - VIEWPORT_MARGIN) {
      menu.style.left = `${window.innerWidth - rect.width - VIEWPORT_MARGIN}px`;
    }
    if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
      menu.style.top = `${window.innerHeight - rect.height - VIEWPORT_MARGIN}px`;
    }
  });
}

/** 供外部查询当前是否有菜单打开（渲染器销毁时清理用）。 */
export function hasOpenContextMenu(): boolean {
  return current !== null;
}
