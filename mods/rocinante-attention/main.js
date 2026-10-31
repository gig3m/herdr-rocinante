// The hit list: only agents that need attention. Waiting on you first, then
// finished while you weren't looking, then working. Idle agents never show,
// so an empty list means everything is caught up.
// It also sets the order agent.next / agent.prev walk (ctrl+space a).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, run, theme, setAgentOrder, layout } from "herdr";

const ICONS = "mods/workspace-chrome";
const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const RANK = { blocked: 3, done: 2, working: 1 };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function work(a, tab) {
  const title = clean(a.title);
  const prog = a.program?.name;
  if (title && title !== prog && !/^[~/]/.test(title) && !title.includes("@")) return title;
  if (tab?.named) return tab.name;
  return prog || tab?.name || a.address;
}

export default class RocinanteAttention extends View {
  init(_props, cx) {
    cx.timer.every(30000, (cx) => cx.notify()); // durations
  }

  status(t, s) {
    if (s === "working") return div().w(12).flex_none().text_size(13).text_color(t.working).frames(BRAILLE, 80);
    if (s === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    return div().size(7).mx(2).flex_none().rounded(4).bg(t.done);
  }

  render() {
    const t = theme();
    const tabs = new Map(spaces().flatMap((s) => s.tabs.map((tab) => [tab.id, { tab, space: s }])));
    const list = agents()
      .filter((a) => RANK[a.status])
      .sort((x, y) => RANK[y.status] - RANK[x.status] || y.seq - x.seq);
    setAgentOrder(list.map((a) => a.address));
    const now = Date.now();
    const urgent = list.filter((a) => a.status !== "working").length;

    if (narrow()) {
      return v_flex().size_full().min_h(0).bg(t.chrome).py(6).gap(2).items_center().overflow_y_scrollbar()
        .when(!list.length, (el) => el.child(svg(`${ICONS}/circle-check.svg`).size(16).mt(6).text_color(t.dim)))
        .children(list.map((a) => h_flex().id(`hit-${a.address}`).h(28).w_full().justify_center().items_center().rounded(7)
          .hover((x) => x.bg(t.hover)).on_click(() => run("agent.focus", { terminal: a.address }))
          .child(a.status === "blocked"
            ? div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!")
            : this.status(t, a.status))));
    }

    const head = h_flex().h(32).px(16).gap(8).items_center().flex_none().text_size(11).font_semibold().text_color(t.dim)
      .child(div().flex_1().child("NEEDS ATTENTION"))
      .when(list.length > 0, (el) => el.child(div().flex_none().px(6).h(17).rounded(5).flex().items_center()
        .bg(urgent ? t.blocked + "26" : t.hover).text_color(urgent ? t.blocked : t.muted)
        .child(String(list.length))));

    if (!list.length) {
      return v_flex().size_full().min_h(0).bg(t.chrome).child(head)
        .child(v_flex().flex_1().items_center().justify_center().gap(6).pb(16).text_color(t.dim)
          .child(svg(`${ICONS}/circle-check.svg`).size(20))
          .child(div().text_size(12.5).child("All caught up")));
    }

    const rows = list.map((a) => {
      const where = tabs.get(a.tab);
      const since = where?.tab.working_since;
      const machine = where?.space.machine;
      return h_flex()
        .id(`hit-${a.address}`)
        .px(8).py(5).gap(9).items_center().flex_none().rounded(8)
        .when(a.focused, (el) => el.bg(t.selected))
        .when(!a.focused, (el) => el.hover((x) => x.bg(t.hover)))
        .on_click(() => run("agent.focus", { terminal: a.address }))
        .child(icon(a.program, 16, t.foreground) ?? div().size(16))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).text_color(t.foreground).child(work(a, where?.tab)))
          .child(div().truncate().text_size(11.5).text_color(t.dim)
            .child([machine, where?.space.name ?? a.space_name].filter(Boolean).join(" · "))))
        .when(a.status === "working" && Boolean(since), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(duration(now - since))))
        .child(this.status(t, a.status));
    });

    return v_flex().size_full().min_h(0).bg(t.chrome)
      .child(head)
      .child(v_flex().flex_1().min_h(0).px(8).pb(10).gap(1).overflow_y_scrollbar().children(rows));
  }
}
