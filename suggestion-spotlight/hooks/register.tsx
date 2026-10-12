import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Anchor } from '../types'
import { abovePrompt, inReply, isStyle, STYLES } from './look'
import type { Style } from './look'
import {
  byWords,
  isTabFill,
  lastReply,
  numbered,
  pickFrom,
  promptFor,
  sectionOf,
  segmentsOf,
  squash,
  SYSTEM,
  unitsOf,
} from './match'
import type { Row, Unit } from './match'

// When you take Claude's suggested next prompt ("do the Friday one now"), find
// the part of the last reply it refers to and spotlight it: outlined in the
// reply, and quoted in a box above the prompt, in the style the person picked.

const offered = atom({ plugin: 'suggestion-spotlight', key: 'offered' } as const, '')
const anchor = atom({ plugin: 'suggestion-spotlight', key: 'anchor' } as const, null)
const enabled = atom({ plugin: 'suggestion-spotlight', key: 'enabled' } as const, true)
const style = atom({ plugin: 'suggestion-spotlight', key: 'style' } as const, 'claude' as Style)

const COMMAND = 'suggestion-spotlight'

type Show = 'both' | 'above-prompt' | 'in-reply'

// The prompt box as the person's own edits left it. A (re)load starts it empty,
// as the box nearly always is between turns.
let lastBox = ''

const toRows = (messages: unknown): Row[] =>
  Array.isArray(messages)
    ? messages.map(m => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        text: typeof m.text === 'string' ? m.text : '',
        isToolResult: Array.isArray(m.toolResults) && m.toolResults.length > 0,
      }))
    : []

const freshAnchor = (suggestion: string, isSent: boolean): Anchor => ({
  suggestion,
  status: 'finding',
  units: [],
  quotes: [],
  isSent,
  isHidden: false,
})

async function locate($: EngineInterface, suggestion: string, model: string, isSent: boolean): Promise<void> {
  const current = await read($, anchor)
  if (current && current.suggestion === suggestion) return
  await update($, anchor, () => freshAnchor(suggestion, isSent))

  const reply = lastReply(toRows(await $.session.messages()), suggestion)
  const lines = reply.split('\n')
  const units = unitsOf(lines)
  let index = -1
  if (units.length) {
    const blocks = numbered(units)
    const answer = await $.model.complete({
      model,
      maxTokens: 10,
      timeoutMs: 15_000,
      system: SYSTEM,
      prompt: promptFor(blocks.text, suggestion),
    })
    index = answer.isAnswered ? pickFrom(answer.text, blocks.indexOf) : byWords(suggestion, units)
  }
  const section: Unit[] = index >= 0 ? sectionOf(units, index, lines) : []

  await update($, anchor, a =>
    a && a.suggestion === suggestion
      ? {
          ...a,
          status: section.length ? ('found' as const) : ('none' as const),
          units: section.map(u => squash(u.text)),
          // The box above the prompt quotes the heading alone; the reply outlines the whole section.
          quotes: section.slice(0, 1).map(u => u.text),
        }
      : a,
  )
}

// A suggestion the person took: remember it and look it up once, in the
// background so the keystroke or the send is never held up.
async function take($: EngineInterface, text: string, model: string, isSent = false): Promise<void> {
  if (!(await read($, enabled))) return
  if (squash(await read($, offered)) === squash(text)) return
  await update($, offered, () => text)
  await update($, anchor, () => null)
  void locate($, text, model, isSent)
}

// ✕ forgets the suggestion as well as the spotlight, so taking it again looks it up again.
async function forget($: EngineInterface): Promise<void> {
  await update($, anchor, () => null)
  await update($, offered, () => '')
}

// `/suggestion-spotlight demo`: spotlight the last list item (or paragraph) of
// the last reply, so the look can be tried without waiting for a suggestion.
async function demo($: EngineInterface): Promise<string> {
  const reply = lastReply(toRows(await $.session.messages()), '')
  const lines = reply.split('\n')
  const units = unitsOf(lines)
  const items = units.map((u, i) => ({ u, i })).filter(({ u }) => /^\s*([-*+]|\d+[.)])\s/.test(u.text))
  const pick = items[items.length - 1]?.i ?? units.length - 1
  if (pick < 0) return 'Nothing to spotlight yet: there is no reply above.'
  const section = sectionOf(units, pick, lines)
  await update($, offered, () => '')
  await update($, anchor, () => ({
    ...freshAnchor('demo', false),
    status: 'found' as const,
    units: section.map(u => squash(u.text)),
    quotes: section.slice(0, 1).map(u => u.text),
  }))
  return 'Spotlighting the last item of the reply above. Press ✕ on the box, or type, to clear it.'
}

export const register: Register = (on, options) => {
  const model = typeof options.model === 'string' && options.model ? options.model : 'haiku'
  const show: Show = options.show === 'above-prompt' || options.show === 'in-reply' ? options.show : 'both'
  const configured: Style = isStyle(options.style) ? options.style : 'claude'

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: `Turn the suggestion spotlight on or off (on, off), pick its look (style ${STYLES.join('|')}), or show a demo on the last reply (demo, or demo <a suggestion> to run the real lookup)`,
    })
    const stored = await $.store.get('enabled')
    await update($, enabled, () => stored !== false)
    // A look picked with the command outlasts the /config default until the default changes.
    const picked = await $.store.get('style')
    const pickedOver = await $.store.get('styleOver')
    await update($, style, () => (isStyle(picked) && pickedOver === configured ? picked : configured))
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [arg = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (arg === 'demo') {
      // `demo <text>`: the real lookup, as if <text> were the suggestion taken with Tab.
      const asIf = e.args.trim().replace(/^demo\s*/i, '').trim()
      if (!asIf) return { text: await demo($) }
      await update($, offered, () => asIf)
      await update($, anchor, () => null)
      await locate($, asIf, model, false)
      const found = await read($, anchor)
      return {
        text:
          found?.status === 'found'
            ? `Spotlighting what “${asIf}” refers to. Press ✕ on the box, or type, to clear it.`
            : `“${asIf}” does not point at anything specific in the reply above.`,
      }
    }
    if (arg === 'style') {
      if (!isStyle(value)) return { text: `Styles: ${STYLES.join(', ')}. Now: ${await read($, style)}.` }
      await update($, style, () => value)
      await $.store.set('style', value)
      await $.store.set('styleOver', configured)
      return { text: `Spotlight style: ${value}. Try /${COMMAND} demo to see it.` }
    }
    const next = arg === 'on' ? true : arg === 'off' ? false : !(await read($, enabled))
    await update($, enabled, () => next)
    await $.store.set('enabled', next)
    if (!next) await update($, anchor, () => null)
    return { text: next ? 'Suggestion spotlight is on.' : 'Suggestion spotlight is off.' }
  })

  // A suggestion appears (the terminal says so; the desktop app does not): look
  // it up at once, so the spotlight shows beside it.
  on('prompt.suggest', async ($, e, next) => {
    const result = await next(e)
    if (result.isShown && (await read($, enabled))) {
      await update($, offered, () => e.text)
      await update($, anchor, a => (a && a.suggestion === e.text ? a : null))
      void locate($, e.text, model, false)
    }
    return result
  })

  // The desktop app neither raises `prompt.suggest` nor counts taking the
  // suggestion (Tab) as an edit: the phrase just appears in the box. So an empty
  // box that now holds a phrase the person never typed was filled by Tab, and the first
  // keystroke after it shows that. Typing along with it keeps the spotlight;
  // typing something else hides it, and clearing the box brings it back.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const before = lastBox
    lastBox = box.text
    if (isTabFill(before, e.text)) await take($, e.text.trim(), model)
    const suggestion = await read($, offered)
    if (!suggestion) return box
    const typed = squash(box.text)
    const isHidden = !!typed && !squash(suggestion).startsWith(typed) && !typed.startsWith(squash(suggestion))
    await update($, anchor, a => (a && a.suggestion === suggestion && a.isHidden !== isHidden ? { ...a, isHidden } : a))
    return box
  })

  // Sent as offered, or with more added: the spotlight stays while the reply is
  // written. Taken with Tab and sent at once: no keystroke showed it, so look now.
  on('prompt.submit', async ($, e, next) => {
    const before = lastBox
    lastBox = ''
    if (e.origin.kind === 'composer' && isTabFill(before, e.text)) {
      await take($, e.text.trim(), model, true)
      return next(e)
    }
    const suggestion = await read($, offered)
    if (suggestion && squash(e.text).startsWith(squash(suggestion))) {
      await update($, anchor, a => (a && a.suggestion === suggestion ? { ...a, isSent: true, isHidden: false } : a))
    } else if (e.origin.kind !== 'task-notification') {
      await update($, anchor, () => null)
    }
    await update($, offered, () => '')
    return next(e)
  })

  // Once the reply that answers it is done, a sent suggestion's spotlight has served.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, anchor, a => (a && a.isSent ? null : a))
    return next(e)
  })

  // The box above the prompt quotes what the suggestion refers to, and keeps
  // whatever other mods draw there beneath it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (show === 'in-reply') return below
    const a = await read($, anchor)
    // Once sent, the choice is made: the box gives the space back, while the
    // outline in the reply stays until the answer is done.
    if (!a || a.status !== 'found' || a.isHidden || a.isSent || e.props.hasSurvey || !a.quotes.length) return below
    const ui = $.ui.resolve(e)
    const { Box, Button } = ui
    const dismiss = (
      <Button key="suggestion-spotlight-dismiss" label="✕" plain role="dismiss" onPress={() => forget($)} />
    )
    return (
      <Box flexDirection="column">
        {abovePrompt(ui, await read($, style), a.suggestion, a.quotes.join('\n'), dismiss)}
        {below}
      </Box>
    )
  })

  // The passage itself, outlined where it sits in the reply.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (show === 'above-prompt') return next(e)
    const a = await read($, anchor)
    if (!a || a.status !== 'found' || a.isHidden || e.props.isSummary) return next(e)
    const segments = segmentsOf(e.props.text, new Set(a.units))
    if (!segments) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Markdown } = ui
    const look = await read($, style)
    return (
      <Box flexDirection="column">
        {segments.map((s, i) =>
          s.isTarget ? inReply(ui, look, a.suggestion, s.text, `t${i}`) : <Markdown key={`p${i}`} text={s.text} />,
        )}
      </Box>
    )
  })
}
