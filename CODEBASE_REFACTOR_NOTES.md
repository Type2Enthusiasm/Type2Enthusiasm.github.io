# Codebase Refactor Notes

Branch: `review/codebase-slop-audit-2026-04-30`  
Base reviewed: `b324266` (`origin/main`, `polish title`)  
Goal: improve resilience, understandability, and simplicity without regressing the website’s current visual feel or puzzle behavior.

## Current shape

This is a static personal website with five HTML pages, one shared stylesheet, and two JavaScript files:

- `index.html` — primary homepage and the only page currently wired to the puzzle.
- `research.html` — research narrative and publications.
- `contact.html` — contact CTA.
- `MPCNC.html` — project page, currently discoverable only by direct/internal links.
- `consulting.html` — consulting page, currently not in the main nav.
- `style.css` — shared site styling plus all puzzle/reward styling.
- `puzzle.js` — bespoke interactive homepage puzzle: text measurement, glyph scene construction, physics, drag input, reveal sequence, reward rendering.
- `pretext.js` — vendored/generated text segmentation and line-layout helper used by `puzzle.js`.

The site is already small and visually coherent. The slop is not “too many files”; the slop is mostly that a few important concepts are implicit and several unrelated responsibilities are packed behind broad interfaces.

## Cleanup pass 1 progress

Branch: `cleanup/website-slop-pass-1`

Completed in the first low-risk cleanup pass:

- Added `scripts/check-site.mjs` as a no-dependency validation harness.
- Aligned homepage copy with the current homepage-only puzzle contract.
- Removed unused puzzle canvas markup/styles.
- Removed production keyboard shortcuts for forced puzzle reveal/unravel.
- Removed `skills-lock.json` from the website repo and ignored future lockfiles unless explicitly documented.

## Preserve these qualities

- The site should remain static and easy to deploy on GitHub Pages.
- The restrained oxblood/cream palette and simple page structure are strengths.
- The puzzle is a differentiating piece of personality; refactors should protect it, not flatten it.
- Avoid introducing a build system unless it clearly buys resilience or locality.
- Avoid over-abstracting the HTML. Plain HTML is still the simplest interface for a site this size.

## Deepening opportunities

### 1. Split the puzzle module into named internal modules

**Files**

- `puzzle.js`
- future candidates: `puzzle/state.js`, `puzzle/scene.js`, `puzzle/physics.js`, `puzzle/reveal.js`, `puzzle/reward.js`, `puzzle/dom.js`

**Problem**

`puzzle.js` is a 2,400-line module with a large implicit interface: DOM assumptions, physics constants, scene-building rules, drag state, reveal state, reward animation, and hidden debug shortcuts all share one mutable `state` object. The current implementation works, but understanding one behavior requires scanning far away functions and knowing which state fields are safe to mutate.

The current module is deep from the page’s perspective (`<script type="module" src="puzzle.js">` is a small external interface), but shallow internally: internal concepts do not have seams. The deletion test says the implementation is carrying real complexity, but the locality is poor because unrelated changes happen in the same file and same state bag.

**Solution**

Keep `puzzle.js` as the page-facing entry module, but create internal modules around actual domain seams:

- Scene construction: DOM text runs -> measured glyph scenes.
- Physics engine: scenes + bars + drag input -> next positions.
- Reveal flow: active puzzle -> solved -> sweeping -> reward.
- Reward rendering: quote data + animation policy -> reward UI.
- DOM adapter: selectors, data attributes, CSS custom properties, event binding.

Do not expose many tiny helpers. Each new module should have a small interface and own the invariants behind it.

**Benefits**

- **Locality:** physics tuning stops being mixed with reward timing and DOM setup.
- **Leverage:** tests can exercise the physics/reveal interfaces without a full browser page.
- **Resilience:** changing the reward card or quote list is less likely to break drag physics.
- **Understandability:** future readers can navigate by concept rather than line number.

**Regression risk**

High if done in one large edit. Refactor in slices, with screenshot/interaction checks after each slice.

---

### 2. Give `pretext.js` a documented adapter and provenance

**Files**

- `pretext.js`
- `puzzle.js`
- `CONTEXT.md`
- possible future file: `text-layout-adapter.js`

**Problem**

`pretext.js` is a vendored/generated 2,700-line module. Its first comment points to a local download path, but the repo does not record its source version, build command, license, or why it is vendored instead of loaded as a package. `puzzle.js` imports only `prepareWithSegments` and `layoutWithLines`, but it still depends on subtle behavior: canvas text measurement, segmentation, line ranges, disabled kerning in `main`, and the shape of returned segment metadata.

This is load-bearing domain knowledge. Without a narrow adapter, the interface between puzzle code and vendored text layout is broader than it looks.

**Solution**

Add a small text-layout adapter module that exposes exactly what the puzzle needs, for example:

- input: text, font, line width, line height, letter spacing;
- output: visual lines with grapheme widths and segment offsets.

Document `pretext.js` provenance in `CONTEXT.md` and, if possible, add the upstream URL/version/build command. Treat `pretext.js` as vendored code: avoid editing it directly except by re-vendoring from source.

**Benefits**

- **Locality:** pretext-specific assumptions live in one adapter instead of inside scene construction.
- **Leverage:** tests can validate the adapter against known wrapping cases.
- **Resilience:** a future pretext upgrade only needs to satisfy the adapter interface.
- **Simplicity:** callers do not need to learn pretext internals.

**Regression risk**

Medium. Text measurement bugs are subtle and visible only through the puzzle alignment.

---

### 3. Extract repeated page chrome carefully, but do not overbuild

**Files**

- `index.html`
- `research.html`
- `contact.html`
- `MPCNC.html`
- `consulting.html`

**Problem**

Head metadata, font links, feather icon initialization, header nav, social links, and footer are duplicated across pages. The duplication is tolerable at five pages, but it already caused drift before: page titles had to be polished across multiple files, hidden pages have no active state, and future nav/social edits must be repeated manually.

The current repeated HTML is shallow in a good way: there is no build interface to learn. But the chrome itself is a real module because deleting it would spread the same knowledge across every page.

**Solution**

Choose the smallest seam that improves locality:

1. Short-term: add a `docs/page-chrome-checklist.md` or comments around shared blocks, and use a script/check to detect drift.
2. Medium-term: add a tiny static generation script if page count grows or chrome changes often.

Do not add a framework. If a generator is introduced, it should be a very small adapter that renders plain HTML and keeps the GitHub Pages output simple.

**Benefits**

- **Locality:** nav/social/title policy changes happen once.
- **Leverage:** one page-chrome interface protects all pages.
- **Resilience:** reduces copy/paste drift without making the site feel like an app.

**Regression risk**

Medium if a generator rewrites all HTML at once. Low if first step is a drift-check script.

---

### 4. Separate base site CSS from puzzle CSS

**Files**

- `style.css`
- future candidates: `styles/base.css`, `styles/puzzle.css`, `styles/contact.css` or sectioned equivalents

**Problem**

`style.css` mixes global typography, layout, header/social styling, contact buttons, footer rules, puzzle bars, glyph overlays, reward cards, and motion preferences. The file is still readable because it is sectioned, but the puzzle rules are now large enough to be their own concept.

The current stylesheet has one page-facing interface (`style.css`), but internally the seam between normal site styling and puzzle styling is implicit.

**Solution**

Either:

- keep one physical `style.css` but formalize stronger sections and naming conventions; or
- split into `base.css` and `puzzle.css`, loaded in that order on pages that need the puzzle.

Given the site’s simplicity, I would start by moving puzzle-specific rules to a contiguous bottom section with a clear “owned by puzzle module” note. Only split files if the puzzle is added to multiple pages or CSS changes become noisy.

**Benefits**

- **Locality:** puzzle visual changes do not require scanning base typography/layout.
- **Leverage:** future puzzle pages can opt into the puzzle styling deliberately.
- **Resilience:** reduces accidental global side effects from puzzle selectors.

**Regression risk**

Low to medium. CSS order matters; visual screenshot checks are required.

---

### 5. Make the puzzle/page contract explicit

**Files**

- `index.html`
- `puzzle.js`
- `style.css`
- `CONTEXT.md`

**Problem**

The puzzle depends on a non-obvious contract:

- `main[data-puzzle-stage]`
- `[data-puzzle-walls]`
- `[data-puzzle-run]`
- `[data-puzzle-trigger]`
- `[data-puzzle-separator]`
- `[data-puzzle-floor]`
- optional social-link keys such as `data-puzzle-social-run="linkedin"`
- CSS custom properties on the header line
- `font-feature-settings: "kern" 0` on `main`

This interface is powerful but undocumented. It also conflicts with the homepage copy saying there is a puzzle “on each page” while only `index.html` is currently wired.

**Solution**

Add a page contract section in `CONTEXT.md` and/or a short comment block in `puzzle.js`. Decide whether the puzzle is homepage-only or truly every-page. Then align copy and markup accordingly.

**Benefits**

- **Locality:** page authors know what attributes are load-bearing.
- **Leverage:** puzzle can move to another page without rediscovering the interface by trial and error.
- **Resilience:** future copy edits are less likely to remove a required data attribute.

**Regression risk**

Low. This is mostly documentation and copy alignment.

---

### 6. Remove or gate development-only puzzle shortcuts

**Files**

- `puzzle.js`

**Problem**

`bindEvents` includes keyboard shortcuts while the puzzle is active:

- `f` starts unraveling all scenes.
- `~` force-reveals the puzzle.

These are useful while tuning, but production users can trigger them accidentally or discover a non-obvious bypass. The interface is invisible, so maintainers may forget it exists.

**Solution**

Either remove the shortcuts before production polish or gate them behind an explicit debug flag, e.g. query param/local constant. If kept, document them as debug-only in `CONTEXT.md`.

**Benefits**

- **Resilience:** fewer accidental state transitions.
- **Locality:** debug behavior becomes explicit rather than hidden inside general event binding.
- **Simplicity:** production puzzle behavior matches visible UI.

**Regression risk**

Low.

---

### 7. Delete or justify unused puzzle canvas markup/styles

**Files**

- `index.html`
- `style.css`
- `puzzle.js`

**Problem**

`index.html` includes `<canvas class="puzzle-overlay" data-puzzle-canvas hidden>`, and `style.css` defines `.puzzle-overlay`, but `puzzle.js` no longer queries or uses `data-puzzle-canvas`. The current active puzzle uses the glyph layer instead.

By the deletion test, this looks like stale implementation residue: deleting it appears to remove complexity rather than move it elsewhere.

**Solution**

Confirm no planned canvas path remains. If none, remove the canvas element and `.puzzle-overlay` styles. If the canvas is reserved for a future effect, document that in `CONTEXT.md` with the reason.

**Benefits**

- **Simplicity:** removes dead interface surface.
- **Understandability:** future readers do not chase a canvas path that is not active.
- **Resilience:** fewer DOM nodes/styles to maintain.

**Regression risk**

Low if verified with puzzle activation afterward.

---

### 8. Add a tiny validation harness for the static site

**Files**

- future candidate: `scripts/check-site.mjs`
- future candidate: `package.json` only if needed

**Problem**

There is no repeatable local check for the things that matter:

- all local links resolve;
- each visible page has a reasonable title and one current nav state where appropriate;
- `puzzle.js` and `pretext.js` parse;
- homepage puzzle boots and activates without console errors;
- mobile/desktop header does not overlap.

Right now these checks live in whoever reviews the site manually. That reduces resilience.

**Solution**

Add a small no-dependency Node script or documented command sequence that checks local links and JS syntax. Optionally add a browser smoke test later if a project dependency is acceptable.

**Benefits**

- **Leverage:** one command protects many pages.
- **Locality:** expected site invariants are encoded close to the repo.
- **Resilience:** refactors can prove they did not regress obvious site quality.

**Regression risk**

Low. A no-dependency script would not change runtime behavior.

---

### 9. Decide what to do with hidden/semi-hidden pages

**Files**

- `MPCNC.html`
- `consulting.html`
- nav in all HTML pages

**Problem**

`MPCNC.html` and `consulting.html` are present and styled but not in the main nav. They also have no active nav state. This may be intentional, but the repo does not say whether they are public pages, legacy pages, hidden portfolio material, or drafts.

This is domain slop more than code slop: future cleanup could delete, expose, or alter these pages without knowing their role.

**Solution**

Record page roles in `CONTEXT.md`. If a page is intentionally hidden, say so. If it is public, add a navigation path or link from a relevant page.

**Benefits**

- **Locality:** page lifecycle decisions become explicit.
- **Resilience:** future refactors do not accidentally remove useful material.
- **Simplicity:** nav remains intentional rather than accidental.

**Regression risk**

Low.

---

### 10. Keep `skills-lock.json` out of the website unless it is intentionally part of repo workflow

**Files**

- `skills-lock.json`
- `.gitignore`

**Problem**

`skills-lock.json` records agent skill metadata. It is not used by the static website at runtime. It may be useful for this repo’s agent workflow, but that decision is not documented. If it is accidental, it is operational slop in the public site repo.

**Solution**

Decide whether this file belongs to the repo:

- If yes, document its purpose in `CONTEXT.md`.
- If no, remove it and add it to `.gitignore`.

**Benefits**

- **Simplicity:** public repo contains fewer non-site artifacts.
- **Locality:** agent workflow files are either documented or absent.
- **Resilience:** avoids future confusion about build/runtime dependencies.

**Regression risk**

Low.

## Recommended order of work

1. Documentation-only pass: add/keep `CONTEXT.md`, decide hidden-page roles, document puzzle/page contract, document `pretext.js` provenance.
2. Low-risk cleanup: remove unused puzzle canvas if confirmed; gate debug shortcuts; align homepage “puzzle on each page” copy with reality.
3. Add no-dependency validation script for local links, titles, JS syntax, and basic puzzle boot.
4. Split `puzzle.js` internally one seam at a time, starting with reward rendering or text-layout adapter because those have clearer interfaces than full physics.
5. Only after tests/smoke checks exist, consider larger physics/reveal module extraction.

## Review checks already run during this audit

- `git pull --ff-only` from `origin/main` before creating the branch.
- Enumerated all non-git/non-artifact files.
- Counted code size and located major functions/selectors.
- Confirmed local static pages return `200` from a simple local server in the previous review pass.
- Ran `node --check puzzle.js` and `node --check pretext.js` in the previous review pass; both parsed.
- Used headless Chromium in the previous review pass to confirm homepage puzzle activation changed stage to `active` with no console/runtime events.

## Definition of done for future refactors

A cleanup PR should not be considered done unless it can show:

- pages still render from a local static server;
- all local links still resolve;
- homepage fresh load has no visible reset/reward UI;
- puzzle activates and exits;
- research/contact pages keep correct nav state;
- mobile and desktop header layouts remain non-overlapping;
- reduced-motion behavior is preserved for puzzle/reward animation.
