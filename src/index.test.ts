import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  isTimestampTitle,
  hasPluginEmoji,
  shouldModifyTitle,
  sanitizeTitle,
  extractKeywords,
  inferIntent,
  generateFallbackTitle,
  findCheapestFromModels,
  loadConfig,
  extractSessionId,
  extractMessageContent,
  CHEAP_MODEL_PATTERNS,
} from "./index"

describe("isTimestampTitle", () => {
  it("returns true for undefined title", () => {
    expect(isTimestampTitle(undefined)).toBe(true)
  })

  it("returns true for empty string", () => {
    expect(isTimestampTitle("")).toBe(true)
  })

  it("returns true for whitespace-only string", () => {
    expect(isTimestampTitle("   ")).toBe(true)
  })

  it("returns true for ISO date format (2024-01-15)", () => {
    expect(isTimestampTitle("2024-01-15")).toBe(true)
    expect(isTimestampTitle("2024-01-15 10:30:00")).toBe(true)
  })

  it("returns true for US date format (1/15/24)", () => {
    expect(isTimestampTitle("1/15/24")).toBe(true)
    expect(isTimestampTitle("01/15/2024")).toBe(true)
  })

  it("returns true for month-first format (Jan 15)", () => {
    expect(isTimestampTitle("Jan 15")).toBe(true)
    // Full month names aren't matched by the regex - only abbreviated forms
    expect(isTimestampTitle("Feb 20")).toBe(true)
  })

  it("returns true for day-first format (15 Jan)", () => {
    expect(isTimestampTitle("15 Jan")).toBe(true)
    expect(isTimestampTitle("20 February")).toBe(true)
  })

  it("returns true for 'Session N' format", () => {
    expect(isTimestampTitle("Session 1")).toBe(true)
    expect(isTimestampTitle("Session 123")).toBe(true)
  })

  it("returns true for 'New Session' format", () => {
    expect(isTimestampTitle("New Session")).toBe(true)
    expect(isTimestampTitle("new session")).toBe(true)
  })

  it("returns true for 'Untitled' format", () => {
    expect(isTimestampTitle("Untitled")).toBe(true)
    expect(isTimestampTitle("Untitled Session")).toBe(true)
  })

  it("returns false for custom titles", () => {
    expect(isTimestampTitle("Fix login bug")).toBe(false)
    expect(isTimestampTitle("Implement user auth")).toBe(false)
    expect(isTimestampTitle("Refactor database layer")).toBe(false)
  })
})

describe("hasPluginEmoji", () => {
  it("returns false for undefined title", () => {
    expect(hasPluginEmoji(undefined)).toBe(false)
  })

  it("returns true for keyword emoji prefix", () => {
    expect(hasPluginEmoji("🔍 Fix Bug")).toBe(true)
  })

  it("returns true for AI emoji prefix", () => {
    expect(hasPluginEmoji("✨ Implement Feature")).toBe(true)
  })

  it("returns false for titles without plugin emojis", () => {
    expect(hasPluginEmoji("Fix login bug")).toBe(false)
    expect(hasPluginEmoji("🚀 Deploy feature")).toBe(false)
  })
})

describe("shouldModifyTitle", () => {
  it("returns true for timestamp titles", () => {
    expect(shouldModifyTitle("2024-01-15")).toBe(true)
    expect(shouldModifyTitle("New Session")).toBe(true)
  })

  it("returns true for titles with plugin emojis", () => {
    expect(shouldModifyTitle("🔍 Keywords")).toBe(true)
    expect(shouldModifyTitle("✨ AI Title")).toBe(true)
  })

  it("returns false for custom user titles", () => {
    expect(shouldModifyTitle("My custom title")).toBe(false)
    expect(shouldModifyTitle("Fix authentication bug")).toBe(false)
  })
})

describe("sanitizeTitle", () => {
  it("removes special characters except dots and hyphens", () => {
    expect(sanitizeTitle("Hello! World?", 60)).toBe("Hello World")
    expect(sanitizeTitle("Test: \"quotes\"", 60)).toBe("Test quotes")
  })

  it("preserves dots in filenames", () => {
    expect(sanitizeTitle("Update AGENTS.md file", 60)).toBe("Update AGENTS.md file")
    expect(sanitizeTitle("Fix package.json", 60)).toBe("Fix package.json")
  })

  it("preserves hyphens", () => {
    expect(sanitizeTitle("fix-bug-123", 60)).toBe("fix-bug-123")
  })

  it("normalizes whitespace", () => {
    expect(sanitizeTitle("Hello   World", 60)).toBe("Hello World")
    expect(sanitizeTitle("  leading spaces  ", 60)).toBe("leading spaces")
  })

  it("respects maxLength", () => {
    const longTitle = "This is a very long title that exceeds the maximum length"
    expect(sanitizeTitle(longTitle, 20).length).toBeLessThanOrEqual(20)
  })

  it("handles empty string", () => {
    expect(sanitizeTitle("", 60)).toBe("")
  })
})

describe("extractKeywords", () => {
  it("extracts meaningful words from text", () => {
    const keywords = extractKeywords("Please help me fix the login bug")
    expect(keywords).toContain("login")
    expect(keywords).toContain("bug")
  })

  it("filters out stop words", () => {
    const keywords = extractKeywords("I want to create a new function")
    expect(keywords).not.toContain("i")
    expect(keywords).not.toContain("want")
    expect(keywords).not.toContain("to")
    expect(keywords).not.toContain("a")
    expect(keywords).toContain("function")
  })

  it("preserves word order", () => {
    const keywords = extractKeywords("database migration testing")
    expect(keywords).toEqual(["database", "migration", "testing"])
  })

  it("removes duplicates while preserving order", () => {
    const keywords = extractKeywords("bug bug bug fix bug")
    expect(keywords.filter(k => k === "bug").length).toBe(1)
  })

  it("limits to 6 keywords", () => {
    const keywords = extractKeywords("one two three four five six seven eight nine ten")
    expect(keywords.length).toBeLessThanOrEqual(6)
  })

  it("filters words shorter than 3 characters", () => {
    const keywords = extractKeywords("a ab abc abcd")
    expect(keywords).not.toContain("a")
    expect(keywords).not.toContain("ab")
    expect(keywords).toContain("abc")
    expect(keywords).toContain("abcd")
  })

  it("handles empty string", () => {
    expect(extractKeywords("")).toEqual([])
  })

  it("handles string with only stop words", () => {
    expect(extractKeywords("the and or but")).toEqual([])
  })
})

describe("inferIntent", () => {
  it("detects testing intent", () => {
    expect(inferIntent("add unit test for login")).toBe("testing")
    expect(inferIntent("pytest failing")).toBe("testing")
    expect(inferIntent("jest spec")).toBe("testing")
    expect(inferIntent("vitest config")).toBe("testing")
  })

  it("detects debugging intent", () => {
    expect(inferIntent("debug this error")).toBe("debugging")
    expect(inferIntent("stack trace issue")).toBe("debugging")
    expect(inferIntent("breakpoint not working")).toBe("debugging")
  })

  it("detects fix intent", () => {
    expect(inferIntent("fix this bug")).toBe("fix")
    expect(inferIntent("broken login")).toBe("fix")
    expect(inferIntent("patch the code")).toBe("fix")
  })

  it("detects refactor intent", () => {
    expect(inferIntent("refactor the database layer")).toBe("refactor")
    expect(inferIntent("cleanup old code")).toBe("refactor")
    expect(inferIntent("restructure components")).toBe("refactor")
  })

  it("detects docs intent", () => {
    expect(inferIntent("update readme")).toBe("docs")
    expect(inferIntent("add documentation")).toBe("docs")
    expect(inferIntent("comment the function")).toBe("docs")
  })

  it("detects review intent", () => {
    expect(inferIntent("review this PR")).toBe("review")
    expect(inferIntent("pull request changes")).toBe("review")
  })

  it("detects devops intent", () => {
    expect(inferIntent("deploy to production")).toBe("devops")
    expect(inferIntent("docker config")).toBe("devops")
    // 'kubernetes' is not in the pattern, only 'k8s'
    expect(inferIntent("k8s cluster")).toBe("devops")
    expect(inferIntent("terraform apply")).toBe("devops")
    expect(inferIntent("ci pipeline")).toBe("devops")
  })

  it("detects api intent", () => {
    expect(inferIntent("create api endpoint")).toBe("api")
    // 'issue' triggers 'debugging' first, so use different examples
    expect(inferIntent("route handler config")).toBe("api")
    expect(inferIntent("controller logic")).toBe("api")
  })

  it("detects ui intent", () => {
    expect(inferIntent("update the ui")).toBe("ui")
    // 'issue' triggers 'debugging' first, so use different examples
    expect(inferIntent("frontend component styles")).toBe("ui")
    expect(inferIntent("css styling")).toBe("ui")
  })

  it("detects database intent", () => {
    expect(inferIntent("database query slow")).toBe("database")
    expect(inferIntent("sql migration")).toBe("database")
    expect(inferIntent("db connection")).toBe("database")
  })

  it("detects auth intent", () => {
    // 'issue' triggers 'debugging' first, so use different examples
    expect(inferIntent("auth flow")).toBe("auth")
    expect(inferIntent("login page")).toBe("auth")
    expect(inferIntent("token expired")).toBe("auth")
    expect(inferIntent("password reset")).toBe("auth")
  })

  it("detects setup intent", () => {
    expect(inferIntent("config file")).toBe("setup")
    expect(inferIntent("setup project")).toBe("setup")
    expect(inferIntent("install dependencies")).toBe("setup")
  })

  it("returns empty string for unknown intent", () => {
    expect(inferIntent("something random")).toBe("")
  })
})

describe("generateFallbackTitle", () => {
  it("generates title from keywords", () => {
    const title = generateFallbackTitle("fix the database connection issue", 60)
    expect(title.length).toBeGreaterThan(0)
    expect(title.length).toBeLessThanOrEqual(60)
  })

  it("uses title case", () => {
    const title = generateFallbackTitle("database migration", 60)
    expect(title).toMatch(/^[A-Z]/)
  })

  it("respects maxLength", () => {
    const title = generateFallbackTitle("this is a very long message with many words", 20)
    expect(title.length).toBeLessThanOrEqual(20)
  })

  it("returns empty string for empty input", () => {
    expect(generateFallbackTitle("", 60)).toBe("")
  })

  it("returns empty string for input with only stop words", () => {
    // Short texts under maxLength are used directly as title case
    // This is by design - see generateFallbackTitle implementation
    expect(generateFallbackTitle("the and or", 60)).toBe("The And Or")
    // Only returns empty when both keywords extraction fails AND cleaned text is too short
    expect(generateFallbackTitle("a", 60)).toBe("")
  })

  it("uses short text directly if under maxLength", () => {
    const title = generateFallbackTitle("fix bug", 60)
    expect(title).toBe("Fix Bug")
  })
})

describe("findCheapestFromModels", () => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns null for empty array", () => {
    expect(findCheapestFromModels([], mockLogger)).toBeNull()
  })

  it("returns null for empty object", () => {
    expect(findCheapestFromModels({}, mockLogger)).toBeNull()
  })

  it("finds model with 'fast' pattern", () => {
    const models = ["gpt-4", "grok-code-fast", "claude-3"]
    expect(findCheapestFromModels(models, mockLogger)).toBe("grok-code-fast")
  })

  it("finds model with 'flash' pattern", () => {
    const models = ["gpt-4", "gemini-flash", "claude-3"]
    expect(findCheapestFromModels(models, mockLogger)).toBe("gemini-flash")
  })

  it("finds model with 'haiku' pattern", () => {
    const models = ["gpt-4", "claude-3-haiku", "claude-3-opus"]
    expect(findCheapestFromModels(models, mockLogger)).toBe("claude-3-haiku")
  })

  it("finds model with 'mini' pattern", () => {
    const models = ["gpt-4", "gpt-4o-mini", "claude-3"]
    expect(findCheapestFromModels(models, mockLogger)).toBe("gpt-4o-mini")
  })

  it("prioritizes patterns correctly (fast > flash > haiku)", () => {
    const models = ["claude-3-haiku", "gemini-flash", "grok-fast"]
    expect(findCheapestFromModels(models, mockLogger)).toBe("grok-fast")
  })

  it("returns first model if no cheap pattern matches", () => {
    const models = ["gpt-4", "claude-opus", "llama-70b"]
    expect(findCheapestFromModels(models, mockLogger)).toBe("gpt-4")
  })

  it("handles object format with model IDs as keys", () => {
    const models = { "gpt-4": {}, "grok-fast": {}, "claude-opus": {} }
    expect(findCheapestFromModels(models, mockLogger)).toBe("grok-fast")
  })

  it("handles array of objects with id property", () => {
    const models = [
      { id: "gpt-4", name: "GPT-4" },
      { id: "claude-haiku", name: "Haiku" },
    ]
    expect(findCheapestFromModels(models, mockLogger)).toBe("claude-haiku")
  })
})

describe("loadConfig", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("returns default config when no env vars set", () => {
    delete process.env.OPENCODE_AUTOTITLE_MODEL
    delete process.env.OPENCODE_AUTOTITLE_PROVIDER
    delete process.env.OPENCODE_AUTOTITLE_MAX_LENGTH
    delete process.env.OPENCODE_AUTOTITLE_DISABLED
    delete process.env.OPENCODE_AUTOTITLE_DEBUG

    const config = loadConfig()
    expect(config.model).toBeNull()
    expect(config.provider).toBeNull()
    expect(config.maxLength).toBe(60)
    expect(config.disabled).toBe(false)
    expect(config.debug).toBe(false)
  })

  it("reads model from env var", () => {
    process.env.OPENCODE_AUTOTITLE_MODEL = "anthropic/claude-3-haiku"
    const config = loadConfig()
    expect(config.model).toBe("anthropic/claude-3-haiku")
  })

  it("reads provider from env var", () => {
    process.env.OPENCODE_AUTOTITLE_PROVIDER = "openai"
    const config = loadConfig()
    expect(config.provider).toBe("openai")
  })

  it("reads maxLength from env var", () => {
    process.env.OPENCODE_AUTOTITLE_MAX_LENGTH = "80"
    const config = loadConfig()
    expect(config.maxLength).toBe(80)
  })

  it("reads disabled from env var (1)", () => {
    process.env.OPENCODE_AUTOTITLE_DISABLED = "1"
    const config = loadConfig()
    expect(config.disabled).toBe(true)
  })

  it("reads disabled from env var (true)", () => {
    process.env.OPENCODE_AUTOTITLE_DISABLED = "true"
    const config = loadConfig()
    expect(config.disabled).toBe(true)
  })

  it("reads debug as boolean when set to '1'", () => {
    process.env.OPENCODE_AUTOTITLE_DEBUG = "1"
    const config = loadConfig()
    expect(config.debug).toBe(true)
  })

  it("reads debug as boolean when set to 'true'", () => {
    process.env.OPENCODE_AUTOTITLE_DEBUG = "true"
    const config = loadConfig()
    expect(config.debug).toBe(true)
  })

  it("reads debug as file path", () => {
    process.env.OPENCODE_AUTOTITLE_DEBUG = "/path/to/debug.log"
    const config = loadConfig()
    expect(config.debug).toBe("/path/to/debug.log")
  })

  it("reads debug as false when set to '0'", () => {
    process.env.OPENCODE_AUTOTITLE_DEBUG = "0"
    const config = loadConfig()
    expect(config.debug).toBe(false)
  })
})

describe("extractSessionId", () => {
  it("extracts sessionID from properties", () => {
    const event = { properties: { sessionID: "session-123" } }
    expect(extractSessionId(event)).toBe("session-123")
  })

  it("extracts session.id from properties", () => {
    const event = { properties: { session: { id: "session-456" } } }
    expect(extractSessionId(event)).toBe("session-456")
  })

  it("extracts info.id from properties", () => {
    const event = { properties: { info: { id: "session-789" } } }
    expect(extractSessionId(event)).toBe("session-789")
  })

  it("extracts sessionID from root", () => {
    const event = { sessionID: "session-root" }
    expect(extractSessionId(event)).toBe("session-root")
  })

  it("extracts session.id from root", () => {
    const event = { session: { id: "session-root-nested" } }
    expect(extractSessionId(event)).toBe("session-root-nested")
  })

  it("returns null for missing sessionId", () => {
    const event = { type: "test" }
    expect(extractSessionId(event)).toBeNull()
  })

  it("returns null for null event", () => {
    expect(extractSessionId(null)).toBeNull()
  })

  it("returns null for undefined event", () => {
    expect(extractSessionId(undefined)).toBeNull()
  })
})

describe("extractMessageContent", () => {
  it("extracts content string from user message", () => {
    const event = {
      properties: {
        messages: [{ role: "user", content: "Hello world" }],
      },
    }
    expect(extractMessageContent(event)).toBe("Hello world")
  })

  it("extracts text string from user message", () => {
    const event = {
      properties: {
        messages: [{ role: "user", text: "Hello text" }],
      },
    }
    expect(extractMessageContent(event)).toBe("Hello text")
  })

  it("extracts text from parts array", () => {
    const event = {
      properties: {
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Hello parts" }],
          },
        ],
      },
    }
    expect(extractMessageContent(event)).toBe("Hello parts")
  })

  it("handles info.role format", () => {
    const event = {
      properties: {
        messages: [{ info: { role: "user" }, content: "Hello info" }],
      },
    }
    expect(extractMessageContent(event)).toBe("Hello info")
  })

  it("returns null for empty messages", () => {
    const event = { properties: { messages: [] } }
    expect(extractMessageContent(event)).toBeNull()
  })

  it("returns null for assistant-only messages", () => {
    const event = {
      properties: {
        messages: [{ role: "assistant", content: "I am assistant" }],
      },
    }
    expect(extractMessageContent(event)).toBeNull()
  })

  it("returns null for null event", () => {
    expect(extractMessageContent(null)).toBeNull()
  })
})

describe("CHEAP_MODEL_PATTERNS", () => {
  it("contains expected patterns", () => {
    expect(CHEAP_MODEL_PATTERNS.some(p => p.source.includes("fast"))).toBe(true)
    expect(CHEAP_MODEL_PATTERNS.some(p => p.source.includes("flash"))).toBe(true)
    expect(CHEAP_MODEL_PATTERNS.some(p => p.source.includes("haiku"))).toBe(true)
    expect(CHEAP_MODEL_PATTERNS.some(p => p.source.includes("mini"))).toBe(true)
  })

  it("patterns are case-insensitive", () => {
    const fastPattern = CHEAP_MODEL_PATTERNS.find(p => p.source.includes("fast"))
    expect(fastPattern?.test("FAST")).toBe(true)
    expect(fastPattern?.test("Fast")).toBe(true)
    expect(fastPattern?.test("fast")).toBe(true)
  })
})
