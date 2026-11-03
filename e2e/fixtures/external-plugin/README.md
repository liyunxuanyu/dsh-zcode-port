# External plugin fixture

A deliberately out-of-workspace package that stands in for a third-party dsh
plugin. `scripts/e2e-external-plugin.mjs` installs it into a scratch copy of the
product profile and asserts that the product boots with it loaded and serves
`GET /e2e-probe/health`.

Why the fixture is not a workspace package: the test must prove resolution from
the **profile's** `node_modules`, which is the real install path for an external
plugin. A workspace link would resolve from the repo instead and hide exactly
the failure this test exists to catch.

The fixture has no build step on purpose — an external plugin shipping plain ESM
is the common case, and requiring `tsc` here would test the wrong thing.
