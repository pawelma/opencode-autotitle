# Installation

## For Humans

Paste this into your LLM agent (OpenCode, Claude Code, Cursor, etc.):

```
Install opencode-autotitle by following the instructions here:
https://raw.githubusercontent.com/pawelma/opencode-autotitle/main/docs/install.md
```

**Alternative: Quick Install**

```bash
curl -fsSL https://raw.githubusercontent.com/pawelma/opencode-autotitle/main/install.sh | bash
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

**Option A: Local plugins directory (recommended for development)**

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

**Option B: Add to config (npm - simpler)**

Edit `~/.config/opencode/opencode.json` and add to the plugin array:

```json
{
  "plugin": ["opencode-autotitle"]
}
```

If the file doesn't exist or doesn't have a plugin array, create it:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-autotitle"]
}
```

### Step 3: Optional Configuration

The plugin works out of the box with sensible defaults. For customization, set environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_AUTOTITLE_MODEL` | (auto) | Model ID like `anthropic/claude-haiku-4-5` |
| `OPENCODE_AUTOTITLE_MAX_LENGTH` | `40` | Maximum title character length |
| `OPENCODE_AUTOTITLE_DISABLED` | `false` | Set to `1` to disable |
| `OPENCODE_AUTOTITLE_DEBUG` | `false` | Set to `1` for debug logging |

Example (add to shell profile):

```bash
export OPENCODE_AUTOTITLE_MODEL="anthropic/claude-haiku-4-5"
export OPENCODE_AUTOTITLE_DEBUG="1"
```

### Step 4: Verify Installation

1. Start OpenCode: `opencode`
2. Send any message to start a conversation
3. After the AI responds, check the session title - it should be automatically updated

If using debug mode, you'll see log messages like:
```
[autotitle] Updated session abc123 title to: Setup React Auth
```

### Troubleshooting

**Plugin not loading:**
- Check that the plugin is in `~/.config/opencode/plugins/opencode-autotitle/` with built files in `dist/`
- Or verify it's listed in `opencode.json` plugin array
- Run `opencode --version` to ensure OpenCode is working

**Titles not generating:**
- Enable debug mode: `export OPENCODE_AUTOTITLE_DEBUG=1`
- Check logs for errors
- Ensure your session has at least one user message and one AI response

**AI title generation failing:**
- The plugin will fall back to keyword extraction automatically
- If you want AI titles, ensure your OpenCode has a working model configured

### Done!

Tell the user:

> "opencode-autotitle installed successfully! Your sessions will now be automatically named based on conversation context. No additional setup required - just use OpenCode normally."

### Optional: Star the Repository

If the user found this helpful:

```bash
gh repo star pawelma/opencode-autotitle
```

Only run this if the user explicitly agrees.
