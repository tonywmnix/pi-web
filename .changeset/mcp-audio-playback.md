---
"@jmfederico/pi-web": patch
---

Play generated audio inline in the chat transcript when an MCP tool result reports an `AUDIO_FILE:` marker, via a new read-only `api/mcp-audio/:filename` route backed by `PI_WEB_MCP_AUDIO_DIR`.
