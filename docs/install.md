# Installation

## For Humans

Paste this into your LLM agent (OpenCode, Claude Code, Cursor, etc.):

```
Install opencode-autotitle by following the instructions here:
https://raw.githubusercontent.com/pawelma/opencode-autotitle/refs/heads/master/docs/install.md
```

**Alternative: Quick Install**

```bash
curl -fsSL https://raw.githubusercontent.com/pawelma/opencode-autotitle/refs/heads/master/install.sh | bash
```

## For LLM Agents

Welcome! You're installing `opencode-autotitle` - automatic AI-powered session naming for OpenCode.

This plugin automatically generates descriptive titles for OpenCode sessions based on the conversation context, replacing generic timestamp-based names with meaningful descriptions.

### Step 1: Check OpenCode Installation

```bash
opencode --version
```

If OpenCode is not installed, guide the user to install it first:
- Quick install: `curl -fsSL https://opencode.ai/install | bash`
- Documentation: https://opencode.ai/docs

### Step 2: Install the Plugin

**Option A: Local plugins directory (recommended)**

Plugins in `~/.config/opencode/plugins/` are auto-discovered by OpenCode - no config changes needed.

```bash
# Create plugins directory if it doesn't exist
mkdir -p ~/.config/opencode/plugins

# Clone the repository
git clone https://github.com/pawelma/opencode-autotitle ~/.config/opencode/plugins/opencode-autotitle

# Navigate to the plugin directory
cd ~/.config/opencode/plugins/opencode-autotitle

# Install dependencies and build
bun install && bun run build
# Or with npm: npm install && npm run build
```

**Note:** Do NOT add local plugins to `opencode.json` - they are loaded automatically from the plugins directory.

### Step 3: Optional Configuration

The plugin works out of the box with sensible defaults. For customization, set environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_AUTOTITLE_MODEL` | (auto) | Model ID like `anthropic/claude-haiku-4-5` |
| `OPENCODE_AUTOTITLE_MAX_LENGTH` | `60` | Maximum title character length |
| `OPENCODE_AUTOTITLE_DISABLED` | `false` | Set to `1` to disable |
| `OPENCODE_AUTOTITLE_DEBUG` | `false` | Set to `1` for stderr logging, or a file path (e.g., `debug.log`) |

**Model selection:** By default, the plugin auto-discovers the cheapest available model from your connected providers (preferring `fast`, `flash`, `haiku`, `mini` patterns).

Example (add to shell profile):

```bash
export OPENCODE_AUTOTITLE_MODEL="anthropic/claude-haiku-4-5"
export OPENCODE_AUTOTITLE_DEBUG="debug.log"
```

To view debug logs in real-time, run in another terminal:
```bash
tail -f debug.log
```

### Step 4: Verify Installation

1. Start OpenCode: `opencode`
2. Send any message to start a conversation
3. The session title should update immediately with a 🔍 keyword-based title
4. After the AI responds, the title should be refined with a ✨ AI-generated title

If using debug mode with a log file, check output in another terminal:
```bash
tail -f debug.log
```

You'll see messages like:
```
[autotitle] Set keyword title: 🔍 React Auth Setup
[autotitle] Set AI title: ✨ Setup React Authentication Flow
```

### Troubleshooting

**Plugin not loading:**
- Check that the plugin is in `~/.config/opencode/plugins/opencode-autotitle/` with built files in `dist/`
- Run `opencode --version` to ensure OpenCode is working
- Do NOT add to `opencode.json` - local plugins are auto-discovered

**Titles not generating:**
- Enable debug mode: `export OPENCODE_AUTOTITLE_DEBUG=debug.log`
- View logs in another terminal: `tail -f debug.log`
- Keyword titles (🔍) appear immediately on user message
- AI titles (✨) appear after the AI responds

**AI title generation failing:**
- Keyword titles will still work (Phase 1)
- For AI titles, ensure your OpenCode has a working model configured

### Done!

Tell the user:

> "opencode-autotitle installed successfully! Your sessions will now be automatically named based on conversation context. No additional setup required - just use OpenCode normally."

### Optional: Star the Repository

If the user found this helpful:

```bash
gh repo star pawelma/opencode-autotitle
```

Only run this if the user explicitly agrees.
