// The words the mod shows, in English, Japanese and Chinese, and which of them
// this computer reads.
//
// Herdr has no language setting (its own screens are English) and a mod has
// no Intl, navigator or environment, so the system is asked once, the way
// each platform keeps its choice:
//
//   · macOS: the first of the preferred languages (System Settings), not
//     LANG — a terminal's LANG is often C.UTF-8 whatever the person reads;
//   · Linux: LANGUAGE, LC_ALL, LC_MESSAGES, LANG, in gettext's order;
//   · Windows: the display language.
//
// Until the answer comes, and for any language not here, it is English. The
// terms are the site's (tracklm-nextjs/messages), so the popup and the
// dashboard it leads to say the same thing.

import { exec, window } from "herdr";

// A language to work on the look in: "en" | "ja" | "zh". Anything else asks
// the system.
const FORCE = null;

const WORDS = {
  en: {
    installingBar: "Installing Tokitoki…",
    setupBar: "Set up Tokitoki",
    today: "today",
    localOnly: "local only",
    offline: "offline",
    sample: "sample data",
    reading: "Reading your Tokitoki numbers…",
    installing: "Installing the Tokitoki CLI…",
    installingNote: "A one-time download from tokitoki.dev into ~/.tokitoki/bin.",
    installFailed: "The Tokitoki CLI could not be installed automatically. It will try again later; or get it yourself.",
    noCli: "Install the Tokitoki CLI to see today's coding time and tokens here.",
    getTokitoki: "Get Tokitoki",
    codedToday: "coded today",
    tokens: "tokens",
    week: "Last 7 days · this machine",
    weekdays: ["S", "M", "T", "W", "T", "F", "S"],
    openDashboard: "Open dashboard",
    connect: "Connect account",
    connectWhy: "Add an API key to see all your machines.",
    keyPlaceholder: "API key",
    save: "Save",
    saving: "Saving…",
    notSaved: "Key not saved.",
    getKey: "Get a key",
    connected: "Tokitoki connected",
    keySaved: "Your API key is saved.",
    placed: "Tokitoki is in the status bar",
    placedCopy: "Herdr's own layout can't be changed, so it is on a copy: {name}.",
  },
  ja: {
    installingBar: "Tokitoki をインストール中…",
    setupBar: "Tokitoki を設定",
    today: "今日",
    localOnly: "このマシンのみ",
    offline: "オフライン",
    sample: "サンプル",
    reading: "Tokitoki のデータを読み込み中…",
    installing: "Tokitoki CLI をインストール中…",
    installingNote: "tokitoki.dev から ~/.tokitoki/bin へ一度だけダウンロードします。",
    installFailed: "Tokitoki CLI を自動でインストールできませんでした。後で再試行します。手動でも入手できます。",
    noCli: "Tokitoki CLI をインストールすると、今日のコーディング時間とトークンを表示します。",
    getTokitoki: "Tokitoki を入手",
    codedToday: "今日のコーディング",
    tokens: "トークン",
    week: "過去 7 日間 · このマシン",
    weekdays: ["日", "月", "火", "水", "木", "金", "土"],
    openDashboard: "ダッシュボードを開く",
    connect: "アカウントを接続",
    connectWhy: "API キーで全マシンのデータを表示",
    keyPlaceholder: "API キー",
    save: "保存",
    saving: "保存中…",
    notSaved: "保存できませんでした",
    getKey: "キーを取得",
    connected: "Tokitoki に接続しました",
    keySaved: "API キーを保存しました。",
    placed: "Tokitoki をステータスバーに追加しました",
    placedCopy: "Herdr 標準のレイアウトは変更できないため、コピー「{name}」に追加しました。",
  },
  zh: {
    installingBar: "正在安装 Tokitoki…",
    setupBar: "设置 Tokitoki",
    today: "今天",
    localOnly: "仅本机",
    offline: "离线",
    sample: "示例数据",
    reading: "正在读取 Tokitoki 数据…",
    installing: "正在安装 Tokitoki CLI…",
    installingNote: "从 tokitoki.dev 下载到 ~/.tokitoki/bin，仅此一次。",
    installFailed: "无法自动安装 Tokitoki CLI，稍后会重试，也可以手动安装。",
    noCli: "安装 Tokitoki CLI 后，这里会显示今天的编码时间和 Token。",
    getTokitoki: "获取 Tokitoki",
    codedToday: "今日编码",
    tokens: "Token",
    week: "最近 7 天 · 本机",
    weekdays: ["日", "一", "二", "三", "四", "五", "六"],
    openDashboard: "打开仪表盘",
    connect: "连接账号",
    connectWhy: "添加 API 密钥，查看所有机器的数据",
    keyPlaceholder: "API 密钥",
    save: "保存",
    saving: "保存中…",
    notSaved: "保存失败",
    getKey: "获取密钥",
    connected: "Tokitoki 已连接",
    keySaved: "API 密钥已保存。",
    placed: "Tokitoki 已加入状态栏",
    placedCopy: "Herdr 自带布局不能修改，已加在它的副本「{name}」上。",
  },
};

// Module state, shared by every copy: the system is asked once per load.
let lang = WORDS[FORCE] ? FORCE : "en";
let asked = null;

// The system's language tag, e.g. "zh-Hans-JP", "ja_JP.UTF-8", "en-US".
async function systemLanguage() {
  const platform = window()?.platform;
  if (platform === "macos") {
    // A plist array: ( "zh-Hans-JP", "ja-JP" ), quoted or not.
    const { stdout } = await exec("defaults", ["read", "-g", "AppleLanguages"]);
    return stdout.replace(/[()",]/g, " ").trim().split(/\s+/)[0];
  }
  if (platform === "windows") {
    const { stdout } = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "(Get-UICulture).Name"]);
    return stdout.trim();
  }
  const { stdout } = await exec("sh", ["-c", 'printf %s "${LANGUAGE:-${LC_ALL:-${LC_MESSAGES:-$LANG}}}"']);
  return stdout.split(":")[0];
}

// Asks the system, once. Resolves when `words()` says what it will keep saying.
export function detectLanguage() {
  if (WORDS[FORCE]) return Promise.resolve();
  asked ??= systemLanguage()
    .then((tag) => {
      const code = String(tag ?? "").slice(0, 2).toLowerCase();
      if (WORDS[code]) lang = code;
    })
    .catch(() => {});
  return asked;
}

export function words() {
  return WORDS[lang];
}
