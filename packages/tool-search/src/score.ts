/**
 * Pure scoring for deferred-tool search.
 *
 * Deterministic and dependency-free so the ranking is unit-testable without a
 * Cordis context. Scoring is intentionally simple: exact name beats prefix,
 * prefix beats keyword, keyword beats description.
 *
 * @module @zcd/tool-search/score
 */

/** One searchable catalog entry. */
export interface CatalogEntry {
  /** Registered tool name (wire name). */
  readonly name: string
  /** Group label used for display and grouping (e.g. `browser`). */
  readonly group: string
  /** Model-facing one-line description. */
  readonly description: string
  /** Extra search terms. */
  readonly keywords: readonly string[]
}

/** One ranked match. */
export interface CatalogMatch {
  readonly entry: CatalogEntry
  readonly score: number
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'with', 'by',
  'tool', 'tools', 'use', 'using', 'need', 'want', 'can', 'i', 'we',
])

/**
 * Split a query into lowercase terms.
 * @param query - raw model query.
 * @returns unique non-empty terms, stop words removed.
 */
export function tokenize(query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/u)
    .filter(term => term.length > 1 && !STOP_WORDS.has(term))
  return [...new Set(terms)]
}

/**
 * Score one entry against pre-tokenized terms.
 * @param entry - catalog entry.
 * @param terms - tokenized query.
 * @returns non-negative score; 0 means no signal.
 */
export function scoreEntry(entry: CatalogEntry, terms: readonly string[]): number {
  const haystackName = entry.name.toLowerCase()
  const haystackGroup = entry.group.toLowerCase()
  const haystackDescription = entry.description.toLowerCase()
  const haystackKeywords = entry.keywords.map(value => value.toLowerCase())

  let score = 0
  for (const term of terms) {
    if (haystackName === term) {
      score += 100
      continue
    }
    if (haystackName.startsWith(term)) {
      score += 60
    } else if (haystackName.includes(term)) {
      score += 40
    }
    if (haystackKeywords.some(keyword => keyword === term)) {
      score += 30
    } else if (haystackKeywords.some(keyword => keyword.includes(term))) {
      score += 18
    }
    if (haystackGroup === term) {
      score += 20
    }
    if (haystackDescription.includes(term)) {
      score += 8
    }
  }
  return score
}

/**
 * Rank entries for one query.
 *
 * Ties are broken by group, then name, so the output is stable across runs and
 * platforms.
 * @param entries - catalog to search.
 * @param query - raw model query.
 * @param limit - maximum matches to return.
 * @returns ranked matches, best first; empty when nothing scores.
 */
export function rankEntries(
  entries: readonly CatalogEntry[],
  query: string,
  limit: number,
): CatalogMatch[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []
  const matches: CatalogMatch[] = []
  for (const entry of entries) {
    const score = scoreEntry(entry, terms)
    if (score > 0) matches.push({ entry, score })
  }
  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    const byGroup = left.entry.group.localeCompare(right.entry.group)
    if (byGroup !== 0) return byGroup
    return left.entry.name.localeCompare(right.entry.name)
  })
  return matches.slice(0, Math.max(0, limit))
}
