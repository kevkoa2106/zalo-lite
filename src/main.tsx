import { render } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import "./styles.css";
import { call, on, type Contact, type Limits, type Me, type Msg, type State, type Sticker, type Thread } from "./api";
import { ago, clock, day, findQuoted, gapLabel, hue, initials, isGap, size, splitMentions, voiceExt, type Mention } from "./format";
import { Icon, type IconName } from "./icons";
import { groupPhotos } from "./photo-groups";
import { LocaleContext, loadLocale, localizeNotice, useLocale } from "./locale";
import { AccountCard, GearMenu, PersonCard, SettingsDialog, notify, sendsWithMod, type GearAction, type Person } from "./dialogs";

// ---------- helpers ----------

const REACTIONS: [string, string][] = [
  ["/-strong", "👍"], ["/-heart", "❤️"], [":>", "😆"], [":o", "😮"], [":-((", "😭"], [":-h", "😡"],
];
const EMOJI: Record<string, string> = {
  ...Object.fromEntries(REACTIONS),
  "/-break": "💔", "/-weak": "👎", ":-*": "😘", ":')": "😂", "/-rose": "🌹", "/-ok": "👌", ";xx": "😍",
  "/-li": "☀️", "/-bd": "🎂", "/-shit": "💩", ";-/": "😕", ";-)": "😉", "/-fade": "😶", "/-bome": "💣",
};
const PREVIEW_ICON: Partial<Record<Msg["kind"], IconName>> = {
  photo: "image", file: "file", link: "link", video: "video", voice: "mic", sticker: "sticker", gif: "image", call: "phoneIn",
};
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const isMac = navigator.platform.startsWith("Mac");

function openExternal(url: string) {
  const t = (window as any).__TAURI__;
  if (t?.opener) t.opener.openUrl(url);
  else window.open(url, "_blank", "noopener");
}

function Avatar({ src, name, id, size: s = 48 }: { src?: string; name: string; id: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken)
    return <img class="avatar" src={src} alt="" width={s} height={s} loading="lazy" onError={() => setBroken(true)} />;
  return (
    <span class="ph" style={{ width: `${s}px`, height: `${s}px`, fontSize: `${Math.round(s * 0.36)}px`, "--h": hue(id) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light" | "system">(() => {
    try {
      return (localStorage.getItem("theme") as any) || "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: light)");
    const apply = () => document.documentElement.classList.toggle("light", theme === "light" || (theme === "system" && mq.matches));
    apply();
    try {
      localStorage.setItem("theme", theme);
    } catch {}
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme] as const;
}

// Click-away popover anchored to a point; rendered fixed so it escapes scrolling containers.
function Popover({ at, onClose, children, label }: { at: { x: number; y: number }; onClose: () => void; children: any; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)) });
    ref.current!.querySelector<HTMLElement>("input, button")?.focus();
  }, [at.x, at.y]);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => addEventListener("mousedown", down));
    addEventListener("keydown", key);
    return () => {
      removeEventListener("mousedown", down);
      removeEventListener("keydown", key);
    };
  }, []);
  return (
    <div ref={ref} class="pop" role="dialog" aria-label={label} style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
      {children}
    </div>
  );
}

// ---------- app ----------

function App() {
  const [locale, setLocale] = useState(loadLocale);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    try { localStorage.setItem("language", locale); } catch {}
  }, [locale]);
  const [state, setState] = useState<State>({ state: "boot" });
  const [up, setUp] = useState(false);
  useEffect(
    () =>
      on((ev) => {
        if (ev.ev === "state") setState(ev);
        if (ev.ev === "socket") setUp(ev.up);
      }),
    [],
  );
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {state.state === "ready" || state.state === "kicked"
        ? <Shell me={state.state === "ready" ? state.me : null} kicked={state.state === "kicked"} up={up} />
        : <Login state={state} up={up} />}
    </LocaleContext.Provider>
  );
}

// ---------- login ----------

function Login({ state, up }: { state: State; up: boolean }) {
  const { t } = useLocale();
  useEffect(() => {
    if (up && (state.state === "logged_out" || state.state === "error")) call("login_qr").catch(() => {});
  }, [up, state.state]);
  useEffect(() => void (document.title = "Zalo Lite"), []);

  const qrSrc = state.state === "qr" ? (state.qr.startsWith("data:") ? state.qr : `data:image/png;base64,${state.qr}`) : "";
  return (
    <main class="login">
      <div class="login-card">
        <p class="brand">Zalo Lite</p>
        <p class="lead">{t("Đăng nhập tài khoản Zalo")}<br />{t("để kết nối với ứng dụng Zalo Lite")}</p>
        <h2>{t("Đăng nhập qua mã QR")}</h2>
        {state.state === "scanned" ? (
          <div class="scanned" aria-live="polite">
            <Avatar src={state.avatar} name={state.name} id={state.name} size={88} />
            <div class="who">{state.name}</div>
            <p class="note" style={{ margin: 0 }}>{t("Vui lòng xác nhận đăng nhập trên điện thoại của bạn.")}</p>
            <button class="btn ghost" onClick={() => call("login_qr")}>{t("Dùng tài khoản khác")}</button>
          </div>
        ) : (
          <>
            <div class="qr" aria-live="polite">
              {qrSrc ? <img src={qrSrc} alt={t("Mã QR đăng nhập")} /> : <div class="spin" role="status" aria-label={t("Đang tải mã QR")} />}
              {(state.state === "qr_expired" || state.state === "error" || !up) && (
                <div class="veil">
                  {!up ? (
                    <>
                      <div class="spin" style={{ margin: "0 auto" }} />
                      <span>{t("Đang khởi động…")}</span>
                    </>
                  ) : (
                    <>
                      <span>{state.state === "error" ? t("Không thể tạo mã QR") : t("Mã QR hết hạn")}</span>
                      <button class="btn" onClick={() => call("qr_retry")}>
                        <Icon name="refresh" size={18} />{" " + t("Lấy mã mới")}</button>
                    </>
                  )}
                </div>
              )}
            </div>
            <p class="note">{t("Mở ứng dụng Zalo trên điện thoại, chọn") + " "}<b>{t("Quét mã QR")}</b>{" " + t("và quét mã này để đăng nhập.")}</p>
          </>
        )}
      </div>
    </main>
  );
}

// ---------- shell ----------

type Typing = Record<string, { uid: string; until: number }>;

function Shell({ me, kicked, up }: { me: Me | null; kicked: boolean; up: boolean }) {
  const { locale, t } = useLocale();
  const [theme, setTheme] = useTheme();
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [limits, setLimits] = useState<Limits>({ maxFiles: 10, maxMB: 100 });
  const [active, setActive] = useState<string>("");
  const openRequest = useRef(0);
  const failedOpen = useRef("");
  const [msgs, setMsgs] = useState<Record<string, Msg[]>>({});
  const [typing, setTyping] = useState<Typing>({});
  const [view, setView] = useState<"chats" | "contacts">("chats");
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState<DOMRect | null>(null); // the gear menu, anchored to the gear button's box
  const [dialog, setDialog] = useState<null | "account" | { settings: string }>(null); // opened from the gear menu
  const gear = useRef<HTMLButtonElement>(null);
  const refocusGear = () => gear.current?.focus();
  const pickGear = (a: GearAction) => {
    setMenu(null);
    if (a === "account") setDialog("account");
    else if (a === "settings") setDialog({ settings: "general" });
    else if (a === "data-settings") setDialog({ settings: "data" });
    else {
      if (a === "sync") call("phone_sync").catch((e) => flash(e.message));
      else if (a === "logout") call("logout");
      else openExternal("https://github.com/kevkoa2106/zalo-lite/issues");
      refocusGear();
    }
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const meId = me?.id ?? "";
  // The live-event handler below is registered once, so it reads these through refs.
  const live = useRef({ meId, active: "", t: (s: string) => s });
  live.current = { meId, active, t };

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast((c) => (c === t ? "" : c)), 3000);
  };

  // Bootstrap and live events.
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!up || kicked) return;
    setLoadError("");
    call<{ threads: Thread[]; contacts: Contact[]; limits: Limits }>("bootstrap")
      .then((d) => {
        setThreads(Object.fromEntries(d.threads.map((t) => [t.id, t])));
        setContacts(d.contacts);
        if (d.limits) setLimits(d.limits);
        setLoaded(true);
      })
      .catch((e) => setLoadError(e.message));
  }, [up, kicked, attempt]);

  useEffect(
    () =>
      on((ev) => {
        switch (ev.ev) {
          case "threads":
            setThreads(Object.fromEntries((ev.threads as Thread[]).map((t) => [t.id, t])));
            setLoaded(true);
            break;
          case "thread":
            if (ev.thread) setThreads((s) => ({ ...s, [ev.thread.id]: ev.thread }));
            break;
          case "contacts":
            setContacts(ev.contacts);
            break;
          case "notice":
            flash(ev.text);
            break;
          case "msg": {
            const m = ev.msg as Msg;
            if (ev.thread) setThreads((s) => ({ ...s, [ev.thread.id]: ev.thread }));
            // OS notification for a new incoming message, unless you are looking at that chat right now.
            const L = live.current;
            if (ev.fresh && !m.undone && m.from !== L.meId && !(document.hasFocus() && m.threadId === L.active)) {
              const th = ev.thread as Thread | undefined;
              const name = th?.name ?? m.dName;
              const body = m.text || (th ? L.t(th.preview) : "");
              notify(th?.type === 1 && m.dName ? `${m.dName} · ${name}` : name, body.length > 120 ? `${body.slice(0, 119)}…` : body);
            }
            setMsgs((s) => (s[m.threadId] ? { ...s, [m.threadId]: upsert(s[m.threadId]!, m) } : s));
            setTyping((t) => (t[m.threadId]?.uid === m.from ? { ...t, [m.threadId]: { uid: "", until: 0 } } : t));
            break;
          }
          case "msgs": // background history sync: fill chats that are already loaded
            setMsgs((s) => {
              let next = s;
              for (const m of ev.msgs as Msg[]) if (next[m.threadId]) next = { ...next, [m.threadId]: upsert(next[m.threadId]!, m) };
              return next;
            });
            break;
          case "deleted":
            setMsgs((s) => (s[ev.threadId] ? { ...s, [ev.threadId]: s[ev.threadId]!.filter((m) => m.id !== ev.msgId) } : s));
            break;
          case "typing":
            setTyping((t) => ({ ...t, [ev.threadId]: { uid: ev.uid, until: Date.now() + 5000 } }));
            setTimeout(() => setTyping((t) => ({ ...t })), 5100);
            break;
        }
      }),
    [],
  );

  // Keep the open thread marked read as new messages land.
  useEffect(() => {
    const t = threads[active];
    if (t?.unread) {
      setThreads((s) => ({ ...s, [active]: { ...t, unread: 0 } }));
      call("open", { threadId: active, type: t.type, before: Number.MAX_SAFE_INTEGER, peek: true }).catch(() => {});
    }
  }, [threads[active]?.unread]);

  const totalUnread = Object.values(threads).reduce((n, t) => n + (t.unread ? 1 : 0), 0);
  useEffect(() => {
    document.title = `${totalUnread ? `(${totalUnread}) ` : ""}Zalo Lite${me ? ` - ${me.name}` : ""}`;
  }, [totalUnread, me?.name]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setView("chats");
        setTimeout(() => searchRef.current?.focus());
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) searchRef.current!.blur();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);

  const [jump, setJump] = useState<Hit | null>(null); // a message search result to open and scroll to

  async function open(id: string, type: 0 | 1, name?: string, avatar?: string) {
    setView("chats");
    if (id === active && failedOpen.current !== id) return;
    failedOpen.current = "";
    const request = ++openRequest.current;
    if (!threads[id])
      setThreads((s) => ({
        ...s,
        [id]: { id, type, name: name ?? id, avatar: avatar ?? "", unread: 0, lastTs: 0, preview: "", previewKind: "text", previewFrom: "", members: 0 },
      }));
    setActive(id);
    try {
      const r = await call<{ thread: Thread; messages: Msg[] }>("open", { threadId: id, type });
      if (request !== openRequest.current) return;
      setMsgs((s) => ({ ...s, [id]: r.messages }));
      setThreads((s) => ({ ...s, [id]: { ...(s[id] ?? r.thread), ...r.thread, unread: 0, name: r.thread.name !== id ? r.thread.name : (s[id]?.name ?? id) } }));
    } catch (e: any) {
      if (request !== openRequest.current) return;
      failedOpen.current = id;
      flash(e.message);
    }
  }

  const thread = threads[active];
  const typer = typing[active];
  const typingName = typer && typer.until > Date.now() && typer.uid ? (contacts.find((c) => c.id === typer.uid)?.name ?? thread?.name ?? "") : "";

  return (
    <div class="shell">
      <nav class="rail" aria-label={t("Điều hướng")}>
        <div class="me" title={me?.name}>
          <Avatar src={me?.avatar} name={me?.name ?? ""} id={meId} size={48} />
        </div>
        <button class="rail-btn" aria-label={t("Tin nhắn")} aria-current={view === "chats" ? "page" : undefined} onClick={() => setView("chats")}>
          <Icon name="chat" size={26} />
          {totalUnread > 0 && <span class="dot">{totalUnread > 5 ? "5+" : totalUnread}</span>}
        </button>
        <button class="rail-btn" aria-label={t("Danh bạ")} aria-current={view === "contacts" ? "page" : undefined} onClick={() => setView("contacts")}>
          <Icon name="contacts" size={26} />
        </button>
        <div class="spacer" />
        <button
          ref={gear}
          class="rail-btn"
          aria-label={t("Cài đặt")}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={() => setMenu(menu ? null : gear.current!.getBoundingClientRect())}
        >
          <Icon name="settings" size={26} />
        </button>
      </nav>

      {menu && <GearMenu anchor={menu} gear={gear.current} onClose={(refocus) => (setMenu(null), refocus && refocusGear())} onPick={pickGear} />}
      {dialog === "account" && <AccountCard onClose={() => setDialog(null)} returnFocus={refocusGear} />}
      {dialog && dialog !== "account" && <SettingsDialog tab={dialog.settings} onClose={() => setDialog(null)} returnFocus={refocusGear} flash={flash} theme={theme} setTheme={setTheme} />}

      <ConvList
        view={view}
        threads={threads}
        contacts={contacts}
        loaded={loaded}
        loadError={loadError}
        onRetry={() => setAttempt((n) => n + 1)}
        active={active}
        meId={meId}
        searchRef={searchRef}
        onOpen={open}
        onPick={(h) => (open(h.threadId, h.type), setJump(h))}
      />

      <section class="main" aria-label={t("Cuộc trò chuyện")}>
        {kicked && (
          <div class="banner warn" role="alert">{t("Tài khoản đang được dùng trên một máy tính hoặc trình duyệt khác.")}<button onClick={() => call("reconnect")}>{t("Kết nối lại")}</button>
          </div>
        )}
        {!up && <div class="banner" role="status">{t("Đang kết nối lại…")}</div>}
        {thread ? (
          <Chat
            key={thread.id}
            thread={thread}
            meId={meId}
            meName={me?.name ?? ""}
            messages={msgs[thread.id]}
            setMessages={(f) => setMsgs((s) => ({ ...s, [thread.id]: f(s[thread.id] ?? []) }))}
            typingName={typingName}
            friend={!!contacts.find((c) => c.id === thread.id)?.friend}
            limits={limits}
            flash={flash}
            jump={jump?.threadId === thread.id ? jump : null}
            onJumped={() => setJump(null)}
          />
        ) : (
          <div class="welcome">
            <h1>{t("Chào mừng đến với") + " "}<b>Zalo Lite</b>!</h1>
            <p>{t("Nhắn tin với người thân, bạn bè và đồng nghiệp ngay trên máy tính. Chọn một cuộc trò chuyện để bắt đầu.")}</p>
            <p class="hint">{t("Nhấn") + " "}<kbd>{isMac ? "⌘" : "Ctrl"} F</kbd>{" " + t("để tìm cuộc trò chuyện")}</p>
          </div>
        )}
      </section>
      {toast && <div class="toast" role="status">{localizeNotice(locale, toast)}</div>}
    </div>
  );
}

function upsert(list: Msg[], m: Msg) {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) return list.map((x, j) => (j === i ? { localPhotoBatch: x.localPhotoBatch, ...m } : x));
  const next = [...list, m];
  next.sort((a, b) => a.ts - b.ts);
  return next;
}

// ---------- conversation list ----------

function ConvList(p: {
  view: "chats" | "contacts";
  threads: Record<string, Thread>;
  contacts: Contact[];
  loaded: boolean;
  loadError: string;
  onRetry: () => void;
  active: string;
  meId: string;
  searchRef: { current: HTMLInputElement | null };
  onOpen: (id: string, type: 0 | 1, name?: string, avatar?: string) => void;
  onPick: (h: Hit) => void;
}) {
  const { locale, t } = useLocale();
  const [q, setQ] = useState("");
  // Message search (server op "search"): runs 250 ms after typing stops, for 2+ characters; the latest query wins.
  const [hits, setHits] = useState<{ q: string; list: Hit[] | null; err: string }>({ q: "", list: null, err: "" });
  useEffect(() => {
    const query = q.trim();
    if (fold(query).length < 2) return setHits({ q: "", list: null, err: "" });
    setHits((h) => ({ ...h, q: query, list: null, err: "" }));
    const timer = setTimeout(() => {
      call<Hit[]>("search", { q: query })
        .then((list) => setHits((h) => (h.q === query ? { q: query, list, err: "" } : h)))
        .catch((e) => setHits((h) => (h.q === query ? { q: query, list: [], err: e.message } : h)));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Most recent first, as in Zalo. My Documents stays listed even before its first message.
  const sorted = useMemo(
    () =>
      Object.values(p.threads)
        .filter((t) => t.lastTs > 0 || t.id === p.active)
        .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)),
    [p.threads, p.active, p.meId],
  );
  const fq = fold(q.trim());
  const shownThreads = fq ? sorted.filter((t) => fold(t.name).includes(fq)) : tab === "unread" ? sorted.filter((t) => t.unread) : sorted;
  const shownContacts = fq ? p.contacts.filter((c) => !p.threads[c.id]?.lastTs && fold(c.name).includes(fq)).slice(0, 30) : [];

  const head = (
    <div class="list-head">
      <div class="search-row">
        <label class="search">
          <Icon name="search" size={18} />
          <span class="sr">{t("Tìm kiếm")}</span>
          <input ref={p.searchRef} placeholder={t("Tìm kiếm")} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          {q && (
            <button class="icon-btn" style={{ width: "20px", height: "20px" }} aria-label={t("Xoá tìm kiếm")} onClick={() => setQ("")}>
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
      </div>
      {p.view === "chats" && !fq ? (
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>{t("Tất cả")}</button>
          <button class="tab" role="tab" aria-selected={tab === "unread"} onClick={() => setTab("unread")}>{t("Chưa đọc")}</button>
        </div>
      ) : (
        <div class="tabs">
          <span class="tab" aria-selected="true">{fq ? t("Kết quả tìm kiếm") : t("Danh bạ")}</span>
        </div>
      )}
    </div>
  );

  if (p.view === "contacts" && !fq) {
    const groups = p.contacts.filter((c) => c.type === 1).sort((a, b) => a.name.localeCompare(b.name, "vi"));
    const friends = p.contacts.filter((c) => c.type === 0 && c.friend).sort((a, b) => a.name.localeCompare(b.name, "vi"));
    return (
      <aside class="list" aria-label={t("Danh bạ")}>
        {head}
        <ul class="items">
          {!p.contacts.length && <li class="list-empty">{p.loaded ? t("Chưa có liên hệ nào") : t("Đang tải danh bạ…")}</li>}
          {friends.length > 0 && <li class="section-label">{t("Bạn bè (")}{friends.length})</li>}
          {friends.map((c) => <ContactRow c={c} onOpen={p.onOpen} />)}
          {groups.length > 0 && <li class="section-label">{t("Nhóm (")}{groups.length})</li>}
          {groups.map((c) => <ContactRow c={c} onOpen={p.onOpen} />)}
        </ul>
      </aside>
    );
  }

  return (
    <aside class="list" aria-label={t("Danh sách trò chuyện")}>
      {head}
      <ul class="items">
        {!p.loaded && p.loadError && (
          <li class="list-empty" role="alert">
            <strong>{t("Không tải được danh sách trò chuyện")}</strong>
            {localizeNotice(locale, p.loadError)}
            <button class="btn ghost" style={{ marginTop: "12px" }} onClick={p.onRetry}>
              <Icon name="refresh" size={18} />{" " + t("Thử lại")}</button>
          </li>
        )}
        {!p.loaded && !p.loadError &&
          Array.from({ length: 7 }, () => (
            <li class="skeleton" aria-hidden="true">
              <i style={{ width: "48px", height: "48px", borderRadius: "50%" }} />
              <span style={{ flex: 1, display: "grid", gap: "8px" }}>
                <i style={{ width: "55%", height: "12px" }} />
                <i style={{ width: "80%", height: "10px" }} />
              </span>
            </li>
          ))}
        {p.loaded && !shownThreads.length && !shownContacts.length && !hits.list?.length && !(hits.q && !hits.list) && (
          <li class="list-empty">
            {fq ? (
              <><strong>{t("Không tìm thấy kết quả")}</strong>{t("Thử tìm bằng tên khác.")}</>
            ) : tab === "unread" ? (
              <><strong>{t("Không có tin nhắn chưa đọc")}</strong>{t("Bạn đã xem hết tin nhắn.")}</>
            ) : (
              <><strong>{t("Chưa có cuộc trò chuyện")}</strong>{t("Tin nhắn mới sẽ xuất hiện ở đây. Mở Danh bạ để bắt đầu trò chuyện.")}</>
            )}
          </li>
        )}
        {fq && shownThreads.length > 0 && <li class="section-label">{t("Trò chuyện")}</li>}
        {shownThreads.map((thread) => (
          <li key={thread.id}>
            <button class={`item${thread.unread ? " unread" : ""}`} aria-current={thread.id === p.active} onClick={() => p.onOpen(thread.id, thread.type)}>
              <Avatar src={thread.avatar} name={thread.name} id={thread.id} />
              <span class="body">
                <span class="row">
                  <span class="name">{thread.name}</span>
                  {thread.lastTs > 0 && <span class="time">{ago(thread.lastTs, undefined, locale)}</span>}
                </span>
                <span class="row">
                  <span class="pv">
                    {thread.previewFrom && <span style={{ flex: "none" }}>
                      {(thread.previewMine ?? (thread.type === 0 && thread.previewFrom === "Bạn")) ? t("Bạn") : thread.previewFrom}:
                    </span>}
                    {PREVIEW_ICON[thread.previewKind] && <Icon name={PREVIEW_ICON[thread.previewKind]!} size={16} />}
                    <span>{thread.previewKind === "call" && /^\[.*\]$/.test(thread.preview)
                      ? `[${t(thread.preview.slice(1, -1))}]`
                      : thread.previewUndone || !["text", "link"].includes(thread.previewKind) ? t(thread.preview) : thread.preview}</span>
                  </span>
                  {thread.unread > 0 && <span class="badge" aria-label={t("{0} tin nhắn chưa đọc", [thread.unread])}>{thread.unread > 99 ? "99+" : thread.unread}</span>}
                </span>
              </span>
            </button>
          </li>
        ))}
        {shownContacts.length > 0 && <li class="section-label">{t("Liên hệ và nhóm")}</li>}
        {shownContacts.map((c) => <ContactRow c={c} onOpen={p.onOpen} />)}
        {hits.q && (shownThreads.length > 0 || shownContacts.length > 0 || !hits.list || hits.list.length > 0) && (
          <li class="section-label">{t("Tin nhắn")}</li>
        )}
        {hits.q && !hits.list && <li class="list-empty" role="status">{t("Đang tìm tin nhắn…")}</li>}
        {hits.err && <li class="list-empty" role="alert">{localizeNotice(locale, hits.err)}</li>}
        {hits.list && !hits.list.length && !hits.err && (shownThreads.length > 0 || shownContacts.length > 0) && (
          <li class="list-empty">{t("Không có tin nhắn phù hợp. Thử từ khoá khác hoặc gõ không dấu.")}</li>
        )}
        {hits.list?.map((h) => {
          const th = p.threads[h.threadId];
          const name = th?.name ?? h.dName;
          const who = h.from === p.meId ? t("Bạn") : h.dName || name;
          return (
            <li key={h.id}>
              <button class="item hit" onClick={() => p.onPick(h)}>
                <Avatar src={th?.avatar} name={name} id={h.threadId} size={40} />
                <span class="body">
                  <span class="row">
                    <span class="name">{name}</span>
                    <span class="time">{ago(h.ts, undefined, locale)}</span>
                  </span>
                  <span class="row">
                    <span class="pv">
                      <span style={{ flex: "none" }}>{who}:</span>
                      <span>{h.before}<mark>{h.hit}</mark>{h.after}</span>
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/** One message search result from the server (server/store.ts `search`): the hit with a little text around it. */
type Hit = { id: string; threadId: string; type: 0 | 1; from: string; dName: string; ts: number; before: string; hit: string; after: string };

function ContactRow({ c, onOpen }: { c: Contact; onOpen: (id: string, type: 0 | 1, name?: string, avatar?: string) => void }) {
  return (
    <li>
      <button class="item" style={{ height: "60px" }} onClick={() => onOpen(c.id, c.type, c.name, c.avatar)}>
        <Avatar src={c.avatar} name={c.name} id={c.id} size={40} />
        <span class="body"><span class="name">{c.name}</span></span>
      </button>
    </li>
  );
}

// ---------- chat ----------

type ChatProps = {
  jump?: Hit | null; // a search result to scroll to once the chat is loaded
  onJumped?: () => void;
  thread: Thread;
  meId: string;
  meName: string;
  messages: Msg[] | undefined;
  setMessages: (f: (m: Msg[]) => Msg[]) => void;
  typingName: string;
  friend: boolean;
  limits: Limits;
  flash: (t: string) => void;
};

function Chat({ thread, meId, meName, messages, setMessages, typingName, friend, limits, flash, jump, onJumped }: ChatProps) {
  const { locale, t } = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [more, setMore] = useState(true);
  // A first page shorter than a full page means there is nothing older to load.
  const sized = useRef(false);
  useEffect(() => {
    if (messages && !sized.current) {
      sized.current = true;
      setMore(messages.length >= 50);
    }
  }, [messages]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [viewer, setViewer] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const profilePress = useRef<HTMLElement | null>(null);
  const profileReturnFocus = useRef<HTMLElement | null>(null);
  const [members, setMembers] = useState<Record<string, { name: string; avatar: string }>>({});
  const prevHeight = useRef(0);

  useEffect(() => {
    if (thread.type !== 1) return;
    call<{ id: string; name: string; avatar: string }[]>("members", { threadId: thread.id })
      .then((ms) => setMembers(Object.fromEntries(ms.map((m) => [m.id, m]))))
      .catch(() => {});
  }, [thread.id]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = 0;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function older() {
    if (!messages?.length || loadingOlder || !more) return;
    setLoadingOlder(true);
    try {
      const r = await call<{ messages: Msg[] }>("open", { threadId: thread.id, type: thread.type, before: messages[0]!.ts });
      if (!scroller.current) return;
      if (r.messages.length < 50) setMore(false);
      prevHeight.current = scroller.current.scrollHeight;
      setMessages((cur) => [...r.messages.filter((m) => !cur.some((c) => c.id === m.id)), ...cur]);
    } finally {
      setLoadingOlder(false);
    }
  }

  // Scroll to the message a reply quotes, loading older pages until it turns up (at most 20 pages, 1,000 messages).
  async function jumpTo(q: NonNullable<Msg["quote"]>) {
    let have = messages ?? [];
    let target = findQuoted(have, q);
    let moreLeft = more;
    const loaded: Msg[] = [];
    for (let n = 0; !target && moreLeft && n < 100; n++) { // 100 pages = 5,000 messages, the largest per-chat cache
      const r = await call<{ messages: Msg[] }>("open", { threadId: thread.id, type: thread.type, before: have[0]!.ts }).catch(() => null);
      if (!r) break;
      if (r.messages.length < 50) moreLeft = false;
      const fresh = r.messages.filter((m) => !have.some((c) => c.id === m.id));
      if (!fresh.length) break;
      loaded.unshift(...fresh);
      have = [...fresh, ...have];
      target = findQuoted(have, q);
    }
    if (!target) return flash(t("Không tìm thấy tin nhắn gốc, có thể đã cũ hơn bộ nhớ của ứng dụng"));
    stick.current = false;
    if (loaded.length) {
      setMore(moreLeft);
      setMessages((cur) => [...loaded.filter((m) => !cur.some((c) => c.id === m.id)), ...cur]);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // let the new rows render first
    }
    const row = scroller.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(target.id)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const bubble = row.querySelector(".bubble");
    bubble?.classList.add("flash");
    setTimeout(() => bubble?.classList.remove("flash"), 1500);
  }

  // A message search result picked in the list: scroll to it once this chat's messages are here.
  useEffect(() => {
    if (!jump || messages === undefined) return;
    onJumped?.();
    jumpTo({ id: jump.id, ts: jump.ts, from: jump.from, dName: "", text: "" });
  }, [jump, messages === undefined]);

  function onScroll() {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60) older();
  }

  // "Sending" bubbles for media. Zalo returns the sent ids; each bubble then takes its real id, so the
  // listener's echo of the same message replaces it instead of duplicating it. On failure it stays,
  // marked failed, with retry and remove.
  const retries = useRef(new Map<string, () => void>());
  function pendingBubble(kind: Msg["kind"], attach: Record<string, any>, text = ""): Msg {
    return {
      id: `tmp-${crypto.randomUUID()}`, cliMsgId: "", threadId: thread.id, type: thread.type, from: meId, dName: meName,
      ts: Date.now(), kind, text, attach, undone: false, reactions: {}, quote: null, pending: true,
    };
  }
  function settle(tmpIds: string[], msgIds: string[]) {
    setMessages((list) =>
      tmpIds.reduce((next, tid, i) => {
        const real = msgIds[i];
        const localPhotoBatch = next.find((x) => x.id === tid)?.localPhotoBatch;
        if (real && next.some((x) => x.id === real)) {
          // The echo can arrive before the send reply identifies the matching pending photo.
          return next.filter((x) => x.id !== tid).map((x) => x.id === real && localPhotoBatch ? { ...x, localPhotoBatch } : x);
        }
        return next.map((x) => (x.id === tid ? { ...x, id: real ?? x.id, pending: false } : x));
      }, list),
    );
  }
  function fail(tmpIds: string[], retry: () => void, err: string) {
    tmpIds.forEach((id) => retries.current.set(id, retry));
    setMessages((list) => list.map((x) => (tmpIds.includes(x.id) ? { ...x, pending: false, failed: true } : x)));
    flash(err);
  }

  async function sendFiles(files: File[], text: string) {
    const over = files.find((f) => f.size > limits.maxMB * 1024 * 1024);
    if (over) return flash(t('"{0}" vượt quá giới hạn {1} MB của Zalo', [over.name, limits.maxMB]));
    if (files.length > limits.maxFiles) return flash(t("Chỉ gửi được tối đa {0} file mỗi lần", [limits.maxFiles]));
    const tmps = files.map((f) =>
      f.type.startsWith("image/")
        ? pendingBubble("photo", { thumb: URL.createObjectURL(f), local: true })
        : pendingBubble("file", { title: f.name, params: { fileSize: f.size, fileExt: f.name.split(".").pop() }, local: true }),
    );
    const batchId = crypto.randomUUID();
    const photos = tmps.filter((m, i) => m.kind === "photo" && /\.(jpe?g|png|webp)$/i.test(files[i]!.name || "image.png"));
    if (photos.length > 1) photos.forEach((m, index) => { m.localPhotoBatch = { id: batchId, index }; });
    setMessages((m) => [...m, ...tmps]);
    const ids = tmps.map((t) => t.id);
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name || "image.png", b64: await toB64(f) })));
      const r = await call<{ msgIds: string[] }>("files", { threadId: thread.id, type: thread.type, files: payload, text });
      settle(ids, r.msgIds);
    } catch (e: any) {
      fail(ids, () => (dismiss(ids), sendFiles(files, text)), t("Gửi file thất bại: {0}", [localizeNotice(locale, e.message)]));
    }
  }

  async function sendSticker(s: Sticker) {
    stick.current = true;
    const tmp = pendingBubble("sticker", { id: s.id, url: s.url });
    setMessages((m) => [...m, tmp]);
    try {
      const r = await call<{ msgIds: string[] }>("sticker", { threadId: thread.id, type: thread.type, sticker: s });
      settle([tmp.id], r.msgIds);
    } catch (e: any) {
      fail([tmp.id], () => (dismiss([tmp.id]), sendSticker(s)), t("Gửi sticker thất bại: {0}", [localizeNotice(locale, e.message)]));
    }
  }

  async function sendVoice(blob: Blob, ms: number) {
    if (blob.size > limits.maxMB * 1024 * 1024) return flash(t("Tin nhắn thoại vượt quá giới hạn {0} MB của Zalo", [limits.maxMB]));
    stick.current = true;
    const url = URL.createObjectURL(blob);
    const tmp = pendingBubble("voice", { href: url, params: { duration: ms, m4a: url }, local: true });
    setMessages((m) => [...m, tmp]);
    try {
      const r = await call<{ msgIds: string[] }>("voice", { threadId: thread.id, type: thread.type, b64: await toB64(blob), ext: voiceExt(blob.type) });
      settle([tmp.id], r.msgIds);
    } catch (e: any) {
      fail([tmp.id], () => (dismiss([tmp.id]), sendVoice(blob, ms)), t("Gửi tin nhắn thoại thất bại: {0}", [localizeNotice(locale, e.message)]));
    }
  }

  function dismiss(ids: string[]) {
    setMessages((list) =>
      list.filter((x) => {
        if (!ids.includes(x.id)) return true;
        if (x.attach?.local && x.attach.thumb) URL.revokeObjectURL(x.attach.thumb);
        if (x.attach?.local && x.attach.href?.startsWith("blob:")) URL.revokeObjectURL(x.attach.href);
        retries.current.delete(x.id);
        return false;
      }),
    );
  }

  async function send(text: string, files: File[]) {
    stick.current = true;
    const quote = replyTo;
    setReplyTo(null);
    if (files.length) return sendFiles(files, text);
    const tmp: Msg = {
      id: `tmp-${Date.now()}`, cliMsgId: "", threadId: thread.id, type: thread.type, from: meId, dName: meName, ts: Date.now(),
      kind: "text", text, attach: null, undone: false, reactions: {}, pending: true,
      quote: quote ? { from: quote.from, dName: quote.dName, text: quote.text || "Tin nhắn", placeholder: !quote.text } : null,
    };
    setMessages((m) => [...m, tmp]);
    try {
      const saved = await call<Msg>("send", { threadId: thread.id, type: thread.type, text, quoteId: quote?.id });
      setMessages((m) => (saved && !m.some((x) => x.id === saved.id) ? m.map((x) => (x.id === tmp.id ? saved : x)) : m.filter((x) => x.id !== tmp.id)));
    } catch (e: any) {
      fail([tmp.id], () => (dismiss([tmp.id]), send(text, [])), t("Không gửi được tin nhắn: {0}", [localizeNotice(locale, e.message)]));
    }
  }

  const nameOf = (uid: string, fallback: string) => (uid === meId ? meName : members[uid]?.name || fallback || uid);
  const avatarOf = (uid: string) => (thread.type === 0 && uid === thread.id ? thread.avatar : members[uid]?.avatar ?? "");
  const profileTrigger = (target: Person) => /^\d{1,32}$/.test(target.id) && target.id !== "0" && target.id !== meId ? {
    "data-profile-trigger": "",
    onPointerDown: (e: PointerEvent) => {
      profilePress.current = e.pointerType === "mouse" && e.button === 0 ? e.currentTarget as HTMLElement : null;
      if (profilePress.current) profileReturnFocus.current = document.activeElement as HTMLElement | null;
    },
    onClick: (e: MouseEvent) => {
      if (e.detail > 0 && profilePress.current === e.currentTarget) setPerson(target);
      profilePress.current = null;
    },
  } : {};
  const directProfile = thread.type === 0 ? profileTrigger({ id: thread.id, name: thread.name, avatar: thread.avatar }) : {};

  // Group runs of messages by the same sender within 5 minutes, with a pill at each new day and after every long pause.
  const blocks = useMemo(() => {
    const out: ({ day: string } | { from: string; dName: string; items: Msg[][] })[] = [];
    let lastDay = "";
    let lastTs = 0;
    for (const photos of groupPhotos(messages ?? [])) {
      const m = photos[0]!;
      const d = day(m.ts, undefined, locale);
      if (d !== lastDay) out.push({ day: (lastDay = d) });
      else if (isGap(lastTs, m.ts)) out.push({ day: gapLabel(m.ts, undefined, locale) });
      lastTs = m.ts;
      const prev = out[out.length - 1];
      if (prev && "items" in prev && prev.from === m.from && m.ts - prev.items.at(-1)![0]!.ts < 300000) prev.items.push(photos);
      else out.push({ from: m.from, dName: m.dName, items: [photos] });
    }
    return out;
  }, [messages, locale]);

  const bubble = (m: Msg, last: boolean) => (
    <Bubble
      key={m.id}
      m={m}
      mine={m.from === meId}
      last={last}
      meId={meId}
      onReply={() => setReplyTo(m)}
      onView={setViewer}
      onJump={jumpTo}
      flash={flash}
      onRetry={retries.current.get(m.id)}
      onDismiss={() => dismiss([m.id])}
    />
  );

  return (
    <>
      <header class="chat-head">
        <span {...directProfile}><Avatar src={thread.avatar} name={thread.name} id={thread.id} size={44} /></span>
        <div class="title">
          <h2 class="profile-name" {...directProfile}>{thread.name}</h2>
          <div class="sub">
            {thread.type === 1 ? (
              <><Icon name="contacts" size={15} /> {thread.members || Object.keys(members).length || ""}{" " + t("thành viên")}</>
            ) : friend ? (
              t("Bạn bè")
            ) : (
              t("Người lạ")
            )}
          </div>
        </div>
      </header>

      {/* Images load after the first scroll and grow the list; re-pin to the bottom on each load unless the user scrolled up. */}
      <div class="messages" ref={scroller} onScroll={onScroll} onLoadCapture={() => stick.current && (scroller.current!.scrollTop = scroller.current!.scrollHeight)} role="log" aria-live="polite" aria-label={t("Tin nhắn với {0}", [thread.name])}>
        {messages === undefined && <div class="spin" style={{ margin: "40px auto" }} role="status" aria-label={t("Đang tải tin nhắn")} />}
        {messages?.length === 0 && (
          <div class="list-empty">
            <strong>{t("Chưa có tin nhắn")}</strong>
            {thread.type === 0 ? t("Tin nhắn cũ hơn chỉ có trên điện thoại. Tin nhắn mới sẽ được lưu ở đây.") : t("Nhóm chưa có tin nhắn nào.")}
          </div>
        )}
        {messages && messages.length > 0 && more && (
          <button class="older" onClick={older} disabled={loadingOlder}>
            {loadingOlder ? t("Đang tải…") : t("Xem tin nhắn cũ hơn")}
          </button>
        )}
        {blocks.map((b) => {
          if ("day" in b) return <div class="day"><span>{b.day}</span></div>;
          const sender = { id: b.from, name: nameOf(b.from, b.dName), avatar: avatarOf(b.from) };
          const trigger = thread.type === 1 ? profileTrigger(sender) : {};
          return (
            <div class={`group${b.from === meId ? " me" : ""}`}>
              {b.from !== meId && (
                <div class="gutter">
                  <span {...trigger}><Avatar src={sender.avatar} name={sender.name} id={b.from} size={36} /></span>
                </div>
              )}
              <div class="stack">
                {thread.type === 1 && b.from !== meId && <div class="sender"><span {...trigger}>{sender.name}</span></div>}
                {b.items.map((items, i) => {
                  const last = i === b.items.length - 1;
                  if (items.length === 1) return bubble(items[0]!, last);
                  const cols = items.length === 4 ? 2 : 3;
                  return (
                    <div class="photo-group" key={items[0]!.id}>
                      {Array.from({ length: Math.ceil(items.length / cols) }, (_, row) => (
                        <div class="photo-row" key={row}>
                          {items.slice(row * cols, (row + 1) * cols).map((m, j) => bubble(m, last && row * cols + j === items.length - 1))}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div class="typing" aria-live="polite">
        {typingName && (
          <>
            <span class="dots"><i /><i /><i /></span> {thread.type === 1 ? t("{0} đang soạn tin…", [typingName]) : t("Đang soạn tin…")}
          </>
        )}
      </div>
      <Composer thread={thread} replyTo={replyTo} replyName={replyTo ? nameOf(replyTo.from, replyTo.dName) : ""} cancelReply={() => setReplyTo(null)} onSend={send} onSticker={sendSticker} onVoice={sendVoice} flash={flash} />
      {person && <PersonCard person={person} onClose={() => setPerson(null)} returnFocus={() => profileReturnFocus.current?.focus()} />}
      {viewer && (
        <div class="viewer" role="dialog" aria-label={t("Xem ảnh")} tabIndex={-1} onClick={() => setViewer("")} onKeyDown={(e) => e.key === "Escape" && setViewer("")} ref={(el) => el?.focus()}>
          <img src={viewer} alt="" />
        </div>
      )}
    </>
  );
}

const toB64 = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;
function Linkified({ text, mentions }: { text: string; mentions?: Mention[] }) {
  return (
    <>
      {splitMentions(text, mentions).map((p) =>
        p.mention ? (
          <span class="mention">{p.text}</span>
        ) : (
          p.text.split(URL_RE).map((s, i) =>
            i % 2 ? (
              <a href={s} onClick={(e) => (e.preventDefault(), openExternal(s))}>{s}</a>
            ) : (
              s
            ),
          )
        ),
      )}
    </>
  );
}

let stopPlaying: (() => void) | null = null; // one voice message plays at a time
let audioCtx: AudioContext | null = null;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Fetch and decode a voice message. Zalo's files come through the backend (server/media.ts); our own recording is a blob: URL. */
async function loadVoice(src: string) {
  const bytes = src.startsWith("blob:")
    ? await (await fetch(src)).arrayBuffer()
    : await call<{ b64: string }>("media", { url: src }).then((r) => Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0)).buffer);
  audioCtx ??= new AudioContext();
  return new Promise<AudioBuffer>((res, rej) => audioCtx!.decodeAudioData(bytes, res, rej));
}

/** Length of a recording in seconds, or null when the webview cannot decode it (then it is not checked). */
async function decodedSeconds(blob: Blob) {
  try {
    audioCtx ??= new AudioContext();
    return (await audioCtx.decodeAudioData(await blob.arrayBuffer())).duration;
  } catch {
    return null;
  }
}

/** Loudness of `n` equal slices of the clip, for the waveform of messages that carry none (ours). */
function peaks(b: AudioBuffer, n = 24) {
  const d = b.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / n));
  return Array.from({ length: n }, (_, i) => {
    let m = 0;
    for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(d[j]!));
    return m;
  });
}

// A voice message as Zalo PC shows it: round play button, waveform that fills as it plays, and the length.
// Zalo's params carry the audio (`m4a`, an .aac file; older messages only have an .amr `href`), `duration` in ms and a short waveform.
// The audio is decoded in the page (WebAudio) so it plays the same in every webview, whatever type the file host reports.
// Zalo deletes old voice files; those show as expired.
function Voice({ a, flash }: { a: Record<string, any>; flash: (t: string) => void }) {
  const { t } = useLocale();
  const p = (a.params ?? {}) as { duration?: number; m4a?: string; waveformSamples?: number[] };
  const src = String(p.m4a || a.href || "");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "gone">("idle");
  const [total, setTotal] = useState(Number(p.duration) || 0); // ms
  const [wave, setWave] = useState<number[] | null>(null);
  const [on, setOn] = useState(false);
  const [at, setAt] = useState(0); // ms played
  const clip = useRef<{ buf: AudioBuffer; node: AudioBufferSourceNode | null; started: number; offset: number; raf: number } | null>(null);
  const bars = useMemo(() => {
    const w = p.waveformSamples?.length ? p.waveformSamples : wave ?? Array(24).fill(1);
    const hi = Math.max(...w, 1);
    return w.map((v) => Math.max(0.15, v / hi));
  }, [a, wave]);

  function pause() {
    const c = clip.current;
    if (!c?.node) return;
    c.offset = audioCtx!.currentTime - c.started;
    const n = c.node;
    c.node = null; // so its onended is not taken for the end of the clip
    n.stop();
    cancelAnimationFrame(c.raf);
    setOn(false);
    if (stopPlaying === pause) stopPlaying = null;
  }
  useEffect(() => () => pause(), []);

  async function play() {
    const c = clip.current!;
    await audioCtx!.resume();
    stopPlaying?.();
    const node = audioCtx!.createBufferSource();
    node.buffer = c.buf;
    node.connect(audioCtx!.destination);
    node.onended = () => {
      if (c.node !== node) return;
      c.node = null;
      c.offset = 0;
      cancelAnimationFrame(c.raf);
      setOn(false);
      setAt(0);
      if (stopPlaying === pause) stopPlaying = null;
    };
    c.node = node;
    c.started = audioCtx!.currentTime - c.offset;
    node.start(0, c.offset);
    const tick = () => {
      setAt((audioCtx!.currentTime - c.started) * 1000);
      c.raf = requestAnimationFrame(tick);
    };
    tick();
    stopPlaying = pause;
    setOn(true);
  }

  async function toggle() {
    if (on) return pause();
    if (!clip.current) {
      setState("loading");
      try {
        const buf = await loadVoice(src);
        clip.current = { buf, node: null, started: 0, offset: 0, raf: 0 };
        setTotal(buf.duration * 1000);
        if (!p.waveformSamples?.length) setWave(peaks(buf));
        setState("ready");
      } catch (e: any) {
        const gone = /hết hạn/.test(e?.message ?? "");
        setState(gone ? "gone" : "idle");
        return flash(gone ? e.message : e?.message || t("Không phát được tin nhắn thoại"));
      }
    }
    play();
  }

  const done = total ? at / total : 0;
  return (
    <div class={`voice${state === "gone" ? " gone" : ""}`}>
      <button class="voice-btn" onClick={toggle} disabled={state === "gone" || state === "loading"} aria-label={state === "gone" ? t("Tin nhắn thoại đã hết hạn") : on ? t("Tạm dừng") : t("Phát tin nhắn thoại")}>
        {state === "loading" ? <span class="spin" /> : <Icon name={on ? "pause" : "play"} size={16} />}
      </button>
      <span class="wave" aria-hidden="true">
        {bars.map((h, i) => <i class={i / bars.length < done ? "on" : ""} style={{ height: `${h * 100}%` }} />)}
      </span>
      <span class="vtime">{state === "gone" ? t("Đã hết hạn") : total ? mmss(on || at ? at : total) : ""}</span>
    </div>
  );
}


function Bubble({ m, mine, last, meId, onReply, onView, onJump, flash, onRetry, onDismiss }: {
  m: Msg; mine: boolean; last: boolean; meId: string; onReply: () => void; onView: (src: string) => void; onJump: (q: NonNullable<Msg["quote"]>) => void;
  flash: (t: string) => void; onRetry?: () => void; onDismiss?: () => void;
}) {
  const { locale, t } = useLocale();
  const [pop, setPop] = useState<null | { kind: "react" | "more"; x: number; y: number }>(null);
  const a = m.attach ?? {};
  const params = (a.params ?? {}) as Record<string, any>;
  const reactions = Object.entries(m.reactions);
  const icons = [...new Set(reactions.map(([, r]) => r))].slice(0, 3);
  const meta = last && <span class="meta">{clock(m.ts)}{m.pending ? t(" · Đang gửi") : m.failed ? t(" · Gửi lỗi") : ""}</span>;

  let body: any;
  let bare = false;
  if (m.undone) body = <>{t("Tin nhắn đã được thu hồi")}{meta}</>;
  else
    switch (m.kind) {
      case "photo": {
        const src = String(params.hd || a.href || a.thumb || "");
        bare = !m.text;
        body = (
          <>
            <button class="photo" onClick={() => onView(src)} aria-label={t("Xem ảnh")}>
              <img src={String(a.thumb || a.href)} alt={m.text || t("Hình ảnh")} width={params.width} height={params.height} loading="lazy" />
            </button>
            {m.text && <div style={{ marginTop: "6px" }}><Linkified text={m.text} mentions={m.mentions} /></div>}
            {!bare && meta}
          </>
        );
        break;
      }
      case "sticker":
        bare = true;
        body = (
          <span class="sticker">
            {a.url && !a.missing ? (
              <img
                src={String(a.url)}
                alt="Sticker"
                loading="lazy"
                onError={(e) => e.currentTarget.replaceWith(Object.assign(document.createElement("span"), { className: "sticker-missing", textContent: "Sticker" }))}
              />
            ) : a.missing ? (
              <span class="sticker-missing">Sticker</span>
            ) : (
              <span class="sticker-loading" role="status" aria-label={t("Đang tải sticker")} />
            )}
          </span>
        );
        break;
      case "gif":
        bare = true;
        body = <img class="photo" src={String(a.href || a.thumb)} alt="GIF" style={{ maxWidth: "260px" }} loading="lazy" />;
        break;
      case "video":
        bare = true;
        body = <video class="vid" src={String(a.href)} poster={String(a.thumb || "")} controls preload="none" />;
        break;
      case "voice":
        body = <><Voice a={a} flash={flash} />{meta}</>;
        break;
      case "file": {
        const ext = String(params.fileExt || String(a.title ?? "").split(".").pop() || "file").slice(0, 4);
        body = (
          <>
            <a class="filecard" href={String(a.href)} onClick={(e) => (e.preventDefault(), openExternal(String(a.href)))}>
              <span class="ext">{ext}</span>
              <span class="fbody">
                <span class="fname" style={{ display: "block" }}>{String(a.title ?? "File")}</span>
                <span class="fsize">{size(Number(params.fileSize))}</span>
              </span>
              <Icon name="download" size={20} />
            </a>
            {meta}
          </>
        );
        break;
      }
      case "link":
        body = (
          <>
            <span class="linkcard">
              {a.thumb && <img src={String(a.thumb)} alt="" loading="lazy" />}
              {a.title && a.title !== a.href && <span class="ltitle">{String(a.title)}</span>}
              {a.description && <span class="ldesc">{String(a.description)}</span>}
              <a href={String(a.href)} onClick={(e) => (e.preventDefault(), openExternal(String(a.href)))}>{String(a.href)}</a>
            </span>
            {meta}
          </>
        );
        break;
      case "call": {
        // The card is its own surface, like Zalo's: centred title and detail, a full-width "Gọi lại" row, and the time outside it.
        const c = a.call as { title: string; detail: string; tone: "ok" | "missed" | "rejected"; video: boolean; callback: boolean } | undefined;
        bare = true;
        body = (
          <>
            <span class={`callcard ${c?.tone ?? "ok"}`}>
              <b class="ctitle">{t(c?.title || m.text || "Cuộc gọi")}</b>
              <span class="cdetail">
                <Icon name={c?.tone === "missed" ? "phoneMissed" : c?.tone === "rejected" ? "phoneRejected" : "phoneIn"} size={20} />
                {c?.detail && (locale === "en"
                  ? t(c.detail).replace(/(\d+) giờ/g, "$1h").replace(/(\d+) phút/g, "$1m").replace(/(\d+) giây/g, "$1s")
                  : c.detail)}
              </span>
              {c?.callback !== false && (
                <button class="callback" onClick={() => flash(t("Zalo Lite chưa hỗ trợ gọi, hãy gọi bằng Zalo trên điện thoại"))}>{t("Gọi lại")}</button>
              )}
            </span>
            <span class="calltime">{clock(m.ts)}</span>
          </>
        );
        break;
      }
      case "other":
        body = <><i>{t("Tin nhắn này chưa được hỗ trợ hiển thị.")}</i>{meta}</>;
        break;
      default:
        body = <><Linkified text={m.text} mentions={m.mentions} />{meta}</>;
    }

  const openPop = (kind: "react" | "more") => (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPop({ kind, x: r.left, y: r.bottom + 6 });
  };
  const act = (op: string, args: Record<string, unknown> = {}) => {
    setPop(null);
    call(op, { msgId: m.id, ...args }).catch((e) => flash(e.message));
  };
  const canAct = !m.pending && !m.failed && !m.id.startsWith("tmp-");

  return (
    <div class={`msg${reactions.length ? " has-reacts" : ""}`} data-id={m.id}>
      <div class={`bubble${bare ? " bare" : ""}${m.undone ? " recalled" : ""}${m.pending ? " pending" : ""}${m.failed ? " failed" : ""}`}>
        {m.quote && !m.undone && (
          // Clickable only when the quote says which message it quotes; backup-imported replies carry no id.
          <span
            class={`quote${m.quote.id || m.quote.ts ? " jump" : ""}`}
            {...(m.quote.id || m.quote.ts
              ? {
                  role: "button",
                  tabIndex: 0,
                  title: t("Đi tới tin nhắn gốc"),
                  onClick: () => onJump(m.quote!),
                  onKeyDown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onJump(m.quote!)),
                }
              : {})}
          >
            <b>{m.quote.dName || t("Tin nhắn")}</b><span>{m.quote.placeholder ? t(m.quote.text) : m.quote.text}</span>
          </span>
        )}
        {body}
        {reactions.length > 0 && (
          <span class="reacts" title={reactions.map(([, r]) => EMOJI[r] ?? r).join(" ")}>
            {icons.map((r) => <span>{EMOJI[r] ?? "👍"}</span>)}
            {reactions.length > 1 && <span class="n">{reactions.length}</span>}
          </span>
        )}
      </div>
      {m.failed && (
        <div class="failed-actions">
          {onRetry && <button onClick={onRetry}><Icon name="refresh" size={15} />{" " + t("Thử lại")}</button>}
          {onDismiss && <button onClick={onDismiss}><Icon name="close" size={15} />{" " + t("Xoá")}</button>}
        </div>
      )}
      {canAct && !m.undone && (
        <div class={`tools${pop ? " open" : ""}`}>
          <button class="icon-btn" aria-label={t("Thả cảm xúc")} onClick={openPop("react")}><Icon name="smile" size={16} /></button>
          <button class="icon-btn" aria-label={t("Trả lời")} onClick={onReply}><Icon name="reply" size={16} /></button>
          <button class="icon-btn" aria-label={t("Thêm")} aria-haspopup="menu" onClick={openPop("more")}><Icon name="more" size={16} /></button>
        </div>
      )}
      {pop?.kind === "react" && (
        <Popover at={pop} onClose={() => setPop(null)} label={t("Chọn cảm xúc")}>
          <div class="emoji-row">
            {REACTIONS.map(([code, e]) => (
              <button aria-label={t("Thả {0}", [e])} aria-pressed={m.reactions[meId] === code} onClick={() => act("react", { icon: code })}>{e}</button>
            ))}
          </div>
        </Popover>
      )}
      {pop?.kind === "more" && (
        <Popover at={pop} onClose={() => setPop(null)} label={t("Tuỳ chọn tin nhắn")}>
          <div class="menu" role="menu">
            {m.text && (
              <button role="menuitem" onClick={() => (setPop(null), navigator.clipboard.writeText(m.text), flash(t("Đã sao chép")))}>
                <Icon name="copy" size={18} />{" " + t("Sao chép tin nhắn")}</button>
            )}
            <button role="menuitem" onClick={() => (setPop(null), onReply())}><Icon name="reply" size={18} />{" " + t("Trả lời")}</button>
            <hr />
            {mine && (
              <button role="menuitem" class="danger" onClick={() => act("undo")}><Icon name="undo" size={18} />{" " + t("Thu hồi")}</button>
            )}
            <button role="menuitem" class="danger" onClick={() => act("delete")}><Icon name="trash" size={18} />{" " + t("Xoá chỉ ở phía tôi")}</button>
          </div>
        </Popover>
      )}
    </div>
  );
}

// ---------- composer ----------

type Pack = { id: number; name: string; icon: string };
const RECENT = -1;
// Pack lists and pack contents survive closing the picker for the rest of the session.
const packCache: { packs?: Pack[]; stickers: Map<number, Sticker[]> } = { stickers: new Map() };

// Zalo's sticker panel: your packs as tabs along the bottom ("Gần đây" first), search on top.
function StickerPicker({ at, onPick, onClose }: { at: { x: number; y: number }; onPick: (s: Sticker) => void; onClose: () => void }) {
  const { t } = useLocale();
  const [q, setQ] = useState("");
  const [packs, setPacks] = useState<Pack[] | null>(packCache.packs ?? null);
  const [tab, setTab] = useState(RECENT);
  const [items, setItems] = useState<Sticker[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (packCache.packs) return;
    call<Pack[]>("stickerPacks")
      .then((p) => setPacks((packCache.packs = p)))
      .catch((e) => (setPacks([]), setError(e.message)));
  }, []);

  useEffect(() => {
    let live = true;
    setError("");
    const cached = !q && tab !== RECENT ? packCache.stickers.get(tab) : undefined;
    setItems(cached ?? null);
    if (cached) return;
    const t = setTimeout(
      () =>
        (q ? call<Sticker[]>("stickers", { q }) : tab === RECENT ? call<Sticker[]>("stickers", { q: "" }) : call<Sticker[]>("stickerPack", { id: tab }))
          .then((s) => {
            if (!q && tab !== RECENT) packCache.stickers.set(tab, s);
            if (live) setItems(s);
          })
          .catch((e) => live && (setItems([]), setError(e.message))),
      q ? 300 : 0,
    );
    return () => ((live = false), clearTimeout(t));
  }, [q, tab]);

  // With no recent stickers yet, open on the first pack instead of an empty tab.
  useEffect(() => {
    if (tab === RECENT && !q && items?.length === 0 && !error && packs?.length) setTab(packs[0]!.id);
  }, [items, packs]);

  const current = packs?.find((p) => p.id === tab);
  const empty = error
    ? t("Không tải được sticker: {0}", [error])
    : q
      ? t("Không tìm thấy sticker")
      : tab === RECENT
        ? t("Chưa dùng sticker nào")
        : t("Bộ sticker này trống");
  return (
    <Popover at={at} onClose={onClose} label="Sticker">
      <div class="stickers">
        <label class="search">
          <Icon name="search" size={16} />
          <span class="sr">{t("Tìm sticker")}</span>
          <input placeholder={t("Tìm sticker")} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        </label>
        <div class="section-label">{q ? t("Kết quả tìm kiếm") : tab === RECENT ? t("Gần đây") : current?.name || "Sticker"}</div>
        <div class="sticker-grid">
          {items === null && Array.from({ length: 8 }, () => <i class="sticker-loading" aria-hidden="true" />)}
          {items?.map((s) => (
            <button aria-label={t("Gửi sticker")} onClick={() => (onPick(s), onClose())}>
              <img src={s.url} alt="" loading="lazy" />
            </button>
          ))}
          {items?.length === 0 && <p class="sticker-empty">{empty}</p>}
        </div>
        {!q && (
          <div class="pack-tabs" role="tablist" aria-label={t("Bộ sticker")}>
            <button role="tab" aria-selected={tab === RECENT} title={t("Gần đây")} aria-label={t("Gần đây")} onClick={() => setTab(RECENT)}>
              <Icon name="clock" size={22} />
            </button>
            {packs === null && <i class="sticker-loading pack-loading" aria-hidden="true" />}
            {packs?.map((p) => (
              <button role="tab" aria-selected={tab === p.id} title={p.name} aria-label={p.name || t("Bộ sticker {0}", [p.id])} onClick={() => setTab(p.id)}>
                {p.icon ? <img src={p.icon} alt="" loading="lazy" /> : <span class="pack-initial">{initials(p.name || "S")}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}

// Object URL for a staged image, released when the preview goes away.
function Thumb({ file }: { file: File }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return src ? <img class="thumb" src={src} alt="" /> : null;
}

const MAX_VOICE_MS = 5 * 60 * 1000;

function Composer({ thread, replyTo, replyName, cancelReply, onSend, onSticker, onVoice, flash }: {
  thread: Thread; replyTo: Msg | null; replyName: string; cancelReply: () => void; onSend: (text: string, files: File[]) => void;
  onSticker: (s: Sticker) => void; onVoice: (blob: Blob, ms: number) => void; flash: (t: string) => void;
}) {
  const { t } = useLocale();
  const [text, setText] = useState("");
  // Voice recording: the mic button starts it, the bin discards it, the send button stops it and sends the clip.
  const [recMs, setRecMs] = useState<number | null>(null);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; send: boolean; t0: number } | null>(null);

  async function startRec() {
    let stream: MediaStream;
    try {
      // The system's voice processing (echo cancellation, noise suppression, gain) cuts audio from a Bluetooth headset in this
      // webview: 10 s recordings came back 8.6 s with a quiet start, and 9.96 s and 9.98 s with all three off (measured with AirPods).
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      return flash(t("Không dùng được micro. Hãy cho phép Zalo Lite truy cập micro trong cài đặt hệ thống"));
    }
    // AAC (audio/mp4) is what Zalo's own voice messages use; other webviews record webm/opus.
    const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const r = { mr, stream, chunks: [] as Blob[], send: false, t0: Date.now() };
    mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      rec.current = null;
      setRecMs(null);
      const ms = Date.now() - r.t0;
      const blob = new Blob(r.chunks, { type: mr.mimeType || type || "audio/mp4" });
      if (!r.send) return;
      if (ms < 600) return flash(t("Ghi âm quá ngắn"));
      if (!blob.size) return flash(t("Không ghi được âm thanh ({0}, {1} đoạn)", [mr.mimeType || type || t("không rõ định dạng"), r.chunks.length]));
      // Some microphones deliver only part of what was said; better to say so than to send a clip with silence in it.
      const got = await decodedSeconds(blob);
      if (got !== null && got < ms / 1000 - 1.5 && got < (ms / 1000) * 0.7) {
        return flash(t("Chỉ ghi được {0} giây trong {1} giây. Micro có thể bị ngắt, hãy thử lại hoặc đổi micro", [Math.round(got), Math.round(ms / 1000)]));
      }
      onVoice(blob, ms);
    };
    rec.current = r;
    mr.start();
    setRecMs(0);
  }
  function stopRec(send: boolean) {
    const r = rec.current;
    if (!r || r.mr.state === "inactive") return;
    r.send = send;
    r.mr.stop();
  }
  useEffect(() => {
    if (recMs === null) return;
    const timer = setInterval(() => {
      const ms = Date.now() - rec.current!.t0;
      setRecMs(ms);
      if (ms >= MAX_VOICE_MS) (flash(t("Đã đạt tối đa 5 phút, đang gửi")), stopRec(true));
    }, 250);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && stopRec(false);
    window.addEventListener("keydown", esc);
    return () => (clearInterval(timer), window.removeEventListener("keydown", esc));
  }, [recMs === null]);
  useEffect(() => () => stopRec(false), [thread.id]); // leaving the chat discards a recording in progress
  const [files, setFiles] = useState<File[]>([]);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => ta.current?.focus(), [thread.id, replyTo]);
  useLayoutEffect(() => {
    const el = ta.current!;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Drag and drop anywhere over the chat pane.
  useEffect(() => {
    const pane = ta.current!.closest(".main") as HTMLElement;
    let depth = 0;
    const enter = (e: DragEvent) => e.dataTransfer?.types.includes("Files") && (depth++, setDragging(true));
    const leave = () => --depth <= 0 && ((depth = 0), setDragging(false));
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) setFiles((f) => [...f, ...e.dataTransfer!.files]);
    };
    pane.addEventListener("dragenter", enter);
    pane.addEventListener("dragleave", leave);
    pane.addEventListener("dragover", over);
    pane.addEventListener("drop", drop);
    return () => {
      pane.removeEventListener("dragenter", enter);
      pane.removeEventListener("dragleave", leave);
      pane.removeEventListener("dragover", over);
      pane.removeEventListener("drop", drop);
    };
  }, []);

  const canSend = text.trim().length > 0 || files.length > 0;
  function submit() {
    if (!canSend) return;
    onSend(text.trim(), files);
    setText("");
    setFiles([]);
  }

  return (
    <div class="composer">
      {dragging && <div class="drop">{t("Thả file vào đây để gửi")}</div>}
      {picker && <StickerPicker at={picker} onPick={onSticker} onClose={() => setPicker(null)} />}
      <div class="bar">
        <button
          class="icon-btn"
          aria-label={t("Gửi sticker")}
          title={t("Gửi sticker")}
          aria-haspopup="dialog"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPicker({ x: r.left, y: r.top - 372 });
          }}
        >
          <Icon name="sticker" size={22} />
        </button>
        <button class="icon-btn" aria-label={t("Gửi hình ảnh")} title={t("Gửi hình ảnh")} onClick={() => imgInput.current!.click()}><Icon name="image" size={22} /></button>
        <button class="icon-btn" aria-label={t("Đính kèm file")} title={t("Đính kèm file")} onClick={() => fileInput.current!.click()}><Icon name="attach" size={22} /></button>
        <button class="icon-btn" aria-label={t("Ghi âm tin nhắn thoại")} title={t("Ghi âm tin nhắn thoại")} onClick={startRec} disabled={recMs !== null}><Icon name="mic" size={22} /></button>
        <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => (setFiles((f) => [...f, ...e.currentTarget.files!]), (e.currentTarget.value = ""))} />
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => (setFiles((f) => [...f, ...e.currentTarget.files!]), (e.currentTarget.value = ""))} />
      </div>
      {replyTo && (
        <div class="replying">
          <div class="rbody">
            <b><Icon name="reply" size={15} /> {t("Trả lời {0}", [replyName])}</b>
            <span>{replyTo.text || t("Tin nhắn")}</span>
          </div>
          <button class="icon-btn" aria-label={t("Huỷ trả lời")} onClick={cancelReply}><Icon name="close" size={16} /></button>
        </div>
      )}
      {files.length > 0 && (
        <div class="staged">
          {files.map((f, i) => (
            <span class={`chip${f.type.startsWith("image/") ? " has-thumb" : ""}`}>
              {f.type.startsWith("image/") ? <Thumb file={f} /> : <Icon name="file" size={16} />}
              <span>{f.name || t("Ảnh dán")}</span>
              {!f.type.startsWith("image/") && <span class="fsize">{size(f.size)}</span>}
              <button class="icon-btn" aria-label={t("Bỏ {0}", [f.name])} onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
            </span>
          ))}
        </div>
      )}
      {recMs !== null && (
        <div class="rec" role="status" aria-label={t("Đang ghi âm")}>
          <button class="icon-btn" aria-label={t("Huỷ ghi âm")} title={t("Huỷ (Esc)")} onClick={() => stopRec(false)}><Icon name="trash" size={20} /></button>
          <span class="rec-dot" aria-hidden="true" />
          <span class="rec-time">{mmss(recMs)}</span>
          <span class="rec-hint">{t("Đang ghi âm…")}</span>
          <button class="send" onClick={() => stopRec(true)} aria-label={t("Gửi tin nhắn thoại")}>{t("Gửi") + " "}<Icon name="send" size={18} />
          </button>
        </div>
      )}
      <div class="input-row" hidden={recMs !== null}>
        <textarea
          ref={ta}
          rows={1}
          value={text}
          aria-label={t("Nhập tin nhắn tới {0}", [thread.name])}
          placeholder={t("Nhập tin nhắn tới {0}", [thread.name])}
          onInput={(e) => {
            setText(e.currentTarget.value);
            if (Date.now() - lastTyping.current > 3000) {
              lastTyping.current = Date.now();
              call("typing", { threadId: thread.id, type: thread.type }).catch(() => {});
            }
          }}
          onKeyDown={(e) => {
            // Settings > Tin nhắn: Enter sends (Shift + Enter breaks the line), or Ctrl/Cmd + Enter sends (Enter breaks the line).
            if (e.key === "Enter" && !e.isComposing && (sendsWithMod() ? e.metaKey || e.ctrlKey : !e.shiftKey)) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape" && replyTo) cancelReply();
          }}
          onPaste={(e) => {
            const pasted = [...(e.clipboardData?.files ?? [])];
            if (pasted.length) {
              e.preventDefault();
              setFiles((f) => [...f, ...pasted]);
            }
          }}
        />
        <button class="send" onClick={submit} disabled={!canSend} aria-label={t("Gửi")}>{t("Gửi") + " "}<Icon name="send" size={18} />
        </button>
      </div>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
