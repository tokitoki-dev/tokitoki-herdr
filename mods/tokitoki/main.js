// Tokitoki in Herdr: today's coding time and tokens in the status bar, and a
// short popup when it is clicked. One mod draws both: the popup is this mod
// opened as an overlay.
//
// The popup is a glance, not a report: today's two numbers, the week's shape,
// and one button to the dashboard, where the rest lives. Rankings by project
// and agent are the dashboard's job.
//
// The numbers come from the Tokitoki CLI (see data.js). The strip asks it once
// a minute and whenever the focused terminal moves to another project; the
// popup shows what the strip last learned straight away, then asks again.
// The strip also reports time spent in the terminals (see track.js).

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, settings, props, openOverlay, closeOverlay, exec, window, shared, setShared, notify } from "herdr";
import {
  REFRESH_MS, INSTALL_RETRY_MS, PREVIEW, CliError,
  canInstall, installCli, findCli, projectOf, snapshot, dashboardUrl, setKey, preview,
} from "./data.js";
import { localFolder, track } from "./track.js";
import { place } from "./place.js";
import { SITE } from "./env.js";
import { detectLanguage, words } from "./i18n.js";

const LOGO = "mods/tokitoki/logo.svg";
const WIDTH = 320;
// The popup opens above the strip, never over it, so its bottom edge has to be
// known: each state has a fixed height, a little over what its content needs.
// Keep these in step with panel() if the content changes.
const HEIGHT = { ready: 266, nokey: 348, nocli: 172, loading: 88, installing: 132 };
// Space between the popup and the strip, and between the popup and the window's edge.
const GAP = 6;
// The longest a project name may run in the strip before it is cut short, so
// the figures fit the block the layout gives them (see README: 320 px).
const PROJECT_MAX = 120;
const PAD = 16;
const INNER = WIDTH - PAD * 2;
const OPENER = { macos: ["open"], linux: ["xdg-open"], windows: ["cmd", "/c", "start", ""] };

// What the strip last learned, shared so a popup opens with numbers on screen
// instead of an empty card. Figures and a project name only: no key, no link.
const LAST = "tokitoki.last";

// The CLI install, shared for the same reason and one more: it is how the strip
// and a popup agree that one is under way, and how a failed one waits an hour
// instead of retrying on every refresh. { at, running }; cleared on success,
// so a record that is not running is always a failure.
const INSTALL = "tokitoki.install";
// An install that says it is running for longer than this died with the app.
const STUCK_MS = 10 * 60 * 1000;
// Shared state outlives the mod: an install recorded as running before this
// code loaded (Herdr restarted, or the mod was saved and reloaded) has no one
// running it any more.
const LOADED_AT = Date.now();

// When a key was last saved from a popup: the strip asks again on seeing it
// change instead of waiting for its next minute.
const KEYED = "tokitoki.keyed";

// Today, as the CLI names days (YYYY-MM-DD, local time).
function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Figures from another day are not today's, whatever is keeping new ones from
// arriving: they give way to "loading" rather than stand under its label.
function current(day) {
  return day?.date && day.date !== todayDate() ? { state: "loading" } : day;
}

// Whether a recorded install is under way right now.
function installing(t) {
  return Boolean(t?.running) && t.at >= LOADED_AT && Date.now() - t.at < STUCK_MS;
}

function tokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function time(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function browse(url) {
  const [cmd, ...args] = OPENER[window()?.platform] ?? OPENER.linux;
  exec(cmd, [...args, url]).catch(() => {});
}

export default class Tokitoki extends View {
  init(_p, cx) {
    // `props()`, not init's argument: only it carries the overlay id.
    this.overlay = Boolean(props()?.overlay);
    this.day = current(shared(LAST)) ?? { state: "loading" };
    this.cmd = null;
    this.folder = localFolder();
    this.strip = null;
    this.names = new Map();
    this.busy = false;
    this.again = false;
    this.keyed = shared(KEYED);
    // English until the system says otherwise; asked once for every copy.
    cx.spawn(async (cx) => { await detectLanguage(); cx.notify(); });
    this.refresh(cx);
    // Only the strip lives long enough to need a clock. The popup asks once.
    if (!this.overlay) cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    if (this.overlay) this.keyField(cx);
    // The popup is how the strip first gets into the window (see place.js).
    if (this.overlay && !PREVIEW) place(cx, (copy) => notify({
      title: words().placed,
      body: copy ? words().placedCopy.replace("{name}", copy) : "",
      level: "success",
    }));
  }

  // Where the no-key popup takes a key, drawn as dots the way VS Code's is.
  // A popup gets the keyboard a moment after it opens, so the field is
  // focused then too (as Herdr's own prompt does).
  keyField(cx) {
    this.key = InputState.new({ placeholder: words().keyPlaceholder });
    this.key.set_masked(true);
    this.key.on("submit", (_e, cx) => this.saveKey(cx));
    this.key.on("focus", (_e, cx) => { this.keyFocused = true; cx.notify(); });
    this.key.on("blur", (_e, cx) => { this.keyFocused = false; cx.notify(); });
    this.saving = false;
    this.rejected = false;
    const focus = () => { if (this.day.state === "nokey") this.key.focus(); };
    focus();
    cx.timer.after(600, focus);
  }

  // A saved key changes what every part of the popup says, so the popup
  // closes and the strip, told through KEYED, shows the account's figures.
  saveKey(cx) {
    const key = this.key.value().trim();
    if (!key || this.saving || !this.cmd) return;
    this.saving = true;
    this.rejected = false;
    cx.notify();
    cx.spawn(async (cx) => {
      const saved = await setKey(this.cmd, key);
      this.saving = false;
      if (!saved) {
        this.rejected = true;
        cx.notify();
        return;
      }
      setShared(KEYED, Date.now());
      notify({ title: words().connected, body: words().keySaved, level: "success" });
      closeOverlay(props().overlay);
    });
  }

  // One refresh at a time; a request that arrives meanwhile (the terminal moved
  // to another project) runs right after, with the then-current folder.
  refresh(cx) {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await this.load(cx);
      } catch {
        // A call that is not an answer (a timeout, a server hiccup): keep the
        // figures already on screen rather than blanking them — while they
        // are still today's.
        this.day = current(this.day);
      }
      this.busy = false;
      cx.notify();
      if (this.again) {
        this.again = false;
        this.refresh(cx);
      }
    });
  }

  async load(cx) {
    this.folder = localFolder();
    this.keyed = shared(KEYED);
    if (PREVIEW) return this.show(preview(PREVIEW));

    this.cmd ??= await findCli();
    if (!this.cmd && !this.overlay && canInstall() && this.mayInstall()) {
      // Only the strip installs, and records that it is doing so before it
      // starts, so nothing else begins the same install meanwhile.
      setShared(INSTALL, { at: Date.now(), running: true });
      this.show({ state: "installing" });
      cx.notify();
      this.cmd = await installCli();
      setShared(INSTALL, this.cmd ? null : { at: Date.now(), running: false });
    }
    if (!this.cmd) return this.show(this.withoutCli());

    // The project is named the way the editor plugins name it, by the CLI.
    // Only a name that was found is remembered, so one failed lookup is retried.
    let name = this.folder ? this.names.get(this.folder) : null;
    if (this.folder && !name) {
      name = await projectOf(this.cmd, this.folder).catch(() => null);
      if (name) this.names.set(this.folder, name);
    }
    try {
      this.show(await snapshot(this.cmd, name));
    } catch (error) {
      // Not the CLI answering badly but the program gone: look for it again.
      if (!(error instanceof CliError)) this.cmd = null;
      throw error;
    }
  }

  // Whether an install is due: none is on record, the last one failed long
  // enough ago, or one recorded as running is not (see LOADED_AT, STUCK_MS).
  mayInstall() {
    const t = shared(INSTALL);
    if (!t) return true;
    if (t.running) return !installing(t);
    return Date.now() - t.at > INSTALL_RETRY_MS;
  }

  // What to say when there is no CLI: that one is being installed, that the
  // last install failed, or just that it is missing (installing is turned off,
  // or the CLI was removed after an install that worked).
  withoutCli() {
    const t = shared(INSTALL);
    if (installing(t)) return { state: "installing" };
    return { state: "nocli", failed: Boolean(t) };
  }

  show(day) {
    if (JSON.stringify(day) === JSON.stringify(this.day)) return;
    this.day = day;
    if (!this.overlay) setShared(LAST, day);
  }

  // Opens the popup right above the strip, its right edge on the strip's (the
  // figures sit at that end). Without the strip's position — it is only known
  // once the pointer has pressed on it — Herdr's default, the pointer, applies.
  open(day) {
    const height = HEIGHT[day.state] ?? HEIGHT.loading;
    const spec = { mod: "tokitoki", kind: "popup", width: WIDTH, height };
    const strip = this.strip;
    if (strip) {
      // The strip's bounds and `at` are both in screen points; a popup's own
      // width and height are mod pixels, which Herdr's zoom setting scales.
      const zoom = settings().zoom ?? 1;
      spec.at = {
        x: Math.max(GAP, strip.x + strip.width - WIDTH * zoom - GAP),
        y: Math.max(GAP, strip.y - height * zoom - GAP),
      };
    }
    openOverlay(spec);
  }

  // The strip under the terminals. Every state opens the popup: it is where a
  // missing key or CLI is explained, so the strip never has to.
  bar(t, day) {
    const numbers = day.state === "ready" || day.state === "nokey";
    const w = words();
    const say = { loading: "Tokitoki", installing: w.installingBar, nocli: w.setupBar };
    // No separator glyphs: the figures are told apart by space and by weight of
    // colour — the number bright, what it counts dim — which keeps the strip
    // quiet next to the neighbouring status items. Each item is one unit, so
    // the gap between items is wider than the gap inside one.
    const item = (value, name) => h_flex().gap(5).items_baseline().flex_none()
      .child(div().text_color(t.foreground).child(value))
      .child(div().text_color(t.dim).child(name));
    // The project gives way when room runs out: its name is cut short first,
    // the figures never are.
    const project = (p) => h_flex().gap(5).items_baseline().min_w(0)
      .child(div().min_w(0).max_w(PROJECT_MAX).truncate().text_color(t.dim).child(p.name))
      .child(div().flex_none().text_color(t.foreground).child(time(p.active_seconds)));
    // The block itself is the status bar's own surface, edge to edge, so it
    // reads as part of the bar however wide the layout made it. Only the
    // figures are the control: they light up on hover and open the popup, so
    // the empty part of the block never shows as a slab of its own.
    const figures = h_flex().id("tokitoki-bar").min_w(0).h(20).px(8).gap(16).items_center().rounded(5)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (e) => { this.strip = e.bounds ?? null; })
      .on_click(() => this.open(day))
      .child(h_flex().gap(6).items_center().flex_none()
        .child(svg(LOGO).size(13).flex_none().text_color(numbers ? t.foreground : t.dim))
        .child(numbers
          ? div().text_color(t.foreground).child(time(day.totals.active_seconds))
          : div().child(say[day.state])))
      // Time first, then where it went, tokens last: what someone glances
      // at the strip for is the time.
      .when(numbers, (el) => el
        .when(day.state === "ready" && Boolean(day.project), (el) => el.child(project(day.project)))
        .child(item(tokens(day.totals.total_tokens), "tok")));
    return h_flex().size_full().px(6).items_center().justify_end()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(figures);
  }

  label(t, text) {
    return div().text_size(11).text_color(t.dim).child(text);
  }

  // `end` sets a figure against the right edge, under the header's tag.
  stat(t, value, name, end) {
    return v_flex().flex_1().gap(1).when(end, (el) => el.items_end())
      .child(div().text_size(22).font_semibold().text_color(t.foreground).child(value))
      .child(this.label(t, name));
  }

  // Seven bars, today's in the accent colour, with the week's total beside the
  // title so the block states its own scale. The week is this machine's own
  // history; the figure above it, with a key, is the account's across machines.
  week(t, daily) {
    const max = Math.max(1, ...daily.map((d) => d.active_seconds));
    const total = daily.reduce((sum, d) => sum + d.active_seconds, 0);
    const w = words();
    const gap = 8;
    const width = Math.floor((INNER - gap * (daily.length - 1)) / daily.length);
    return v_flex().gap(9)
      .child(h_flex().items_baseline()
        .child(div().flex_1().child(this.label(t, w.week)))
        .child(this.label(t, time(total))))
      .child(h_flex().gap(gap).items_end().children(daily.map((d, i) =>
        v_flex().gap(4).items_center()
          .child(div().w(width).h(Math.max(2, Math.round((32 * d.active_seconds) / max))).rounded(2)
            .bg(i === daily.length - 1 ? t.accent : t.dim))
          .child(this.label(t, w.weekdays[new Date(`${d.date}T00:00:00`).getDay()])))));
  }

  // `primary` is the one thing the popup wants clicked: ink on paper, so it
  // reads as the answer rather than as another row. `go(cx)` does the work and
  // closes the popup itself: closing cancels the popup's unfinished tasks, so a
  // click that has to ask the CLI first must finish before it closes.
  button(t, text, go, primary) {
    return h_flex().id(`tokitoki-open-${text}`).h(32).px(14).rounded(7).items_center().justify_center().flex_none()
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground).font_semibold())
      .when(!primary, (el) => el.bg(t.raised).text_color(t.foreground).hover((s) => s.bg(t.hover)))
      .cursor_pointer()
      .on_click((_e, cx) => go(cx))
      .child(text);
  }

  // Opens a page and closes the popup.
  site(t, text, url, primary) {
    return this.button(t, text, () => { browse(url); closeOverlay(props().overlay); }, primary);
  }

  // The dashboard is the one page that wants the CLI's login link.
  dashboard(t) {
    return this.button(t, words().openDashboard, (cx) => cx.spawn(async () => {
      browse(await dashboardUrl(this.cmd));
      closeOverlay(props().overlay);
    }), true);
  }

  // The no-key state: what a key adds (the figures above are this machine's;
  // with one they are every machine's), where to get one, and the key field.
  // The link sits in the title row, at the card's right edge like the button
  // under it; a refusal takes the explanation's line, so nothing moves.
  setup(t) {
    const w = words();
    // Smaller than the popup's own button: a form inside a card, not the
    // popup's answer.
    const field = Input.new(this.key).flex_1().h(26).px(8).rounded(6).border_1()
      .border_color(this.keyFocused ? t.accent : t.input).bg(t.background).text_size(12).text_color(t.foreground);
    const get = div().id("tokitoki-get-key").text_size(11).text_color(t.accent).cursor_pointer()
      .on_click(() => { browse(`${SITE}/settings`); closeOverlay(props().overlay); })
      .child(w.getKey);
    return v_flex().gap(10).p(12).rounded(8).bg(t.raised)
      .child(h_flex().items_baseline().justify_between()
        .child(div().font_semibold().text_color(t.foreground).child(w.connect))
        .child(get))
      .child(div().text_size(12).when(this.rejected, (el) => el.text_color(t.blocked))
        .child(this.rejected ? w.notSaved : w.connectWhy))
      .child(h_flex().gap(8).items_center()
        .child(field)
        .child(this.button(t, this.saving ? w.saving : w.save, (cx) => this.saveKey(cx), true)
          .h(26).px(10).rounded(6).text_size(12)));
  }

  panel(t, day) {
    const w = words();
    const tag = PREVIEW ? w.sample : day.state === "nokey" ? w.localOnly : day.stale ? w.offline : w.today;
    const head = h_flex().items_center().gap(7)
      .child(svg(LOGO).size(15).flex_none().text_color(t.foreground))
      .child(div().flex_1().font_semibold().text_color(t.foreground).child("Tokitoki"))
      .child(this.label(t, day.state === "ready" || day.state === "nokey" ? tag : ""));
    const root = v_flex().w_full().h(HEIGHT[day.state] ?? HEIGHT.loading).p(PAD).gap(16)
      .bg(t.popover).text_size(12.5).text_color(t.muted).child(head);
    if (day.state === "loading") {
      return root.child(div().text_color(t.dim).child(w.reading));
    }
    if (day.state === "installing") {
      return root
        .child(div().child(w.installing))
        .child(div().text_size(11).text_color(t.dim).child(w.installingNote));
    }
    if (day.state === "nocli") {
      return root
        .child(div().child(day.failed ? w.installFailed : w.noCli))
        .child(this.site(t, w.getTokitoki, `${SITE}/download`, true));
    }
    const today = h_flex().gap(12)
      .child(this.stat(t, time(day.totals.active_seconds), w.codedToday))
      .child(this.stat(t, tokens(day.totals.total_tokens), w.tokens, true));
    // Same popup with or without a key; only what it leads to differs.
    return root
      .child(today)
      .child(this.week(t, day.daily))
      .child(day.state === "nokey" ? this.setup(t) : this.dashboard(t));
  }

  render(cx) {
    const t = theme();
    // Focus moved to a terminal in another project, or a key was just saved:
    // ask again.
    if (!PREVIEW && (localFolder() !== this.folder || shared(KEYED) !== this.keyed)) this.refresh(cx);
    // A render is how a mod learns that something happened (see track.js).
    if (!PREVIEW && !this.overlay && this.cmd) track(this.cmd);
    return this.overlay ? this.panel(t, this.day) : this.bar(t, this.day);
  }
}
