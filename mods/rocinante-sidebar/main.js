// One sidebar for spaces and their agents.
// A machine picker (all machines, or one) sits at the top. Under each machine
// its spaces, each a bold row with a colored tile. A space with exactly one
// agent shows that agent's work on a second line; a space with more can be
// expanded into its tabs and their agents.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, machines, panes, focused, run, theme, shared, setShared, openOverlay, closeOverlay, props, layout, exec, home, appHome } from "herdr";

const ICONS = "mods/workspace-chrome";
const PICK = "rocinante.machine"; // shared: "all" | "local" | a machine name
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// Same avatar colors as the shipped spaces list, so a space keeps its color.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
// A braille spinner, drawn natively (no redraw timer).
export const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// Machine problems use fixed colors so they read as status in any theme.
const PROBLEM = { red: "#e5534b", yellow: "#e3b341" };
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Terminal titles lead with a status glyph ("✳ Fix login"); drop it.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const key = (m) => m ?? "local";
const label = (m) => m ?? "This computer";

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

// What an agent is doing: its own title when it says something, else its tab or program.
function work(a, tab) {
  const title = clean(a.title);
  const prog = a.program?.name;
  const telling = title && title !== prog && !/^[~/]/.test(title) && !title.includes("@");
  if (telling) return title;
  if (tab?.named) return tab.name;
  return prog || tab?.name || a.address;
}


// ---- project artwork ------------------------------------------------------
// A space whose project has an icon (favicon, app icon, logo) shows it instead
// of the letter tile. The file is found on the space's machine, in the repo
// root of where its first terminal is now, and copied into .icons/ here
// (hidden, so writing it doesn't reload the mod).
const CACHE = "mods/rocinante-sidebar/.icons";
const MAX_BYTES = 90000; // passed through a command line as base64
// Only inside a git repo: a plain folder (~/Projects, /tmp) would borrow a
// nested project's icon and walk a large tree.
const FIND = String.raw`root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
case "$root" in "$HOME"|/) exit 0 ;; esac
cd "$root" || exit 0
echo "ROOT $root"
find . -maxdepth 5 \( -name node_modules -o -name .git -o -name vendor -o -name target -o -name .venv -o -name Pods \) -prune -o -type f \( \
  -iname 'apple-touch-icon*.png' -o -iname 'favicon*.svg' -o -iname 'favicon*.png' -o -iname 'favicon.ico' \
  -o -iname 'icon.svg' -o -iname 'icon.png' -o -iname 'icon-*.png' -o -iname 'icon[0-9]*.png' -o -iname 'app-icon*.png' -o -iname 'appicon*.png' \
  -o -iname 'logo.svg' -o -iname 'logo.png' -o -iname 'ic_launcher*.png' -o -ipath '*appiconset/*.png' \) \
  -size -${MAX_BYTES}c -printf '%s %p\n' 2>/dev/null | head -200
# An SVG favicon written into the page itself (<link rel="icon" href="data:image/svg+xml,...">).
find . -maxdepth 4 \( -name node_modules -o -name .git -o -name vendor -o -name dist -o -name build \) -prune -o -type f -name '*.html' -size -300k -print 2>/dev/null | head -60 \
  | xargs -r grep -ohE "href=\"data:image/svg\+xml[^\"]+|href='data:image/svg\+xml[^']+" 2>/dev/null | head -1 | sed -E "s/^href=.//; s/^/DATA /"`;
// Per-project overrides, for icons no search can find (a logo drawn by CSS):
// <machine or "local">--<repo folder name>.svg|png beats everything. Looked for
// in the app home's project-icons/ first (yours; survives updates to this mod),
// then in this mod's own project-icons/. Paths are relative to the app home.
// image() won't load through a symlink leaving the app home, and an override is
// often one (dotfiles), so app-home overrides are copied into the cache (as
// override--<file>) and shown from there.
const OVERRIDE_DIRS = ["project-icons", "mods/rocinante-sidebar/project-icons"];

// Higher is better: a real app or touch icon beats a favicon, vector beats a
// tiny bitmap, source beats build output.
function score(size, path) {
  const name = path.split("/").pop().toLowerCase();
  let s = 0;
  if (/apple-touch-icon|appiconset|ic_launcher|app-?icon/.test(path.toLowerCase())) s += 60;
  else if (/^icon([.-]|\d)/.test(name)) s += 50; // icon.png, icon-512.png, icon128.png (browser extensions)
  else if (/^favicon.*\.svg$/.test(name)) s += 45;
  else if (/^logo\.svg$/.test(name)) s += 40;
  else if (/^favicon.*\.png$/.test(name)) s += 30;
  else if (/^logo\.png$/.test(name)) s += 25;
  else if (name === "favicon.ico") s += 5;
  if (name.endsWith(".png")) s += Math.min(15, size / 1000);
  if (/(^|\/)(dist|build|out|\.next|public\/build|coverage)\//.test(path)) s -= 20;
  if (/test|fixture|example|sample/.test(path.toLowerCase())) s -= 30;
  return s;
}


function hash(text) {
  let h = 5381;
  for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export default class RocinanteSidebar extends View {
  init(_props, cx) {
    if (props()?.machineMenu) return;
    // Spaces the person opened or closed; the rest follow the default (open while shown).
    this.open = JSON.parse(localStorage.getItem("open") ?? "{}");
    // Machine order (dragged by the person) and collapsed machines, in the order
    // they were collapsed: the newest sinks to the very bottom.
    this.order = JSON.parse(localStorage.getItem("machine.order") ?? "[]");
    this.collapsed = JSON.parse(localStorage.getItem("machine.collapsed") ?? "[]");
    this.drag = null; // { from, over } while a header is held
    this.spaceDrag = null; // { from, over, machine } while a space row is held
    // Tabs whose row shows the agent's own title instead of the tab's name.
    this.flipped = new Set(JSON.parse(localStorage.getItem("flipped") ?? "[]"));
    // place ("machine\u0000folder") -> { file: path under the app home or null, at }
    // place -> { file, root (repo found there), at (looked), used (last shown) }
    this.art = JSON.parse(localStorage.getItem("art.v7") ?? "{}");
    this.looking = new Set();
    this.overrides = [];
    cx.spawn(async (cx) => {
      await this.listOverrides();
      await this.prune();
      this.findArt(cx);
      cx.notify();
    });
    cx.timer.every(60000, (cx) => cx.spawn(async (cx) => { await this.listOverrides(); cx.notify(); }));
    cx.timer.every(3600000, (cx) => cx.spawn(async () => { await this.prune(); }));
    cx.timer.every(5000, (cx) => this.findArt(cx));
    cx.timer.every(30000, (cx) => cx.notify()); // durations
  }

  // Where a space is now: its first terminal's live folder, else where it was made.
  place(s, ps) {
    const tabs = new Set(s.tabs.map((x) => x.id));
    const cwd = ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    return cwd ? `${s.machine ?? ""}\u0000${cwd}` : null;
  }

  async listOverrides() {
    const found = [];
    for (const dir of OVERRIDE_DIRS) {
      try {
        const r = await exec("ls", [`${appHome()}/${dir}`]);
        if (r.code !== 0) continue;
        for (const f of r.stdout.split("\n").filter((f) => /\.(svg|png)$/i.test(f))) {
          if (dir.startsWith("mods/")) { found.push(`${dir}/${f}`); continue; }
          // -L: the override may be a symlink (dotfiles). Refreshing the copy each
          // minute also keeps it newer than the cache's 7-day cleanup.
          const c = await exec("sh", ["-c", 'mkdir -p "$(dirname "$2")" && cp -fL "$1" "$2"', "x", `${appHome()}/${dir}/${f}`, `${appHome()}/${CACHE}/override--${f}`]);
          if (c.code === 0) found.push(`${CACHE}/override--${f}`);
        }
      } catch {}
    }
    this.overrides = found; // app-home ones first, so they win
  }

  // An override for the repo a place is in: project-icons/<machine>--<repo>.svg|png.
  override(where, root) {
    if (!root) return null;
    const machine = where.split("\u0000")[0] || "local";
    const want = `${machine}--${root.split("/").pop()}`;
    return this.overrides.find((f) => f.split("/").pop().replace(/^override--/, "").replace(/\.(svg|png)$/i, "") === want) ?? null;
  }

  save() {
    localStorage.setItem("art.v7", JSON.stringify(this.art));
  }

  // Places not shown for a week go (at most 300 kept). Cached files go by age:
  // every place in view rewrites its file at least every 30 minutes, so a file
  // untouched for 7 days is one no sidebar copy (in any layout) still shows.
  async prune() {
    const now = Date.now();
    const entries = Object.entries(this.art)
      .filter(([, a]) => now - (a.used ?? a.at) < 7 * 86400000)
      .sort(([, a], [, b]) => (b.used ?? b.at) - (a.used ?? a.at))
      .slice(0, 300);
    this.art = Object.fromEntries(entries);
    try {
      await exec("find", [`${appHome()}/${CACHE}`, "-maxdepth", "1", "-type", "f", "-mtime", "+7", "-delete"]);
    } catch {}
    // A place whose cached file is gone (cache cleared, mod folder replaced) is
    // looked up again rather than drawn blank until its next 30-minute check.
    try {
      const r = await exec("ls", [`${appHome()}/${CACHE}`]);
      const have = new Set(r.code === 0 ? r.stdout.split("\n").filter(Boolean) : []);
      for (const [where, a] of Object.entries(this.art)) {
        if (a.file?.startsWith(`${CACHE}/`) && !have.has(a.file.split("/").pop())) delete this.art[where];
      }
    } catch {}
    this.save();
  }

  // Looks once per place (again after 30 minutes, or 5 after a failure) for
  // that project's artwork.
  findArt(cx) {
    const ps = panes();
    const now = Date.now();
    for (const s of spaces()) {
      const where = this.place(s, ps);
      if (!where || this.looking.has(where)) continue;
      const known = this.art[where];
      if (known && now - known.at < (known.failed ? 5 : 30) * 60000) continue;
      this.looking.add(where);
      cx.spawn(async (cx) => {
        const [machine, cwd] = where.split("\u0000");
        const on = machine || undefined;
        let file = null, root = null;
        try {
          const r = await exec("sh", ["-c", FIND], { cwd, on });
          const lines = r.stdout.split("\n");
          root = lines.find((l) => l.startsWith("ROOT "))?.slice(5) ?? null;
          const best = lines.filter((l) => /^\d+ /.test(l))
            .map((l) => { const i = l.indexOf(" "); const size = +l.slice(0, i); const path = l.slice(i + 1).replace(/^\.\//, ""); return { size, path, s: score(size, path) }; })
            .filter((c) => c.size > 100)
            .sort((a, b) => b.s - a.s)[0];
          const data = lines.find((l) => l.startsWith("DATA "))?.slice(5);
          if (this.override(where, root)) {
            // Shown from the override at draw time; nothing to fetch.
          } else if (root && data && data.length < 60000 && (!best || best.s < 45)) {
            // The page's own inline SVG favicon, saved as a file.
            const comma = data.indexOf(",");
            const meta = data.slice(0, comma), body = data.slice(comma + 1);
            // A raw "%" (width='100%') isn't URI-encoded: keep such text as it is.
            const raw = body.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
            let svgText = null;
            if (!meta.includes(";base64")) { try { svgText = decodeURIComponent(raw); } catch { svgText = raw; } }
            const name = `${hash(`${machine}:${root}:${data}`)}.svg`;
            const dest = `${appHome()}/${CACHE}/${name}`;
            const w = svgText
              ? await exec("sh", ["-c", 'mkdir -p "$(dirname "$2")" && printf %s "$1" > "$2"', "x", svgText, dest])
              : await exec("sh", ["-c", 'mkdir -p "$(dirname "$2")" && printf %s "$1" | base64 -d > "$2"', "x", body, dest]);
            if (w.code === 0) file = `${CACHE}/${name}`;
          } else if (root && best) {
            const ext = best.path.split(".").pop().toLowerCase();
            const name = `${hash(`${machine}:${root}/${best.path}:${best.size}`)}.${ext}`;
            const dest = `${appHome()}/${CACHE}/${name}`;
            const src = `${root}/${best.path}`;
            if (on) {
              const b = await exec("base64", ["-w0", src], { on });
              if (b.code === 0 && b.stdout) {
                await exec("sh", ["-c", 'mkdir -p "$(dirname "$2")" && printf %s "$1" | base64 -d > "$2"', "x", b.stdout.trim(), dest]);
                file = `${CACHE}/${name}`;
              }
            } else {
              const c = await exec("sh", ["-c", 'mkdir -p "$(dirname "$2")" && cp "$1" "$2"', "x", src, dest]);
              if (c.code === 0) file = `${CACHE}/${name}`;
            }
          }
          this.art[where] = { file, root, at: Date.now(), used: Date.now() };
        } catch {
          // The machine is away or the folder is gone: look again in 5 minutes.
          // Keep what it showed before (icon, repo for overrides) until a look succeeds.
          this.art[where] = { ...(this.art[where] ?? { file: null, root: null }), at: Date.now(), used: Date.now(), failed: true };
        }
        this.save();
        this.looking.delete(where);
        cx.notify();
      });
    }
  }

  // An agent's name on its row: the tab's name when someone named it, else what
  // the agent calls its work. A right-click on the name flips a named tab's row
  // to the agent's own title and back; a left click selects, like the rest of the row.
  agentName(t, a, tab, color) {
    const own = work({ ...a }, { ...tab, named: false });
    const flips = tab?.named && tab.name !== own;
    const showOwn = !tab?.named || this.flipped.has(tab.id);
    return div()
      .id(`name-${a.address}`)
      .flex_1().min_w(0).truncate().text_color(color)
      .when(flips, (el) => el
        .tooltip(`${showOwn ? `Tab: ${tab.name}` : `Agent: ${own}`} (right-click to switch)`)
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          this.flipped.has(tab.id) ? this.flipped.delete(tab.id) : this.flipped.add(tab.id);
          localStorage.setItem("flipped", JSON.stringify([...this.flipped]));
          cx.notify();
        }))
      .child(showOwn ? own : tab.name);
  }

  toggle(id, now) {
    this.open[id] = !now;
    localStorage.setItem("open", JSON.stringify(this.open));
  }

  // ---- the machine picker -------------------------------------------------

  machineNames() {
    const names = new Set(machines().map((m) => m.name ?? null));
    for (const s of spaces()) names.add(s.machine ?? null);
    names.delete(null);
    return [null, ...[...names].sort()];
  }

  pickMenu(t) {
    const on = shared(PICK) ?? "all";
    const item = (value, text, iconName) => h_flex()
      .id(`pick-${value}`)
      .h(30).px(10).gap(9).items_center().rounded(6)
      .text_size(13).text_color(t.foreground)
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        setShared(PICK, value);
        closeOverlay(props().overlay);
      })
      .child(svg(`${ICONS}/${iconName}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().truncate().child(text))
      .when(value === on, (el) => el.child(svg(`${ICONS}/check.svg`).size(14).flex_none()));
    return v_flex().p(5).gap(1).bg(t.popover)
      .child(item("all", "All machines", "layers"))
      .children(this.machineNames().map((m) => item(key(m), label(m), m ? "server" : "monitor")));
  }

  picker(t) {
    const on = shared(PICK) ?? "all";
    const text = on === "all" ? "All machines" : on === "local" ? "This computer" : on;
    return h_flex().h(40).px(10).gap(6).items_center().flex_none()
      .child(h_flex()
        .id("pick-open")
        .flex_1().min_w(0).h(30).px(9).gap(8).items_center().rounded(7)
        .border(1).border_color(t.border).bg(t.surface)
        .text_size(12.5).text_color(t.foreground)
        .hover((s) => s.bg(t.hover))
        .on_click(() => openOverlay({ mod: "rocinante-sidebar", kind: "popup", width: 230, height: 240, props: { machineMenu: true } }))
        .child(svg(`${ICONS}/${on === "all" ? "layers" : on === "local" ? "monitor" : "server"}.svg`).size(13).flex_none().text_color(t.muted))
        .child(div().flex_1().truncate().child(text))
        .child(svg(`${ICONS}/chevron-down.svg`).size(12).flex_none().text_color(t.dim)))
      .child(div()
        .id("space-new")
        .size(30).flex_none().flex().items_center().justify_center().rounded(7)
        .text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("New space")
        .on_click(() => {
          // Always name the machine: left out, a click follows the focused space's machine.
          const pick = shared(PICK) ?? "all";
          const m = pick === "all" ? spaces().find((s) => s.active)?.machine : pick === "local" ? null : pick;
          run("space.new", { machine: m ?? "" });
        })
        .child(svg(`${ICONS}/plus.svg`).size(15)));
  }

  // ---- status marks -------------------------------------------------------

  status(t, s) {
    if (s === "working") return div().w(12).flex_none().text_size(13).text_color(t.working).frames(BRAILLE, 80);
    if (s === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    if (s === "done") return div().size(7).mx(2).flex_none().rounded(4).bg(t.done);
    // Idle needs nothing: an empty element (never null: every caller passes it to .child()).
    return div().flex_none();
  }

  // ---- rows ---------------------------------------------------------------

  tile(t, s, size = 22) {
    const where = this.place(s, panes());
    const entry = this.art?.[where];
    if (entry) entry.used = Date.now();
    const art = this.override(where ?? "", entry?.root) ?? entry?.file;
    if (art) return div().size(size).flex_none().rounded(6).overflow_hidden().child(image(art).size(size));
    const color = (shared("space.colors") ?? {})[s.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return h_flex().size(size).flex_none().rounded(6).bg(fill).items_center().justify_center()
      .text_size(size * 0.55).font_bold().text_color("#ffffff")
      .child([...s.name][0]?.toUpperCase() ?? "?");
  }

  // The space: tile, bold name, and on the right its most urgent state.
  // One agent: that agent's work on a second line. More: a chevron to open it.
  spaceRow(t, s, mine, open, now, grouped = false) {
    const one = mine.length === 1 ? mine[0] : null;
    const tab = one && s.tabs.find((x) => x.id === one.tab);
    const many = mine.length > 1 || s.tabs.length > 1;
    const since = tab?.working_since;
    const head = h_flex().gap(9).items_center()
      .child(this.tile(t, s))
      .child(div().flex_1().min_w(0).truncate().text_size(14).font_bold().text_color(t.foreground).child(s.name))
      .when(!one && Boolean(s.status), (el) => el.child(this.status(t, s.status)))
      .when(many, (el) => el.child(div()
        .id(`fold-${s.id}`)
        .flex_none().p(3).rounded(4).text_color(t.dim)
        .hover((x) => x.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.spaceDrag = null; this.toggle(s.id, open); cx.notify(); })
        .child(svg(`${ICONS}/chevron-${open ? "down" : "right"}.svg`).size(12))));
    const line = one && h_flex()
      .id(`one-${one.address}`)
      .pl(31).gap(7).items_center().text_size(12.5)
      .on_click((_e, cx) => { cx.stop_propagation(); this.spaceDrag = null; run("pane.focus", { pane: one.pane }); })
      .child(icon(one.program, 14, t.muted) ?? div())
      .child(this.agentName(t, one, tab, one.status === "idle" ? t.muted : t.foreground))
      .when(one.status === "working" && Boolean(since), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(duration(now - since))))
      .child(this.status(t, one.status) ?? div());
    return v_flex()
      .id(`space-${s.id}`)
      .px(8).py(one ? 7 : 0).gap(4)
      .when(!one, (el) => el.h(38).justify_center())
      .flex_none().rounded(8)
      .when(s.active && !grouped, (el) => el.bg(t.selected))
      .when(!s.active, (el) => el.hover((x) => x.bg(t.hover)))
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("left", () => { this.drag = null; this.spaceDrag = { from: s.id, over: s.id, machine: s.machine ?? null }; })
      .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: s.id } } }))
      .child(head)
      .when(Boolean(one), (el) => el.child(line));
  }

  // The row being looked at inside an open space: a thin accent bar, not a fill.
  marker(t) {
    return div().absolute().left(24).top(7).bottom(7).w(2).rounded(1).bg(t.accent);
  }

  // A space row, or an open space's whole card, as a place to drop a dragged space:
  // only within its machine. An accent line shows where it lands: below when dragged
  // down, above when dragged up. The press starts on the space's own row (spaceRow).
  spaceDropTarget(el, t, s) {
    const d = this.spaceDrag;
    const position = (id) => spaces().findIndex((x) => x.id === id);
    const target = d && d.over === s.id && d.from !== s.id;
    const down = target && position(d.from) < position(s.id);
    return el
      .relative()
      .when(d?.from === s.id && d.over !== s.id, (x) => x.opacity(0.5))
      .on_mouse_move((_e, cx) => {
        const now = this.spaceDrag;
        if (!now) return;
        const over = now.machine === (s.machine ?? null) ? s.id : null; // no landing on another machine
        if (now.over !== over) { now.over = over; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => {
        const now = this.spaceDrag;
        this.spaceDrag = null;
        // space.move takes the position in spaces(), from 1, as Herdr's own list does.
        if (now && now.from !== s.id && now.machine === (s.machine ?? null)) run("space.move", { id: now.from, index: position(s.id) + 1 });
        cx.notify();
      })
      .when(target, (x) => x.child(div().absolute().left(0).right(0).h(2).bg(t.accent).when(down, (l) => l.bottom(-2)).when(!down, (l) => l.top(-2))));
  }

  // Under an open space: each tab, and under it its agents. A tab with one
  // agent folds into one line ("tab · what the agent is doing").
  tabRows(t, s, mine, now) {
    return s.tabs.flatMap((tab) => {
      const here = mine.filter((a) => a.tab === tab.id);
      const name = tab.named ? tab.name : `Tab ${tab.name}`;
      const single = here.length === 1 ? here[0] : null;
      const tabRow = h_flex()
        .id(`tab-${tab.id}`)
        .on_mouse_down("left", () => { this.drag = null; this.spaceDrag = null; })
        .relative()
        .h(28).pl(39).pr(8).gap(8).items_center().flex_none().rounded(7)
        .text_size(12.5)
        .when(s.active && tab.active && (single || !here.length), (el) => el.child(this.marker(t)))
        .hover((x) => x.bg(t.hover))
        .on_click(() => single ? run("pane.focus", { pane: single.pane }) : run("tab.select", { id: tab.id }))
        .child(single ? (icon(single.program, 14, t.muted) ?? div().size(14)) : svg(`${ICONS}/terminal.svg`).size(13).flex_none().text_color(t.dim))
        .child(single
          ? this.agentName(t, single, tab, single.status === "idle" ? t.muted : t.foreground)
          : div().flex_1().min_w(0).truncate().text_color(t.foreground).child(name))
        .when(Boolean(single) && single.status === "working" && Boolean(tab.working_since), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(duration(now - tab.working_since))))
        .child((single ? this.status(t, single.status) : this.status(t, tab.status)) ?? div());
      if (single || !here.length) return [tabRow];
      return [tabRow, ...here.map((a) => h_flex()
        .id(`ag-${a.address}`)
        .on_mouse_down("left", () => { this.drag = null; this.spaceDrag = null; })
        .relative()
        .h(26).pl(61).pr(8).gap(8).items_center().flex_none().rounded(7)
        .text_size(12.5)
        .when(a.focused, (el) => el.child(this.marker(t)))
        .hover((x) => x.bg(t.hover))
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(icon(a.program, 14, t.muted) ?? div().size(14))
        .child(div().flex_1().min_w(0).truncate().text_color(a.status === "idle" ? t.muted : t.foreground).child(work(a, tab)))
        .child(this.status(t, a.status) ?? div()))];
    });
  }

  // Machines in the person's order; ones never ordered follow, as Herdr lists them.
  orderedMachines() {
    const keys = this.machineNames().map(key);
    const rank = (k) => { const i = this.order.indexOf(k); return i < 0 ? 1e6 + keys.indexOf(k) : i; };
    return [...keys].sort((x, y) => rank(x) - rank(y));
  }

  collapse(k) {
    this.collapsed = this.collapsed.includes(k) ? this.collapsed.filter((x) => x !== k) : [...this.collapsed, k];
    localStorage.setItem("machine.collapsed", JSON.stringify(this.collapsed));
  }

  // Drop `from` where `to` is: below it when dragged down, above it when dragged up.
  move(from, to) {
    const list = this.orderedMachines().filter((k) => k !== from);
    const down = this.orderedMachines().indexOf(from) < this.orderedMachines().indexOf(to);
    list.splice(list.indexOf(to) + (down ? 1 : 0), 0, from);
    this.order = list;
    localStorage.setItem("machine.order", JSON.stringify(list));
  }

  // Connected machines are neutral; only a problem gets color: yellow while
  // connecting, red when unreachable, on a tint of the same color. Click to collapse it to the bottom
  // (or open it again); drag it onto another header to reorder.
  machineHead(t, k, state, folded, info) {
    const m = k === "local" ? null : k;
    const problem = state === "unavailable" || state === "loading";
    const color = state === "unavailable" ? PROBLEM.red : state === "loading" ? PROBLEM.yellow : t.muted;
    const band = problem ? color + "1f" : t.raised;
    const bandHover = problem ? color + "33" : t.hover;
    const d = this.drag;
    const target = d && d.over === k && d.from !== k;
    const down = target && this.orderedMachines().indexOf(d.from) < this.orderedMachines().indexOf(k);
    return h_flex()
      .id(`machine-${k}`)
      .relative()
      .h(26).mt(folded ? 4 : 12).mb(folded ? 0 : 6).px(8).gap(7).items_center().flex_none().rounded(7)
      .bg(band)
      .hover((x) => x.bg(bandHover))
      .when(d?.from === k && d.over !== k, (el) => el.opacity(0.5))
      .text_size(11).font_semibold().text_color(color)
      .tooltip(state === "unavailable" ? "Not reachable" : state === "loading" ? "Connecting" : "Connected")
      .on_mouse_down("left", () => { this.spaceDrag = null; this.drag = { from: k, over: k }; })
      .on_mouse_move((_e, cx) => {
        if (this.spaceDrag && this.spaceDrag.over !== null) { this.spaceDrag.over = null; cx.notify(); }
        if (this.drag && this.drag.over !== k && !folded) { this.drag.over = k; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => {
        const drag = this.drag;
        this.drag = null;
        if (drag?.from === k) this.collapse(k);
        else if (drag && !folded && !this.collapsed.includes(drag.from)) this.move(drag.from, k);
        cx.notify();
      })
      .when(target, (el) => el.child(div().absolute().left(0).right(0).h(2).bg(t.accent).when(down, (l) => l.bottom(-3)).when(!down, (l) => l.top(-3))))
      .child(svg(`${ICONS}/${m ? "server" : "monitor"}.svg`).size(12).flex_none())
      .child(div().flex_1().truncate().child(label(m).toUpperCase()))
      .when(folded && info.count > 0, (el) => el.child(div().flex_none().text_color(t.dim).font_normal().child(String(info.count))))
      .when(folded && Boolean(info.status) && info.status !== "idle", (el) => el.child(this.status(t, info.status) ?? div()))
      // New space on this machine. Stops the press so the header doesn't collapse or
      // drag. Not the release: a header drag dropped here must still end.
      .when(state !== "unavailable" && state !== "loading", (el) => el.child(div()
        .id(`machine-new-${k}`)
        .size(18).flex_none().flex().items_center().justify_center().rounded(4)
        .text_color(t.dim)
        .hover((x) => x.bg(t.hover).text_color(t.foreground))
        .tooltip(`New space on ${label(m)}`)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (folded) this.collapse(k); // open it, or the new space lands out of sight
          // Left out, the machine follows focus. Named, a space on the focused terminal's own
          // machine still takes its folder, which may be gone: this computer's + goes home.
          run("space.new", m ? { machine: m } : { machine: "", folder: home() });
          cx.notify();
        })
        .child(svg(`${ICONS}/plus.svg`).size(12))))
      .child(svg(`${ICONS}/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim));
  }

  compact(t, s) {
    return h_flex()
      .id(`space-${s.id}`)
      .h(34).flex_none().justify_center().items_center().rounded(8)
      .when(s.active, (el) => el.bg(t.selected))
      .hover((x) => x.bg(t.hover))
      .on_click(() => run("space.select", { id: s.id }))
      .child(div().relative().child(this.tile(t, s, 24))
        .when(Boolean(s.status) && s.status !== "idle", (el) => el.child(div().absolute().right(-3).top(-3).size(8).rounded(4).bg(t[s.status] ?? t.dim))));
  }

  // Same color bookkeeping as the shipped spaces list (shared "space.colors").
  colors(sp) {
    const ids = new Set(sp.map((p) => p.id));
    const all = shared("space.colors") ?? {};
    const kept = Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(all).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = (c) => Object.values(kept).filter((v) => v === c).length;
      kept[p.id] = PALETTE.reduce((best, c) => (uses(c) < uses(best) ? c : best));
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
  }

  render() {
    const t = theme();
    if (props()?.machineMenu) return this.pickMenu(t);
    const sp = spaces();
    this.colors(sp);
    const ag = agents();
    const now = Date.now();
    const pick = shared(PICK) ?? "all";
    const state = Object.fromEntries(machines().map((m) => [key(m.name), m.layout]));
    const shownMachines = pick === "all" ? this.machineNames() : [pick === "local" ? null : pick];

    if (narrow()) {
      const list = sp.filter((s) => shownMachines.includes(s.machine ?? null));
      return v_flex().size_full().min_h(0).bg(t.chrome).px(6).py(6).gap(2).overflow_y_scrollbar()
        .children(list.map((s) => this.compact(t, s)));
    }

    const rank = { blocked: 4, done: 3, working: 2, idle: 1 };
    const rowsFor = (m) => {
      const mine = sp.filter((s) => (s.machine ?? null) === m);
      const rows = mine.flatMap((s) => {
        const sa = ag.filter((a) => a.space === s.id);
        const many = sa.length > 1 || s.tabs.length > 1;
        const open = many && (this.open[s.id] ?? s.active);
        if (!open) return [this.spaceDropTarget(this.spaceRow(t, s, sa, open, now), t, s)];
        // An open space and its rows are one card, one highlight for the group.
        return [this.spaceDropTarget(v_flex()
          .id(`card-${s.id}`)
          .flex_none().rounded(9).pb(4).gap(1)
          .when(s.active, (el) => el.bg(t.selected))
          .child(this.spaceRow(t, s, sa, open, now, true))
          .children(this.tabRows(t, s, sa, now)), t, s)];
      });
      if (rows.length) return rows;
      return [h_flex()
        .id(`new-${key(m)}`)
        .h(30).px(8).gap(8).items_center().flex_none().rounded(7)
        .text_size(12.5).text_color(t.dim)
        .hover((x) => x.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg(`${ICONS}/plus.svg`).size(12))
        .child(state[key(m)] === "loading" ? "Loading…" : "New space there")];
    };
    const info = (k) => {
      const mine = sp.filter((s) => key(s.machine ?? null) === k);
      const status = mine.map((s) => s.status).reduce((a, b) => ((rank[b] ?? 0) > (rank[a] ?? 0) ? b : a), null);
      return { count: mine.length, status };
    };

    let body, bottom = [];
    if (pick === "all") {
      const all = this.orderedMachines();
      const open = all.filter((k) => !this.collapsed.includes(k));
      const folded = this.collapsed.filter((k) => all.includes(k));
      body = open.flatMap((k) => [this.machineHead(t, k, state[k], false, info(k)), ...rowsFor(k === "local" ? null : k)]);
      bottom = folded.map((k) => this.machineHead(t, k, state[k], true, info(k)));
    } else {
      body = rowsFor(pick === "local" ? null : pick);
    }

    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .on_mouse_up("left", (_e, cx) => { if (this.drag || this.spaceDrag) { this.drag = null; this.spaceDrag = null; cx.notify(); } })
      // A release outside the sidebar never reaches it: the next press ends the drag,
      // out there here, or on a row (which arms its own or disarms).
      .on_mouse_down_out((_e, cx) => { if (this.drag || this.spaceDrag) { this.drag = null; this.spaceDrag = null; cx.notify(); } })
      .child(this.picker(t))
      .child(v_flex().flex_1().min_h(0).px(8).pb(8).gap(2).overflow_y_scrollbar().children(body))
      .when(bottom.length > 0, (el) => el.child(v_flex().flex_none().px(8).pt(2).pb(8).children(bottom)));
  }
}
