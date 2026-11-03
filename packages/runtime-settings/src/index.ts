/**
 * `ctx.runtimeSettings` — operator switches that the settings page can change
 * without editing a profile.
 *
 * The file is the source of truth (`$DSH_HOME/storages/zcd-settings.json`), so
 * a value written from the browser survives a restart. Nothing here decides
 * policy by itself: consumers read a value at decision time and fall back to
 * their composition config when it is absent, so an empty file leaves the
 * shipped behaviour untouched.
 *
 * Every value is validated on write: an unknown key, a wrong type, or an
 * out-of-range number is rejected instead of silently stored.
 *
 * @module @zcd/runtime-settings
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** Deployment configuration. */
export interface Config {
  /** Settings file path; defaults to `$DSH_HOME/storages/zcd-settings.json`. */
  path?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    runtimeSettings: RuntimeSettingsService
  }
}

/**
 * The switch catalogue. Each entry carries its default and its bound; the
 * defaults are what the composition already does, so a missing file is a
 * no-op rather than a silent behaviour change.
 */
export const SETTING_SPECS = {
  'policy.planReadonly.enabled': { type: 'boolean', default: false },
  'policy.planReadonly.classifyBash': { type: 'boolean', default: true },
  'workflow.maxNodes': { type: 'integer', default: 100, min: 1, max: 1000 },
  'workflow.nodeTimeoutMs': { type: 'integer', default: 1_800_000, min: 1_000, max: 86_400_000 },
  'offpeak.idleMinutes': { type: 'integer', default: 10, min: 0, max: 1440 },
} as const

/** Every settable key. */
export type SettingKey = keyof typeof SETTING_SPECS

/** Resolved value of one key. */
export type SettingValue<K extends SettingKey> = (typeof SETTING_SPECS)[K] extends { type: 'boolean' }
  ? boolean
  : number

/** A full snapshot: every known key with its current (possibly defaulted) value. */
export type SettingsSnapshot = { [K in SettingKey]: SettingValue<K> }

const KEYS = Object.keys(SETTING_SPECS) as SettingKey[]

/**
 * Resolve the settings file path.
 *
 * `ZCD_SETTINGS_HOME` exists for tests and for deployments that keep the whole
 * product state in one directory; the default is the Harness home, where the
 * profile and every other ZCD storage already live.
 * @param env - process environment (injectable for tests).
 * @returns an absolute path.
 */
export function resolveSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ZCD_SETTINGS_HOME
  if (override !== undefined && override.trim().length > 0) return join(override, 'zcd-settings.json')
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'zcd-settings.json')
}

/** Whether a string names a known setting. */
export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_SPECS, key)
}

/**
 * Validate one candidate value for a key.
 * @param key - known setting key.
 * @param raw - untrusted value from a request body or file.
 * @returns the coerced value.
 * @throws when the value does not match the spec.
 */
export function coerceSetting<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  const spec = SETTING_SPECS[key] as { type: 'boolean' | 'integer'; min?: number; max?: number }
  if (spec.type === 'boolean') {
    if (typeof raw !== 'boolean') throw new Error(`${key} must be a boolean`)
    return raw as SettingValue<K>
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw)) throw new Error(`${key} must be an integer`)
  if (spec.min !== undefined && raw < spec.min) throw new Error(`${key} must be >= ${spec.min}`)
  if (spec.max !== undefined && raw > spec.max) throw new Error(`${key} must be <= ${spec.max}`)
  return raw as SettingValue<K>
}

/**
 * Runtime settings service.
 */
export class RuntimeSettingsService extends Service {
  private readonly path: string
  private values: Partial<SettingsSnapshot> = {}

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'runtimeSettings')
    this.path = config.path ?? resolveSettingsPath()
    this.values = this.read()
  }

  /** Load the file, dropping keys or values that no longer validate. */
  private read(): Partial<SettingsSnapshot> {
    if (!existsSync(this.path)) return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      this.ctx.logger.warn('zcd-settings: ignoring unreadable file %s', this.path)
      return {}
    }
    if (typeof parsed !== 'object' || parsed === null) return {}
    const kept: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isSettingKey(key)) continue
      try {
        kept[key] = coerceSetting(key, value)
      } catch {
        this.ctx.logger.warn('zcd-settings: ignoring invalid %s in %s', key, this.path)
      }
    }
    return kept as Partial<SettingsSnapshot>
  }

  /** Write the file atomically. */
  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(temp, `${JSON.stringify(this.values, null, 2)}\n`)
    renameSync(temp, this.path)
  }

  /**
   * Read one value, falling back to the shipped default.
   * @param key - setting key.
   * @returns the stored value or the spec default.
   */
  get<K extends SettingKey>(key: K): SettingValue<K> {
    return (this.values[key] ?? SETTING_SPECS[key].default) as SettingValue<K>
  }

  /**
   * Merge several values and persist. All values are validated before any is
   * written, so a partial update never leaves a half-applied patch.
   * @param patch - key/value pairs.
   * @returns the refreshed snapshot.
   */
  update(patch: Record<string, unknown>): SettingsSnapshot {
    const next: Record<string, unknown> = { ...this.values }
    const changed: string[] = []
    for (const [key, raw] of Object.entries(patch)) {
      if (!isSettingKey(key)) throw new Error(`unknown setting: ${key}`)
      const value = coerceSetting(key, raw)
      if (next[key] !== value) changed.push(key)
      next[key] = value
    }
    this.values = next as Partial<SettingsSnapshot>
    this.persist()
    if (changed.length > 0) this.ctx.logger.info('zcd-settings: updated %s', changed.join(', '))
    return this.snapshot()
  }

  /**
   * Every known key with its effective value, plus the file path for the UI.
   * @returns the snapshot.
   */
  snapshot(): SettingsSnapshot {
    const out: Record<string, unknown> = {}
    for (const key of KEYS) out[key] = this.get(key)
    return out as SettingsSnapshot
  }

  /** Drop every stored override and fall back to the shipped defaults. */
  reset(): SettingsSnapshot {
    this.values = {}
    this.persist()
    return this.snapshot()
  }
}

export default RuntimeSettingsService
