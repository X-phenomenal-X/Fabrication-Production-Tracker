# Cutting Department Interaction Tokens

## Visual and semantic tokens

| Role | Token | Value | Contrast / behavior |
| --- | --- | --- | --- |
| App base | `--bg` | `#0F172A` | Dark slate, glare-resistant |
| Raised surface | `--panel` | `#111F31` | Restrained glass layer |
| Secondary surface | `--panel-2` | `#1A2A40` | Input and drawing well |
| Primary ink | `--ink` | `#F8FAFC` | WCAG AA on base and panels |
| Secondary ink | `--ink-2` | `#CBD5E1` | Supporting labels |
| Muted ink | `--ink-3` | `#94A3B8` | Metadata only, never sole status cue |
| In progress | `--work` | `#22D3EE` | Cyan rail, icon, and text label |
| Complete | `--ok` | `#34D399` | Emerald Done and completion motion |
| Rush | `--rush` | `#FB7185` | Rose pulse; separate from shortage |
| Warning / break | `--warn` | `#F59E0B` | Amber schedule and break warning |
| Shortage / blocked | `--bad` | `#EF4444` | Crimson icon, rail, and text |
| SOP conflict | `--sop` | `#E879F9` | Magenta route deviation |

All 25 representative text/background pairs pass WCAG AA in both light and
dark themes. Status is always repeated in text or iconography; color is never
the only signal.

## Typography

| Token / role | Specification |
| --- | --- |
| Body | Bundled IBM Plex Sans Regular/Semibold |
| Display | IBM Plex Sans Bold, tightened tracking, uppercase for machine/status labels |
| Work order / die | Bundled IBM Plex Mono Semibold |
| Dashboard date | 48px desktop, 26px phone, weight 850, line height 1.04 |
| Hero work order | 34px desktop; 19–24px phone |
| KPI value | 24px desktop; 19px phone |
| Micro-label | 11–12px, weight 800, uppercase, positive tracking |

The font set is bundled so the online-first PWA and the standalone offline file
render consistently without requesting a third-party font service.

## Geometry and touch

| Token | Value | Use |
| --- | --- | --- |
| `--tap` | 44px | Existing compact accessible control floor |
| Rugged primary target | 48px minimum | Operator status and primary actions |
| Large primary | 56px minimum | Phone Done dock, lookup primary action |
| Dashboard Done | 385×98px at 1440px reference | Glanceable across a workstation |
| Pan/zoom controls | 44×44px | Three visible drawing controls |
| Phone header budget | 96px | Two-row identity and navigation shell |
| Small radius | 6–8px | Dense controls and rows |
| Medium radius | 10–12px | Hero, KPI rail, dialogs |
| Pill radius | 999px | Status pills only |

## Motion and feedback

| Interaction | Visual | Haptic | Duration |
| --- | --- | --- | --- |
| Tap | Scale `.97–.985` | 8ms | 90ms |
| Done | Emerald ripple, glow, ghost, FLIP | 15ms | 440ms |
| Rush on | Rose beacon | `30, 30, 30` | Semantic pulse |
| SOP conflict | Magenta glow | 60ms | Immediate |
| Rejected save | Return + shake | `18, 45, 18` | 420ms |
| Page change | Depth cross-slide | none | 360ms |
| Dialog open | Expand from trigger | none | 280ms |
| Sync merge | Glyph orbit + scan wave | none | 900ms lifecycle |

## Status component contracts

| Component | Required content | Required state treatment |
| --- | --- | --- |
| Queue status card | W/O, die, project/floor, qty, due, status | 4px semantic rail; stable motion key |
| Running Now | Machine, W/O, die, qty, due, operator provenance | Cyan frame; one dominant emerald Done |
| Inferred status pill | “Done” plus “inferred” wording | Soft emerald outline / patterned treatment; never solid asserted green |
| SOP flag | “SOP conflict” and route explanation | Magenta border, icon, text; 60ms haptic on open |
| Rush badge | “Rush” and need-by context | Rose, not crimson; 3-pulse haptic only when enabled |
| Back order | “B/O” or “Back order” plus shortage context | Crimson; owner and note remain visible in detail |
| Machine allocation drawer | Source machine, target choices, current assignment | 48px choices; selected target and success toast |

## Gesture contracts

| Gesture | Threshold | Result |
| --- | --- | --- |
| Swipe right | 88px, clamped at 112px | Done |
| Swipe left | 88px, clamped at 112px | Open Note |
| Vertical escape | Horizontal must exceed vertical by 1.15× after 8px | Preserve page scroll |
| Pinch | 1×–5× | Zoom drawing around gesture center |
| One-finger drag | At zoom >1× | Pan within clamped bounds |
| Double-click/tap | 1× ↔ 2× | Fast inspect/reset |
| Wheel | Exponential step | Desktop drawing zoom |

## Accessibility contracts

- Every persistent operator action is at least 44px; primary rugged actions
  are 48–56px.
- Keyboard focus uses a visible outline or shadow.
- All buttons, gesture alternatives, and icon-only controls have accessible
  names.
- Swipe actions are real labelled buttons behind the moving row.
- Reduced motion removes nonessential travel, pulsing, FLIP, and vibration.
- Monitor mode is read-only: zero pressable controls.
- Fixed phone actions clear the browser safe area by at least 8px.
