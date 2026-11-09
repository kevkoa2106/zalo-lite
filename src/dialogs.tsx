// Dialogs opened from the gear menu: the shared Modal, the account card and the settings dialog.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { call } from "./api";
import { dobLabel, hue, initials, size } from "./format";
import { Icon, type IconName } from "./icons";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog over a dimmed backdrop. Esc and a click outside close it, Tab stays inside it, and `returnFocus`
 * runs after it closes (the opener, a menu item, is gone by then, so the caller says where focus goes back to).
 */
export function Modal({ label, onClose, returnFocus, class: cls = "", children }: {
  label: string; onClose: () => void; returnFocus?: () => void; class?: string; children: ComponentChildren;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current!;
    (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return (e.stopPropagation(), onClose());
      if (e.key !== "Tab") return;
      const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!f.length) return e.preventDefault();
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    addEventListener("keydown", key);
    return () => {
      removeEventListener("keydown", key);
      returnFocus?.();
    };
  }, []);
  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} class={`modal ${cls}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

// ---------- gear menu ----------

export type GearAction = "account" | "settings" | "data-settings" | "sync" | "logout" | "issues";

type Item = { label: string; icon?: IconName; action?: GearAction; danger?: boolean; disabled?: boolean; checked?: boolean; hint?: string; sub?: Item[] };

// Order and labels follow Zalo PC's gear menu. "Thoát" is left out: quitting needs a Tauri command that is not added yet.
const MENU: (Item | "-")[] = [
  { label: "Thông tin tài khoản", icon: "user", action: "account" },
  { label: "Cài đặt", icon: "settings", action: "settings" },
  "-",
  {
    label: "Dữ liệu", icon: "database",
    sub: [
      { label: "Đồng bộ tin nhắn từ điện thoại", icon: "phoneIn", action: "sync" },
      { label: "Quản lý dữ liệu", icon: "database", action: "data-settings" },
    ],
  },
  { label: "Ngôn ngữ", icon: "globe", sub: [{ label: "Tiếng Việt", checked: true }, { label: "English", disabled: true, hint: "Chưa hỗ trợ" }] },
  { label: "Hỗ trợ", icon: "help", sub: [{ label: `Phiên bản ${__APP_VERSION__}`, disabled: true }, { label: "Báo lỗi hoặc góp ý", icon: "link", action: "issues" }] },
  "-",
  { label: "Đăng xuất", danger: true, action: "logout" },
];

function Row({ item, pick, enter }: { item: Item; pick: (a: GearAction) => void; enter?: () => void }) {
  return (
    <button
      role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
      aria-checked={item.checked}
      disabled={item.disabled}
      class={`${item.danger ? "danger" : ""}${item.icon ? "" : " noicon"}`}
      onMouseEnter={enter}
      onClick={() => item.action && pick(item.action)}
    >
      {item.icon && <Icon name={item.icon} size={18} />} {item.label}
      {item.hint && <span class="hint">{item.hint}</span>}
      {item.checked && <span class="check"><Icon name="check" size={16} /></span>}
    </button>
  );
}

/**
 * The menu above the gear button. Up, Down, Home and End move between rows, Right opens a submenu, Left or Esc
 * closes it, Esc on the main menu closes everything. `gear` is the button itself, so a click on it toggles the menu.
 */
export function GearMenu({ anchor, gear, onClose, onPick }: {
  anchor: DOMRect; gear: HTMLElement | null; onClose: (refocus: boolean) => void; onPick: (a: GearAction) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: anchor.left, y: -9999 });
  const [open, setOpen] = useState(-1); // index of the row whose submenu is open
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: Math.max(8, anchor.left), y: Math.max(8, anchor.top - r.height - 8) });
    ref.current!.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, []);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !gear?.contains(e.target as Node) && onClose(false);
    setTimeout(() => addEventListener("mousedown", down));
    return () => removeEventListener("mousedown", down);
  }, []);

  function key(e: KeyboardEvent) {
    const here = (e.target as HTMLElement).closest<HTMLElement>('[role="menu"]')!;
    const rows = [...here.querySelectorAll<HTMLElement>(":scope > button:not(:disabled), :scope > .has-sub > button:not(:disabled)")];
    const at = rows.indexOf(e.target as HTMLElement);
    const go = (i: number) => (e.preventDefault(), rows[(i + rows.length) % rows.length]?.focus());
    const inSub = here.classList.contains("sub");
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at < 0 ? -1 : at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    else if (e.key === "ArrowRight" && (e.target as HTMLElement).getAttribute("aria-haspopup")) {
      e.preventDefault();
      setOpen(MENU.findIndex((m) => m !== "-" && m.label === (e.target as HTMLElement).textContent?.trim()));
      setTimeout(() => (e.target as HTMLElement).parentElement?.querySelector<HTMLElement>(".sub button:not(:disabled)")?.focus());
    } else if ((e.key === "ArrowLeft" || e.key === "Escape") && inSub) {
      e.preventDefault();
      e.stopPropagation();
      (here.parentElement?.querySelector(":scope > button") as HTMLElement | null)?.focus();
      setOpen(-1);
    } else if (e.key === "Escape") onClose(true);
    else if (e.key === "Tab") onClose(true);
  }

  return (
    <div ref={ref} class="pop gear-menu" style={{ left: `${pos.x}px`, top: `${pos.y}px` }} onKeyDown={key}>
      <div class="menu" role="menu" aria-label="Cài đặt">
        {MENU.map((it, i) =>
          it === "-" ? (
            <hr />
          ) : it.sub ? (
            <div class="has-sub">
              <button role="menuitem" aria-haspopup="menu" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)} onMouseEnter={() => setOpen(i)}>
                <Icon name={it.icon!} size={18} /> {it.label}
                <span class="chev"><Icon name="chevron" size={16} /></span>
              </button>
              {open === i && (
                <div class="pop sub" role="menu" aria-label={it.label}>
                  {it.sub.map((s) => <Row item={s} pick={onPick} />)}
                </div>
              )}
            </div>
          ) : (
            <Row item={it} pick={onPick} enter={() => setOpen(-1)} />
          ),
        )}
      </div>
    </div>
  );
}

// ---------- account card ----------

export type Profile = { id: string; name: string; avatar: string; cover: string; gender: 0 | 1; dob: string; phone: string };

/** A round picture, or the person's initials on a colour when there is none (or it fails to load). */
function Pic({ src, name, id, size }: { src: string; name: string; id: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img class="avatar" src={src} alt="" width={size} height={size} onError={() => setBroken(true)} />;
  return (
    <span class="ph" style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px`, "--h": hue(id) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header class="mhead">
      <h2>{title}</h2>
      <button class="icon-btn" aria-label="Đóng" onClick={onClose}><Icon name="close" size={22} /></button>
    </header>
  );
}

/** A picked image as a centred square JPEG of at most 640 px: what the avatar upload takes. */
async function cropSquare(file: File, max = 640) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(side, max);
  const c = document.createElement("canvas");
  c.width = c.height = out;
  c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9));
  if (!blob) throw new Error("Không đọc được ảnh");
  return { blob, width: out, height: out };
}

async function toB64(blob: Blob) {
  const u = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

type Pending = { kind: "profile"; name: string; gender: 0 | 1; dob: string } | { kind: "avatar"; url: string; blob: Blob; width: number; height: number };

/**
 * "Thông tin tài khoản": the banner, the avatar, the name and the personal details of the signed-in account.
 * Changing the name, gender, birth date or avatar changes the real Zalo account, so each change shows a summary and
 * asks for one confirmation first. The banner can only be shown: zca-js has no call to change it.
 */
export function AccountCard({ onClose, returnFocus }: { onClose: () => void; returnFocus: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [form, setForm] = useState({ name: "", gender: 0 as 0 | 1, dob: "" });
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const load = () => {
    setErr("");
    call<Profile>("profile").then(setP).catch((e) => setErr(e.message));
  };
  useEffect(load, []);
  useEffect(() => () => pending?.kind === "avatar" && URL.revokeObjectURL(pending.url), [pending]);

  const edit = () => {
    setForm({ name: p!.name, gender: p!.gender, dob: p!.dob });
    setFormErr("");
    setMode("edit");
  };
  function review(e: Event) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return setFormErr("Tên hiển thị không được để trống");
    if (!form.dob) return setFormErr("Hãy chọn ngày sinh");
    setPending({ kind: "profile", name, gender: form.gender, dob: form.dob });
    setFormErr("");
    setMode("confirm");
  }
  async function pickAvatar(f: File) {
    try {
      const c = await cropSquare(f);
      setPending({ kind: "avatar", url: URL.createObjectURL(c.blob), ...c });
      setFormErr("");
      setMode("confirm");
    } catch {
      setFormErr("Không đọc được ảnh này, hãy chọn ảnh khác");
    }
  }
  async function apply() {
    if (!pending) return;
    setBusy(true);
    setFormErr("");
    try {
      const r =
        pending.kind === "profile"
          ? await call<Profile>("profile_update", { name: pending.name, gender: pending.gender, dob: pending.dob })
          : await call<Profile>("avatar", { b64: await toB64(pending.blob), width: pending.width, height: pending.height });
      setP(r);
      setPending(null);
      setMode("view");
    } catch (e: any) {
      setFormErr(e.message);
      setMode(pending.kind === "profile" ? "edit" : "view");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal label="Thông tin tài khoản" onClose={onClose} returnFocus={returnFocus} class="account">
      <Head title="Thông tin tài khoản" onClose={onClose} />
      {!p && !err && <div class="spin" style={{ margin: "60px auto" }} role="status" aria-label="Đang tải" />}
      {err && (
        <div class="mempty">
          <p>{err}</p>
          <button class="update" onClick={load}><Icon name="refresh" size={18} /> Thử lại</button>
        </div>
      )}
      {p && (
        <>
          <div class="banner" style={p.cover ? { backgroundImage: `url("${p.cover}")` } : undefined} role="img" aria-label="Ảnh bìa" />
          <div class="who">
            <div class="avwrap">
              <Pic src={p.avatar} name={p.name} id={p.id} size={80} />
              <button class="cam" aria-label="Đổi ảnh đại diện" onClick={() => file.current!.click()} disabled={busy || mode === "confirm"}><Icon name="camera" size={16} /></button>
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) pickAvatar(f); }} />
            </div>
            <div class="nm">
              <strong>{p.name}</strong>
              <button class="icon-btn" aria-label="Đổi tên hiển thị" onClick={edit} disabled={busy || mode !== "view"}><Icon name="pencil" size={16} /></button>
            </div>
          </div>

          {mode === "view" && (
            <>
              <section class="info">
                <h3>Thông tin cá nhân</h3>
                <dl>
                  <dt>Giới tính</dt>
                  <dd>{p.gender === 1 ? "Nữ" : "Nam"}</dd>
                  <dt>Ngày sinh</dt>
                  <dd>{dobLabel(p.dob) || "Chưa cập nhật"}</dd>
                  <dt>Điện thoại</dt>
                  <dd>{p.phone || "Chưa có"}</dd>
                </dl>
                <p class="note">Chỉ bạn bè có lưu số của bạn trong danh bạ máy xem được số này</p>
                {formErr && <p class="ferr" role="alert">{formErr}</p>}
              </section>
              <footer class="mfoot">
                <button class="update" onClick={edit}><Icon name="pencil" size={18} /> Cập nhật</button>
              </footer>
            </>
          )}

          {mode === "edit" && (
            <form class="info eform" onSubmit={review}>
              <h3>Cập nhật thông tin</h3>
              <label>
                <span>Tên hiển thị</span>
                <input value={form.name} maxLength={64} onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} />
              </label>
              <fieldset>
                <legend>Giới tính</legend>
                <label class="radio"><input type="radio" name="gender" checked={form.gender === 0} onChange={() => setForm({ ...form, gender: 0 })} /> Nam</label>
                <label class="radio"><input type="radio" name="gender" checked={form.gender === 1} onChange={() => setForm({ ...form, gender: 1 })} /> Nữ</label>
              </fieldset>
              <label>
                <span>Ngày sinh</span>
                <input type="date" value={form.dob} max={new Date().toISOString().slice(0, 10)} onInput={(e) => setForm({ ...form, dob: e.currentTarget.value })} />
              </label>
              {formErr && <p class="ferr" role="alert">{formErr}</p>}
              <div class="fbtns">
                <button type="button" class="ghost" onClick={() => setMode("view")}>Huỷ</button>
                <button type="submit" class="primary">Tiếp tục</button>
              </div>
            </form>
          )}

          {mode === "confirm" && pending && (
            <section class="info confirm">
              <h3>Xác nhận thay đổi</h3>
              <p>Thay đổi này sẽ cập nhật tài khoản Zalo thật của bạn.</p>
              {pending.kind === "avatar" ? (
                <img class="avprev" src={pending.url} alt="Ảnh đại diện mới" width={96} height={96} />
              ) : (
                <dl>
                  <dt>Tên hiển thị</dt>
                  <dd>{pending.name}</dd>
                  <dt>Giới tính</dt>
                  <dd>{pending.gender === 1 ? "Nữ" : "Nam"}</dd>
                  <dt>Ngày sinh</dt>
                  <dd>{dobLabel(pending.dob)}</dd>
                </dl>
              )}
              {formErr && <p class="ferr" role="alert">{formErr}</p>}
              <div class="fbtns">
                <button class="ghost" onClick={() => (setPending(null), setMode(pending.kind === "profile" ? "edit" : "view"))} disabled={busy}>Quay lại</button>
                <button class="primary" onClick={apply} disabled={busy}>{busy ? "Đang cập nhật…" : "Xác nhận"}</button>
              </div>
            </section>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------- settings dialog ----------

export type Theme = "dark" | "light" | "system";
export type AppSettings = { remember: boolean; cachePerChat: number };
export type SettingsReply = { settings: AppSettings; db: { bytes: number; messages: number } };

type TabId = "general" | "account" | "privacy" | "sync" | "data" | "look" | "notify" | "messages" | "calls" | "tools";

// Same order and icons as Zalo PC. `ready: false` tabs show the "not supported" panel.
const TABS: { id: TabId; label: string; icon: IconName; ready: boolean }[] = [
  { id: "general", label: "Cài đặt chung", icon: "settings", ready: true },
  { id: "account", label: "Tài khoản và bảo mật", icon: "shield", ready: true },
  { id: "privacy", label: "Quyền riêng tư", icon: "lock", ready: false },
  { id: "sync", label: "Đồng bộ và sao lưu", icon: "refresh", ready: true },
  { id: "data", label: "Quản lý dữ liệu", icon: "database", ready: true },
  { id: "look", label: "Giao diện", icon: "brush", ready: true },
  { id: "notify", label: "Thông báo", icon: "bell", ready: false },
  { id: "messages", label: "Tin nhắn", icon: "chat", ready: true },
  { id: "calls", label: "Cài đặt cuộc gọi", icon: "phoneIn", ready: false },
  { id: "tools", label: "Tiện ích", icon: "sliders", ready: false },
];

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button class="switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange?.(!checked)} />;
}

function Unsupported({ label, note }: { label: string; note?: string }) {
  return (
    <div class="sempty">
      <h3>{label}</h3>
      <p>Tính năng này chưa được hỗ trợ trong Zalo Lite. {note}</p>
    </div>
  );
}

function General({ s, save }: { s: SettingsReply | null; save: (p: Partial<AppSettings>) => void }) {
  return (
    <>
      <h3>Ngôn ngữ</h3>
      <div class="scard">
        <div class="srow">
          <span>Thay đổi ngôn ngữ</span>
          <span class="sel">
            <select aria-label="Thay đổi ngôn ngữ">
              <option>Tiếng Việt</option>
              <option disabled>English (Chưa hỗ trợ)</option>
            </select>
            <Icon name="down" size={16} />
          </span>
        </div>
      </div>
      <h3>Khởi động &amp; ghi nhớ tài khoản</h3>
      <div class="scard">
        <div class="srow">
          <span>Khởi động Zalo khi mở máy <small class="sub-label">Chưa hỗ trợ</small></span>
          <Switch checked={false} disabled label="Khởi động Zalo khi mở máy" />
        </div>
        <div class="srow">
          <span>Ghi nhớ tài khoản đăng nhập</span>
          <Switch checked={s?.settings.remember ?? true} disabled={!s} onChange={(v) => save({ remember: v })} label="Ghi nhớ tài khoản đăng nhập" />
        </div>
      </div>
    </>
  );
}

/** "Cài đặt": the list of tabs on the left and the open tab on the right. */
export function SettingsDialog({ tab: first, onClose, returnFocus, flash, theme, setTheme }: {
  tab: string; onClose: () => void; returnFocus: () => void; flash: (t: string) => void; theme: Theme; setTheme: (t: Theme) => void;
}) {
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === first) ? (first as TabId) : "general");
  const [s, setS] = useState<SettingsReply | null>(null);
  useEffect(() => void call<SettingsReply>("settings").then(setS).catch((e) => flash(e.message)), []);
  const save = (p: Partial<AppSettings>) =>
    call<SettingsReply>("set_settings", { settings: p }).then(setS).catch((e) => flash(e.message));
  const cur = TABS.find((t) => t.id === tab)!;

  function key(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab) + (e.key === "ArrowDown" ? 1 : -1);
    const next = TABS[(i + TABS.length) % TABS.length]!;
    setTab(next.id);
    setTimeout(() => document.getElementById(`tab-${next.id}`)?.focus());
  }

  return (
    <Modal label="Cài đặt" onClose={onClose} returnFocus={returnFocus} class="settings">
      <nav class="snav" role="tablist" aria-orientation="vertical" aria-label="Cài đặt" onKeyDown={key}>
        <h2>Cài đặt</h2>
        {TABS.map((t) => (
          <button id={`tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls="spane" tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={20} /> {t.label}
            {!t.ready && <span class="hint">Chưa hỗ trợ</span>}
          </button>
        ))}
      </nav>
      <div id="spane" class="spane" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <button class="icon-btn sclose" aria-label="Đóng" onClick={onClose}><Icon name="close" size={22} /></button>
        {tab === "general" ? <General s={s} save={save} />
          : tab === "account" ? <AccountTab />
          : tab === "sync" ? <Sync flash={flash} />
          : tab === "data" ? <DataTab s={s} save={save} />
          : tab === "look" ? <Look theme={theme} setTheme={setTheme} />
          : tab === "messages" ? <Messages />
          : <Unsupported label={cur.label} note={tab === "privacy" ? "Hãy đổi quyền riêng tư trong ứng dụng Zalo trên điện thoại." : undefined} />}
      </div>
    </Modal>
  );
}

// ---------- settings tabs ----------

const SEND_KEY = "sendKey"; // "enter" (default) or "mod": the composer reads it on every Enter

/** True when messages are sent with Ctrl or Cmd + Enter and Enter alone starts a new line. */
export function sendsWithMod() {
  try {
    return localStorage.getItem(SEND_KEY) === "mod";
  } catch {
    return false;
  }
}

function Choice({ checked, onPick, children }: { checked: boolean; onPick: () => void; children: ComponentChildren }) {
  return (
    <button class="choice" role="radio" aria-checked={checked} onClick={onPick}>
      <span>{children}</span>
      {checked && <span class="check"><Icon name="check" size={18} /></span>}
    </button>
  );
}

function Look({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <>
      <h3>Giao diện</h3>
      <div class="scard" role="radiogroup" aria-label="Giao diện">
        {([["dark", "Tối"], ["light", "Sáng"], ["system", "Theo hệ thống"]] as const).map(([v, label]) => (
          <Choice checked={theme === v} onPick={() => setTheme(v)}>{label}</Choice>
        ))}
      </div>
    </>
  );
}

function Sync({ flash }: { flash: (t: string) => void }) {
  return (
    <>
      <h3>Đồng bộ và sao lưu</h3>
      <div class="scard">
        <div class="srow">
          <span>
            Đồng bộ tin nhắn từ điện thoại
            <small class="sdesc">Điện thoại sẽ hỏi bạn có đồng ý không. Tin nhắn cũ của bạn bè chỉ có trên điện thoại.</small>
          </span>
          <button class="primary" onClick={() => call("phone_sync").catch((e) => flash(e.message))}>Đồng bộ</button>
        </div>
      </div>
    </>
  );
}

function DataTab({ s, save }: { s: SettingsReply | null; save: (p: Partial<AppSettings>) => void }) {
  return (
    <>
      <h3>Quản lý dữ liệu</h3>
      <div class="scard">
        <div class="srow"><span>Dung lượng tin nhắn trên máy</span><strong>{s ? size(s.db.bytes) : "…"}</strong></div>
        <div class="srow"><span>Số tin nhắn đã lưu</span><strong>{s ? s.db.messages.toLocaleString("vi-VN") : "…"}</strong></div>
        <div class="srow">
          <span>
            Số tin nhắn giữ lại mỗi cuộc trò chuyện
            <small class="sdesc">Giảm số này sẽ xoá ngay các tin nhắn cũ hơn khỏi máy này. Tin nhắn trên Zalo và điện thoại không bị ảnh hưởng.</small>
          </span>
          <span class="sel">
            <select aria-label="Số tin nhắn giữ lại mỗi cuộc trò chuyện" disabled={!s} value={s?.settings.cachePerChat} onChange={(e) => save({ cachePerChat: Number(e.currentTarget.value) })}>
              {[1000, 3000, 5000].map((n) => <option value={n}>{n.toLocaleString("vi-VN")}</option>)}
            </select>
            <Icon name="down" size={16} />
          </span>
        </div>
      </div>
    </>
  );
}

function Messages() {
  const [mod, setMod] = useState(sendsWithMod());
  const pick = (v: boolean) => {
    setMod(v);
    try {
      localStorage.setItem(SEND_KEY, v ? "mod" : "enter");
    } catch {}
  };
  return (
    <>
      <h3>Tin nhắn</h3>
      <div class="scard" role="radiogroup" aria-label="Gửi tin nhắn bằng">
        <Choice checked={!mod} onPick={() => pick(false)}>Enter để gửi, Shift + Enter để xuống dòng</Choice>
        <Choice checked={mod} onPick={() => pick(true)}>Ctrl hoặc ⌘ + Enter để gửi, Enter để xuống dòng</Choice>
      </div>
    </>
  );
}

function AccountTab() {
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => void call<Profile>("profile").then((p) => setPhone(p.phone)).catch(() => setPhone("")), []);
  return (
    <>
      <h3>Tài khoản và bảo mật</h3>
      <div class="scard">
        <div class="srow"><span>Số điện thoại</span><strong>{phone === null ? "…" : phone || "Chưa có"}</strong></div>
      </div>
      <p class="sdesc">Đổi mật khẩu và các cài đặt bảo mật khác hãy dùng ứng dụng Zalo trên điện thoại.</p>
    </>
  );
}
