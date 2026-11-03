# Claude Code tools for this project

This repo comes with four Claude Code add-ons already set up. When you open it in Claude Code and trust the folder, it offers to install the plugins.

| Tool | What it does | Where it's set up |
|---|---|---|
| **Compound Engineering** | Plan, build, review and save what was learned (`/ce:plan`, `/ce:work`, `/ce:review`, `/ce:compound`) | `.claude/settings.json` (plugin) |
| **Playwright skill** | Claude opens the site in a real browser and tests buttons, forms and checkout | `.claude/settings.json` (plugin) |
| **Graphify** | Turns the code into a knowledge graph, so Claude reads less and uses fewer tokens | `.claude/skills/graphify`, hooks in `.claude/settings.json`, rules in `CLAUDE.md` |
| **21st MCP** | Ready-made UI components, design ideas and logos | `.mcp.json` |

## One-time steps on your computer

1. **21st MCP key.** Make a free key at https://21st.dev/mcp, then add it to your shell profile (`~/.zshrc` or `~/.bashrc`):
   ```bash
   export TWENTY_FIRST_API_KEY="your-key"
   ```
   Until the key is set, the `21st` server shows as failing in `/mcp`. Everything else still works.
2. **Graphify.** Run `/graphify .` once in Claude Code to build the graph. It installs the `graphifyy` Python package (Python 3.10+) if it's missing. After that, `graphify update .` refreshes it for free. The graph is saved in `graphify-out/`, which git ignores.
3. **Playwright.** The first time Claude uses the skill, it installs Chromium (Node 18+).

Run `/plugin` to see or turn off the plugins and `/mcp` to see the 21st server.
