---
"@jmfederico/pi-web": patch
---

Stop pressing Stop repeatedly from stalling the whole UI. Only one stop request per session is issued at a time, and the button reports that it is already stopping.
