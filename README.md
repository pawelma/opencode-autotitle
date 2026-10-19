# opencode-autotitle

[![CI](https://github.com/pawelma/opencode-autotitle/actions/workflows/ci.yml/badge.svg)](https://github.com/pawelma/opencode-autotitle/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/pawelma/opencode-autotitle/actions/workflows/publish.yml/badge.svg)](https://github.com/pawelma/opencode-autotitle/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/opencode-autotitle.svg)](https://www.npmjs.com/package/opencode-autotitle)

> [!WARNING]
> **Repository Archived & Deprecated for OpenCode 2.0+**
>
> OpenCode 2.0+ now natively supports automatic session titling via its built-in `title` system agent and `SessionTitle` service. This plugin is no longer needed or recommended for OpenCode 2.0+, as running it alongside OpenCode 2.0 causes race conditions and redundant LLM calls.
>
> For existing OpenCode 1.x installations, the legacy package remains available on [npm (`v0.1.3`)](https://www.npmjs.com/package/opencode-autotitle).
> For a detailed architectural evaluation, see [docs/opencode-2.0-analysis.md](docs/opencode-2.0-analysis.md).

## Migrating to Native OpenCode 2.0 Autotitling

OpenCode 2.0 automatically generates descriptive titles for new sessions after your first prompt. You can configure which model and prompt the native `title` agent uses directly in your global or project configuration:

### Quick Setup (`~/.config/opencode/opencode.json` or `opencode.json`)

Add the `title` agent under `agents`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "agents": {
    "title": {
      "model": "github-copilot/gpt-4.1-mini", // Or: openrouter/openai/gpt-4o-mini, google/gemini-2.5-flash
      "prompt": "Generate a concise, specific title (3-6 words) for this conversation. Return ONLY the title."
    }
  }
}
```

### OpenCode Documentation & Resources

* [OpenCode Agent Configuration](https://opencode.ai/docs/agents) — Documentation on configuring primary and hidden system agents (`title`, `compaction`, `summary`).
* [OpenCode Configuration Reference](https://opencode.ai/docs) & [JSON Schema](https://opencode.ai/config.json) — Full configuration options.
* [OpenCode CLI Reference](https://opencode.ai/docs/cli) — Manual session naming via `opencode run --title "My Title"`.
* [Architectural Analysis](docs/opencode-2.0-analysis.md) — Detailed report explaining OpenCode 2.0's internal `SessionTitle` service and why an external plugin is obsolete.

---

## Legacy OpenCode 1.x Documentation

The documentation below is preserved for users running OpenCode 1.x.

AI-powered automatic session naming for [OpenCode](https://opencode.ai).

Automatically generates descriptive titles for your OpenCode sessions based on conversation context, replacing generic timestamp-based names like "2024-01-15 14:30" with meaningful descriptions like "Setup React Auth Flow".

### From Timestamp Chaos to Meaningful Titles

| Before | After |
|--------|-------|
| ![Before - Timestamp titles](docs/images/before.png) | ![After - Auto-generated titles](docs/images/after.png) |

## Features

- **Two-phase titling**: Instant keyword title on user message, refined AI title after response
- **AI-powered**: Auto-selects cheapest available model (flash/haiku/fast) for title generation
- **Instant feedback**: Keyword-based title appears immediately, no waiting for AI
- **Zero configuration**: Works out of the box with sensible defaults
- **Non-blocking**: Runs in the background, never slows your workflow
- **Respects custom titles**: Won't overwrite manually set session names

## Installation

### Quick Install (Recommended)

**Option 1: Let your AI agent install it**

Paste this into OpenCode, Claude Code, Cursor, or any AI coding assistant:

```
Install opencode-autotitle by following the instructions here:
https://raw.githubusercontent.com/pawelma/opencode-autotitle/refs/heads/master/docs/install.md
```

**Option 2: One-liner**

```bash
curl -fsSL https://raw.githubusercontent.com/pawelma/opencode-autotitle/refs/heads/master/install.sh | bash
```

### Manual Installation

OpenCode loads plugin **files** directly from `~/.config/opencode/plugins/`.

```bash
# Clone, build, and copy the plugin file
tmp_dir=$(mktemp -d)
git clone --depth 1 https://github.com/pawelma/opencode-autotitle "$tmp_dir"
cd "$tmp_dir" && npm install && npm run build
mkdir -p ~/.config/opencode/plugins
cp dist/index.js ~/.config/opencode/plugins/opencode-autotitle.js
rm -rf "$tmp_dir"
```

## How It Works

The plugin uses a **two-phase approach** for instant feedback with quality refinement:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         OPENCODE SESSION                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: Quick Title (on message.part.updated)                         │
│  ───────────────────────────────────────────────────────────────────────│
│                                                                         │
│   User types message ──► Extract keywords ──► Set title immediately     │
│                                                                         │
│   "Help me set up JWT auth"  ──►  "🔍 Jwt Auth Express"                 │
│                                                                         │
│   • No API call needed                                                  │
│   • Instant title update                                                │
│   • Uses keyword extraction + stop word filtering                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: AI Title (on session.idle)                                    │
│  ───────────────────────────────────────────────────────────────────────│
│                                                                         │
│   AI responds ──► Find cheap model ──► Generate title ──► Update        │
│                                                                         │
│   Context: user question + AI response                                  │
│                                                                         │
│   "🔍 Jwt Auth Express"  ──►  "✨ Setup JWT Auth Express"               │
│                                                                         │
│   • Uses cheapest available model (flash/haiku/fast)                    │
│   • Creates temp session for title generation                           │
│   • More specific title based on actual conversation                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  RESULT                                                                 │
│  ───────────────────────────────────────────────────────────────────────│
│                                                                         │
│   🔍 = Keyword-based title (fast fallback)                              │
│   ✨ = AI-generated title (final quality)                               │
│                                                                         │
│   Custom user titles are never overwritten                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### State Management

```
┌──────────────────────────────────────────────────────────────┐
│                      Plugin State                            │
├──────────────────────────────────────────────────────────────┤
│  keywordTitledSessions: Set<string>   ← Has 🔍 title         │
│  aiTitledSessions: Set<string>        ← Has ✨ title (done)  │
│  pendingAISessions: Set<string>       ← Currently processing │
│  cheapestModel: cached model choice   ← Lazily discovered    │
└──────────────────────────────────────────────────────────────┘
```

### Title Generation

Phase 1 sets a quick keyword title, Phase 2 refines it with AI:

| User Message | Generated Title |
|--------------|-----------------|
| "Help me set up authentication with JWT in my Express app" | "Setup JWT Auth Express" |
| "There's a bug in the login form, it's not validating emails" | "Fix Login Email Validation" |
| "Can you refactor the database queries to use connection pooling?" | "Refactor Database Pooling" |
| "Write tests for the payment processing module" | "Testing Payment Module" |

## Configuration

All configuration is optional. The plugin works out of the box.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_AUTOTITLE_MODEL` | (auto) | Model ID like `anthropic/claude-haiku-4-5` |
| `OPENCODE_AUTOTITLE_MAX_LENGTH` | `60` | Maximum title character length |
| `OPENCODE_AUTOTITLE_DISABLED` | `false` | Set to `1` to disable the plugin |
| `OPENCODE_AUTOTITLE_DEBUG` | `false` | File path for debug logs (e.g., `debug.log`) |

### Model Selection

By default, the plugin auto-discovers the cheapest available model from your connected providers, preferring models with names like `fast`, `flash`, `haiku`, or `mini`. To use a specific model:

```bash
export OPENCODE_AUTOTITLE_MODEL="anthropic/claude-haiku-4-5"
```

## Debugging

Enable debug mode to see what's happening:

```bash
export OPENCODE_AUTOTITLE_DEBUG=debug.log
opencode
# In another terminal: tail -f debug.log
```

Look for `[autotitle]` messages in the output.

## Development

```bash
# Clone the repository
git clone https://github.com/pawelma/opencode-autotitle
cd opencode-autotitle

# Install dependencies
npm install          # or: bun install

# Build
npm run build

# Watch mode
npm run dev

# Type check
npm run typecheck

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Inspirations

This project was inspired by and builds upon ideas from:

- **[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)** - The comprehensive OpenCode enhancement suite that pioneered the agent-assisted installation pattern and demonstrated what's possible with OpenCode plugins. The installation documentation approach used here is directly inspired by their excellent developer experience.

- **[opencode-zellij-namer](https://github.com/24601/opencode-zellij-namer)** - AI-powered Zellij session naming plugin that showed how to elegantly combine AI generation with fallback heuristics for naming. The signal collection and intent inference patterns in this plugin were influenced by their implementation.

Thank you to the maintainers and contributors of these projects for sharing their work with the community.

## License

MIT - see [LICENSE](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

> **Note:** Currently tested with the GitHub Copilot provider only.
