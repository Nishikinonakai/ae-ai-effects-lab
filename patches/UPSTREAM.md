# Vendored fork: after-effects-mcp

- Upstream: https://github.com/Dakkshin/after-effects-mcp.git
- Cloned at commit: 88d5fbf08b7ae9f015ee98e5f8c4904095cf8202 (2026-07-13)
- Local modification: `after-effects-mcp-runscript.patch` — adds a `runScript` case to
  `src/scripts/mcp-bridge-auto.jsx` (arbitrary ExtendScript execution; the stock whitelist
  cannot enumerate effect params or save frames). Everything in this project depends on it.
- The vendored copy in `after-effects-mcp/` already has the patch applied AND built
  (`build/scripts/mcp-bridge-auto.jsx`). To reproduce from upstream:
  `git clone <upstream> && git checkout 88d5fbf && git apply after-effects-mcp-runscript.patch && npm install && node install-bridge.js`
