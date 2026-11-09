// Dialogs opened from the gear menu: the shared Modal, the account card and the settings dialog.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
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
