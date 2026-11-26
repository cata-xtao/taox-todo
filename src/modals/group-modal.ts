import { Modal, type App } from "obsidian";
import { findLiveRenderer, type RegisteredRenderer } from "../services/storage";
import {
  COLOR_KEYS,
  COLOR_LABELS,
  type GroupColor,
  type TaoxTodoGroup,
} from "../services/model";

/* ---------- 宿主接口（解耦 modal 与具体 renderer） ---------- */

/** 分组编辑后可写回的字段（本轮：名称 + 颜色）。 */
export interface GroupPatch {
  name: string;
  color: GroupColor;
}

export interface GroupModalHost extends RegisteredRenderer {
  /** 应用分组字段更新，并重渲染 + 调度持久化；分组不存在返回 false。 */
  commitGroupEdit(groupId: string, patch: GroupPatch): boolean;
}

/* ---------- 分组编辑模态框 ---------- */

/**
 * 分组编辑弹窗：名称 + 颜色。
 * 由分组标题右键菜单的「重命名分组」调用。
 */
export class GroupModal extends Modal {
  private host: GroupModalHost;
  private group: TaoxTodoGroup;

  constructor(app: App, host: GroupModalHost, group: TaoxTodoGroup) {
    super(app);
    this.host = host;
    this.group = group;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass("st-modal");
    if (this.modalEl) this.modalEl.addClass("st-modal-el");
    titleEl.setText("编辑分组");

    const state = {
      name: this.group.name || "",
      color: this.group.color || ("" as GroupColor),
    };

    // 名称
    const r1 = contentEl.createDiv({ cls: "st-row" });
    r1.createSpan({ cls: "st-row-label", text: "名称" });
    const nameInput = r1.createEl("input", {
      cls: "st-in st-grow",
      attr: { type: "text", value: state.name, placeholder: "分组名称" },
    });
    nameInput.addEventListener("input", () => {
      state.name = nameInput.value;
    });
    requestAnimationFrame(() => nameInput.focus());

    // 颜色色板（含「无颜色」），对齐 _modal.scss 的 .st-color-pick / .st-swatch 样式。
    const r2 = contentEl.createDiv({ cls: "st-row" });
    r2.createSpan({ cls: "st-row-label", text: "颜色" });
    const colorWrap = r2.createDiv({ cls: "st-color-pick" });
    const options: { key: GroupColor; label: string }[] = [
      { key: "", label: "无颜色" },
      ...COLOR_KEYS.map((k) => ({ key: k, label: COLOR_LABELS[k] })),
    ];
    const colorBtns: { btn: HTMLElement; key: GroupColor }[] = [];
    for (const opt of options) {
      const btn = colorWrap.createSpan({
        cls:
          "st-swatch " +
          (opt.key ? `st-swatch-${opt.key}` : "st-swatch-default") +
          (state.color === opt.key ? " is-on" : ""),
        attr: { "aria-label": opt.label, title: opt.label },
      });
      colorBtns.push({ btn, key: opt.key });
      btn.addEventListener("click", () => {
        state.color = opt.key;
        colorBtns.forEach(({ btn: b, key }) =>
          b.toggleClass("is-on", key === opt.key)
        );
      });
    }

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

      const patch: GroupPatch = {
        name: state.name.trim() || "未命名",
        color: state.color,
      };

      this.close();
      requestAnimationFrame(() => {
        const live = findLiveRenderer(this.host) as GroupModalHost;
        live.commitGroupEdit(this.group.id, patch);
      });
    };

    save.addEventListener("click", commit);
    contentEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA") return;
      e.preventDefault();
      commit();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
