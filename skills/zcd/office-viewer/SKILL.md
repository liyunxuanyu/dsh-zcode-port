---
name: office-viewer
description: Use when the user wants to open, read, search, review, or point at a Word, Excel, PDF, or text document in the workspace. Covers read_document, search_document, open_document, show_in_viewer, and get_view.
---

<!-- Rewritten for dsh from ZCode viewer skills (Apache-2.0):
     apps/zcode-cli/packages/documents-plugin/skills/docx-viewer,
     spreadsheets-plugin/skills/xlsx-viewer, pdf-plugin/skills/pdf-viewer,
     presentations-plugin/skills/pptx-viewer. The ZCode panel-only
     capture_view/cursor semantics do not exist in dsh, so they are omitted. -->

# Office and document viewer

Read the file with tools, then open it so the user sees the same content. The
viewer is read-only: never claim to have edited a file through it. To create or
change documents, use the `office` routing skill and `office-docx` /
`office-xlsx` / `office-pptx`.

`read_document`, `search_document`, `open_document`, `show_in_viewer`, and
`get_view` start **deferred**. If one is not in the current tool list, load it
first with `tool_search` (query the tool name, for example `read_document`).

## Anchors

Anchors returned by these tools are workspace-relative:

| Format | Anchor | Meaning |
|---|---|---|
| text / Markdown | `#l:12` | 1-based line |
| Word (`.docx`) | `#p:3` | 1-based paragraph |
| Excel (`.xlsx`) | `#s:Sheet1!A5` | sheet and cell |
| PDF | `#page:2` | 1-based page |

## Workflow

1. `read_document(path, max_units?)` returns addressable units prefixed with
   their anchors. Read the relevant material before answering; raise
   `max_units` only when the result says `truncated` and the missing part matters.
2. `search_document(path, query, limit?)` finds literal text and returns the
   matching units with anchors. Use it before reading a large file end to end.
3. `open_document(path)` opens the file in the document viewer and records it as
   the session's current document. Open a file before discussing it.
4. `show_in_viewer(path, anchor)` reopens a file at a location. Only `#l:n`
   (text/Markdown) scrolls the viewer; other formats open at the beginning, so
   use the anchor to tell the user where to look rather than claiming it scrolled.
5. `get_view()` returns the document the user most recently opened in this
   session, with its anchor. Call it when the user says "this", "here", or "the
   selected …" without naming a path.

After creating a document with `create_document` or the `office-*` skills, open
it with `open_document` so the user can review it with you.

## Notes

- Paths must stay inside the session working directory; absolute paths outside
  it are rejected.
- Read-only. Edits go through the `office-*` skills and their libraries.
- Do not paste whole documents into the chat. Quote briefly and point at the
  anchor instead.
- If the visual viewer does not render a format, the read and search tools still
  work; say the preview is unavailable instead of claiming it rendered.
