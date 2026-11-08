// One outline family: 24px grid, 1.7 stroke, round caps. Decorative by default (aria-hidden);
// buttons that hold only an icon carry their own aria-label.
import type { JSX } from "preact";

const paths: Record<string, JSX.Element> = {
  chat: (
    <>
      <path d="M4 11.5C4 7.4 7.6 4.5 12 4.5s8 2.9 8 7-3.6 7-8 7c-1 0-2-.1-2.9-.4L5 19.5l1.2-3.4C4.8 14.9 4 13.3 4 11.5Z" />
      <path d="M8.5 10h7M8.5 13h4.5" />
    </>
  ),
  contacts: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <circle cx="12" cy="10" r="2.5" />
      <path d="M8.5 16.5c.6-1.6 1.9-2.5 3.5-2.5s2.9.9 3.5 2.5M3 8h2M3 12h2M3 16h2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5l1.6 2.1 2.6-.6.7 2.6 2.5 1-.9 2.4.9 2.4-2.5 1-.7 2.6-2.6-.6L12 20.5l-1.6-2.1-2.6.6-.7-2.6-2.5-1 .9-2.4-.9-2.4 2.5-1 .7-2.6 2.6.6L12 3.5Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  addFriend: (
    <>
      <circle cx="10" cy="8.5" r="3.5" />
      <path d="M3.5 19.5c.8-3.2 3.3-5 6.5-5s5.7 1.8 6.5 5M18 4.5v5M15.5 7h5" />
    </>
  ),
  addGroup: (
    <>
      <circle cx="9" cy="9" r="3" />
      <circle cx="15.5" cy="10" r="2.5" />
      <path d="M3.5 19c.7-2.8 2.8-4.3 5.5-4.3s4.8 1.5 5.5 4.3M14.5 14.8c2.3-.3 4.3 1 5 3.5M18.5 3.5v4M16.5 5.5h4" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 17 4.5-4.5 3.5 3.5 2.5-2.5L20 18" />
    </>
  ),
  attach: <path d="M19 11.5 12.2 18.3a4.5 4.5 0 0 1-6.4-6.4l7.1-7.1a3 3 0 0 1 4.3 4.3l-7 7a1.5 1.5 0 0 1-2.2-2.1l6.5-6.5" />,
  send: <path d="M4.5 4.8 20 12 4.5 19.2l2.4-7.2-2.4-7.2ZM7 12h6.5" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14c.8 1.3 2 2 3.5 2s2.7-.7 3.5-2M9 9.8v.4M15 9.8v.4" />
    </>
  ),
  reply: <path d="M10 6 4.5 11 10 16M5 11h8.5c3.5 0 6 2.4 6 6v1" />,
  more: (
    <>
      <circle cx="6" cy="12" r=".9" />
      <circle cx="12" cy="12" r=".9" />
      <circle cx="18" cy="12" r=".9" />
    </>
  ),
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  link: (
    <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
  ),
  file: (
    <>
      <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8.5l-5-5Z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  phoneIn: (
    <path d="M6.6 3.8 9 4.4l1.2 3.8-1.9 1.4a11 11 0 0 0 6.1 6.1l1.4-1.9 3.8 1.2.6 2.4c-.3 1.6-1.7 2.6-3.3 2.4C10 19.1 4.9 14 4.1 7.1c-.2-1.6.9-3 2.5-3.3ZM20 4l-5 5M15 5.5V9h3.5" />
  ),
  phoneMissed: <path d="M6.6 3.8 9 4.4l1.2 3.8-1.9 1.4a11 11 0 0 0 6.1 6.1l1.4-1.9 3.8 1.2.6 2.4c-.3 1.6-1.7 2.6-3.3 2.4C10 19.1 4.9 14 4.1 7.1c-.2-1.6.9-3 2.5-3.3Z M20.5 3.5l-5 5M15.5 3.5l5 5" />,
  phoneRejected: (
    <>
      <path d="M6.6 3.8 9 4.4l1.2 3.8-1.9 1.4a11 11 0 0 0 6.1 6.1l1.4-1.9 3.8 1.2.6 2.4c-.3 1.6-1.7 2.6-3.3 2.4C10 19.1 4.9 14 4.1 7.1c-.2-1.6.9-3 2.5-3.3Z" />
      <circle cx="17" cy="7" r="3.5" />
      <path d="m14.5 9.5 5-5" />
    </>
  ),
  play: <path d="M8.5 5.5v13L19 12Z" stroke-linejoin="round" />,
  pause: (
    <>
      <rect x="7" y="5.5" width="3.6" height="13" rx="1" />
      <rect x="13.4" y="5.5" width="3.6" height="13" rx="1" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  video: (
    <>
      <rect x="3.5" y="6" width="12.5" height="12" rx="2.5" />
      <path d="m16 10.5 4.5-2.5v8L16 13.5" />
    </>
  ),
  sticker: (
    <>
      <path d="M20.5 12.5a8.5 8.5 0 1 1-9-9h1.5l7.5 7.5v1.5Z" />
      <path d="M12.5 3.5v4a3.5 3.5 0 0 0 3.5 3.5h4.5M8.5 14.5c.8 1 2 1.5 3.3 1.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  refresh: <path d="M19 12a7 7 0 1 1-2-4.9M19 4.5v3.5h-3.5" />,
  logout: <path d="M14 4.5H7.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14M10.5 12h9.5M17 8.5l3.5 3.5-3.5 3.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  undo: <path d="M8 8.5 4.5 12 8 15.5M5 12h9.5a4.5 4.5 0 0 1 0 9H12" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9L17.5 7M10.5 11v5M13.5 11v5" />,
  download: <path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14" />,
  down: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  check: <path d="m5.5 12.5 4 4 9-9" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 24, class: cls }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
