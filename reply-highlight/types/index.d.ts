/** What a taken suggestion was matched to in the reply before it. */
export type Anchor = {
  suggestion: string
  status: 'finding' | 'found' | 'none'
  /** The matched units of the reply (lines, or whole tables and code blocks), whitespace-squashed. */
  units: string[]
  /** The same units as written, for the band above the prompt. */
  quotes: string[]
  /** True once the suggestion was sent; the outline then stays until the next suggestion. */
  isSent: boolean
  /** True while the box holds something other than the suggestion. */
  isHidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'reply-highlight': {
      /** The suggestion the prompt box offers now, '' when none. */
      offered: string
      anchor: Anchor | null
    }
  }
}
