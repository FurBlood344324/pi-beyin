---
name: source-distillation
description: Capture an external source (web doc, arXiv/paper, local PDF archive, bookmark export) and distill it into a source-linked concept note in the vault. Use for requests like "dokümanları damıt", "makale arşivini işle", "bookmarklarımı damıt", "distill these docs", "process the paper archive". The quality wall and the secret/privacy gate are mandatory. Raw source paths come from the project profile.
---

# Source distillation (external source → vault)

Language: write in the user's language and reuse the target file's headings — see `../_shared/project-profile.md` (Language).

Distill transferable knowledge from an **external source** the user gives (web, paper, local PDF, bookmark) into
the vault. Not copying raw text: **source ≠ derived**. The raw source stays outside the vault; the vault holds only
the distilled, source-linked note. Related: `../brain/SKILL.md`.

## Paths (from the project profile)
`<project root>/.pi/beyin-project.json` → `sources` (optional; fallback `sources/` under the project root),
`secret_dirs`, `root`. Raw captures go to `<sources>/<campaign>/`. Schema: `../_shared/project-profile.md`.
Nothing under `secret_dirs` is read or copied.

## Quality wall (gate) — no note is written unless all four hold
1. **Source exists:** URL plus access date, or a local file path (traceable).
2. **Transferable:** not a momentary measurement tied to a project or date; reusable in another context.
   (A log count, a run name, "on that day we did this" is not distilled.)
3. **No duplicate:** doesn't collide with `knowledge/index.md` and existing notes. If it does, **update the existing
   note** instead of writing a new one (single ownership).
4. **Verifiable:** the claim passed `beyin_jev_review`/`beyin_jev_answer` (*supported*) or is proven with an exact
   quote. `insufficient`/`uncertain` is a **scope difference** — still write the note, but mark it explicitly.

**Two gates** (a batch doesn't finish before both):
- **Secret & privacy gate:** tokens/passwords, personal-sensitive documents (transcripts, IDs, account statements,
  criminal records, contracts) and company-private data **are not distilled**; on detection the item is skipped and
  the user is told in one line. Anything under the profile's `secret_dirs` is out of scope by default.
- **Quality trend:** if note quality or the link count drops by the end of a batch, shrink the batch size.

## Flow
1. **Scope contract:** source (URL list / site root / directory) + target topic + **out of scope**, all clear.
2. **Capture (raw):** written under `<sources>/<campaign>/`. Never into the vault.
3. **Distill:** one concept note per topic → short description · mechanism/key points · limits · source
   (URL + date). Detail stays in the raw capture.
4. **Quality wall + two gates** (above).
5. **Link & record:** a `knowledge/index.md` line + real graph links (`[[...]]`) + `beyin.py sync` +
   `beyin.py receipt` (refs = the new/updated notes).
6. **Show the batch to the user at the end; continue only after approval** (keep the quality from eroding).

## Tool mapping
| Source | Tool |
|---|---|
| Single web page | `firecrawl scrape "<url>" -o ...` |
| Docs section | `firecrawl map --search "<topic>"` → `firecrawl crawl` |
| Topic without a URL | `firecrawl search "<topic>" --scrape` |
| Local PDF/DOCX | `pdftotext` (free, local) or `firecrawl parse` |
| Bookmark export | `Bookmarks` (JSON) / HTML export → URL list → scrape |

## Sub-agent (when to delegate)
- **Wide capture** (≥~10 URLs, a docs tree, a bookmark export) → a `collect`-style sub-agent: raw content never
  enters the main context, it returns **paths + an index of ≤15 lines**. Don't delegate small work; it costs more
  than the latency it saves.
- For long scans use a writing-capable collect sub-agent, not `Explore` — write access is required.
- **Distillation, the quality wall and the `[[...]]` links stay with you.** The decision to write a note is not
  delegated.

## Secrets & privacy
- The raw source lives under `<sources>/`, from the project profile; it is never copied into the vault.
- Company-private data and personal-sensitive documents are out of scope; when flagged, they are skipped.

## Limits
- No bulk dump: only genuinely transferable concepts. A course archive is a **source**, not text to be copied.
- Heavy bulk crawl only with user approval (credits + time); by default start with a small sample, look at the
  quality, then widen.
- Source freshness is checked; the note states the date.
