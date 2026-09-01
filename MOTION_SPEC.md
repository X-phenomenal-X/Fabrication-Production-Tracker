# Cutting Department Motion Specification

## Intent

Motion confirms work, preserves spatial context, and makes real-time changes
legible without turning a shop-floor screen into ambient animation. Every
transition is interruptible. Repeated status beacons never loop except for the
short, semantic Rush pulse.

The production implementation lives in `js/motion.js`; CSS choreography and
reduced-motion fallbacks live in `css/app.css`.

## Motion language

| Token | Value | Use |
| --- | --- | --- |
| `spring` | `cubic-bezier(.22, 1, .36, 1)` | Physical controls, FLIP reflow, dialog origin |
| `springSoft` | `cubic-bezier(.2, .82, .28, 1)` | Confirmation, scan wave, rollback settling |
| `exit` | `cubic-bezier(.4, 0, 1, 1)` | Departing page snapshot |
| `press` | 90ms | Button compression |
| `confirm` | 180ms | Swipe settle and local feedback |
| `dialog` | 280ms | Modal expansion from its trigger |
| `reflow` | 320ms | Queue FLIP into a vacated row |
| `view` | 360ms | Page-to-page shared transition |
| `rollback` | 420ms | Rejected mutation return and shake |
| `complete` | 440ms | Done macro confirmation and departure |
| `sync` | 900ms | One-shot sync merge pulse lifecycle |

## One-tap Done choreography

1. Pointer down compresses the macro to `scale(.98)` over 90ms.
2. On activation, capture every `[data-motion-key]` bounding box.
3. Commit `DONE` immediately. The data model, persisted local copy, counters,
   and queue state update before the animation finishes.
4. Emit one 15ms haptic pulse where vibration is available.
5. Expand a radial emerald confirmation from 12% to 150% scale over 430ms:
   opacity `.72 → .34 → 0`, `springSoft`.
6. Preserve the departing surface as a fixed-position ghost:
   - 0–24%: `scale(1 → 1.02)`, brightness `1 → 1.22`, emerald glow.
   - 24–55%: hold confirmation, translate X to 18px.
   - 55–100%: translate X to 62px, scale to `.965`, blur to 5px,
     opacity to 0.
7. After two animation frames, surviving keyed rows FLIP from their previous
   geometry to the new geometry over 320ms using `spring`.
8. Show a small Undo toast. Undo restores the exact previous explicit status.

## Rejected mutation / rollback

Network loss is not a rejection: the local mutation remains and queues for the
next sync. A local-storage failure is a rejection because the device cannot
guarantee the operator's action.

When persistence fails:

- restore the previous status immediately;
- vibrate `18ms, 45ms pause, 18ms`;
- keep the ghost for 420ms and shake X `0 → 8 → -6 → 4 → 0`;
- reintroduce the restored row from X 34px, then settle `-5 → 4 → -2 → 0`;
- announce: “Could not save this change — the line was put back.”

## Queue reflow

Queue rows, Running Now surfaces, overview work, and phone row surfaces carry
stable `data-motion-key` identities. Geometry is measured before the model
mutation, then measured again after rendering. Only rows that actually moved
animate; stationary rows receive no animation.

## Page transitions

- Old document snapshot: X `0 → -18px`, scale `1 → .992`, blur `0 → 2px`,
  opacity to 0, 360ms `exit`.
- New document snapshot: X `22px → 0`, scale `.988 → 1`, blur `3px → 0`,
  opacity `0 → 1`, 360ms `spring`.
- Header shell and page identity use named shared elements.
- If a second navigation arrives during a transition, the first transition is
  skipped and the latest destination renders immediately. Navigation state is
  never dropped to preserve decoration.
- Browsers without View Transitions use a 180ms opacity entrance.

## Dialog origin

Engineering drawings and line-launched lookup dialogs expand from the center
of the activating control. The transform origin is calculated from the
trigger's center relative to the final dialog bounds.

- Start: opacity `.25`, translate by the trigger-to-dialog delta,
  scale `.72 × .66`.
- Finish: opacity `1`, translate `0`, scale `1`.
- Duration: 280ms, `spring`.

## Sync merge

Only a newly completed sync timestamp triggers motion.

- The sync glyph performs one Y-axis orbit: `0° → 300° → 360°`, scale
  `.9 → 1.16 → 1`, 680ms.
- A 3px electric-cyan scan line moves from the header to the bottom of the
  viewport over 820ms.
- The root state is removed after 900ms. Nothing loops while merely “live.”

## Rush and SOP signals

- Rush becoming active: three 30ms haptic pulses and a restrained rose beacon
  that breathes once per keyframe cycle. It never changes layout.
- SOP conflict opening: one 60ms haptic pulse. The conflict remains magenta in
  text, border, and icon so it cannot be confused with a red shortage.

## Mobile swipe

- Vertical-scroll escape: movement is not classified until 8px; horizontal
  intent must exceed vertical movement by 1.15×.
- Reveal: 64px.
- Commit: 88px.
- Clamp: 112px.
- Right exposes a labelled emerald Done action; left exposes a labelled
  magenta Note action.
- Below threshold, the row springs home over 180ms.
- Above threshold, the action holds at 112px, commits after 150ms, then resets.

## Drawing gestures

- One pointer pans.
- Two pointers pinch continuously from 1× to 5×.
- Wheel zoom steps by `exp(-deltaY × .0015)`.
- Double-click toggles between 1× and 2×.
- Visible 44px Zoom out, Reset, and Zoom in controls use the same transform.
- Panning is clamped to the current scaled image bounds.

## Reduced motion

`prefers-reduced-motion: reduce` is authoritative:

- View Transitions, Rush pulse, sync orbit, scan wave, entry animations, and
  transform transitions are disabled.
- Done and swipe actions still commit immediately and show textual feedback.
- No ghost, ripple, FLIP, modal travel, or haptic vibration is emitted.
