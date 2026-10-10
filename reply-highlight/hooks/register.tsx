import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Anchor } from '../types'

// When the person takes the prompt box's suggestion ("do the Friday one now"),
// find the part of the last reply it refers to and draw an outline around it.

const offered = atom({ plugin: 'reply-highlight', key: 'offered' } as const, '')
const anchor = atom({ plugin: 'reply-highlight', key: 'anchor' } as const, null)

const ACCENT = '#8f8cf4'
// A small, cheap model: it only picks block numbers.
const MODEL = 'haiku'
const MAX_UNITS = 3
const UNIT_CHARS = 400

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)

// A unit is what the outline may hold: one line of prose or one list item, or a
// whole code block or table, which would break apart if split.
type Unit = { start: number; end: number; text: string }

const unitsOf = (lines: string[]): Unit[] => {
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

// The reply the suggestion follows: the assistant text after the last prompt the
// person sent (not counting the suggestion itself, once it has been sent).
async function lastReply($: EngineInterface, suggestion: string): Promise<string> {
  const messages = await $.session.messages()
  if (!Array.isArray(messages)) return ''
  const parts: string[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.role === 'assistant') {
      if (m.text.trim()) parts.unshift(m.text)
      continue
    }
    // Tool results come back as user rows inside the same reply: not a prompt.
    if (m.toolResults?.length) continue
    const text = m.text.trim()
    if (!text || (squash(text) === squash(suggestion) && !parts.length)) continue
    if (parts.length) break
  }
  return parts.join('\n\n')
}

const STOP = new Set(
  'the this that with from have will what your yours just then them they into also more some okay sure please lets let'.split(' '),
)

// Without the model: the unit sharing the most words with the suggestion.
const byWords = (suggestion: string, units: Unit[]): Unit[] => {
  const words = squash(suggestion)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length > 3 && !STOP.has(w))
  if (!words.length) return []
  const scored = units.map(u => ({ u, score: words.filter(w => squash(u.text).includes(w)).length }))
  const best = Math.max(0, ...scored.map(s => s.score))
  return best >= 2 || (best === 1 && words.length === 1) ? scored.filter(s => s.score === best).slice(0, 1).map(s => s.u) : []
}

async function locate($: EngineInterface, suggestion: string, isSent = false): Promise<void> {
  const current = await read($, anchor)
  if (current && current.suggestion === suggestion) return
  await update($, anchor, () => ({ suggestion, status: 'finding' as const, units: [], quotes: [], isSent, isHidden: false }))

  const reply = await lastReply($, suggestion)
  const units = unitsOf(reply.split('\n'))
  let picked: Unit[] = []
  if (units.length) {
    const numbered = units.map((u, i) => `[${i + 1}] ${clip(u.text.replace(/\n/g, ' '), UNIT_CHARS)}`).join('\n')
    const answer = await $.model.complete({
      model: MODEL,
      maxTokens: 20,
      timeoutMs: 15_000,
      system:
        'You link a short follow-up message to the part of the previous reply it refers to. ' +
        'Answer with block numbers only, comma-separated, at most three, or NONE.',
      prompt:
        `Previous reply, split into numbered blocks:\n${numbered}\n\n` +
        `Follow-up the user is about to send: "${suggestion}"\n\n` +
        'Which blocks does the follow-up agree to, act on or point at? Pick the most specific blocks ' +
        '(the option, item or sentence itself, not an introduction to a list). ' +
        'Answer NONE if it refers to nothing specific, such as a general "go ahead" or "let me know".',
    })
    if (answer.isAnswered) {
      const nums = /none/i.test(answer.text) ? [] : [...answer.text.matchAll(/\d+/g)].map(m => Number(m[0]))
      picked = [...new Set(nums)].map(n => units[n - 1]).filter((u): u is Unit => !!u).slice(0, MAX_UNITS)
    } else {
      picked = byWords(suggestion, units)
    }
  }

  await update($, anchor, a =>
    a && a.suggestion === suggestion
      ? { ...a, status: picked.length ? ('found' as const) : ('none' as const), units: picked.map(u => squash(u.text)), quotes: picked.map(u => u.text) }
      : a,
  )
}

type Segment = { text: string; isTarget: boolean }

// Splits a drawn block of the reply into runs of plain and outlined lines.
const segmentsOf = (text: string, targets: Set<string>): Segment[] | null => {
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

// The prompt box as the person's own edits left it. A (re)load starts it empty,
// as the box nearly always is between turns.
let lastBox: string | undefined = ''

const isPhrase = (s: string): boolean => s.trim().split(/\s+/).length >= 2

// A suggestion the person took: remember it and look it up once, in the
// background so the keystroke or the send is never held up.
async function take($: EngineInterface, text: string, isSent = false): Promise<void> {
  if (squash(await read($, offered)) === squash(text)) return
  await update($, offered, () => text)
  await update($, anchor, () => null)
  void locate($, text, isSent)
}

export const register: Register = on => {
  // A suggestion appears (the terminal says so; the desktop app does not): look
  // it up at once, so the outline shows beside it.
  on('prompt.suggest', async ($, e, next) => {
    const result = await next(e)
    if (result.isShown) {
      await update($, offered, () => e.text)
      await update($, anchor, a => (a && a.suggestion === e.text ? a : null))
      void locate($, e.text)
    }
    return result
  })

  // Typing along with the suggestion (or taking it with Tab) keeps the outline;
  // typing something else hides it, and clearing the box brings it back.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const before = lastBox
    lastBox = box.text
    // The desktop app neither raises `prompt.suggest` nor counts taking the
    // suggestion (Tab) as an edit: the phrase just appears in the box. So a box
    // that holds a phrase the person never typed was filled by Tab, and the first
    // keystroke after it shows that.
    if (before !== undefined && squash(e.text) !== squash(before) && isPhrase(e.text)) {
      await take($, e.text.trim())
    }
    const suggestion = await read($, offered)
    if (!suggestion) return box
    const typed = squash(box.text)
    const isHidden = !!typed && !squash(suggestion).startsWith(typed) && !typed.startsWith(squash(suggestion))
    await update($, anchor, a => (a && a.suggestion === suggestion && a.isHidden !== isHidden ? { ...a, isHidden } : a))
    return box
  })

  // Sent as offered, or with more added: the outline stays until the next suggestion.
  on('prompt.submit', async ($, e, next) => {
    const before = lastBox
    lastBox = ''
    // Taken with Tab and sent straight away: no keystroke ever showed the fill.
    if (e.origin.kind === 'composer' && before !== undefined && squash(e.text) !== squash(before) && isPhrase(e.text)) {
      await take($, e.text.trim(), true)
      return next(e)
    }
    const suggestion = await read($, offered)
    if (suggestion && squash(e.text).startsWith(squash(suggestion))) {
      await update($, anchor, x => (x && x.suggestion === suggestion ? { ...x, isSent: true, isHidden: false } : x))
    } else if (e.origin.kind !== 'task-notification') {
      await update($, anchor, () => null)
    }
    await update($, offered, () => '')
    return next(e)
  })

  // Once the reply that answers it is done, a sent suggestion's outline has served.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, anchor, a => (a && a.isSent ? null : a))
    return next(e)
  })

  // The band above the prompt quotes what the suggestion refers to. It draws on
  // every surface (the desktop app does not let a mod redraw reply text), and
  // keeps whatever other mods draw there beneath it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const a = await read($, anchor)
    if (!a || a.status !== 'found' || a.isHidden || e.props.hasSurvey || !a.quotes.length) return below
    const { Box, Text, Markdown, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingLeft={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={ACCENT} wrap="truncate-end">
              ↳ “{clip(a.suggestion, 60)}” refers to:
            </Text>
            <Button key="reply-highlight-dismiss" label="✕" plain role="dismiss" onPress={() => update($, anchor, () => null)} />
          </Box>
          {a.quotes.map((q, i) => (
            <Markdown key={`q${i}`} text={q} />
          ))}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const a = await read($, anchor)
    if (!a || a.status !== 'found' || a.isHidden || e.props.isSummary) return next(e)
    const segments = segmentsOf(e.props.text, new Set(a.units))
    if (!segments) return next(e)

    const { Box, Text, Markdown } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {segments.map((s, i) =>
          s.isTarget ? (
            <Box key={`t${i}`} flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingLeft={1}>
              <Text color={ACCENT} wrap="truncate-end">
                ↳ “{clip(a.suggestion, 60)}” refers to this
              </Text>
              <Markdown text={s.text} />
            </Box>
          ) : (
            <Markdown key={`p${i}`} text={s.text} />
          ),
        )}
      </Box>
    )
  })
}
