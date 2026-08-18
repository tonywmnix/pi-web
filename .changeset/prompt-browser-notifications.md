---
"@jmfederico/pi-web": patch
---

Show a browser notification when any session opens an `ask_user` question or an extension confirmation dialog, so you notice prompts even when they're not the session you're currently viewing. Notifications are deduplicated across tabs of the same browser and clicking one focuses the window and jumps to that session when possible.
