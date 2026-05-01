# CONTEXT.md

This file captures domain knowledge for the personal website codebase so future refactors preserve the site’s current quality instead of simplifying away load-bearing behavior.

## Product identity

This is Harrison J. Esterly’s personal website. It should feel restrained, credible, personal, and slightly intriguing. The site is not trying to look like a SaaS app or a heavy portfolio system.

The site currently emphasizes:

- chemistry PhD / scientific research;
- ultrafast spectroscopy and biological measurement;
- technology commercialization;
- startups and early-stage investing;
- a small personal puzzle/reward interaction.

## Runtime and deployment

The site is a static GitHub Pages site served from this repository.

Current deployment domain:

- `harrisonesterly.com` from `CNAME`.

There is no required build step for the website at the time of this note. Plain HTML/CSS/JS is part of the site’s simplicity.

## Design language

Current visual direction:

- fixed near-monochrome cream/oxblood palette;
- light typography using Ubuntu for body and Raleway for headings/site title;
- simple centered column with generous whitespace;
- subtle ruled header/footer lines;
- minimal navigation: Home, Research, Contact;
- social icons in the header.

Avoid reintroducing theme toggles or large experimental visual systems unless the design direction changes explicitly.

## Page roles

- `index.html` — main homepage and current puzzle host.
- `research.html` — research narrative and publications.
- `contact.html` — primary contact path.
- `MPCNC.html` — CNC/project page. Currently not in top navigation; treat as intentionally semi-hidden until Harrison decides otherwise.
- `consulting.html` — consulting page. Currently not in top navigation; treat as intentionally semi-hidden until Harrison decides otherwise.

If hidden/semi-hidden page status changes, update this section before or alongside nav changes.

## Puzzle domain model

The puzzle is the main custom interactive feature. It turns selected text runs into draggable glyph chains. Solving the puzzle reveals a quote reward.

Important terms:

- **Puzzle host page** — a page that includes the puzzle DOM contract and loads `puzzle.js`.
- **Puzzle run** — an element with `data-puzzle-run`; its visible text is converted into positioned glyphs.
- **Glyph** — a generated span representing one grapheme or visible text unit in the puzzle layer.
- **Scene** — the glyph chain built from one puzzle run.
- **Walls** — the containing puzzle area, currently `[data-puzzle-walls]`.
- **Ceiling** — the header line that can be loaded/snapped during solve flow, currently `[data-puzzle-ceiling]`.
- **Floor/separator** — the horizontal line above the footer, currently `[data-puzzle-separator]` / `[data-puzzle-floor]`.
- **Reward** — the hidden quote panel revealed after solve, currently `[data-puzzle-reward]`.

Current puzzle/page contract:

- `main[data-puzzle-stage]` stores puzzle stage: `static`, `active`, `revealed`.
- `[data-puzzle-trigger]` starts the puzzle.
- `[data-puzzle-walls]` wraps all puzzle runs.
- `[data-puzzle-run]` marks text whose layout should be converted into glyph scenes.
- `[data-puzzle-drop]` marks a run whose tail begins slightly sagged.
- `[data-puzzle-social-run]` associates a text run with a social icon hint.
- `[data-puzzle-social-icon]` marks a header social icon that can highlight during solve hints.
- `[data-puzzle-glyph-layer]` receives generated glyph spans.
- `[data-puzzle-reset]` exits/reset the puzzle.
- `[data-puzzle-reward]` and `[data-puzzle-quote-stack]` render the solved reward.

Only `index.html` currently satisfies this full contract and loads `puzzle.js`. If the homepage copy says there is a puzzle “on each page,” either wire every page or change the copy.

## Puzzle implementation notes

`puzzle.js` owns several concepts at once:

- bootstrapping and DOM lookup;
- reward quote rendering;
- text measurement and scene construction;
- drag input;
- Verlet-style glyph physics;
- collision with viewport/header/footer bars;
- solve detection;
- reveal/unravel/sweep sequence;
- scroll/layout locking during reveal;
- reward entrance animation.

These are real concepts, not arbitrary helper slices. If the module is split, use these concepts as seams.

The puzzle uses viewport coordinates because the glyph layer is `position: fixed; inset: 0`. This matters for drag math, collision math, scroll locking, and resize behavior.

`main` currently disables kerning with `font-feature-settings: "liga" 1, "kern" 0;`. This is load-bearing for glyph alignment: `puzzle.js` relies on canvas text measurement matching browser layout closely enough when reconstructing text positions.

Reduced-motion support is intentional and should be preserved.

Debug/development shortcuts currently exist while the puzzle is active:

- `f` starts unraveling all scenes.
- `~` force-reveals the puzzle.

Before production polish, decide whether these should remain, be gated, or be removed.

## `pretext.js` domain knowledge

`pretext.js` is a vendored/generated text layout module used by the puzzle. It exports more than the puzzle currently needs. `puzzle.js` imports:

- `prepareWithSegments`
- `layoutWithLines`

The first line of `pretext.js` currently references a local source path:

```js
// ../../../Downloads/pretext-main/dist/bidi.js
```

That means provenance is incomplete in the repo. Before editing or upgrading `pretext.js`, record:

- upstream repository or package name;
- upstream commit/version;
- license;
- build command used to create this file;
- why vendoring is preferred over loading as a dependency.

Treat `pretext.js` as vendored code. Prefer adding a small adapter around it rather than editing generated internals directly.

## Refactor constraints

A good refactor here should:

- keep the site static and GitHub Pages friendly;
- preserve current visual design unless intentionally changing design;
- avoid frameworks unless there is a clear, documented reason;
- protect puzzle behavior with at least manual or scripted smoke checks;
- make load-bearing data attributes and CSS assumptions more explicit;
- improve locality without creating a maze of shallow modules.

## Suggested smoke checks for any cleanup

- Serve repo locally with `python3 -m http.server`.
- Open `index.html`, `research.html`, `contact.html`, `MPCNC.html`, and `consulting.html`.
- Confirm local links resolve.
- Confirm header/social layout does not overlap at desktop and narrow widths.
- Confirm homepage puzzle starts from the `puzzle` link.
- Confirm reset exits the puzzle.
- Confirm the reward reveal still works or document if not manually tested.
- Confirm `node --check puzzle.js` and `node --check pretext.js` pass.
