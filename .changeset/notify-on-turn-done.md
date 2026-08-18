---
"@jmfederico/pi-web": patch
---

Show a browser notification when a session finishes its turn and is waiting for the next prompt, in addition to the existing notifications for `ask_user` questions and extension confirmation dialogs. Skipped when the turn ends by opening one of those instead, so you only get one notification per event.
