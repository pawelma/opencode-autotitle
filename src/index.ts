import type { Plugin } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"

// Emoji prefixes for titles
const EMOJI_KEYWORD = "🔍"  // Used for quick keyword-based titles
const EMOJI_AI = "✨"       // Used for AI-generated titles

interface PluginConfig {
  model: string | null
  provider: string | null
  maxLength: number
  disabled: boolean
  debug: boolean | string  // true, false, or path to log file
}

interface State {
  keywordTitledSessions: Set<string>  // Sessions with keyword title (waiting for AI)
  aiTitledSessions: Set<string>       // Sessions with final AI title
  pendingAISessions: Set<string>      // Sessions currently generating AI title
  cheapestModel: { providerID: string; modelID: string } | null | undefined
}

// Known cheap/fast model patterns - ordered by preference
// Priority: fast (often free) > flash (very cheap) > haiku (cheap) > other cheap patterns
const CHEAP_MODEL_PATTERNS = [
  /fast/i,      // Grok Code Fast, etc. (often free)
  /flash/i,     // Gemini Flash (very cheap)
  /haiku/i,     // Claude Haiku (cheap)
  /mini/i,
  /instant/i,
  /small/i,
  /lite/i,
  /turbo/i,
  /8b/i,
  /7b/i,
]

function findCheapestFromModels(models: any, log: ReturnType<typeof createLogger>): string | null {
  // Handle both array and object formats
  let modelIds: string[] = []
  
  if (Array.isArray(models)) {
    modelIds = models
      .map((m: any) => m.id || m.name || m)
      .filter((id): id is string => typeof id === "string")
  } else if (models && typeof models === "object") {
    // Models is an object with model IDs as keys
    modelIds = Object.keys(models)
  }
  
  if (modelIds.length === 0) return null
  
  log.debug(`Available models: ${modelIds.slice(0, 10).join(", ")}${modelIds.length > 10 ? "..." : ""}`)
  
  // Try to find a cheap model by pattern matching
  for (const pattern of CHEAP_MODEL_PATTERNS) {
    const match = modelIds.find(id => pattern.test(id))
    if (match) {
      log.debug(`Found cheap model by pattern ${pattern}: ${match}`)
      return match
    }
  }
  
  // No cheap model found, return first available
  log.debug(`No cheap model pattern matched, using first: ${modelIds[0]}`)
  return modelIds[0] || null
}

function loadConfig(): PluginConfig {
  const env = process.env
  const debugEnv = env.OPENCODE_AUTOTITLE_DEBUG
  
  // Debug can be: "1", "true" (enable stderr), or a file path
  let debug: boolean | string = false
  if (debugEnv) {
    if (debugEnv === "1" || debugEnv === "true") {
      debug = true
    } else if (debugEnv !== "0" && debugEnv !== "false") {
      // Treat as file path
      debug = debugEnv
    }
  }
  
  return {
    model: env.OPENCODE_AUTOTITLE_MODEL || null,
    provider: env.OPENCODE_AUTOTITLE_PROVIDER || null,
    maxLength: Number(env.OPENCODE_AUTOTITLE_MAX_LENGTH) || 60,
    disabled: env.OPENCODE_AUTOTITLE_DISABLED === "1" || env.OPENCODE_AUTOTITLE_DISABLED === "true",
    debug,
  }
}

function createLogger(debug: boolean | string, client?: any) {
  const isEnabled = !!debug
  const logFile = typeof debug === "string" ? debug : null
  
  // If logging to file, resolve path and ensure directory exists
  let logPath: string | null = null
  if (logFile) {
    logPath = path.isAbsolute(logFile) ? logFile : path.resolve(process.cwd(), logFile)
    try {
      const dir = path.dirname(logPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      // Clear log file on startup
      fs.writeFileSync(logPath, `[autotitle] Log started at ${new Date().toISOString()}\n`)
    } catch {
      // Fall back to stderr if file creation fails
      logPath = null
    }
  }
  
  const log = (level: string, msg: string) => {
    // Only show debug and info when debug mode is enabled
    if ((level === "debug" || level === "info") && !isEnabled) return
    
    const timestamp = new Date().toISOString()
    const line = `[autotitle] ${timestamp} ${level.toUpperCase()}: ${msg}`
    
    if (logPath) {
      // Append to log file
      try {
        fs.appendFileSync(logPath, line + "\n")
      } catch {
        // Fallback to stderr
        console.error(line)
      }
    } else if (isEnabled || level === "error") {
      // Log to stderr
      console.error(line)
    }
    
    // Also use client.app.log if available
    if (client?.app?.log) {
      client.app.log({
        body: {
          service: "autotitle",
          level: level as "debug" | "info" | "warn" | "error",
          message: msg,
        },
      }).catch(() => {})
    }
  }
  
  return {
    debug: (msg: string) => log("debug", msg),
    info: (msg: string) => log("info", msg),
    error: (msg: string) => log("error", msg),
  }
}

async function findCheapestModel(
  client: any,
  config: PluginConfig,
  log: ReturnType<typeof createLogger>
): Promise<{ providerID: string; modelID: string } | null> {
  // If explicit model is set, use it
  if (config.model) {
    const [providerID, modelID] = config.model.includes("/")
      ? config.model.split("/", 2)
      : ["anthropic", config.model]
    log.debug(`Using configured model: ${providerID}/${modelID}`)
    return { providerID, modelID }
  }

  try {
    // First, get connected providers to prefer currently logged-in provider
    let connectedProviderIds: string[] = []
    try {
      const providerResponse = await client.provider.list() as any
      const providerData = providerResponse?.data || providerResponse
      connectedProviderIds = providerData?.connected || []
      log.debug(`Connected providers: ${connectedProviderIds.join(", ") || "none"}`)
    } catch (e) {
      log.debug(`Failed to fetch connected providers: ${e instanceof Error ? e.message : "unknown"}`)
    }

    const providersResponse = await client.config.providers() as any
    const responseData = providersResponse?.data || providersResponse
    const providers = responseData?.providers || []
    
    log.debug(`Found ${providers.length} providers`)
    
    // Debug: log provider structure
    if (providers.length > 0) {
      log.debug(`First provider keys: ${JSON.stringify(Object.keys(providers[0]))}`)
      log.debug(`First provider: ${JSON.stringify(providers[0]).slice(0, 500)}`)
    }
    
    // If a specific provider is requested, use it
    if (config.provider) {
      const provider = providers.find((p: any) => p.id === config.provider)
      if (provider) {
        const models = provider.models || []
        const cheapModel = findCheapestFromModels(models, log)
        if (cheapModel) {
          return { providerID: config.provider, modelID: cheapModel }
        }
      }
    }
    
    // Prioritize connected (logged-in) providers first
    // This respects the user's current provider choice and avoids unnecessary provider switching
    const connectedProviders = providers.filter((p: any) => connectedProviderIds.includes(p.id))
    const otherProviders = providers.filter((p: any) => !connectedProviderIds.includes(p.id))
    const sortedProviders = [...connectedProviders, ...otherProviders]
    
    if (connectedProviders.length > 0) {
      log.debug(`Prioritizing ${connectedProviders.length} connected provider(s): ${connectedProviders.map((p: any) => p.id).join(", ")}`)
    }
    
    // Find cheapest model, preferring connected providers
    for (const provider of sortedProviders) {
      const providerID = provider.id
      if (!providerID) continue
      
      const models = provider.models || []
      const cheapModel = findCheapestFromModels(models, log)
      if (cheapModel) {
        log.debug(`Selected ${providerID}/${cheapModel}`)
        return { providerID, modelID: cheapModel }
      }
    }
    
    log.debug("No models found in any provider")
  } catch (e) {
    log.debug(`Failed to fetch providers: ${e instanceof Error ? e.message : "unknown"}`)
  }

  return null
}

function isTimestampTitle(title: string | undefined): boolean {
  if (!title) return true
  if (title.trim() === "") return true
  
  const timestampPatterns = [
    /^\d{4}-\d{2}-\d{2}/, // 2024-01-15...
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/, // 1/15/24 or 01/15/2024
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i,
    /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
    /^Session\s+\d+/i,
    /^New\s+Session/i,
    /^Untitled/i,
  ]
  
  return timestampPatterns.some(pattern => pattern.test(title.trim()))
}

// Check if title was set by our plugin (has our emoji prefix)
function hasPluginEmoji(title: string | undefined): boolean {
  if (!title) return false
  return title.startsWith(EMOJI_KEYWORD) || title.startsWith(EMOJI_AI)
}

// Check if we should modify this title
// Returns true if: default/timestamp title OR has our emoji prefix
// Returns false if: custom user title (no emoji from us)
function shouldModifyTitle(title: string | undefined): boolean {
  if (isTimestampTitle(title)) return true
  if (hasPluginEmoji(title)) return true
  return false
}

function sanitizeTitle(title: string, maxLength: number): string {
  return title
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "dare",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "each", "few",
    "more", "most", "other", "some", "such", "no", "nor", "not",
    "only", "own", "same", "so", "than", "too", "very", "just",
    "and", "but", "if", "or", "because", "until", "while", "this",
    "that", "these", "those", "i", "me", "my", "myself", "we", "our",
    "you", "your", "he", "him", "his", "she", "her", "it", "its",
    "they", "them", "their", "what", "which", "who", "whom", "please",
    "help", "want", "like", "make", "create", "write", "add", "get",
    // Additional common verbs that don't add meaning
    "came", "come", "goes", "going", "went", "give", "gave", "take", "took",
    "put", "see", "saw", "know", "knew", "think", "thought", "tell", "told",
    "ask", "asked", "use", "used", "find", "found", "let", "try", "tried",
    "look", "looking", "need", "needed", "seem", "seemed", "work", "working",
  ])

  // Return words in order they appear (preserving sequence), not by frequency
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))

  // Remove duplicates while preserving order
  const seen = new Set<string>()
  const uniqueWords: string[] = []
  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word)
      uniqueWords.push(word)
    }
  }

  return uniqueWords.slice(0, 6)
}

function inferIntent(text: string): string {
  const t = text.toLowerCase()
  
  if (/\b(test|pytest|jest|spec|vitest|testing)\b/.test(t)) return "testing"
  if (/\b(debug|trace|breakpoint|stack|error|issue)\b/.test(t)) return "debugging"
  if (/\b(fix|bug|broken|patch|resolve)\b/.test(t)) return "fix"
  if (/\b(refactor|cleanup|reorganize|restructure|clean)\b/.test(t)) return "refactor"
  if (/\b(doc|readme|documentation|comment)\b/.test(t)) return "docs"
  if (/\b(review|pr|pull.?request)\b/.test(t)) return "review"
  if (/\b(deploy|docker|k8s|terraform|ci|cd|pipeline)\b/.test(t)) return "devops"
  if (/\b(api|endpoint|route|controller)\b/.test(t)) return "api"
  if (/\b(ui|frontend|component|style|css)\b/.test(t)) return "ui"
  if (/\b(database|db|sql|query|migration)\b/.test(t)) return "database"
  if (/\b(auth|login|password|session|token)\b/.test(t)) return "auth"
  if (/\b(config|setup|install|configure)\b/.test(t)) return "setup"
  
  return ""
}

function generateFallbackTitle(text: string, maxLength: number): string {
  const keywords = extractKeywords(text)
  
  // Debug logging handled by caller
  
  // For very short inputs, try to use the whole message as-is
  const cleanedText = text.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim()
  if (cleanedText.length <= maxLength && cleanedText.length > 3) {
    // Capitalize first letter of each word for title case
    const titleCased = cleanedText
      .split(" ")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
    return titleCased
  }
  
  if (keywords.length === 0) {
    return ""
  }
  
  // Join keywords in order (they're already in original word order)
  // Take enough keywords to fit in maxLength
  let title = ""
  for (const keyword of keywords) {
    const capitalized = keyword.charAt(0).toUpperCase() + keyword.slice(1)
    const potential = title ? `${title} ${capitalized}` : capitalized
    if (potential.length <= maxLength) {
      title = potential
    } else {
      break
    }
  }
  
  return sanitizeTitle(title, maxLength)
}

async function generateAITitle(
  client: any,
  sessionId: string,
  userMessage: string,
  assistantMessage: string | null,
  modelToUse: { providerID: string; modelID: string } | null,
  config: PluginConfig,
  log: ReturnType<typeof createLogger>
): Promise<string | null> {
  // Build context from both user question and assistant response
  let context = `User asked: "${userMessage.slice(0, 300)}"`
  if (assistantMessage) {
    context += `\n\nAssistant responded: "${assistantMessage.slice(0, 400)}"`
  }
  
  const prompt = `Generate a concise, specific title (3-6 words) for this conversation:

${context}

Rules:
- MUST NOT exceed ${config.maxLength} characters - this is a hard limit
- No quotes or special punctuation
- Use title case
- Be SPECIFIC about the actual content discussed (e.g., "British Shorthair Cat Photo" not "Image Identification")
- If the response mentions specific things (names, technologies, animals, etc.), include them
- If there's a ticket/issue reference (JIRA like ABC-123, GitHub PR #123, Trello, Linear, etc.), include it as a prefix (e.g., "ABC-123 Fix Login Bug")
- Return ONLY the title, nothing else`

  let tempSessionId: string | null = null
  
  try {
    log.debug("Creating temp session for AI title generation")
    
    // Create temp session using the correct SDK pattern
    const tempSession = await client.session.create({
      body: { title: "autotitle-temp" }
    }) as any
    tempSessionId = tempSession?.id || tempSession?.data?.id
    
    if (!tempSessionId) {
      log.debug(`Failed to create temp session: ${JSON.stringify(tempSession).slice(0, 200)}`)
      return null
    }
    
    log.debug(`Created temp session ${tempSessionId}, sending prompt`)
    
    // Build model config from the resolved model
    const bodyConfig: any = {
      parts: [{ type: "text", text: prompt }],
    }
    if (modelToUse) {
      bodyConfig.model = modelToUse
      log.debug(`Using model: ${modelToUse.providerID}/${modelToUse.modelID}`)
    }
    
    // Use session.prompt which returns AssistantMessage with AI response
    const response = await client.session.prompt({
      path: { id: tempSessionId },
      body: bodyConfig,
    }) as any
    
    log.debug(`Prompt response: ${JSON.stringify(response).slice(0, 300)}`)
    
    // Extract text from response parts
    const parts = response?.parts || response?.data?.parts || []
    for (const part of parts) {
      if (part?.type === "text" && part?.text) {
        const responseText = part.text.trim()
        log.debug(`Got AI text: "${responseText.slice(0, 100)}"`)
        
        // Take first line as title
        const lines = responseText.split("\n").filter((l: string) => l.trim())
        const titleCandidate = lines[0] || responseText
        
        if (titleCandidate.length > 0 && titleCandidate.length <= config.maxLength + 20) {
          const title = sanitizeTitle(titleCandidate, config.maxLength)
          log.debug(`AI generated title: "${title}"`)
          
          // Cleanup temp session
          await client.session.delete({ path: { id: tempSessionId } }).catch(() => {})
          return title
        }
      }
    }
    
    // Also try response.content pattern
    if (response?.content) {
      const title = sanitizeTitle(response.content, config.maxLength)
      log.debug(`AI generated title (content): "${title}"`)
      await client.session.delete({ path: { id: tempSessionId } }).catch(() => {})
      return title
    }
    
    log.debug("No valid title in AI response")
  } catch (e) {
    log.debug(`AI generation failed: ${e instanceof Error ? e.message : "unknown"}`)
  } finally {
    // Always try to cleanup temp session
    if (tempSessionId) {
      await client.session.delete({ path: { id: tempSessionId } }).catch(() => {})
    }
  }

  return null
}

// Extract session ID from various event structures
function extractSessionId(event: any): string | null {
  // Try various paths where session ID might be
  return (
    event?.properties?.sessionID ||
    event?.properties?.session?.id ||
    event?.properties?.info?.id ||
    event?.sessionID ||
    event?.session?.id ||
    null
  )
}

// Extract user message content from event
function extractMessageContent(event: any): string | null {
  // Try to get content from event properties
  const messages = event?.properties?.messages || event?.messages || []
  
  for (const msg of messages) {
    if (msg?.role === "user" || msg?.info?.role === "user") {
      // Try different content locations
      if (typeof msg.content === "string") return msg.content
      if (typeof msg.text === "string") return msg.text
      
      // Check parts array
      const parts = msg.parts || []
      for (const part of parts) {
        if (part?.type === "text" && part?.text) {
          return part.text
        }
      }
    }
  }
  
  return null
}

export const AutoTitle: Plugin = async ({ client }) => {
  const config = loadConfig()
  const log = createLogger(config.debug, client)

  if (config.disabled) {
    log.info("Plugin is disabled via OPENCODE_AUTOTITLE_DISABLED")
    return {}
  }

  const state: State = {
    keywordTitledSessions: new Set(),
    aiTitledSessions: new Set(),
    pendingAISessions: new Set(),
    cheapestModel: null,
  }

  log.info("AutoTitle plugin initialized")

  // Helper to update session title
  async function updateTitle(sessionId: string, title: string): Promise<boolean> {
    try {
      await client.session.update({
        path: { id: sessionId },
        body: { title },
      })
      log.debug(`Updated session ${sessionId} title to: ${title}`)
      return true
    } catch (err) {
      log.error(`Failed to update session title: ${err instanceof Error ? err.message : "unknown"}`)
      return false
    }
  }

  // Helper to get current session title
  async function getSessionTitle(sessionId: string): Promise<string | undefined> {
    try {
      const response = await client.session.get({ path: { id: sessionId } }) as any
      const sessionData = response?.data || response
      return sessionData?.title
    } catch {
      return undefined
    }
  }

  // Helper to get session messages
  async function getSessionMessages(sessionId: string): Promise<{ user: string | null; assistant: string | null }> {
    try {
      const response = await client.session.messages({ path: { id: sessionId } }) as any
      const messages = response?.data || response || []
      
      let user: string | null = null
      let assistant: string | null = null
      
      for (const msg of messages) {
        const role = msg?.info?.role || msg?.role
        const parts = msg?.parts || []
        
        for (const part of parts) {
          if (part?.type === "text" && part?.text) {
            if (role === "user" && !user) {
              user = part.text
            } else if (role === "assistant" && !assistant) {
              assistant = part.text
            }
            break
          }
        }
        
        if (user && assistant) break
      }
      
      return { user, assistant }
    } catch {
      return { user: null, assistant: null }
    }
  }

  // Phase 1: Quick keyword-based title on user message
  async function handleUserMessage(sessionId: string, userText: string) {
    // Skip if already processed
    if (state.keywordTitledSessions.has(sessionId) || state.aiTitledSessions.has(sessionId)) {
      return
    }

    // Check current title
    const currentTitle = await getSessionTitle(sessionId)
    
    // Don't modify custom user titles (titles without our emoji that aren't default)
    if (!shouldModifyTitle(currentTitle)) {
      log.debug(`Session ${sessionId} has custom title, skipping: ${currentTitle}`)
      state.aiTitledSessions.add(sessionId)  // Mark as done
      return
    }

    // Generate keyword-based title
    const keywordTitle = generateFallbackTitle(userText, config.maxLength - 2)  // -2 for emoji + space
    if (!keywordTitle) {
      log.debug(`Could not generate keyword title for session ${sessionId}`)
      return
    }

    const fullTitle = `${EMOJI_KEYWORD} ${keywordTitle}`
    if (await updateTitle(sessionId, fullTitle)) {
      log.info(`Set keyword title: ${fullTitle}`)
      state.keywordTitledSessions.add(sessionId)
    }
  }

  // Phase 2: AI-generated title after response
  async function handleSessionIdle(sessionId: string) {
    // Skip if already has AI title
    if (state.aiTitledSessions.has(sessionId)) {
      return
    }

    // Skip if currently processing
    if (state.pendingAISessions.has(sessionId)) {
      return
    }

    // Check current title
    const currentTitle = await getSessionTitle(sessionId)
    
    // Don't modify custom user titles
    if (!shouldModifyTitle(currentTitle)) {
      log.debug(`Session ${sessionId} has custom title, skipping AI: ${currentTitle}`)
      state.aiTitledSessions.add(sessionId)
      return
    }

    state.pendingAISessions.add(sessionId)

    try {
      // Get messages for context
      const { user: userMessage, assistant: assistantMessage } = await getSessionMessages(sessionId)
      
      if (!userMessage) {
        log.debug(`No user message found for session ${sessionId}`)
        return
      }

      log.debug(`Generating AI title for session ${sessionId}`)
      log.debug(`User: ${userMessage.slice(0, 100)}...`)
      if (assistantMessage) {
        log.debug(`Assistant: ${assistantMessage.slice(0, 100)}...`)
      }

      // Lazily find cheapest model
      if (state.cheapestModel === null) {
        try {
          const found = await findCheapestModel(client, config, log)
          state.cheapestModel = found ?? undefined
          if (state.cheapestModel) {
            log.debug(`Selected model: ${state.cheapestModel.providerID}/${state.cheapestModel.modelID}`)
          }
        } catch (e) {
          log.debug(`Failed to find cheap model: ${e instanceof Error ? e.message : "unknown"}`)
          state.cheapestModel = undefined
        }
      }

      // Generate AI title
      const aiTitle = await generateAITitle(
        client, sessionId, userMessage, assistantMessage,
        state.cheapestModel ?? null, config, log
      )

      if (aiTitle) {
        const fullTitle = `${EMOJI_AI} ${aiTitle}`
        if (await updateTitle(sessionId, fullTitle)) {
          log.info(`Set AI title: ${fullTitle}`)
          state.aiTitledSessions.add(sessionId)
          state.keywordTitledSessions.delete(sessionId)  // Clean up
        }
      } else {
        log.debug(`AI title generation failed for session ${sessionId}`)
        // Keep the keyword title if we have one
        if (state.keywordTitledSessions.has(sessionId)) {
          state.aiTitledSessions.add(sessionId)  // Mark as done (keep keyword title)
        }
      }
    } catch (err) {
      log.error(`Failed to generate AI title: ${err instanceof Error ? err.message : "unknown"}`)
    } finally {
      state.pendingAISessions.delete(sessionId)
    }
  }

  return {
    event: async ({ event }: { event: unknown }) => {
      const e = event as any
      
      if (config.debug) {
        log.debug(`Event: ${e?.type} - ${JSON.stringify(e).slice(0, 500)}`)
      }

      // Phase 1: On user message, set quick keyword title
      if (e?.type === "message.part.updated") {
        const part = e?.properties?.part
        const sessionId = part?.sessionID
        
        // Check if this is a user message text part
        if (sessionId && part?.type === "text" && part?.text) {
          // We need to check if this is from a user message
          // The part doesn't directly tell us the role, so we check if we've seen this session
          if (!state.keywordTitledSessions.has(sessionId) && !state.aiTitledSessions.has(sessionId)) {
            // Get the message to check its role
            const messageId = part?.messageID
            if (messageId) {
              // For now, trigger on first text we see for a new session
              // The session.idle will refine it later
              handleUserMessage(sessionId, part.text).catch(err => {
                log.debug(`Error in handleUserMessage: ${err instanceof Error ? err.message : "unknown"}`)
              })
            }
          }
        }
      }

      // Phase 2: On session idle (after AI responds), generate AI title
      if (e?.type === "session.idle") {
        const sessionId = extractSessionId(e)
        if (sessionId) {
          handleSessionIdle(sessionId).catch(err => {
            log.debug(`Error in handleSessionIdle: ${err instanceof Error ? err.message : "unknown"}`)
          })
        }
      }
    },
  }
}

export default AutoTitle
