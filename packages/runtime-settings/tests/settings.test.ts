import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { RuntimeSettingsService, coerceSetting, isSettingKey } from '../src/index.js'

async function service() {
  const ctx = new Context()
  const path = join(mkdtempSync(join(tmpdir(), 'zcd-settings-')), 'zcd-settings.json')
  await ctx.plugin(RuntimeSettingsService, { path })
  return { ctx, path, service: ctx.get('runtimeSettings') as RuntimeSettingsService }
}

describe('runtime settings', () => {
  it('starts from the shipped defaults when no file exists', async () => {
    const { service: settings } = await service()
    expect(settings.get('policy.planReadonly.enabled')).toBe(false)
    expect(settings.get('policy.planReadonly.classifyBash')).toBe(true)
    expect(settings.get('workflow.maxNodes')).toBe(100)
    expect(settings.get('workflow.nodeTimeoutMs')).toBe(1_800_000)
  })

  it('persists a validated patch and reads it back from a new instance', async () => {
    const first = await service()
    first.service.update({ 'workflow.maxNodes': 7, 'policy.planReadonly.enabled': true })
    expect(first.service.get('workflow.maxNodes')).toBe(7)

    const ctx = new Context()
    await ctx.plugin(RuntimeSettingsService, { path: first.path })
    const reloaded = ctx.get('runtimeSettings') as RuntimeSettingsService
    expect(reloaded.get('workflow.maxNodes')).toBe(7)
    expect(reloaded.get('policy.planReadonly.enabled')).toBe(true)
    expect(JSON.parse(readFileSync(first.path, 'utf8'))['workflow.maxNodes']).toBe(7)
  })

  it('rejects unknown keys, wrong types, and out-of-range numbers', async () => {
    const { service: settings } = await service()
    expect(() => settings.update({ 'not.a.setting': true })).toThrow(/unknown setting/)
    expect(() => settings.update({ 'workflow.maxNodes': 'many' })).toThrow(/integer/)
    expect(() => settings.update({ 'workflow.maxNodes': 1.5 })).toThrow(/integer/)
    expect(() => settings.update({ 'workflow.maxNodes': 0 })).toThrow(/>= 1/)
    expect(() => settings.update({ 'policy.planReadonly.enabled': 'yes' })).toThrow(/boolean/)
    expect(settings.get('workflow.maxNodes')).toBe(100)
  })

  it('applies no part of a patch that fails validation', async () => {
    const { service: settings } = await service()
    expect(() => settings.update({ 'workflow.maxNodes': 9, 'offpeak.idleMinutes': -1 })).toThrow(/>= 0/)
    expect(settings.get('workflow.maxNodes')).toBe(100)
  })

  it('resets every override', async () => {
    const { service: settings } = await service()
    settings.update({ 'workflow.maxNodes': 5 })
    const after = settings.reset()
    expect(after['workflow.maxNodes']).toBe(100)
    expect(settings.get('workflow.maxNodes')).toBe(100)
  })

  it('drops unknown or invalid keys from an existing file', async () => {
    const ctx = new Context()
    const path = join(mkdtempSync(join(tmpdir(), 'zcd-settings-')), 'zcd-settings.json')
    writeFileSync(path, JSON.stringify({ 'workflow.maxNodes': 12, 'bogus.key': 1, 'offpeak.idleMinutes': -3 }))
    await ctx.plugin(RuntimeSettingsService, { path })
    const settings = ctx.get('runtimeSettings') as RuntimeSettingsService
    expect(settings.get('workflow.maxNodes')).toBe(12)
    expect(settings.get('offpeak.idleMinutes')).toBe(10)
  })

  it('exposes a snapshot with every known key', async () => {
    const { service: settings } = await service()
    const snapshot = settings.snapshot()
    expect(Object.keys(snapshot).sort()).toEqual([
      'offpeak.idleMinutes',
      'policy.planReadonly.classifyBash',
      'policy.planReadonly.enabled',
      'workflow.maxNodes',
      'workflow.nodeTimeoutMs',
    ])
  })

  it('knows its own catalogue', () => {
    expect(isSettingKey('workflow.maxNodes')).toBe(true)
    expect(isSettingKey('workflow.nope')).toBe(false)
    expect(coerceSetting('policy.planReadonly.enabled', true)).toBe(true)
    expect(() => coerceSetting('policy.planReadonly.enabled', 1)).toThrow()
  })
})
