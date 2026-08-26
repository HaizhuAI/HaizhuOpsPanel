# Operations Dashboard Page Overrides

> **PROJECT:** HaizhuOpsPanel
> **SOURCE:** Visual study of `next-dash.uzuma.ru` captured 2026-07-13
> This file overrides `../MASTER.md` for the authenticated operations console.

## Visual Direction

- Use a light-first, monochrome control-console aesthetic.
- Preserve HaizhuOpsPanel's operational language and status semantics; do not copy the reference brand.
- Prefer whitespace, thin borders and grouping over gradients, glow or heavy elevation.
- Terminal and live log surfaces remain dark because their information model is code-first.

## Measured Reference Rules

- Desktop sidebar: `256px`; top workspace bar: `64px`.
- App background and primary cards: `#FFFFFF`; secondary surface: `#FAFAFA`.
- Border: `#E4E4E7` / soft divider `#EEEEEF`.
- Primary text: `#09090B`; secondary text: `#71717A`.
- Primary action: `#18181B` with white label.
- Nav active state: approximately `rgba(24, 24, 27, .09)`, 10px radius.
- Resource and metric cards: 16px radius, 1px border, no default shadow.
- Font: Outfit with Chinese system fallbacks; heading 30px/600, body 14px/400-500.

## Layout

- Page content max width: `1320px`.
- Desktop page gutters: `64px`; tablet: `32px`; mobile: `16px`.
- Page header: large title and short description on the left, one compact tool group on the right.
- Dashboard order: page header → compute-resource callout → live health strip → four KPIs → asset table.
- Host page uses responsive instance cards (`minmax(300px, 1fr)`) with identity, status, four specs and actions.
- Operations and app cards use the same border/radius language for consistency.

## Interaction and Accessibility

- Primary controls use black; success green is reserved for health and completion states.
- Destructive controls use red text and a pale red surface, never color alone.
- Every interactive target is at least 40px desktop and 44px touch.
- Focus uses a visible 2px blue ring; motion is 150-220ms and disabled with reduced motion.
- At 820px the sidebar becomes an off-canvas drawer; at 480px dense grids collapse to one column.
- No horizontal page overflow at 375px.

## Avoid

- No neon gradients, glow, glassmorphism or default dark dashboard chrome.
- No floating cards with exaggerated shadow.
- No emoji or mixed icon styles.
- No generic landing-page sections inside the authenticated product.
