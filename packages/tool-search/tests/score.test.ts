import { describe, expect, it } from 'vitest'
import { rankEntries, scoreEntry, tokenize } from '../src/score.js'

const entries = [
  { name: 'workflow_run', group: 'workflow', description: 'Start a durable workflow run', keywords: ['orchestrate', 'script'] },
  { name: 'browser_navigate', group: 'browser', description: 'Open a page in the controlled browser', keywords: ['page', 'url'] },
  { name: 'memory_search', group: 'memory', description: 'Search long-term memory', keywords: ['recall', 'notes'] },
] as const

describe('tokenize', () => {
  it('drops stop words and punctuation', () => {
    expect(tokenize('I need to use a browser page')).toEqual(['browser', 'page'])
  })
})

describe('scoreEntry', () => {
  it('scores an exact name highest', () => {
    const exact = scoreEntry(entries[0], ['workflow_run'])
    const partial = scoreEntry(entries[0], ['workflow'])
    expect(exact).toBeGreaterThan(partial)
  })
})

describe('rankEntries', () => {
  it('ranks by relevance and respects the limit', () => {
    const matches = rankEntries(entries, 'browser page', 1)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.entry.name).toBe('browser_navigate')
  })

  it('returns nothing for an empty or unmatched query', () => {
    expect(rankEntries(entries, '', 5)).toEqual([])
    expect(rankEntries(entries, 'zzz', 5)).toEqual([])
  })

  it('is deterministic for ties', () => {
    const first = rankEntries(entries, 'open', 5).map(match => match.entry.name)
    const second = rankEntries(entries, 'open', 5).map(match => match.entry.name)
    expect(first).toEqual(second)
  })
})
