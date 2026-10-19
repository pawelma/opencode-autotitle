# OpenCode 2.0 Architecture Analysis: Session Autotitling & Plugin Feasibility

## Executive Summary

**Verdict: Updating and maintaining `opencode-autotitle` for OpenCode 2.0 does not make sense.**

OpenCode 2.0 has introduced a native, first-class background service (`SessionTitle`) powered by an internal system agent (`title`). It automatically names sessions after the first user message, manages fallback and bounded conversation contexts, tracks token usage and costs, protects manual renames from race conditions, and supports title regeneration.

Attempting to update `opencode-autotitle` for OpenCode 2.0 is both **functionally obsolete** and **architecturally incompatible**:
1. **Redundancy & Conflicts:** Running this plugin alongside OpenCode 2.0 triggers competing LLM calls and race conditions. OpenCode's native generator aborts if a session title is non-default, meaning the plugin's phase-1 keyword title (`🔍`) actually prevents OpenCode's native, higher-quality title generation.
2. **Architectural Mismatch in PR #2:** The existing migration attempt on branch `migrate-to-opencode-v2` (PR #2) assumes APIs on `PluginContext` (`ctx.event.subscribe`, `ctx.session.update`, `ctx.client`) that do not exist in the OpenCode 2.0 Plugin SDK. It only passed unit tests because the tests mocked these non-existent interfaces.
3. **Native Configuration Replaces the Plugin:** Users who want fast or cheap models for titling can configure the native `title` agent directly in `opencode.json` using `agents.title.model`.

---

## 1. Deep Dive: OpenCode 2.0 Native Titling Architecture

In OpenCode 2.0, session titling is no longer an afterthought or an extension point requiring external polling. It is handled directly within `packages/core`:

### 1.1 The `SessionTitle` Core Service
* **Source:** `packages/core/src/session/title.ts`
* **Lifecycle:** When a session receives its first user message, OpenCode checks if the session has a default title (`isExactRootFallback` / `isDefaultTitle`, matching patterns like `New session - <timestamp>`).
* **Generation Process:**
  - Extracts the initial user message (bounded to 2,000 characters).
  - For title regeneration on existing sessions, it extracts the initial goal plus recent turns up to an 8,000-character context window.
  - Excludes internal subagent private reasoning (e.g., `<thought>` blocks).
  - Calls the resolved title model and streams the response.
  - Truncates the result to 100 characters and publishes `SessionEvent.Renamed`.
* **Cost & Token Accounting:** OpenCode records all token usage and costs incurred by titling under the source `"title"`, associating it with the session usage metrics.
* **Concurrency Protection:** Uses `Bus.latestSequence` optimistic concurrency control. If a user manually renames the session while title generation is in flight, the generated title is automatically discarded.

### 1.2 The Built-in `title` Agent
* OpenCode 2.0 includes a hidden built-in system agent with ID `"title"`.
* **Model Resolution Hierarchy:**
  1. `agents.title.model` in `opencode.json` (user-specified override).
  2. `small_model` in `opencode.json` (legacy / fallback configuration).
  3. The session's primary model.
* **Minimal Reasoning:** Automatically selects minimal reasoning variants (`none`, `minimal`, `low`) on reasoning models to ensure fast, low-cost execution.

### 1.3 The `session.title` Plugin Hook (PR #47663)
In OpenCode 2.0, plugins that want to customize title generation do not intercept messages or spawn temporary sessions. OpenCode introduced a dedicated plugin hook:
```typescript
export interface SessionTitle extends SessionRequest {
  readonly sessionID: Session.ID
  readonly model: Model.Ref
  system: Array<SystemPart>
  messages: Array<Message>
  options: SessionRequestOptions
}
```
This hook allows a plugin to modify the system prompt, messages, or options sent to the LLM during the native title generation step—without taking over session lifecycle management.

---

## 2. Analysis of `opencode-autotitle` (v1.x)

In OpenCode 1.x, session titles frequently remained as generic ISO timestamps (`2024-01-15 14:30`). To solve this, `opencode-autotitle` used a two-phase workaround:

```
User Message 
  ──► Phase 1 (Keyword): Extract keywords ──► Set title "🔍 Keyword Title"
  ──► Phase 2 (AI on session.idle):
        1. Create temp session: client.session.create({ body: { title: "autotitle-temp" } })
        2. Send prompt: client.session.prompt(...)
        3. Parse response and update original session: "✨ AI Title"
        4. Delete temp session: client.session.delete(...)
```

While innovative for OpenCode 1.x, this approach suffered from inherent drawbacks:
- Created and deleted throwaway sessions on every conversation turn.
- Relied on arbitrary heuristics to search providers for cheap models.
- Required full client API access and custom event tracking.

---

## 3. Analysis of the V2 Migration Attempt (Branch `migrate-to-opencode-v2` / PR #2)

Branch `migrate-to-opencode-v2` attempted to adapt `src/index.ts` to `Plugin.define` from `@opencode/plugin`. A review of the code reveals critical architectural flaws:

### 3.1 Non-Existent Interfaces on `PluginContext`
In `src/index.ts` (lines 543-547 and 789-808):
```typescript
export const plugin = Plugin.define({
  id: "autotitle",
  async setup(ctx) {
    const client = (ctx as any).client || (ctx as any).sdk || (ctx as any)
    ...
    if (ctx.event && typeof (ctx.event as any).subscribe === "function") {
      const stream = await (ctx.event as any).subscribe()
      ...
    }
```
**Reality in `@opencode-ai/plugin` v2 (`v2/promise/context.d.ts`):**
```typescript
export interface PluginContext {
  readonly options: PluginOptions
  readonly agent: AgentHooks & Reload
  readonly aisdk: AISDKHooks
  readonly catalog: CatalogHooks & Reload
  readonly command: CommandHooks & Reload
  readonly integration: IntegrationHooks & Reload
  readonly plugin: PluginDomain
  readonly reference: ReferenceHooks & Reload
  readonly skill: SkillHooks & Reload
}
```
- `ctx.event` does **not** exist.
- `ctx.client` does **not** exist.
- `ctx.session` does **not** exist.

The `setup` function will never subscribe to any events in a real OpenCode 2.0 instance. The event loop never runs, and the plugin is effectively inert.

### 3.2 False Positive Unit Tests
`src/index.test.ts` lines 582-598 passed because the test mocked `mockCtx` with:
```typescript
const mockCtx = {
  session: { ... },
  event: { subscribe: vi.fn(...) }
}
```
The test verified that the mock was called, not that the mock matched OpenCode 2.0's actual runtime contracts.

---

## 4. Conflict & Race Condition Matrix

If someone were to bridge the plugin to OpenCode 2.0's event bus, severe regressions would occur:

| Stage | OpenCode 2.0 Native Behavior | `opencode-autotitle` Behavior | Conflict / Outcome |
|---|---|---|---|
| **Turn 1 (Prompt Sent)** | Evaluates `isExactRootFallback` (checks if title is timestamp). Dispatches background `title.generate`. | Intercepts `message.part.updated`. Instantly updates session title to `🔍 Keyword`. | **Race condition:** Because the title is now `🔍 Keyword`, OpenCode 2.0's `isExactRootFallback` returns `false` and cancels native AI generation. The user is left with a rudimentary keyword title. |
| **Turn 1 (Response Completed)** | Background LLM finishes, renames session to clean title (e.g., `Review stamp-wallet PR #30`). | Intercepts `session.idle`. Spawns `autotitle-temp` session, runs second LLM call, overwrites title with `✨ AI Title`. | **Wasted cost & thrashing:** Two separate LLM calls run per session. Session title flickers multiple times. Temp session artifacts pollute SQLite history. |
| **User Renames Session** | `Bus.latestSequence` detects sequence mismatch and cancels background rename. | State tracker unaware of sequence number; overwrites user title on idle. | **Data loss:** User's custom session name is overwritten. |

---

## 5. How to Achieve the Desired Behavior in OpenCode 2.0

All primary goals of `opencode-autotitle` (automatic naming, cheap/fast models, zero manual intervention) are natively supported in OpenCode 2.0 via `~/.config/opencode/opencode.json`.

### Recommended Configuration (`opencode.json`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",

  // Configure the built-in title agent with your preferred fast/cheap model
  "agents": {
    "title": {
      "model": "github-copilot/gpt-4.1-mini", // or openrouter/openai/gpt-4o-mini, google/gemini-2.5-flash
      "prompt": "Generate a concise, specific title (3-6 words) for this conversation. Return ONLY the title."
    }
  }
}
```

### Manual Renaming and CLI Options:
* **CLI flag on startup:** `opencode --title "My Feature" ...`
* **In-session tool:** OpenCode includes `session_rename` for agents/users to rename sessions programmatically.
* **TUI feedback:** OpenCode 2.0 displays an animated title shimmer (`title-shimmer.tsx`) while title generation is in flight, eliminating the need for a temporary keyword title.

---

## 6. Recommendations

1. **Do not migrate `opencode-autotitle` to OpenCode 2.0.**
   - The plugin's core utility has been upstreamed and perfected inside OpenCode core.
2. **Close PR #2 (`migrate-to-opencode-v2`).**
   - The PR relies on fabricated interfaces and does not function in real OpenCode 2.0 runtimes.
3. **Update README.md & Deprecate Repository:**
   - Mark `opencode-autotitle` as deprecated for OpenCode 2.0+.
   - Add a notice directing users to OpenCode 2.0's native `agents.title` configuration.
   - Retain v0.1.3 on npm for historical OpenCode 1.x installations.
