# antislop audit 001 (2026-11-02)

Scope: `src/main.tsx`, `src/styles.css`, `src/icons.tsx`, Vietnamese UI copy.
Direction: PRODUCT.md (match Zalo PC; familiarity is the feature). Design Read: desktop messaging client for existing Zalo users, in Zalo PC's own visual language, dial ENERGY 1 / RHYTHM 1 / MOTION 1 (uniform, calm, hover and state transitions only).
Mode: after. Nothing below is changed until you approve numbers.

| # | Priority | Rule | Finding | Proposed fix |
|---|---|---|---|---|
| 1 | HIGH | R-26 | "Thêm bạn" and "Tạo nhóm" buttons beside search are permanently disabled, with no label saying why. Dead controls. | Remove both (adding friends and creating groups are outside the messaging scope). |
| 2 | HIGH | R-25 | Unread badges: white 12px text on `#e94949` is 3.81:1 (needs 4.5:1). Affects list badge and rail count. | Use Zalo's `accent-red-bg` `#d91b1b` (5.09:1). |
| 3 | HIGH | R-25 | Welcome hint uses `--text-3` (`#77859c` on `#1d2025`, 4.37:1). | Use `--text-2` (6:1 or better). |
| 4 | HIGH | R-38 | 1:1 chat header always says "Bạn bè" even when the person is not a friend. Inaccurate content. | Show "Bạn bè" only when the person is in the friend list, otherwise "Người lạ" like the real client. |
| 5 | HIGH | R-36 | Welcome copy says "nhẹ và nhanh hơn" (lighter and faster): an unmeasured comparative performance claim. | Drop the comparison; state what the app does. |
| 6 | HIGH | R-27 | If `bootstrap` fails, the error is swallowed and the list shows skeletons forever. No error state. | Show an inline error with a "Thử lại" button. |
| 7 | MEDIUM | C-2 | Composer placeholder "Nhập @, tin nhắn tới …" promises @mentions, which are not implemented. | Use "Nhập tin nhắn tới …" until mentions exist. |
| 8 | LOW | C-4 | "Xem tin nhắn cũ hơn" shows even when the first page already returned fewer than 50 messages (no older history). | Initialise `more` from the first page size. |
| 9 | LOW | C-4 | Sticker images load from a CDN URL pattern that was not verified against live traffic; a broken image would show the browser's broken-image icon. | Fall back to a "Sticker" text label on image error. |

Passing checks (evidence):
- R-02 PASS: `grep -rn '—' src server` returns nothing.
- R-04 PASS: icons are an original outline set drawn for this app, one per real function (chat, contacts, image, attach, reply, recall).
- R-06 PASS: Segoe UI first, matching the real client's bundled `SegoeuiPc`; platform sans on macOS.
- R-21 PASS: dark default comes from the user's reference; light and system modes ship via Cài đặt.
- R-23 PASS: avatars without a photo use initials; the brand is plain text "Zalo Lite", no generated logo.
- R-25 other pairs PASS: text-2 on every surface 4.87 to 7.64:1, accent links 5.11 to 5.93:1.
- R-32 PASS: popovers focus their first item and close on Escape; message tools appear on `:focus-within`; image viewer closes on Escape; visible `:focus-visible` ring.
- R-17 / R-18 / R-28: no statistics, testimonials or FAQ exist.

## Follow-up (2026-11-02): all 9 approved and fixed

1. Removed "Thêm bạn" / "Tạo nhóm" buttons.
2. Badge background `#d91b1b` in both themes (white text 5.09:1).
3. Welcome hint uses `--text-2`.
4. 1:1 header: "Bạn bè" only for friends (friend flag from the friend list), "Người lạ" otherwise; My Documents gets its own subtitle. Verified with a non-friend thread.
5. Welcome copy no longer claims "nhẹ và nhanh hơn".
6. Bootstrap failure shows "Không tải được danh sách trò chuyện" with the error and a "Thử lại" button.
7. Placeholder is "Nhập tin nhắn tới …".
8. "Xem tin nhắn cũ hơn" only when the first page is full (50).
9. Sticker image falls back to a "Sticker" label on load error.

`bun check` clean; screenshots checked in the browser against the mock backend.
