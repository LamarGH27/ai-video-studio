# Design system

The visual language, and why each decision is the way it is. The tokens live in
`app/globals.css`; this explains them.

---

## 1. The intent

The product should read as a **cinematic production studio**, not as software.
The references are a premium streaming platform, a luxury fashion campaign and
modern editorial layout. The anti-references are equally specific: generic AI
SaaS, enterprise dashboards, neon, heavy gradients, and a landing page built out
of identical rounded cards.

One sentence the whole design serves: _"I want to see what they could create
with my photos."_

---

## 2. Brand

`lib/brand/index.ts` is the only place the product is named. The wordmark,
metadata, footer, emails and page titles all read from it, so renaming the
product — to **Scenelio** or anything else — is editing one file. A preview
deployment can override it with `NEXT_PUBLIC_BRAND_NAME` without a code change;
it is deliberately public, being the least secret thing in the system.

Voice: premium, confident, human. It avoids "AI-powered", "next-generation" and
"cutting-edge" — the customer is buying an experience, not an algorithm, and the
word _AI_ appears about as often as a good restaurant mentions its oven.

---

## 3. Colour

| Token                     | Role                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `ink-990` … `ink-800`     | Grounds. Warm-shifted, never neutral grey — film is never grey      |
| `bone-50` … `bone-500`    | Foreground. Bone rather than white; pure white on near-black glares |
| `brass-200` … `brass-600` | The brand accent, and the **only** saturated colour in routine use  |
| `plum-800/900`            | Held in reserve for depth behind media. Never for text              |

Brass predates this milestone and was already doing the right job, so it was
kept and the range around it widened. The palette stays narrow deliberately: a
room lit by a few good lights reads as expensive; a room lit by twelve reads as
a showroom.

**Status colours were deliberately restrained.** They previously spanned sky,
amber, violet, teal, indigo, orange, emerald and rose — eight saturated hues,
which reads as a bug tracker. Now: brass means _your turn_, bone means _in
hand_, green means _done_, rose means _closed_.

All body text is verified against what the browser actually paints — see §9.

---

## 4. Type

Two families, no more.

- **Instrument Serif** (400, plus italic) for display. One weight, because
  display type is used at 40–90px where one weight is plenty and each extra is
  another file on the critical path.
- **Inter** (variable) for interface text. One file carries the whole weight
  range.

Both are self-hosted by `next/font`: downloaded at build, served from this
origin. No request to a third party on page load, no extra DNS and TLS
handshake, and nothing leaking a visitor's IP to a font CDN.

> The theme tokens are `--font-display` / `--font-sans`; the faces injected by
> `next/font` are `--font-display-face` / `--font-sans-face`. The names must
> differ — a custom property defined as `var(--itself)` is silently invalid, and
> the only symptom is a page that quietly falls back to Times.

Sizes: `text-display-xl` / `-lg` / `-md` and `lede`. Anything else is a one-off
and should be questioned.

---

## 5. Layout and rhythm

`section-y` and `section-y-lg` are the only two vertical rhythms. Using them
rather than ad-hoc padding is most of what makes a long page feel composed.

Section headings use `SectionHeading`, which is **asymmetric by default**: the
display line takes the left two thirds and the supporting paragraph sits low and
right, the way a magazine sets a standfirst. That one decision is most of what
stops a page of sections looking like a stack of centred hero blocks.

**Cards are used only where containment earns it.** Most sections are separated
by a hairline `rule-top` instead. Grids stagger — the first experience tile runs
tall, every third portfolio piece drops half a frame — because a grid whose rows
all start at the same y-position reads as a table of records.

---

## 6. Media

`media-frame` is the single container for anything image- or video-shaped, so
media presentation changes in one place.

`PortfolioFrame` is the stand-in for a film still. No real films exist yet and
stock photography would misrepresent the work, so each piece gets a composed
frame: a graded sky, a key light, a horizon, an anamorphic streak and grain.
**Graded by category, not by hash** — an earlier version hashed the slug and
produced four warm-amber tiles out of eight, because random is not the same as
varied. Colour now carries meaning: travel is daylight, celebration is
candlelight, executive is cold and architectural.

It is built to be deleted: when `portfolio_items.media_url` is populated, swap
the inner layers for a `<video poster>` or `next/image` at the same aspect ratio
and nothing around it changes.

`scrim` exists because the bottom fall-off is for text sitting _on_ media. Where
the caption is below the frame, the scrim only crushes the lower half of a tall
poster to flat black.

---

## 7. Motion

One curve (`--ease-cinema`), a few durations, and a rule: motion reinforces
quality, it is not the entertainment.

| Utility                         | Where                                         |
| ------------------------------- | --------------------------------------------- |
| `animate-rise` / `animate-fade` | Hero entry, staggered                         |
| `animate-curtain`               | The hero frame opening. Used once             |
| `animate-drift`                 | Very slow parallax on decorative grounds only |
| `reveal`                        | Scroll-linked section entry                   |
| `stagger`                       | Sequenced children. Used sparingly            |

`reveal` is **pure CSS** — `animation-timeline: view()`, no observer and no
JavaScript. The `@supports` guard matters: the default state is _visible_ and
the animation is added, never the reverse. A browser without scroll-linked
animation shows a normal page rather than a blank one.

Everything degrades under `prefers-reduced-motion: reduce`, and no reveal is
load-bearing. This is verified rather than assumed (§9).

---

## 8. Accessibility

- One `<h1>` per page; no heading-level jumps.
- Landmarks on every page: `header`, `main`, `footer`, named `nav`s.
- Choice tiles are real radio inputs, visually hidden inside their label: the
  whole tile is the hit area, arrow keys move between options, and selection is
  announced. A `div` with an `onClick` does none of that.
- Focus is visible everywhere (`:focus-visible`, brass, 2px, offset). Where
  focus lands on a hidden input, the tile shows it with `has-[:focus-visible]`.
- Hover-revealed content is also revealed by `group-focus-within`, so it is
  never a pointer-only affordance.
- Touch targets are 44px from `md` up.
- The create flow moves focus to the step heading on **change**, not on mount —
  focusing on first render steals focus and scrolls the page before the person
  has seen the top of it.

Playwright selectors are accessible roles and names. When copy changed in this
milestone the specs were updated to the new copy; no `data-testid` was added.

---

## 9. Checking it, rather than believing it

Three scripted checks were run against the built app at 375/430/768/1280/1680:

1. **Horizontal overflow** — `scrollWidth - clientWidth` on every public page.
2. **Reduced motion** — with `prefers-reduced-motion: reduce`, nothing with text
   may be left below 15% opacity. This catches the classic reveal bug where
   content is animated _from_ invisible and never arrives.
3. **Contrast** — WCAG AA against what the browser actually painted.

The contrast check resolves colours through a canvas rather than parsing
`getComputedStyle`. Chrome returns `oklch(...)` verbatim for oklch-authored
values, and reading that triplet as RGB produces ratios near 1.0 for
white-on-black — a false alarm on every element on the site. The checker was
then self-tested against a known-good and known-bad pair (18.99 vs 1.5) before
its clean result was believed.

---

## 10. Still to supply

The design is complete; the **content** is not. What would raise it most, in
order:

1. **Real film stills or short loops** for `portfolio_items.media_url` —
   `PortfolioFrame` is a placeholder and everything else is built around it.
2. **A hero loop** (muted, poster image, mobile fallback) for the transformation
   strip.
3. **A real before/after pair** — one photograph and one frame from the film
   made out of it. That single asset would do more than any copy on the page.
4. **A logo mark**, if the wordmark is ever not enough.
5. **An OG/social image** — the product will mostly be met through a shared link.
6. **Genuine testimonials.** None are invented here and none should be; the trust
   section is structured so real ones drop in beside it when they exist.
