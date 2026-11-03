---
name: visualize
description: >-
  Use when the user needs to see or explore something in the conversation: a chart, diagram, simulation, map, timeline, calculator, or small interactive tool. Creates a self-contained HTML page with the visualize tool; not for project files or static tables.
---

<!-- Rewritten for dsh from the ZCode visualize skill (Apache-2.0):
     apps/zcode-cli/packages/visualize-plugin/skills/visualize.
     dsh renders a host-served sandboxed page instead of a `::visualize`
     markdown directive, and the page has no host bridge or network access. -->

# Visualize

Use `visualize` when seeing or manipulating something materially improves the
answer: dynamics, spatial relationships, adjustable inputs, comparisons, or a
small calculator. Do not use it for a normal Markdown table, a static Mermaid
diagram, or a request to change project files; those use the normal tools.

`visualize` is deferred. If it is not visible, call `tool_search` for
`visualize` first.

## Contract

Call `visualize({ html, title, mode?, height? })`:

- `html` is a **complete** document: `<!doctype html>`, `<html>`, inline
  `<style>` and `<script>`. No external scripts, stylesheets, fonts, images, or
  network calls — the page runs under
  `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'`
  and silently drops anything else.
- Data must be embedded in the document. Inline images only as `data:` URLs.
- `title` is short and user-facing. `mode: 'wide'` is for side-by-side panels
  or full app mockups; the default `inline` suits one chart or diagram.
- `height` is the suggested frame height (240–10000 px); pick 360–720 for a
  single chart, more for a long page.
- The page cannot call tools, read the workspace, or message the host. Any
  follow-up action is a normal link the user can open.
- Keep it under 2 MB. Aggregate or downsample large datasets.

The tool returns a URL and a card renders it in a sandboxed iframe. Do not paste
the HTML into the reply and do not claim the page can access files or the
network.

## Authoring

1. Decide the one interaction or comparison the visual should support.
2. Build the smallest layout that shows it; avoid decorative panels and
   redundant legends.
3. Use theme-neutral colors (`currentColor`, CSS variables with fallbacks) so
   the page works in light and dark hosts.
4. Put a concise explanation outside the visual, not inside it.
5. Check that every element the script queries exists and that the primary
   interaction changes the visual. Scripts run after the DOM is parsed.

## When a file is the right answer

If the user asks for a website, app page, component, or a change to project
files, build that in the workspace with the normal tools. `visualize` is only
for an in-conversation artifact.
