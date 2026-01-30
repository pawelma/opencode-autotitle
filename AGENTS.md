# AGENTS.md - Coding Agent Guidelines

This document provides guidelines for AI coding agents working on the opencode-autotitle project.

## Project Overview

OpenCode plugin that automatically generates AI-powered session titles based on conversation context. Single-file TypeScript implementation (~480 lines) using the OpenCode Plugin SDK.

**Tech Stack:** TypeScript, Node.js >= 18, Bun >= 1.0, ESM modules

## Build/Lint/Test Commands

### Build Commands

```bash
# Build TypeScript to JavaScript
npm run build        # or: bun run build

# Watch mode for development
npm run dev          # or: bun run dev

# Type check without emitting files
npm run typecheck    # or: bun run typecheck
```

### Install Dependencies

```bash
bun install          # Preferred
npm install          # Alternative
```

### No Tests Currently

This project does not have a test suite. If adding tests, consider:
- Using Vitest or Jest for unit tests
- Testing pure functions: `extractKeywords`, `inferIntent`, `sanitizeTitle`, `isTimestampTitle`, `generateFallbackTitle`

### No Linter Currently

No ESLint or Prettier configuration exists. When adding:
- Prefer ESLint with TypeScript support
- Use Prettier for formatting

## Code Style Guidelines

### File Structure

- **Single-file architecture**: All plugin logic lives in `src/index.ts`
- **Output directory**: `dist/` (generated, gitignored)
- **Entry point**: `dist/index.js` with TypeScript declarations

### Imports

```typescript
// Use type-only imports for types
import type { Plugin } from "@opencode-ai/plugin"

// ESM module syntax only (no CommonJS)
export const AutoTitle: Plugin = async ({ client }) => { ... }
export default AutoTitle
```

### TypeScript Configuration

- **Target**: ES2022
- **Module**: ESNext with bundler resolution
- **Strict mode**: Enabled
- Generates declarations, declaration maps, and source maps

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Interfaces | PascalCase | `PluginConfig`, `State` |
| Functions | camelCase | `loadConfig`, `createLogger` |
| Constants | camelCase | `stopWords` |
| Environment vars | SCREAMING_SNAKE_CASE | `OPENCODE_AUTOTITLE_DEBUG` |
| Plugin export | PascalCase | `AutoTitle` |

### Function Patterns

```typescript
// Pure utility functions at module level
function sanitizeTitle(title: string, maxLength: number): string {
  return title
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

// Async functions for SDK operations
async function generateAITitle(
  client: any,
  sessionId: string,
  userMessage: string,
  assistantMessage: string | null,
  config: PluginConfig,
  log: ReturnType<typeof createLogger>
): Promise<string | null> {
  // ...
}
```

### Error Handling

```typescript
// Use try-catch with graceful fallbacks
try {
  const result = await client.session.get({ path: { id: sessionId } })
  // ...
} catch (err) {
  log.error(`Failed: ${err instanceof Error ? err.message : "unknown"}`)
}

// Fire-and-forget cleanup with .catch(() => {})
await client.session.delete({ path: { id: tempSessionId } }).catch(() => {})
```

### Type Assertions

```typescript
// Use `as any` for dynamic SDK responses (SDK types are incomplete)
const sessionResponse = await client.session.get({
  path: { id: sessionId },
}) as any

const sessionData = sessionResponse?.data || sessionResponse
```

### Environment Variable Handling

```typescript
// All config via environment variables with OPENCODE_AUTOTITLE_ prefix
function loadConfig(): PluginConfig {
  const env = process.env
  return {
    model: env.OPENCODE_AUTOTITLE_MODEL || null,
    maxLength: Number(env.OPENCODE_AUTOTITLE_MAX_LENGTH) || 60,
    disabled: env.OPENCODE_AUTOTITLE_DISABLED === "1" || env.OPENCODE_AUTOTITLE_DISABLED === "true",
    debug: env.OPENCODE_AUTOTITLE_DEBUG || false,  // File path for debug logs
  }
}
```

### Logging Pattern

```typescript
// Create logger with debug flag and optional client
const log = createLogger(config.debug, client)

// Usage
log.debug("Detailed info")   // Only shows when OPENCODE_AUTOTITLE_DEBUG is set
log.info("Important info")   // Only shows when OPENCODE_AUTOTITLE_DEBUG is set
log.error("Always shows")    // Always outputs to stderr
```

### Plugin Export Pattern

```typescript
// Named export for explicit imports
export const AutoTitle: Plugin = async ({ client }) => {
  // Initialize config and state
  const config = loadConfig()
  const state: State = { titledSessions: new Set(), pendingSessions: new Set() }

  // Return event handler object
  return {
    event: async ({ event }: { event: unknown }) => {
      // Handle events
    },
  }
}

// Default export for convenience
export default AutoTitle
```

## Project-Specific Guidelines

### State Management

Use `Set<string>` for tracking session IDs:

```typescript
interface State {
  titledSessions: Set<string>   // Sessions already titled
  pendingSessions: Set<string>  // Sessions being processed (prevents race conditions)
}
```

### String Processing

- Use regex patterns for timestamp detection
- Extract keywords by filtering stop words
- Sanitize titles: remove special chars, normalize whitespace, apply max length

### SDK Interaction

The OpenCode SDK client provides:
- `client.session.get({ path: { id } })` - Get session info
- `client.session.messages({ path: { id } })` - Get session messages
- `client.session.update({ path: { id }, body: { title } })` - Update session
- `client.session.create({ body: { title } })` - Create session
- `client.session.delete({ path: { id } })` - Delete session
- `client.session.prompt({ path: { id }, body: { parts } })` - Send prompt
- `client.app.log({ body: { service, level, message } })` - Log to app

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main plugin implementation |
| `package.json` | Project manifest and scripts |
| `tsconfig.json` | TypeScript configuration |
| `dist/index.js` | Compiled output (generated) |

## Git Workflow

- Main branch: `main`
- Feature branches: `feature/description`
- Commit style: Conventional-ish (`Add feature`, `Fix bug`, `Update docs`)
- PR workflow: Fork -> Branch -> Commit -> Push -> PR

### Commit Guidelines

- **Stage files explicitly**: Always use `git add <specific-files>` instead of `git add .` to ensure only intended changes are committed
- **Concise commit messages**: Write short, human-readable first line that can be quickly scanned. Additional details can go on subsequent lines, but keep them focused.
  - Good:
    ```
    Add debug logging to title generation

    Log session ID and message content before API call.
    Helps diagnose why some titles fail to generate.
    ```
  - Good: `Fix race condition in session tracking`
  - Bad: `Updated the generateAITitle function to add additional debug logging statements for better observability`
- **One logical change per commit**: Keep commits focused on a single purpose

## Common Tasks

### Adding a New Configuration Option

1. Add to `PluginConfig` interface
2. Add parsing in `loadConfig()`
3. Use the option where needed
4. Document in README.md

### Adding a New Event Handler

Events are handled in the `event` function returned by the plugin:

```typescript
return {
  event: async ({ event }: { event: unknown }) => {
    const e = event as any
    if (e?.type === "your.event.type") {
      // Handle event
    }
  },
}
```

### Debugging

```bash
export OPENCODE_AUTOTITLE_DEBUG=debug.log
opencode
# In another terminal: tail -f debug.log
```
