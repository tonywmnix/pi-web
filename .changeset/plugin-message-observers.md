---
"@jmfederico/pi-web": minor
---

Add a `messageObservers` browser plugin contribution: plugins can now register an `onAssistantMessage` callback that fires once per turn that finishes with a readable assistant message in the currently selected session, receiving its plain text (no tool calls, thinking, or images). This lets plugins react to new agent replies (e.g. text-to-speech, logging, custom notifications) without scraping the DOM or relying on manual copy/paste. See "Message observers" in the plugin docs.
