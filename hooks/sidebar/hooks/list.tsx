/**
 * The ACTIVITY list and the search results, as a `Client` surface module: a
 * region this module draws and whose clicks it reads itself (`onPointer`).
 *
 * Why not Buttons: a Button is inverted by the engine under the pointer and
 * the focus, so moving the mouse over the list lit row after row. Here a
 * click on a row opens or closes it, a click on its `↗` line asks the hooks
 * module to open the link (`post`), and nothing changes under a passing
 * pointer. An open row closes itself after 30 s (a timer that counts only
 * while a row is open).
 *
 * The hooks module hands everything already worded, coloured and wrapped
 * (`ListProps`); this file lays it out. No `$` here: `post` is the way back.
 */
import type { ClientModule, ClientSurface } from 'claude-code'

import { ellipsizeCells as ellipsize, padCells } from './width'

export type ListRow = {
  kind: 'row'
  id: string
  dot: string
  word: string
  wordColor: string
  time: string
  /** The sentence, wrapped to the text column: two show closed, all open. */
  lines: string[]
  /** What opening adds under the sentence. */
  more: { text: string; dim: boolean }[]
  link: { url: string; label: string } | null
  textColor: string
  barColor: string
}

/** A dim line of its own (`+5 from other sessions`, `nothing yet`). */
export type ListNote = { kind: 'note'; id: string; text: string; color: string }

export type ListProps = {
  items: (ListRow | ListNote)[]
  /** The word column: dot, word and time take this many cells. */
  lw: number
  /** The text column's width. */
  tw: number
  /** Colours: the link, the faint time. */
  linkColor: string
  faintColor: string
}

type State = { open: string | null; ticks: number }

/** Closes an open row after this many one-second ticks. */
const CLOSE_TICKS = 30

/** Where each item sits: its first row, its height, and an open row's link line. */
export function layout(props: ListProps, open: string | null): { id: string; y: number; h: number; linkY: number | null; url: string | null }[] {
  const out: { id: string; y: number; h: number; linkY: number | null; url: string | null }[] = []
  let y = 0
  for (const item of props.items) {
    if (item.kind === 'note') {
      out.push({ id: item.id, y, h: 1, linkY: null, url: null })
      y += 2
      continue
    }
    const isOpen = item.id === open
    const extra = isOpen ? Math.max(0, item.lines.length - 2) + item.more.length : 0
    const linkY = isOpen && item.link !== null ? y + 2 + extra : null
    const h = 2 + extra + (linkY === null ? 0 : 1)
    out.push({ id: item.id, y, h, linkY, url: isOpen && item.link !== null ? item.link.url : null })
    y += h + 1
  }
  return out
}

const List: ClientModule<ListProps, State> = (props, surface: ClientSurface<State>) => {
  const { Box, Text } = surface.elements
  const state: State = surface.state ?? { open: null, ticks: 0 }
  if (surface.state === undefined) {
    surface.setState(state)
    surface.every(1000, () => {
      const st = surface.state
      if (st === undefined || st.open === null) return
      surface.setState(st.ticks + 1 >= CLOSE_TICKS ? { open: null, ticks: 0 } : { open: st.open, ticks: st.ticks + 1 })
    })
  }
  const spots = layout(props, state.open)
  surface.onPointer(ev => {
    if (ev.type !== 'down' || (ev.button !== undefined && ev.button !== 'left')) return
    const spot = spots.find(s => ev.y >= s.y && ev.y < s.y + s.h)
    if (spot === undefined) return
    const item = props.items.find(i => i.id === spot.id)
    if (item === undefined || item.kind !== 'row') return
    if (spot.linkY !== null && ev.y === spot.linkY && spot.url !== null) {
      surface.post({ open: spot.url })
      return
    }
    const now = surface.state ?? state
    surface.setState(now.open === item.id ? { open: null, ticks: 0 } : { open: item.id, ticks: 0 })
  })

  const rows: JSX.Element[] = []
  for (const item of props.items) {
    if (item.kind === 'note') {
      rows.push(<Text key={`n:${item.id}`} color={item.color}>{ellipsize(item.text, props.lw + props.tw)}</Text>)
      rows.push(<Text key={`n:${item.id}:gap`}> </Text>)
      continue
    }
    const isOpen = item.id === state.open
    const first = item.lines[0] ?? ''
    const second = isOpen
      ? (item.lines[1] ?? '')
      : item.lines.length > 2
        ? ellipsize(`${item.lines[1] ?? ''} ${item.lines.slice(2).join(' ')}`, props.tw)
        : (item.lines[1] ?? '')
    const word = padCells(ellipsize(item.word, props.lw - 3), props.lw - 2)
    rows.push(
      <Box key={`r:${item.id}:0`} flexDirection="row">
        <Text color={item.dot}>● </Text>
        <Text color={isOpen ? '#ffffff' : item.wordColor} bold>{word}</Text>
        <Text color={isOpen ? '#ffffff' : item.textColor}>{ellipsize(first, props.tw)}</Text>
      </Box>,
    )
    rows.push(
      <Box key={`r:${item.id}:1`} flexDirection="row">
        <Text color={props.faintColor}>{`  ${padCells(item.time, props.lw - 2)}`}</Text>
        <Text color={isOpen ? '#ffffff' : item.textColor}>{second}</Text>
      </Box>,
    )
    if (isOpen) {
      const extra = [...item.lines.slice(2).map(l => ({ text: l, dim: false })), ...item.more]
      extra.forEach((x, i) => {
        rows.push(
          <Box key={`r:${item.id}:x${String(i)}`} flexDirection="row">
            <Text color={item.barColor}>{'  │'.padEnd(props.lw)}</Text>
            <Text color={x.dim ? props.faintColor : '#ffffff'}>{x.text}</Text>
          </Box>,
        )
      })
      if (item.link !== null) {
        rows.push(
          <Box key={`r:${item.id}:link`} flexDirection="row">
            <Text>{' '.repeat(props.lw)}</Text>
            <Text color={props.linkColor}>{ellipsize(`↗ ${item.link.label}`, props.tw)}</Text>
          </Box>,
        )
      }
    }
    rows.push(<Text key={`r:${item.id}:gap`}> </Text>)
  }
  return <Box flexDirection="column">{rows}</Box>
}

export default List
