# Obsidian Markdown Portability: Honest Research

**Research date:** 2026-03-27
**Question:** Are Obsidian markdown files truly portable and readable in other editors, or does Obsidian use enough custom/non-standard markdown syntax that the files are NOT easily readable outside Obsidian?

---

## Executive Summary

The honest answer is: **it depends heavily on which Obsidian features you use.** Vanilla markdown notes with standard formatting are fully portable. But the moment you use wikilinks, embeds, callouts, block references, Dataview queries, Templater code, or other plugin-specific syntax, your files accumulate non-standard syntax that ranges from "cosmetic noise" to "completely non-functional" in other editors. Obsidian's marketing claim of "it's just markdown" is technically true at the file format level but increasingly misleading in practice as users adopt Obsidian-specific features.

---

## 1. Non-Standard Markdown Syntax Obsidian Uses

Obsidian uses what it calls **"Obsidian Flavored Markdown"** -- a combination of CommonMark, GitHub Flavored Markdown (GFM), LaTeX, and several proprietary extensions. The official documentation states it strives for "maximum capability without breaking any existing formats."

Here is a comprehensive list of Obsidian-specific syntax that is NOT part of any markdown standard:

### Fully Non-Portable (Obsidian-only)

| Syntax | Example | What happens outside Obsidian |
|--------|---------|-------------------------------|
| **Wikilinks** | `[[My Note]]` | Renders as literal `[[My Note]]` text. No link. |
| **Wikilink with alias** | `[[My Note\|Display Text]]` | Literal brackets and pipe visible. |
| **Embeds** | `![[Another Note]]` | Literal text `![[Another Note]]`, no embedded content. |
| **Image embeds with sizing** | `![[image.png\|300]]` | Broken or literal text. |
| **Block references** | `[[Note#^abc123]]` | Literal text, no navigation. |
| **Block IDs** | `Some text ^abc123` | The `^abc123` appears as visible text at end of paragraph. |
| **Highlights** | `==highlighted text==` | Literal `==` characters shown around text. |
| **Comments** | `%%hidden text%%` | Literal `%%` and text visible (not hidden). |
| **Image resize via pipe** | `![alt\|200](url)` | Image may display but sizing is ignored; pipe may break rendering. |
| **Obsidian-specific callout types** | `> [!BUG]`, `> [!QUESTION]`, `> [!EXAMPLE]` | Rendered as plain blockquote with visible `[!TYPE]` text. |
| **Foldable callouts** | `> [!NOTE]+` or `> [!NOTE]-` | Fold behavior lost; rendered as plain blockquote. |

### Partially Portable

| Syntax | Example | Portability notes |
|--------|---------|-------------------|
| **5 standard callout types** | `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]` | These 5 types render on GitHub (as "alerts"). Do NOT render in VS Code, Typora, iA Writer, or most other editors. |
| **LaTeX math** | `$E=mc^2$` and `$$...$$` | Supported by GitHub, Typora, and many editors. Generally portable. |
| **Mermaid diagrams** | ` ```mermaid ` | Supported by GitHub and several editors. Generally portable. |
| **Footnotes** | `[^1]` | Part of PHP Markdown Extra and supported by many editors, but not part of strict CommonMark. |
| **Strikethrough** | `~~text~~` | Part of GFM. Widely supported. |
| **Task lists** | `- [ ] task` | Part of GFM. Widely supported. |

---

## 2. How These Render in Specific Other Editors

### VS Code
- **Wikilinks:** Rendered as literal `[[text]]`. No link navigation. Some extensions (e.g., Foam, Dendron) can add wikilink support.
- **Embeds:** Literal text. No embedding behavior.
- **Callouts:** Rendered as plain blockquotes with visible `[!TYPE]` markers.
- **Highlights:** Literal `==text==` shown.
- **Block references:** Literal text.
- **LaTeX/Mermaid:** Supported with built-in markdown preview or extensions.
- **YAML frontmatter:** Recognized and not rendered in preview.

### Typora
- **Wikilinks:** Not natively supported. The `[[` brackets are shown literally. Files are not linked to each other.
- **YAML frontmatter:** Supported (Typora explicitly supports Jekyll-style frontmatter).
- **LaTeX math:** Fully supported.
- **Mermaid:** Fully supported.
- **Highlights:** Not supported by default (literal `==` shown).
- **Callouts:** Not supported.

### iA Writer
- **Wikilinks:** iA Writer has added wikilink support (`[[links]]` work). This is a notable exception.
- **Most other Obsidian-specific syntax:** Not supported.
- **YAML frontmatter:** Supported.

### GitHub (viewing .md files in a repo)
- **Wikilinks:** Rendered as literal `[[text]]`. No link.
- **Embeds:** Literal text.
- **Callouts (5 standard types):** Rendered as GitHub Alerts (NOTE, TIP, IMPORTANT, WARNING, CAUTION only).
- **Callouts (Obsidian-specific types):** Plain blockquote.
- **Highlights:** Not supported (literal `==` shown).
- **LaTeX math:** Supported.
- **Mermaid:** Supported.
- **YAML frontmatter:** Rendered as a formatted table at top of file.
- **Block references/IDs:** `^blockid` text visible as literal characters.

### Summary Table

| Feature | VS Code | Typora | iA Writer | GitHub |
|---------|---------|--------|-----------|--------|
| Wikilinks | No* | No | **Yes** | No |
| Embeds `![[]]` | No | No | No | No |
| Highlights `==` | No | No | No | No |
| Comments `%%` | No | No | No | No |
| Block refs `^id` | No | No | No | No |
| Callouts (5 std) | No | No | No | **Yes** |
| Callouts (custom) | No | No | No | No |
| LaTeX math | Yes | Yes | No | Yes |
| Mermaid | Yes | Yes | No | Yes |
| YAML frontmatter | Yes | Yes | Yes | Yes |
| Footnotes | Yes | Yes | Yes | Yes |

*VS Code can support wikilinks via Foam/Dendron extensions.

---

## 3. User Experiences Migrating Away from Obsidian

### "Goodbye Obsidian" (bit-101.com, 2024)
A detailed migration account identified these specific problems:
- **Wikilinks required manual fixing.** Media-wiki type links were "useless in other markdown systems, like GitHub" and the author "had to go through a lot of manual link fixing."
- **Plugin-dependent syntax was dead weight.** Plugins required "special non-markdown syntax" including query languages that became "completely useless outside of Obsidian."
- **Front matter was messy.** The author noted that Obsidian relies heavily on front matter, which is "not standard markdown" (though widely supported -- see section 5).
- **The realization:** "You need such a tool points up the fact that once you start buying into Obsidian, you start to become locked in."

### Obsidian Forum Discussion: "Are we moving away from portability?"
Community members raised these concerns:
- **Plugin abandonment risk:** "A plugin is often created by a single developer that could abandon it at any moment. Then a new version of Obsidian comes out that doesn't support that plugin anymore and boom, hundreds of notes suddenly become partially or totally unreadable."
- **Export challenges:** "Maintaining the critical links between note files, images, and other embedded files is complicated without a proper export function." One user required Bear as an intermediary converter, then manually reorganized folders.
- **Pragmatic advice from the community:** Keep frontmatter minimal, avoid complex plugins, use only markdown-compatible syntax, write custom conversion scripts if needed.

### Hacker News Commentary
- A user argued it is problematic to call Obsidian's format simply "Markdown" without qualification, since "all the little tiny differences between all the different implementations can act as annoying papercuts."
- Defenders noted that markdown "has never been standardized" and even GitHub markets its own variant simply as "Markdown," making Obsidian's approach consistent with industry practice.
- One balanced view: "the data portability -- while it provides some nice enhancements, if Obsidian went evil tomorrow... I'd get 90% of the value." The 90% figure is telling -- it implicitly acknowledges a 10% loss.

---

## 4. Plugin-Specific Syntax: Dataview, Templater, Canvas

### Dataview Queries
This is the **single biggest portability concern** for power users.

- Dataview queries are stored in notes as fenced code blocks with the `dataview` or `dataviewjs` language identifier:
  ```
  ```dataview
  TABLE file.ctime AS "Created"
  FROM #project
  SORT file.ctime DESC
  ```
  ```
- **The critical problem:** Query results are generated on the fly and never actually exist in the markdown files. Outside Obsidian, you see the raw query code -- not the results. The dynamic data simply disappears.
- Concrete consequences:
  - Query results do not appear on Obsidian Publish sites (which cannot execute queries)
  - Results are invisible to the Graph View
  - AI tools and search cannot see query output
  - Switching platforms means losing all dynamically generated content
- **Mitigation:** The Dataview Serializer plugin can convert dynamic queries into actual static markdown, "turning your dynamic queries into real Markdown: visible in the Graph, working on Publish, and portable to any tool." This is a community-built workaround, not a default behavior.

### Templater Code
- Templater uses `<% ... %>` syntax (based on the Eta templating engine) embedded in markdown files.
- Example: `<% tp.date.now("YYYY-MM-DD") %>`
- **Outside Obsidian:** These template directives appear as literal text. The `<% ... %>` tags are visible and unprocessed.
- **Important distinction:** Templater code is typically in template files, not in final notes. When a template is applied, Templater processes the directives and inserts the results as plain text. So the resulting notes are usually clean markdown. However, if you use Templater's dynamic commands or have unprocessed templates, those files contain non-portable syntax.

### Canvas Files (.canvas)
- Obsidian Canvas uses the `.canvas` extension with JSON content.
- Obsidian released this as the open **JSON Canvas** specification (jsoncanvas.org) under MIT license.
- **Reality check on adoption:** Despite being open-source, Hacker News users noted that "Obsidian remains the only significant implementation." Critics said the spec "is quite short on detail" and questioned why Obsidian released v1.0 "without consulting other major players like Excalidraw, Draw.io, or Figma."
- Canvas files are readable JSON but practically usable only in Obsidian. Other canvas tools (Excalidraw, Miro, FigJam) use completely different formats.

### Other Plugin Syntax Examples
- **Tasks plugin:** Uses non-standard emoji-based metadata inline: `- [ ] task [due:: 2024-01-01] [priority:: high]`
- **Kanban plugin:** Stores board data as markdown lists with specific formatting conventions.
- **Excalidraw plugin:** Stores drawing data in `.excalidraw.md` files with embedded JSON.
- All of these create files that are technically readable as text but functionally meaningless outside their respective plugins.

---

## 5. YAML Frontmatter: Is It Standard?

**Short answer: YAML frontmatter is NOT part of any official markdown specification (CommonMark or the original Markdown), but it is a widely adopted de facto standard.**

Details:
- YAML frontmatter (delimited by `---`) was popularized by Jekyll (the static site generator) and has been adopted by Hugo, Gatsby, Eleventy, and many other tools.
- **Editor support is excellent:**
  - Typora: Explicitly supports Jekyll-style YAML frontmatter
  - VS Code: Recognizes and formats frontmatter in markdown files
  - iA Writer: Supports frontmatter
  - GitHub: Renders frontmatter as a formatted table at the top of file previews
- **Verdict:** While not technically part of the markdown spec, YAML frontmatter is so widely supported that it is effectively portable. This is one area where Obsidian's usage aligns with broad ecosystem conventions.
- **Caveat:** Obsidian-specific frontmatter keys (like `cssclass`, `aliases`, `publish`) are meaningless to other tools but do not break anything -- they are simply ignored.

---

## 6. Community Perspective and Known Portability Issues

### The Spectrum of Lock-In
The Obsidian community generally acknowledges a spectrum:

1. **Minimal Obsidian usage (fully portable):** Plain markdown, standard links `[text](url)`, standard formatting. Files work everywhere.
2. **Moderate usage (mostly portable with noise):** Wikilinks, highlights, comments. Files are readable but contain visual artifacts (`[[`, `==`, `%%`) in other editors.
3. **Heavy usage (significant portability issues):** Dataview queries, Templater code, block references, plugin-specific syntax. Files contain substantial non-functional content outside Obsidian.
4. **Power-user usage (effectively locked in):** Canvas files, Excalidraw drawings, complex Dataview/DataviewJS queries, tasks plugin metadata, heavily interlinked vaults with wikilinks. Migration requires substantial conversion tooling.

### What the Community Recommends
- **Use standard markdown links** instead of wikilinks if portability matters (Obsidian has a setting to disable wikilinks: Settings > Files & Links > Use [[Wikilinks]] toggle OFF).
- **Avoid embedding Dataview queries** in important notes, or use Dataview Serializer to materialize results.
- **Keep plugin dependencies minimal** for core notes.
- **Maintain awareness** that each Obsidian-specific feature you adopt increases switching costs.
- **Defenders argue:** Some lock-in is unavoidable with any sophisticated tool, and the tradeoff of functionality vs. portability is worth it.

### The Uncomfortable Truth
One forum user summarized it well: when Obsidian launched, "one of the original differentiators was the lack of lock-in compared to Notion, Roam, or other tools -- it's just markdown and you can export it. However, when you start to use extra features, you start moving away from pure markdown, which immediately makes your data less portable."

---

## 7. Quantifying the Portability

Here is an honest assessment of what percentage of a typical note's content survives migration, depending on usage patterns:

| Usage Pattern | Content Surviving Migration | Effort to Clean Up |
|---------------|---------------------------|-------------------|
| Plain markdown only | ~100% | None |
| Wikilinks + standard formatting | ~90-95% (links break, text remains) | Find-and-replace to convert `[[links]]` to standard links |
| Wikilinks + highlights + callouts | ~85-90% (visual noise from non-standard syntax) | Moderate regex work |
| Dataview + Templater + block refs | ~70-80% (dynamic content lost, raw code visible) | Significant manual work or custom scripts |
| Full plugin ecosystem | ~50-70% (substantial non-functional syntax) | Major conversion project |

---

## 8. Conclusions

1. **Obsidian files are plain text markdown.** This is genuinely true and genuinely valuable. You will never face a proprietary binary format. Any text editor can open any `.md` file from an Obsidian vault.

2. **"Readable" and "functional" are different things.** The files are always readable as text, but Obsidian-specific syntax shows up as visual noise or dead markup in other editors. Wikilinks become `[[literal brackets]]`. Block IDs become visible `^randomstring` at the end of paragraphs. Highlights become `==surrounded by equals signs==`.

3. **The more Obsidian features you use, the less portable your files become.** This is a sliding scale, not a binary. Basic notes are fully portable. Power-user notes are not.

4. **Dataview is the biggest lock-in vector.** Because query results never exist in the files, migrating away means losing all dynamically generated content unless you serialize it first.

5. **Wikilinks are the most common portability issue.** They are Obsidian's default link format, most users adopt them, and they do not work in most other editors. However, they can be converted to standard links with tooling.

6. **YAML frontmatter is fine.** It is widely supported across the ecosystem.

7. **Canvas files are effectively Obsidian-only** despite the open JSON Canvas spec, due to lack of adoption by other tools.

8. **Obsidian is still far more portable than Notion, Roam, or Evernote.** The portability concerns are real but relative. Compared to proprietary databases and cloud-only formats, local markdown files -- even with non-standard extensions -- are a dramatically better starting point for migration.

---

## Sources

- [Obsidian Flavored Markdown - Official Docs](https://help.obsidian.md/obsidian-flavored-markdown)
- [Obsidian Markdown: Syntax Guide and Unique Features - MDtoLink](https://mdtolink.com/blog/markdown-in-obsidian/)
- [Obsidian Markdown Reference - Markdown Guide](https://www.markdownguide.org/tools/obsidian/)
- [Are we moving away from portability? - Obsidian Forum](https://forum.obsidian.md/t/are-we-moving-away-from-portability-how-much-is-obsidian-locking-our-notes-in/19329?page=4)
- [Goodbye Obsidian - bit-101.com](https://bit-101.com/blog/posts/2024-09-08/goodbye-obsidian/)
- [What markdown standard is Obsidian using? - Obsidian Forum](https://forum.obsidian.md/t/what-markdown-standard-is-obsidian-using/85793)
- [Hacker News: Obsidian Markdown Portability Discussion](https://news.ycombinator.com/item?id=28896624)
- [Hacker News: JSON Canvas Discussion](https://news.ycombinator.com/item?id=39670922)
- [Dataview Serializer 2.0 - dsebastien.net](https://www.dsebastien.net/dataview-serializer-2-0-powerful-queries-without-sacrificing-data-portability/)
- [Making heading and block reference more compatible - Obsidian Forum](https://forum.obsidian.md/t/making-heading-and-block-reference-more-compatible-with-other-editors/7810)
- [JSON Canvas - Official Specification](https://jsoncanvas.org/)
- [JSON Canvas - GitHub Repository](https://github.com/obsidianmd/jsoncanvas)
- [Templater Plugin - GitHub](https://github.com/SilentVoid13/Templater)
- [YAML Front Matter - Typora Support](https://support.typora.io/YAML/)
- [Obsidian vs Notion vs Markdown Files: 2026 Comparison](https://dasroot.net/posts/2026/03/obsidian-vs-notion-vs-markdown-files-2026-pkm-comparison/)
- [8 Best Obsidian Alternatives in 2026 - Journal It](https://home.journalit.app/alternatives/obsidian)
