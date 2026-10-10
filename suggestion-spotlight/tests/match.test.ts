import { expect, test } from 'claude-code/testing'

import { byWords, inkLines, lastReply, numbered, pickFrom, sectionOf, segmentsOf, sparkled, squash, unitsOf } from '../hooks/match'

const REPLY = `Two ways to run the refresh:

1. **Daily:** run it every morning.
2. **Friday only:** keep the weekly Friday task and extend it.

| Tab | Source |
|---|---|
| Council | ALDC |

Which do you want?`

const PLAN = `Here is the plan.

1. **Polish the mod (about an hour):**

- A command with a demo.
- Settings in /config.

2. **Package it:**

- A public repo.

Want me to start on step 1?`

const lines = (s: string) => s.split('\n')

test('a table stays one unit', () => {
  const units = unitsOf(lines(REPLY))
  expect(units.map(u => u.text.split('\n').length)).toEqual([1, 1, 1, 3, 1])
})

test('a code block stays one unit', () => {
  const units = unitsOf(lines('Run this:\n\n```bash\nnpm test\nnpm run build\n```\n\nDone.'))
  expect(units.length).toBe(3)
  expect(units[1]?.text.startsWith('```bash')).toBe(true)
})

test('a heading ending in a colon takes in the list beneath it, and stops at its sibling', () => {
  const ls = lines(PLAN)
  const units = unitsOf(ls)
  const section = sectionOf(units, 1, ls)
  expect(section.map(u => u.text)).toEqual([
    '1. **Polish the mod (about an hour):**',
    '- A command with a demo.',
    '- Settings in /config.',
  ])
})

test('a plain item is its own section', () => {
  const ls = lines(REPLY)
  const units = unitsOf(ls)
  expect(sectionOf(units, 2, ls).length).toBe(1)
})

test('word matching finds the Friday option', () => {
  const units = unitsOf(lines(REPLY))
  expect(units[byWords('do the friday one now', units)]?.text).toEqual(
    '2. **Friday only:** keep the weekly Friday task and extend it.',
  )
})

test('word matching gives up on a generic follow-up', () => {
  expect(byWords('okay let me know when it is done', unitsOf(lines(REPLY)))).toBe(-1)
})

test("the model's block number maps back to the unit, NONE to nothing", () => {
  const units = unitsOf(lines(REPLY))
  const blocks = numbered(units)
  expect(pickFrom('3', blocks.indexOf)).toBe(2)
  expect(pickFrom('NONE', blocks.indexOf)).toBe(-1)
  expect(pickFrom('99', blocks.indexOf)).toBe(-1)
})

test('a very long reply sends its closing part', () => {
  const long = Array.from({ length: 200 }, (_, i) => `Line ${i} ${'x'.repeat(200)}`)
  const units = unitsOf(long)
  const blocks = numbered(units)
  expect(blocks.text.length < 20_000).toBe(true)
  expect(blocks.indexOf.get(1)! > 0).toBe(true)
  expect(blocks.indexOf.get(blocks.indexOf.size)).toBe(199)
})

test('the last reply skips tool results and the follow-up itself', () => {
  const rows = [
    { role: 'user' as const, text: 'earlier prompt', isToolResult: false },
    { role: 'assistant' as const, text: 'First part.', isToolResult: false },
    { role: 'user' as const, text: 'command output', isToolResult: true },
    { role: 'assistant' as const, text: 'Second part.', isToolResult: false },
    { role: 'user' as const, text: 'do the second one', isToolResult: false },
  ]
  expect(lastReply(rows, 'do the second one')).toEqual('First part.\n\nSecond part.')
})

test('only the matched lines are outlined, blank lines between them included', () => {
  const ls = lines(PLAN)
  const units = unitsOf(ls)
  const targets = new Set(sectionOf(units, 1, ls).map(u => squash(u.text)))
  const segments = segmentsOf(PLAN, targets)
  expect(segments?.map(s => s.isTarget)).toEqual([false, true, false])
  expect(segments?.[1]?.text.split('\n').length).toBe(4)
})

test('a block without the passage is left alone', () => {
  expect(segmentsOf('Nothing to see here.', new Set(['something else']))).toBe(null)
})

test('sparkles go inside a list marker and at the end', () => {
  expect(sparkled('2. **Friday only:** keep it.')).toEqual('2. ✨ **Friday only:** keep it. ✨')
  expect(sparkled('Plain sentence.')).toEqual('✨ Plain sentence. ✨')
})

test('a table gets its sparkles on lines of their own', () => {
  expect(sparkled('| a | b |\n|---|---|')).toEqual('✨\n\n| a | b |\n|---|---|\n\n✨')
})

test('the highlighter keeps bold, drops code ticks and link targets, leaves the marker unmarked', () => {
  expect(inkLines('1. **Add a button** to `panel.tsx`, see [docs](https://x.y)')).toEqual([
    {
      marker: '1. ',
      runs: [
        { text: 'Add a button', bold: true },
        { text: ' to panel.tsx, see docs', bold: false },
      ],
    },
  ])
})

test('the highlighter skips code fences and table rules', () => {
  expect(inkLines('```bash\nnpm test\n```').map(l => l.runs.map(r => r.text).join(''))).toEqual(['npm test'])
  expect(inkLines('| a |\n|---|').length).toBe(1)
})
