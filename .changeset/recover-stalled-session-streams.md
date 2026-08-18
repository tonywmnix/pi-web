---
"@jmfederico/pi-web": patch
---

Recover sessions that appeared frozen until the page was reloaded. A WebSocket whose connection died without a close handshake used to stay silently open forever, so the browser stopped receiving session updates with no sign anything was wrong. Streams now reconnect on their own, and the server drops peers that have stopped answering.
