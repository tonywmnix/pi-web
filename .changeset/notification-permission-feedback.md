---
"@jmfederico/pi-web": patch
---

Explain why desktop notifications did not turn on instead of leaving the toggle silently off. A browser can answer a permission request without ever showing a prompt, and a blocked site left the button disabled with no way back, so both cases looked like a broken button. The toggle now stays clickable, says what happened and where to fix it, and picks up permission granted from the address bar without a reload.
