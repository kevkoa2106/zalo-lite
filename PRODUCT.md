# Zalo Lite

A lightweight desktop client (Tauri + Bun) for the messaging part of Zalo. Social features (Nhật ký, Cloud, Zalo Video, mini-apps) are out of scope.

- **Who:** an existing Zalo user on macOS who wants the chat experience without the heavy Electron client.
- **Mode:** Operate. The user is in a task (reading and replying); familiarity is the feature.
- **Visual authority:** Zalo PC 26.x itself. Layout, density, colours, copy (Vietnamese), and interaction patterns follow the real client so a Zalo user trusts it on sight. Colour values come from the real client's semantic tokens (surface, layer, text, blue/white message bubbles) for both dark and light themes. The stylesheet, icons, and code are written from scratch; no Zalo assets or logos are bundled.
- **Success:** log in by QR, see the same conversation list, read and send text, photos and files, reply, react, recall; all without surprises.

Assumptions (inferred from the brief, no interview): dark theme first because the reference screenshot is dark, with light and system themes available like the real app.
