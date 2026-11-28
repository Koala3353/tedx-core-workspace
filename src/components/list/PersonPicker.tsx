import type { ComponentProps } from 'react'
import { SearchSelect, type SearchOption } from './SearchSelect'

export type PickerPerson = {
  id: string
  name: string
  committee?: string | null
  position?: string | null
  email?: string | null
  extra?: string | null
}

/**
 * Person options for a SearchSelect: grouped by committee (when known) and showing committee and position.
 * People without a committee go last under "No committee". Leadership (no committee, has a position) goes first.
 */
export function personOptions(people: PickerPerson[], { selfId, leadingOptions = [] }: { selfId?: string; leadingOptions?: SearchOption[] } = {}): SearchOption[] {
  const grouped = people.some(p => p.committee)
  const groupOf = (p: PickerPerson) => !grouped ? undefined : p.committee ?? (p.position ? 'Leadership' : 'No committee')
  const rank = (g: string | undefined) => g === 'Leadership' ? 0 : g === 'No committee' ? 2 : 1
  const sorted = [...people].sort((a, b) => {
    const ga = groupOf(a), gb = groupOf(b)
    return rank(ga) - rank(gb) || (ga ?? '').localeCompare(gb ?? '') || a.name.localeCompare(b.name)
  })
  return [...leadingOptions, ...sorted.map(p => ({
    value: p.id,
    label: p.name + (p.id === selfId ? ' (you)' : ''),
    meta: [p.committee, p.position, p.extra].filter(Boolean).join(' · ') || undefined,
    group: groupOf(p),
    keywords: p.email ?? undefined,
  }))]
}

/** A SearchSelect tuned for picking one person. */
export function PersonPicker(props: ComponentProps<typeof SearchSelect>) {
  return <SearchSelect placeholder="Type a name" emptyText="No one matches. Try a shorter name or a committee." {...props} />
}
