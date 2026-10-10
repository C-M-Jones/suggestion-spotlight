/** What a taken suggestion was matched to in the reply before it. */
export type Anchor = {
  /** The suggestion as taken, or 'demo' for `/suggestion-spotlight demo`. */
  suggestion: string
  status: 'finding' | 'found' | 'none'
  /** The matched units of the reply (lines, or whole tables and code blocks), whitespace-squashed. */
  units: string[]
  /** The first matched unit as written, for the box above the prompt. */
  quotes: string[]
  /** True once the suggestion was sent; the spotlight then stays until the reply is done. */
  isSent: boolean
  /** True while the box holds something other than the suggestion. */
  isHidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'suggestion-spotlight': {
      /** The suggestion the prompt box holds or offers now, '' when none. */
      offered: string
      anchor: Anchor | null
      /** Off after `/suggestion-spotlight off`, remembered across sessions. */
      enabled: boolean
    }
  }
}
