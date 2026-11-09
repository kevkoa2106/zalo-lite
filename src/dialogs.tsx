// Dialogs opened from the gear menu: the shared Modal, the account card and the settings dialog.
import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";

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
