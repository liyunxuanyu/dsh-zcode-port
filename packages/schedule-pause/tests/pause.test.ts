import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule'
import { PausedTaskStore, resolvePausedPath, toCreateRequest } from '../src/index.js'

/** One record per rule kind. */
const records = {
  after: {
    id: 's-after', kind: 'after', title: 'Standup', prompt: 'stand up', afterSeconds: 600,
    scheduledAt: '2026-11-03T09:00:00.000Z',
  },
  every: {
    id: 's-every', kind: 'every', title: 'Ping', prompt: 'ping', everySeconds: 3600,
    scheduledAt: '2026-11-03T10:00:00.000Z',
  },
  daily: {
    id: 's-daily', kind: 'daily', title: 'Review', prompt: 'review', time: '09:30:00.000',
    timeZone: 'Asia/Shanghai', scheduledAt: '2026-11-04T01:30:00.000Z',
  },
  weekly: {
    id: 's-weekly', kind: 'weekly', title: 'Retro', prompt: 'retro', time: '16:00:00.000',
    timeZone: 'Asia/Shanghai', weekdays: [1, 3], scheduledAt: '2026-11-04T08:00:00.000Z',
  },
  cron: {
    id: 's-cron', kind: 'cron', title: 'Clean', prompt: 'clean', expression: '*/15 9-17 * * 1-5',
    timeZone: 'UTC', scheduledAt: '2026-11-03T10:15:00.000Z',
  },
} as const satisfies Record<string, ScheduleRecord>

describe('toCreateRequest', () => {
  it('round-trips every rule kind losslessly', () => {
    expect(toCreateRequest(records.every)).toMatchObject({ every_seconds: 3600, title: 'Ping', prompt: 'ping' })
    expect(toCreateRequest(records.daily)).toMatchObject({ daily: { time: '09:30:00.000', time_zone: 'Asia/Shanghai' } })
    expect(toCreateRequest(records.weekly)).toMatchObject({
      weekly: { time: '16:00:00.000', time_zone: 'Asia/Shanghai', weekdays: [1, 3] },
    })
    expect(toCreateRequest(records.cron)).toMatchObject({ cron: { expression: '*/15 9-17 * * 1-5', time_zone: 'UTC' } })
  })

  it('keeps an absolute instant for one-shot rules so an overdue reminder still fires', () => {
    expect(toCreateRequest(records.after)).toMatchObject({ at: '2026-11-03T09:00:00.000Z' })
    expect(toCreateRequest(records.after)).not.toHaveProperty('after_seconds')
  })

  it('never leaks the original id into the create request', () => {
    for (const record of Object.values(records)) {
      expect(toCreateRequest(record as ScheduleRecord)).not.toHaveProperty('id')
    }
  })
})

describe('PausedTaskStore', () => {
  function store() {
    return new PausedTaskStore(join(mkdtempSync(join(tmpdir(), 'zcd-pause-')), 'paused.json'))
  }

  it('starts empty and round-trips a task', () => {
    const s = store()
    expect(s.list()).toEqual([])
    s.put({ id: 's-1', sessionId: 'sess-1', record: records.every, pausedAt: 1 })
    expect(s.get('s-1')?.record.title).toBe('Ping')
    expect(s.list()).toHaveLength(1)
  })

  it('replaces by id instead of duplicating', () => {
    const s = store()
    s.put({ id: 's-1', sessionId: 'sess-1', record: records.every, pausedAt: 1 })
    s.put({ id: 's-1', sessionId: 'sess-1', record: records.daily, pausedAt: 2 })
    expect(s.list()).toHaveLength(1)
    expect(s.get('s-1')?.record.kind).toBe('daily')
  })

  it('removes and reports whether anything was there', () => {
    const s = store()
    s.put({ id: 's-1', sessionId: 'sess-1', record: records.every, pausedAt: 1 })
    expect(s.remove('s-1')).toBe(true)
    expect(s.remove('s-1')).toBe(false)
    expect(s.list()).toEqual([])
  })

  it('survives a reopen and ignores a corrupted file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'zcd-pause-')), 'paused.json')
    new PausedTaskStore(path).put({ id: 's-1', sessionId: 'sess-1', record: records.cron, pausedAt: 5 })
    expect(new PausedTaskStore(path).get('s-1')?.record.kind).toBe('cron')

    const broken = new PausedTaskStore(join(mkdtempSync(join(tmpdir(), 'zcd-pause-')), 'missing.json'))
    expect(broken.list()).toEqual([])
  })

  it('honours the ZCD_SCHEDULE_PAUSE_HOME override', () => {
    expect(resolvePausedPath({ ZCD_SCHEDULE_PAUSE_HOME: '/tmp/x' })).toBe(join('/tmp/x', 'zcd-schedule-paused.json'))
    expect(resolvePausedPath({ DSH_HOME: '/tmp/home' })).toBe(join('/tmp/home', 'storages', 'zcd-schedule-paused.json'))
  })
})
