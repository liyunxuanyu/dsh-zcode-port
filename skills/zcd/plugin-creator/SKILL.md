---
name: plugin-creator
description: Use when adding a dsh Cordis plugin or bundle to this overlay project, wiring it into the product profile, or debugging why a new plugin row does not activate.
---

<!-- Rewritten for dsh from the ZCode plugin-creator skill (Apache-2.0).
     dsh plugins are Cordis packages composed by profile/bundle patches, not
     ZCode marketplace plugins. -->

# Creating a dsh plugin

dsh composes a product from a profile: ordered bundles, then the profile patch,
then launcher overlays. A plugin is a package with an `apply(ctx, config)`
function or a `Service` subclass. Upstream `packages/**` is read-only here;
product differences live in our own bundles and packages.

## 1. Pick the package shape

| Need | Shape |
|---|---|
| Model-facing tools | `export function apply(ctx)` + `inject = ['tools', 'deferredTools']` |
| A long-lived service (`ctx.foo`) | `export class Foo extends Service` + `export default Foo` |
| A host route | Plugin that injects `webServer` and calls `ctx.webServer.register` |
| A client page/card | Separate `client.js` lazy-CJS bundle, served by dsh's module loader |

A `Service` module **must have a default export**; the loader will otherwise
report `failed to import` with no detail. Tool plugins export named `apply`.

## 2. Package skeleton

```json
{
  "name": "@zcd/my-plugin",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": { ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" } },
  "dependencies": {
    "@deepseek-ai/dsh-tools": "0.2.2-alpha.2",
    "@zcd/deferred-tools": "workspace:*"
  },
  "peerDependencies": { "@deepseek-ai/cordis": "~4.0.6-alpha.1" },
  "devDependencies": { "@deepseek-ai/cordis": "4.0.6-alpha.1" }
}
```

Use `tsconfig` extending `../../tsconfig.base.json`, `outDir: lib`. Declare any
service you add with module augmentation so consumers type-check:

```ts
declare module '@deepseek-ai/cordis' {
  interface Context { foo: FooService }
}
```

Consumers must build the owning package first; workspace `exports` point at
`lib/*.d.ts`.

## 3. Register tools

- `defineTool` output schemas reject a root-level `required` array. Mark each
  property `required: true` instead.
- `execute` must be `async`.
- Read arguments from `exec.arguments`, not `exec.args`.
- For rare tools, use `ctx.deferredTools.register(definition, { group, keywords })`
  so they enter the step only after `tool_search` finds them.
- Paths from model input must be contained in `exec.agent.session.header.cwd`.

## 4. Compose it

1. Add the row to `packages/bundle-base/cordis.patch.yml` (or
   `bundle-web-app` for browser-side/host UI rows). A bundle patch is one
   top-level `insert` array; each row has `id`, `name`, optional `config`,
   optional `disabled`.
2. Add the dependency to the bundle package and to
   `profiles/product/package.json`.
3. Add a `link-profile.mjs` mapping under `directories` for `@zcd/*` packages.
4. `pnpm build && node scripts/link-profile.mjs`.
5. `DSH_HOME=... dsh --profile product --dump-config` shows the row.
6. `npx -y node@24 scripts/smoke-profile.mjs` boots the profile and fails if
   any plugin reports `did not activate`.

External third-party plugins follow the same path without a mapping: add the
published package to the profile and insert its row. `pnpm doctor` checks
dependencies, `engines.dsh`, duplicate versions, and bundle manifests.

## 5. Verify

- Unit test the service/tool in isolation with a Cordis `Context`.
- Add a route/SQL fixture to `scripts/smoke-profile.mjs` when the plugin has an
  HTTP surface.
- `pnpm typecheck && pnpm test && pnpm verify`.
- Keep `docs/13-implementation-status.md`, README counts, and screenshots in
  sync in the same change.

## Failure guide

| Symptom | Check |
|---|---|
| `failed to import` | Service default export; import path; built `lib/`; profile install |
| `pending (waiting for service: x)` | Injectable service missing or its row disabled |
| Row absent from `--dump-config` | Bundle patch path or dependency missing |
| Row present but tools missing | Plugin's `inject` names, `apply` throw, deferred admission |
| Client half not in boot graph | `dsh.client` declaration and lazy-CJS factory id |
