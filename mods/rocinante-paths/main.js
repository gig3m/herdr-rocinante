// The terminal's right-click menu (the rocinante layout's "terminal_menu").
// It reads the terminal once, when the menu opens. (A side panel that read it
// every 2 s was dropped: herdr-app 0.1.10 then failed to repaint the terminal
// after the panel closed.)
// On top: file and folder paths written in that terminal, newest first, each
// opening in the file manager over D-Bus (org.freedesktop.FileManager1:
// folders with ShowFolders, files with ShowItems). Below: Herdr's own pane
// items, since a personal terminal menu replaces the whole menu.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme, terminals, hc, home } from "herdr";
import { candidates, existing, openInFileManager, shorten } from "./paths.js";

const ICONS = "mods/workspace-chrome";
const MAX_PATHS = 8;
const HISTORY = 300; // lines above the screen to look through

export default class RocinantePaths extends View {
  init(_props, cx) {
    this.paths = null; // [{ path, dir }] once looked up
    this.note = null;
    const tg = props()?.target ?? {};
    cx.spawn(async (cx) => {
      try {
        const addr = tg.terminal;
        if (!addr) throw new Error("no terminal");
        if (addr.includes("/")) {
          this.note = `Paths on ${addr.split("/")[0]} can't open in this computer's file manager`;
          this.paths = [];
          cx.notify();
          return;
        }
        const r = await hc(["read", addr, "--lines", String(HISTORY)]);
        const h = home();
        const list = candidates(r.stdout ?? "", h).slice(0, 60);
        const ok = await existing(list);
        const seen = new Set();
        this.paths = list.filter((p) => ok.has(p))
          .map((p) => ({ path: p.replace(/\/+$/, "") || "/", dir: ok.get(p) === "d" }))
          .filter((x) => !seen.has(x.path) && seen.add(x.path))
          .slice(0, MAX_PATHS);
      } catch {
        this.paths = [];
      }
      cx.notify();
    });
  }

  open(item) {
    openInFileManager(item.path, item.dir);
  }

  paneItems() {
    const tg = props()?.target ?? {};
    const term = terminals().find((t) => t.address === tg.terminal);
    const parent = term?.parent && terminals().find((t) => t.address === term.parent);
    const toProgram = term?.labels?.["herdr.right-click"] === "program";
    return [
      ["Split right", "panel-right", () => run("pane.split", { direction: "right", pane: tg.pane })],
      ["Split down", "panel-right", () => run("pane.split", { direction: "down", pane: tg.pane })],
      ["Zoom", "square", () => run("pane.zoom", { pane: tg.pane })],
      ...(term ? [toProgram
        ? ["Use Herdr right-click menu", "terminal", () => run("terminal.right_click", { terminal: term.address, to: "menu" })]
        : ["Send right-clicks to pane", "terminal", () => run("terminal.right_click", { terminal: term.address, to: "program" })]] : []),
      ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal", () => run("terminal.park", { terminal: term.address })]] : []),
      ["Close pane", "x", () => run("pane.close", { pane: tg.pane })],
    ];
  }

  row(t, id, iconName, text, act, muted = false) {
    return h_flex()
      .id(id)
      .h(30).px(10).gap(9).items_center().flex_none().rounded(6)
      .text_size(13).text_color(muted ? t.muted : t.foreground)
      .hover((x) => x.bg(t.hover))
      .on_click(() => { closeOverlay(props().overlay); act(); })
      .child(svg(`${ICONS}/${iconName}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render() {
    const t = theme();
    const h = home();
    const head = (text) => div().h(24).px(10).flex().items_center().text_size(11).font_semibold().text_color(t.dim).child(text);
    const paths = this.paths === null
      ? [div().h(30).px(10).flex().items_center().text_size(12.5).text_color(t.dim).child("Looking for paths…")]
      : this.paths.length
        ? this.paths.map((p, i) => this.row(t, `path-${i}`, p.dir ? "folder" : "file-text", shorten(p.path, h), () => this.open(p)))
        : [div().px(10).py(6).text_size(12.5).text_color(t.dim).child(this.note ?? "No paths in this terminal")];
    return v_flex().p(5).gap(1).bg(t.popover)
      .child(head("OPEN IN FILE MANAGER"))
      .children(paths)
      .child(div().h(1).my(4).mx(6).bg(t.border))
      .children(this.paneItems().map(([text, iconName, act], i) => this.row(t, `item-${i}`, iconName, text, act)));
  }
}
