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

// --- sparkle: a strip of twinkling pixels, sparse at one end and dense at the
// other, as Claude Code's own effort slider draws it.

// Reply blocks do not say how wide they are; the band above the prompt does,
// and it draws on every turn, so it keeps this up to date.
let columns = 0

export const noteColumns = (n: number): void => {
  if (n > 0) columns = n
}

/** About 8 CSS px a column, less the transcript's gutters; a sane width before the band has said. */
const stripWidth = (): number => Math.max(240, Math.min(1400, columns ? columns * 8 - 64 : 640))

const CELL = 4
const STRIP_ROWS = 3

// Deterministic noise, so the field does not reshuffle between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// Four groups of pixels twinkle out of phase, in shades of the Ultracode purple.
const STRIP_CSS = `<style>
.d0{fill:#c9c4fa}.d1{fill:#a9a2f5}.d2{fill:#8f8cf4}.d3{fill:#7068d6}
.d0,.d1,.d2,.d3{animation:tw 2.2s ease-in-out infinite}
.d1{animation-duration:2.8s;animation-delay:-.7s}.d2{animation-duration:1.9s;animation-delay:-1.3s}.d3{animation-duration:3.3s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion: reduce){.d0,.d1,.d2,.d3{animation:none}}
</style>`

/** One strip of the field; `rising` thickens left to right, otherwise right to left. */
export const sparkleStrip = (width: number, rising: boolean, seed: number): string => {
  const cols = Math.floor(width / CELL)
  const dots: string[] = []
  for (let c = 0; c < cols; c++) {
    const along = rising ? c / cols : 1 - c / cols
    const density = 0.1 + 0.85 * Math.pow(along, 1.3)
    for (let r = 0; r < STRIP_ROWS; r++) {
      if (noise(c + seed, r) < density) {
        dots.push(`<rect class="d${Math.floor(noise(r + seed, c) * 4)}" x="${c * CELL}" y="${r * CELL}" width="3" height="3"/>`)
      }
    }
  }
  const h = STRIP_ROWS * CELL
  // A lavender wash under the pixels, fading in toward the dense end, as the slider's track has.
  const wash = `<defs><linearGradient id="w${seed}" x1="${rising ? 0 : 1}" x2="${rising ? 1 : 0}" y1="0" y2="0"><stop offset="0" stop-color="#8f8cf4" stop-opacity="0"/><stop offset="1" stop-color="#8f8cf4" stop-opacity=".28"/></linearGradient></defs><rect width="${width}" height="${h}" rx="${h / 2}" fill="url(#w${seed})"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" shape-rendering="crispEdges">${STRIP_CSS}${wash}${dots.join('')}</svg>`
}

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
  if (style === 'sparkle') {
    return (
      <Text color={PURPLE} wrap="truncate-end">
        ✦ {text}
      </Text>
    )
  }
  return (
    <Text dimColor wrap="truncate-end">
      🖍 {text}
    </Text>
  )
}

/** The passage itself, marked in the style; without the heading line. */
const passage = (ui: Ui, style: Style, md: string, key: string): RenderElement => {
  const { Box, Text, Markdown } = ui
  if (style === 'sparkle') {
    // Pixels where pixels draw: a strip that thickens toward the passage's end
    // above it, and one that thins away below. The terminal gets ✨ instead.
    if (!('Svg' in ui)) return <Markdown key={key} text={sparkled(md)} />
    const { Svg } = ui
    const width = stripWidth()
    return (
      <Box key={key} flexDirection="column">
        <Svg source={sparkleStrip(width, true, 0)} alt="" width={width} height={STRIP_ROWS * CELL} />
        <Markdown text={md} />
        <Svg source={sparkleStrip(width, false, 37)} alt="" width={width} height={STRIP_ROWS * CELL} />
      </Box>
    )
  }
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
