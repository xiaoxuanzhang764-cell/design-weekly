# Design System

## Direction

The public gallery is a dark, centered exhibition surface inspired by the browsing rhythm of PPT Master, while the document workspace is a bright, utilitarian collaboration panel inspired by the clarity of DingTalk Docs. The transition from gallery to document should feel like walking from an exhibition foyer into a well-lit studio workspace.

## Color Strategy

Use a restrained product palette in the editor and let issue covers carry expressive color on the gallery. The palette tool's green seed is retained as the primary identity/status color; the previously approved blue remains the interaction accent.

```css
:root {
  --color-gallery: oklch(0.09 0 0);
  --color-gallery-raised: oklch(0.16 0.008 265);
  --color-app: oklch(0.95 0.004 265);
  --color-document: oklch(1 0 0);
  --color-ink: oklch(0.19 0.01 265);
  --color-ink-inverse: oklch(0.97 0 0);
  --color-muted: oklch(0.48 0.012 265);
  --color-border: oklch(0.86 0.006 265);
  --color-primary: oklch(0.55 0.119 160);
  --color-accent: oklch(0.61 0.19 264);
  --color-danger: oklch(0.58 0.18 28);
}
```

Use near-white text on primary, accent, and danger fills. Use color plus text/icon state for online, syncing, offline, and error feedback.

## Typography

Use a single dependable Chinese system stack with strong scale contrast rather than an ornamental font pairing:

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
```

- Gallery display: fluid 48–80 px, 0.98–1.05 line height, letter spacing no tighter than -0.035em.
- Page title: 32–48 px, 1.05 line height.
- Document body: 16 px, 1.7 line height, maximum 72ch.
- Metadata and controls: 12–14 px, never below 12 px.

## Layout

- Gallery: centered hero followed by a responsive three-column issue grid using `repeat(auto-fit, minmax(280px, 1fr))`.
- Document desktop: 220 px issue sidebar, flexible 680–760 px document canvas, 190–220 px information sidebar.
- Tablet: hide the information sidebar behind a labeled drawer.
- Mobile: show a single document column; both sidebars become top-bar drawers.
- Use spacing rhythm of 4, 8, 12, 16, 24, 32, 48, 64, and 96 px.

## Components

- Issue cards use a 12 px radius, one defined border, and no broad decorative shadow.
- Buttons use 7–9 px radius; pills are reserved for filters, live states, and people.
- The document canvas is a white continuous surface, not a stack of cards.
- Media blocks sit in the document flow with captions and explicit upload/error states.
- Remote cursors combine a colored caret, name label, and selection tint.
- Focus rings use a 2 px solid accent with 2 px offset.

## Motion

- Gallery cards may use a short 160–220 ms lift/cover reveal on hover.
- New collaborator and save-state transitions use opacity and small transforms only.
- Do not gate content visibility on animation.
- Under `prefers-reduced-motion`, use instant state changes and automatic scrolling.

## Content Voice

Use concise Chinese interface copy: `已保存`, `正在同步`, `离线编辑`, `更新中`, `打开周刊目录`, and `恢复此版本`. Avoid marketing filler and technical CRDT/WebSocket terminology in the interface.

