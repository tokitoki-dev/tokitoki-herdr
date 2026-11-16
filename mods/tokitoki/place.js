// Putting the strip in the window: next to Herdr's status line, at its right
// end, the first time the popup opens.
//
// Herdr docks a new mod only into a layout of the person's own, and most
// people are on Herdr's own `main`, which is read-only: copying the folder
// shows nothing. So installing ends with opening the popup once
// (`herdr-app do mod.open '{"name":"tokitoki"}'`), and the popup does the
// rest with Herdr's own commands: `layout.set` on the shown layout, and when
// that layout turns out to be one of Herdr's, `layout.clone` first, the way
// Herdr asks for any change to its layouts.
//
// Once only: someone who takes the strip out again keeps it out.

import { layout, layouts, run, shared, setShared } from "herdr";

const PLACED = "tokitoki.placed";
// Long enough for a command to land in the shown layout.
const SETTLE_MS = 500;

const STRIP = { id: "tokitoki", type: "block", size: { px: 320 }, content: { mod: "tokitoki" } };

const isStrip = (n) => n?.content?.mod === "tokitoki";
const isStatus = (n) => n?.content?.mod === "workspace-status";

function some(node, test) {
  return Boolean(node) && (test(node) || (node.children ?? []).some((c) => some(c, test)));
}

// The tree with the strip after the status line, or null when there is no
// status line to put it by. A status line alone in its column gets a row of
// its own height, shared with the strip.
function withStrip(tree) {
  let found = false;
  const walk = (node) => {
    if (!node.children) return node;
    const children = node.children.flatMap((c) => {
      if (found || !isStatus(c)) return [walk(c)];
      found = true;
      if (node.type === "row") return [c, STRIP];
      return [{ id: "tokitoki-row", type: "row", size: c.size, resizable: false,
        children: [{ ...c, size: { weight: 1 } }, STRIP] }];
    });
    return { ...node, children };
  };
  const out = walk(tree);
  return found ? out : null;
}

function freeName(name) {
  const taken = new Set(layouts());
  let as = `${name}-tokitoki`;
  for (let i = 2; taken.has(as); i++) as = `${name}-tokitoki-${i}`;
  return as;
}

// Puts the strip in the shown layout unless it is there or was put there
// before. `said(copy)` follows a placement: `copy` names the layout made for
// it, null when the shown one took it.
export function place(cx, said) {
  const tree = layout();
  if (shared(PLACED) || some(tree, isStrip)) return;
  const next = withStrip(tree);
  if (!next) return;
  setShared(PLACED, true);
  run("layout.set", { layout: next });
  cx.timer.after(SETTLE_MS, () => {
    if (some(layout(), isStrip)) return said(null);
    // One of Herdr's layouts: it keeps its structure, a copy takes the strip.
    const as = freeName(shared("layout"));
    run("layout.clone", { name: shared("layout"), as });
    cx.timer.after(SETTLE_MS, () => {
      const copy = withStrip(layout());
      if (copy) run("layout.set", { layout: copy });
      said(as);
    });
  });
}
