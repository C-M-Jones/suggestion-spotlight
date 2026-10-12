// Pure text work: splitting a reply into blocks, asking which block a follow-up
// points at, and splitting a drawn block into plain and outlined runs. No engine
// calls here, so the tests exercise it directly.

export const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

export const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)

export const isPhrase = (s: string): boolean => s.trim().split(/\s+/).length >= 2

/**
 * Whether the draft was filled by taking a suggestion (Tab) rather than typed:
 * the box changed without an edit of the person's, from empty to a phrase.
 * Suggestions are only offered in an empty box, so a box that already held
 * the person's own words was changed some other way (autocorrect, a text
 * substitution, an edit folded out of `prompt.edit`), not by Tab.
 */
export const isTabFill = (before: string, draft: string): boolean =>
  !squash(before) && squash(draft) !== squash(before) && isPhrase(draft)

/**
 * A unit is what an outline may hold: one line of prose or one list item, or a
 * whole code block or table, which would break apart if split.
 */
export type Unit = { start: number; end: number; text: string }

export const unitsOf = (lines: string[]): Unit[] => {
  const units: Unit[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.trim()) {
      i++
      continue
    }
    let end = i + 1
    if (/^\s*(```|~~~)/.test(line)) {
      const fence = line.trim().slice(0, 3)
      while (end < lines.length && !(lines[end] ?? '').trim().startsWith(fence)) end++
      end = Math.min(lines.length, end + 1)
    } else if (/^\s*\|/.test(line)) {
      while (end < lines.length && /^\s*\|/.test(lines[end] ?? '')) end++
    }
    units.push({ start: i, end, text: lines.slice(i, end).join('\n') })
    i = end
  }
  return units
}

const isListLine = (line: string): boolean => /^\s*([-*+]|\d+[.)])\s/.test(line) || /^\s{2,}\S/.test(line)

// "1. **Polish the mod:**" introduces the list beneath it: the section is the
// heading and that list, so an outline holds what the heading stands for.
const endsWithColon = (text: string): boolean => /:\s*(\*\*|__)?\s*$/.test(text.trim())

/** The picked unit, and the list under it when the unit is a heading ending in a colon. */
export const sectionOf = (units: Unit[], index: number, lines: string[]): Unit[] => {
  const head = units[index]
  if (!head || !endsWithColon(head.text)) return head ? [head] : []
  const section = [head]
  for (const u of units.slice(index + 1)) {
    const between = lines.slice(section[section.length - 1]!.end, u.start)
    if (between.some(l => l.trim())) break
    if (!isListLine(u.text.split('\n')[0] ?? '')) break
    // A sibling of the heading (the next "2. …" at the same indent) ends the section.
    if (/^\d+[.)]\s/.test(u.text) && /^\d+[.)]\s/.test(head.text)) break
    section.push(u)
  }
  return section
}

const STOP = new Set(
  'the this that with from have will what your yours just then them they into also more some okay sure please lets let'.split(' '),
)

/** Without the model: the index of the unit sharing the most words with the follow-up, or -1. */
export const byWords = (followUp: string, units: Unit[]): number => {
  const words = squash(followUp)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length > 3 && !STOP.has(w))
  if (!words.length) return -1
  const scores = units.map(u => words.filter(w => squash(u.text).includes(w)).length)
  const best = Math.max(0, ...scores)
  return best >= 2 || (best === 1 && words.length === 1) ? scores.indexOf(best) : -1
}

/** At most this much of a reply goes to the model; past it, its closing part, where options usually sit. */
export const MAX_PROMPT_CHARS = 16_000
const UNIT_CHARS = 400

/** The numbered blocks the model reads, and the unit index each number stands for. */
export const numbered = (units: Unit[]): { text: string; indexOf: Map<number, number> } => {
  const rows: string[] = []
  const indexOf = new Map<number, number>()
  let size = 0
  for (let i = units.length - 1; i >= 0; i--) {
    const row = clip((units[i]?.text ?? '').replace(/\n/g, ' '), UNIT_CHARS)
    if (size + row.length > MAX_PROMPT_CHARS && rows.length) break
    rows.unshift(row)
    size += row.length + 8
  }
  const first = units.length - rows.length
  rows.forEach((_, k) => indexOf.set(k + 1, first + k))
  return { text: rows.map((r, k) => `[${k + 1}] ${r}`).join('\n'), indexOf }
}

export const SYSTEM =
  'You link a short follow-up message to the one part of the previous reply it refers to. ' +
  'Answer with a single block number, or NONE.'

export const promptFor = (blocks: string, followUp: string): string =>
  `Previous reply, split into numbered blocks:\n${blocks}\n\n` +
  `Follow-up the user is about to send: "${followUp}"\n\n` +
  'Which one block does the follow-up agree to, act on or point at? Pick the most specific block: ' +
  'the option, item or sentence itself, never a closing question that merely offers it. ' +
  'Answer NONE if it refers to nothing specific, such as a general "go ahead" or "let me know".'

/** The unit index the model's answer names, or -1. */
export const pickFrom = (answer: string, indexOf: Map<number, number>): number => {
  if (/none/i.test(answer)) return -1
  const n = Number(/\d+/.exec(answer)?.[0])
  return indexOf.get(n) ?? -1
}

/** One row of the conversation, as far as finding the last reply needs. */
export type Row = { role: 'user' | 'assistant'; text: string; isToolResult: boolean }

/**
 * The reply a follow-up answers: the assistant text after the last prompt the
 * person sent, not counting the follow-up itself once it has been sent.
 */
export const lastReply = (rows: Row[], followUp: string): string => {
  const parts: string[] = []
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (!r) continue
    if (r.role === 'assistant') {
      if (r.text.trim()) parts.unshift(r.text)
      continue
    }
    // Tool results come back as user rows inside the same reply: not a prompt.
    if (r.isToolResult) continue
    const text = r.text.trim()
    if (!text || (squash(text) === squash(followUp) && !parts.length)) continue
    if (parts.length) break
  }
  return parts.join('\n\n')
}

// --- The highlighter, which paints text and so needs the passage as plain runs.

const MARKER = /^(\s*(?:[-*+]|\d+[.)]|#{1,6})\s+)?(.*)$/

/** A run of one line as a highlighter draws it: plain text, bold or not. */
export type Run = { text: string; bold: boolean }

/** One line of the highlighted passage: its list marker (left unmarked) and its runs. */
export type InkLine = { marker: string; runs: Run[] }

/**
 * The passage as plain lines for the highlighter, which paints text and so
 * cannot draw markdown: bold stays bold, code and links keep their words.
 */
export const inkLines = (md: string): InkLine[] =>
  md
    .split('\n')
    .filter(l => l.trim() && !/^\s*(```|~~~)/.test(l) && !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l))
    .map(line => {
      const [, marker = '', rest = ''] = MARKER.exec(line) ?? []
      const plain = rest.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]*)`/g, '$1')
      const runs: Run[] = plain
        .split(/(\*\*|__)/)
        .reduce<{ runs: Run[]; bold: boolean }>(
          (acc, part) =>
            part === '**' || part === '__'
              ? { ...acc, bold: !acc.bold }
              : part
                ? { ...acc, runs: [...acc.runs, { text: part, bold: acc.bold }] }
                : acc,
          { runs: [], bold: false },
        ).runs
      return { marker, runs }
    })

export type Segment = { text: string; isTarget: boolean }

/** Splits a drawn block of the reply into runs of plain and outlined lines, or null when it holds no target. */
export const segmentsOf = (text: string, targets: Set<string>): Segment[] | null => {
  const lines = text.split('\n')
  const hit = new Array<boolean>(lines.length).fill(false)
  let any = false
  for (const u of unitsOf(lines)) {
    if (!targets.has(squash(u.text))) continue
    any = true
    for (let i = u.start; i < u.end; i++) hit[i] = true
  }
  if (!any) return null
  // A blank line between two outlined units keeps them in one outline.
  const filled = lines.map((line, i) => {
    if (hit[i] || line.trim()) return hit[i] ?? false
    const before = hit.slice(0, i).findLast((_, k) => (lines[k] ?? '').trim() !== '')
    const after = hit.slice(i + 1).find((_, k) => (lines[i + 1 + k] ?? '').trim() !== '')
    return before === true && after === true
  })
  const segments: Segment[] = []
  lines.forEach((line, i) => {
    const isTarget = filled[i] ?? false
    const last = segments[segments.length - 1]
    if (last && last.isTarget === isTarget) last.text += '\n' + line
    else segments.push({ text: line, isTarget })
  })
  return segments.map(s => ({ ...s, text: s.text.replace(/^\n+|\n+$/g, '') })).filter(s => s.text.trim())
}
