import type { Plugin } from "@opencode-ai/plugin"

interface PluginConfig {
  model: string | null
  maxLength: number
  disabled: boolean
  debug: boolean
}

interface State {
  titledSessions: Set<string>
  pendingSessions: Set<string>
}

interface SessionEvent {
  type: string
  properties?: {
    sessionID?: string
    info?: {
      id?: string
      title?: string
    }
  }
}

interface Message {
  info: {
    role: string
  }
  parts: Array<{
    type: string
    text?: string
  }>
}

function loadConfig(): PluginConfig {
  const env = process.env
  return {
    model: env.OPENCODE_AUTOTITLE_MODEL || null,
    maxLength: Number(env.OPENCODE_AUTOTITLE_MAX_LENGTH) || 40,
    disabled: env.OPENCODE_AUTOTITLE_DISABLED === "1" || env.OPENCODE_AUTOTITLE_DISABLED === "true",
    debug: env.OPENCODE_AUTOTITLE_DEBUG === "1" || env.OPENCODE_AUTOTITLE_DEBUG === "true",
  }
}

function createLogger(debug: boolean) {
  return {
    debug: (msg: string) => debug && console.error(`[autotitle] ${msg}`),
    error: (msg: string) => console.error(`[autotitle] ERROR: ${msg}`),
    info: (msg: string) => debug && console.error(`[autotitle] ${msg}`),
  }
}

function isTimestampTitle(title: string | undefined): boolean {
  if (!title) return true
  if (title.trim() === "") return true
  
  const timestampPatterns = [
    /^\d{4}-\d{2}-\d{2}/, // 2024-01-15...
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/, // 1/15/24 or 01/15/2024
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i, // Jan 15...
    /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i, // 15 Jan...
    /^Session\s+\d+/i, // Session 1, Session 2...
    /^New\s+Session/i, // New Session
    /^Untitled/i, // Untitled
  ]
  
  return timestampPatterns.some(pattern => pattern.test(title.trim()))
}

function sanitizeTitle(title: string, maxLength: number): string {
  return title
    .replace(/[^\w\s-]/g, "") // Remove special characters except hyphen
    .replace(/\s+/g, " ") // Normalize whitespace
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
  ])

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))

  const wordCounts = new Map<string, number>()
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1)
  }

  return Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word)
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
  const intent = inferIntent(text)
  
  if (keywords.length === 0) {
    return "New Session"
  }
  
  let title = ""
  
  if (intent) {
    title = intent.charAt(0).toUpperCase() + intent.slice(1)
    const remainingKeywords = keywords.filter(k => k !== intent.toLowerCase())
    if (remainingKeywords.length > 0) {
      title += " " + remainingKeywords.slice(0, 2).join(" ")
    }
  } else {
    title = keywords
      .slice(0, 3)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  }
  
  return sanitizeTitle(title, maxLength)
}

async function generateAITitle(
  client: any,
  text: string,
  config: PluginConfig,
  log: ReturnType<typeof createLogger>
): Promise<string | null> {
  const prompt = `Generate a concise session title (3-6 words max) that captures the main task or topic.

User's message:
"${text.slice(0, 500)}"

Rules:
- Maximum ${config.maxLength} characters
- No quotes, colons, or special characters
- Descriptive but brief (like a git commit subject)
- Focus on the WHAT, not the HOW
- Return ONLY the title, nothing else`

  try {
    const modelConfig = config.model 
      ? { providerID: config.model.split("/")[0], modelID: config.model.split("/")[1] }
      : undefined

    log.debug(`Generating title with model: ${config.model || "default"}`)

    const response = await client.session.prompt({
      path: { id: "temp-title-gen" },
      body: {
        model: modelConfig,
        parts: [{ type: "text", text: prompt }],
        noReply: false,
      },
    })

    if (response?.parts?.[0]?.text) {
      const title = sanitizeTitle(response.parts[0].text, config.maxLength)
      log.debug(`AI generated title: ${title}`)
      return title
    }
  } catch (e) {
    log.debug(`AI title generation failed: ${e instanceof Error ? e.message : "unknown"}`)
  }

  return null
}

async function getFirstUserMessage(
  client: any,
  sessionId: string,
  log: ReturnType<typeof createLogger>
): Promise<string | null> {
  try {
    const messagesResponse = await client.session.messages({
      path: { id: sessionId },
    })

    if (!messagesResponse?.data) {
      log.debug("No messages data in response")
      return null
    }

    const messages = messagesResponse.data as Message[]
    
    for (const msg of messages) {
      if (msg.info?.role === "user") {
        for (const part of msg.parts || []) {
          if (part.type === "text" && part.text) {
            log.debug(`Found user message: ${part.text.slice(0, 100)}...`)
            return part.text
          }
        }
      }
    }
  } catch (e) {
    log.debug(`Failed to get messages: ${e instanceof Error ? e.message : "unknown"}`)
  }

  return null
}

export const AutoTitle: Plugin = async ({ client }) => {
  const config = loadConfig()
  const log = createLogger(config.debug)

  if (config.disabled) {
    log.info("Plugin is disabled")
    return {}
  }

  const state: State = {
    titledSessions: new Set(),
    pendingSessions: new Set(),
  }

  log.info("AutoTitle plugin initialized")

  return {
    event: async ({ event }: { event: unknown }) => {
      const sessionEvent = event as SessionEvent
      
      if (sessionEvent.type !== "session.idle") {
        return
      }

      const sessionId = sessionEvent.properties?.sessionID || sessionEvent.properties?.info?.id
      if (!sessionId) {
        log.debug("No session ID in event")
        return
      }

      if (state.titledSessions.has(sessionId)) {
        log.debug(`Session ${sessionId} already titled, skipping`)
        return
      }

      if (state.pendingSessions.has(sessionId)) {
        log.debug(`Session ${sessionId} already pending, skipping`)
        return
      }

      state.pendingSessions.add(sessionId)

      try {
        const sessionResponse = await client.session.get({
          path: { id: sessionId },
        })

        const currentTitle = sessionResponse?.data?.title
        
        if (!isTimestampTitle(currentTitle)) {
          log.debug(`Session ${sessionId} already has custom title: ${currentTitle}`)
          state.titledSessions.add(sessionId)
          state.pendingSessions.delete(sessionId)
          return
        }

        const userMessage = await getFirstUserMessage(client, sessionId, log)
        if (!userMessage) {
          log.debug(`No user message found for session ${sessionId}`)
          state.pendingSessions.delete(sessionId)
          return
        }

        let title: string | null = null

        title = await generateAITitle(client, userMessage, config, log)

        if (!title) {
          log.debug("AI generation failed, using fallback")
          title = generateFallbackTitle(userMessage, config.maxLength)
        }

        if (title && title !== "New Session") {
          await client.session.update({
            path: { id: sessionId },
            body: { title },
          })
          log.info(`Updated session ${sessionId} title to: ${title}`)
        }

        state.titledSessions.add(sessionId)
      } catch (e) {
        log.error(`Failed to process session ${sessionId}: ${e instanceof Error ? e.message : "unknown"}`)
      } finally {
        state.pendingSessions.delete(sessionId)
      }
    },
  }
}

export default AutoTitle
