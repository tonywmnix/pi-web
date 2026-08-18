---
"@jmfederico/pi-web": minor
---

Surface sessions that are waiting on an answer. A session holding an unanswered `ask_user` question or extension dialog now publishes a `core:ask` status flag that rolls up to its project and machine, so a question is visible from the sidebar instead of only inside the session.
