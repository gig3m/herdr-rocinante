// Finding file paths in terminal text, and opening them in the file manager.
// Used by the terminal right-click menu (main.js).

import { exec, window } from "herdr";

// A path starts with / or ~/ and runs to whitespace or a quote/bracket; a
// trailing period, colon or comma is sentence punctuation, not the path.
// It must start a word: "src/lib" is a relative path, not "/lib".
const PATH = /(?<![\p{L}\p{N}_.~$-])(?:~\/|\/)[^\s'"`<>()[\]{}|;,]*[^\s'"`<>()[\]{}|;,.:]/gu;
const PATH_CHAR = /^[^\s'"`<>()[\]{}|;,]+/;
const SYSTEM = /^\/(dev|proc|sys|run)(\/|$)/;

// Paths in the text, newest (lowest on screen) first. A path cut by the
// terminal's wrap ("…/4520aa82-87dc-5" then "  5fbf…") is also tried joined
// with the start of the next line. `~/` is expanded with `home`.
export function candidates(text, home) {
  const lines = text.split("\n");
  const found = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    for (const m of line.matchAll(PATH)) {
      const p = m[0];
      if (p.length < 3 || SYSTEM.test(p)) continue;
      if (m.index + p.length >= line.trimEnd().length && i + 1 < lines.length) {
        const next = lines[i + 1].trimStart().match(PATH_CHAR)?.[0];
        if (next) found.push((p + next).replace(/[.:]+$/, ""));
      }
      found.push(p);
    }
  }
  return [...new Set(found.map((p) => (p.startsWith("~/") ? home + p.slice(1) : p)))];
}

// Which of `paths` exist: Map path -> "d" | "f" (missing ones are left out).
// Paths are absolute, so no working folder is needed (the terminal's may be gone).
export async function existing(paths) {
  if (!paths.length) return new Map();
  const r = await exec("sh", ["-c", 'for p do if [ -d "$p" ]; then echo "d $p"; elif [ -e "$p" ]; then echo "f $p"; fi; done', "x", ...paths]);
  return new Map(r.stdout.split("\n").filter(Boolean).map((l) => [l.slice(2), l[0]]));
}

const fileUri = (p) => "file://" + p.split("/").map(encodeURIComponent).join("/");

// Folders open themselves; files open their folder with the file selected.
// Linux: the file manager over D-Bus (org.freedesktop.FileManager1 ShowFolders /
// ShowItems), else xdg-open on the folder. macOS: Finder (`open`, `open -R`).
export async function openInFileManager(path, dir) {
  const target = path.replace(/\/+$/, "") || "/";
  try {
    if (window()?.platform === "macos") {
      await exec("open", dir ? [target] : ["-R", target]);
      return;
    }
    const method = dir ? "ShowFolders" : "ShowItems";
    const r = await exec("gdbus", ["call", "--session", "--dest", "org.freedesktop.FileManager1",
      "--object-path", "/org/freedesktop/FileManager1",
      "--method", `org.freedesktop.FileManager1.${method}`,
      `['${fileUri(target).replace(/'/g, "%27")}']`, ""]);
    if (r.code !== 0) throw new Error(r.stderr);
  } catch {
    // No FileManager1 service (or no gdbus): open the folder with the default app.
    const folder = dir ? target : target.replace(/\/[^/]*$/, "") || "/";
    exec("xdg-open", [folder]).catch(() => {});
  }
}

export function shorten(p, home, max = 46) {
  const s = home && p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
  return s.length > max ? s.slice(0, Math.floor(max * 0.4)) + "…" + s.slice(-Math.ceil(max * 0.6) + 1) : s;
}
