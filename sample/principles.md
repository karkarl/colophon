# Design principles — Northlight

> This is the prose companion to `design.json`. Designers write here; developers
> and Copilot read here. Keep it short enough that people actually read it.

## The one-line brief
Field notes for people who build in the open. It should feel like a well-set
editorial tool — calm, exact, a little warm — not a dashboard template.

## Voice
- Plain-spoken and exact. Short sentences. Say the thing.
- No hype words ("supercharge", "seamless", "revolutionary", "effortless").
- Labels are lowercase-simple; headlines can have a point of view.

## Information hierarchy
1. **One subject per screen.** Decide what the screen is *for* and let that element win.
2. **Size and weight before color.** Establish the hierarchy in grayscale first; color is the last 10%.
3. **One accent.** `accent` means "act here". If everything is accented, nothing is.
4. **Generous vertical rhythm.** Prefer the `space-5`/`space-6` steps between groups; let content breathe.

## Do
- Tint neutrals toward the brand (warm ink, warm paper).
- Use the serif display face for headlines, sans for everything else, mono for data.
- Keep motion to 120–200ms ease-out. Animate to explain, not to impress.

## Don't
- Don't put gray text on a colored background.
- Don't nest cards inside cards, or wrap every block in a card.
- Don't use pure black (#000) or pure gray (#888) — always tinted.
- Don't reach for bounce/elastic easing; it reads as dated and AI-generated.
- Don't add a rounded-square icon tile above every heading.

## Anti-references
If a mock could be mistaken for a generic SaaS landing page, a purple gradient
hero, or an Inter-on-white admin panel — start over.
