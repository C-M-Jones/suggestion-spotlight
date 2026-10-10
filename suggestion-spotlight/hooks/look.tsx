import type { EngineInterface, RenderElement } from 'claude-code'

import { clip, inkLines, sparkled } from './match'

// The four looks a spotlight can take. `claude` and `outline` draw a box around
// the passage; `sparkle` and `highlighter` leave it in place and mark the text.

export const STYLES = ['claude', 'outline', 'sparkle', 'highlighter'] as const
export type Style = (typeof STYLES)[number]

export const isStyle = (v: unknown): v is Style => typeof v === 'string' && (STYLES as readonly string[]).includes(v)

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const CLAY = '#D97757'
const INK = '#1F1E1D'
const PURPLE = '#8f8cf4'
// Dark text on a highlighter yellow reads the same in light and dark themes.
const YELLOW = '#FFE066'
const ON_YELLOW = '#1f1f1f'
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// Clawd, the pixel crab, cropped to its body: 24×16 grid cells.
const CRAB_RECTS: [number, number, number, number, string][] = [
  [4, 0, 16, 12, CLAY],
  [0, 4, 4, 4, CLAY],
  [20, 4, 4, 4, CLAY],
  [6, 2, 2, 2, INK],
  [16, 2, 2, 2, INK],
  [4, 12, 2, 4, CLAY],
  [8, 12, 2, 4, CLAY],
  [14, 12, 2, 4, CLAY],
  [18, 12, 2, 4, CLAY],
]

/** The crab and a line of clay text, as one drawing: the desktop wraps sibling elements, so they share an SVG. */
const crabLabel = (text: string, width: number): string => {
  const crab = CRAB_RECTS.map(([x, y, w, h, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="18" viewBox="0 0 ${width} 18">
<g transform="translate(0,3) scale(0.75)" shape-rendering="crispEdges">${crab}</g>
<text x="25" y="13.5" font-family="${FONT}" font-size="13" font-weight="500" fill="${CLAY}">${xml(text)}</text></svg>`
}

/** The heading line of a spotlight: what the suggestion was, in the style's own voice. */
const label = (ui: Ui, style: Style, text: string): RenderElement => {
  const { Text } = ui
  if (style === 'claude') {
    if ('Svg' in ui) {
      const { Svg } = ui
      // About 7.4px a character of 13px system text, after the crab's 25px.
      const width = Math.ceil(30 + text.length * 7.4)
      return <Svg source={crabLabel(text, width)} alt={text} width={width} height={18} />
    }
    return (
      <Text color={CLAY} wrap="truncate-end">
        ▣ {text}
      </Text>
    )
  }
  if (style === 'outline') {
    return (
      <Text color={PURPLE} wrap="truncate-end">
        ↳ {text}
      </Text>
    )
  }
  return (
    <Text dimColor wrap="truncate-end">
      {style === 'sparkle' ? '✨ ' : '🖍 '}
      {text}
    </Text>
  )
}

/** The passage itself, marked in the style; without the heading line. */
const passage = (ui: Ui, style: Style, md: string, key: string): RenderElement => {
  const { Box, Text, Markdown } = ui
  if (style === 'sparkle') return <Markdown key={key} text={sparkled(md)} />
  if (style === 'highlighter') {
    return (
      <Box key={key} flexDirection="column">
        {inkLines(md).map((line, i) => (
          <Text key={`${key}-${i}`} wrap="wrap">
            {line.marker}
            <Text backgroundColor={YELLOW} color={ON_YELLOW}>
              {line.runs.map((r, j) => (
                <Text key={`${key}-${i}-${j}`} bold={r.bold} backgroundColor={YELLOW} color={ON_YELLOW}>
                  {r.text}
                </Text>
              ))}
            </Text>
          </Text>
        ))}
      </Box>
    )
  }
  return <Markdown key={key} text={md} />
}

const boxed = (style: Style): boolean => style === 'claude' || style === 'outline'

const borderOf = (style: Style): string => (style === 'claude' ? CLAY : PURPLE)

/**
 * The passage where it sits in the reply. The boxed styles carry a heading
 * naming the suggestion; the minimal ones mark the text and say nothing.
 */
export const inReply = (ui: Ui, style: Style, suggestion: string, md: string, key: string): RenderElement => {
  const { Box } = ui
  if (!boxed(style)) return passage(ui, style, md, key)
  const text = suggestion === 'demo' ? 'demo' : `“${clip(suggestion, 60)}” refers to this`
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={borderOf(style)} paddingLeft={1}>
      {label(ui, style, text)}
      {passage(ui, style, md, `${key}-body`)}
    </Box>
  )
}

/** The box above the prompt: the heading, a dismiss, and the passage's first line. */
export const abovePrompt = (
  ui: Ui,
  style: Style,
  suggestion: string,
  quote: string,
  dismiss: RenderElement,
): RenderElement => {
  const { Box } = ui
  const text = suggestion === 'demo' ? 'Demo: what a suggestion would point at' : `“${clip(suggestion, 60)}” refers to:`
  const head = (
    <Box flexDirection="row" justifyContent="space-between">
      {label(ui, style, text)}
      {dismiss}
    </Box>
  )
  if (!boxed(style)) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        {head}
        {passage(ui, style, quote, 'quote')}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderOf(style)} paddingLeft={1}>
      {head}
      {passage(ui, style, quote, 'quote')}
    </Box>
  )
}
