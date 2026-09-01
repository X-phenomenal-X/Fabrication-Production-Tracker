/* Shared interaction choreography for the production tracker.

   The app deliberately stays framework-free, but its movement still needs one
   vocabulary. These helpers keep the same spring, durations, FLIP reflow,
   haptics and gesture thresholds everywhere instead of letting each view grow
   its own almost-matching animation. */

export const MOTION = Object.freeze({
  spring: 'cubic-bezier(.22,1,.36,1)',
  springSoft: 'cubic-bezier(.2,.82,.28,1)',
  exit: 'cubic-bezier(.4,0,1,1)',
  durations: Object.freeze({
    press: 90,
    confirm: 180,
    reflow: 320,
    complete: 440,
    rollback: 420,
    view: 360,
    sync: 900,
    dialog: 280,
  }),
  swipe: Object.freeze({ reveal: 64, commit: 88, limit: 112 }),
});

export const HAPTIC = Object.freeze({
  tap: 8,
  done: 15,
  rush: [30, 30, 30],
  sop: 60,
  reject: [18, 45, 18],
});

export function reducedMotion() {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function haptic(kind = 'tap') {
  if (reducedMotion() || typeof navigator === 'undefined'
      || typeof navigator.vibrate !== 'function') return false;
  try { return navigator.vibrate(HAPTIC[kind] ?? HAPTIC.tap); }
  catch { return false; }
}

const FLIP_SELECTOR = '[data-motion-key]';

export function captureFlip(root = document, selector = FLIP_SELECTOR) {
  const positions = new Map();
  root.querySelectorAll(selector).forEach((node) => {
    const key = node.dataset.motionKey;
    if (!key || positions.has(key)) return;
    const rect = node.getBoundingClientRect();
    positions.set(key, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  });
  return positions;
}

export function playFlip(before, root = document, selector = FLIP_SELECTOR) {
  if (!before?.size || reducedMotion()) return;
  root.querySelectorAll(selector).forEach((node) => {
    const first = before.get(node.dataset.motionKey);
    if (!first || typeof node.animate !== 'function') return;
    const last = node.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = last.width ? first.width / last.width : 1;
    const sy = last.height ? first.height / last.height : 1;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5
        && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) return;
    node.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transform: 'none' },
    ], { duration: MOTION.durations.reflow, easing: MOTION.spring, composite: 'replace' });
  });
}

function completionGhost(surface) {
  if (!surface || reducedMotion()) return null;
  const rect = surface.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ghost = surface.cloneNode(true);
  ghost.classList.add('motion-completion-ghost');
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  ghost.querySelectorAll('button,input,select,textarea,a').forEach((node) => {
    node.setAttribute('tabindex', '-1');
    node.setAttribute('aria-hidden', 'true');
  });
  Object.assign(ghost.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
    zIndex: '120', pointerEvents: 'none', transformOrigin: '50% 50%',
  });
  document.body.append(ghost);
  return ghost;
}

function radialRipple(trigger) {
  if (!trigger || reducedMotion()) return;
  const rect = trigger.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.8;
  const ripple = document.createElement('span');
  ripple.className = 'motion-done-ripple';
  ripple.setAttribute('aria-hidden', 'true');
  Object.assign(ripple.style, {
    position: 'fixed',
    left: `${rect.left + rect.width / 2 - size / 2}px`,
    top: `${rect.top + rect.height / 2 - size / 2}px`,
    width: `${size}px`, height: `${size}px`, zIndex: '125',
  });
  document.body.append(ripple);
  const animation = ripple.animate([
    { opacity: .72, transform: 'scale(.12)' },
    { opacity: .34, offset: .42 },
    { opacity: 0, transform: 'scale(1.5)' },
  ], { duration: 430, easing: MOTION.springSoft });
  animation.finished.finally(() => ripple.remove());
}

/** Commit immediately, preserve the departing surface as a visual ghost, then
    FLIP every surviving keyed row into the space it left behind. */
export function completeWithMotion({ surface, trigger, commit, root = document }) {
  const before = captureFlip(root);
  radialRipple(trigger);
  const ghost = completionGhost(surface);
  haptic('done');
  const committed = commit();

  if (committed === false) {
    haptic('reject');
    if (ghost && typeof ghost.animate === 'function') {
      const rejected = ghost.animate([
        { opacity: 1, transform: 'translateX(0) scale(1)' },
        { transform: 'translateX(8px) scale(1.01)', offset: .3 },
        { transform: 'translateX(-6px)', offset: .5 },
        { transform: 'translateX(4px)', offset: .68 },
        { opacity: 0, transform: 'translateX(0)' },
      ], { duration: MOTION.durations.rollback, easing: MOTION.springSoft, fill: 'forwards' });
      rejected.finished.finally(() => ghost.remove());
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const restored = surface?.dataset.motionKey
        ? root.querySelector(`[data-motion-key="${CSS.escape(surface.dataset.motionKey)}"]`)
        : null;
      rejectWithMotion(restored);
    }));
    return;
  }

  requestAnimationFrame(() => requestAnimationFrame(() => playFlip(before, root)));
  if (!ghost || typeof ghost.animate !== 'function') return;
  const animation = ghost.animate([
    { opacity: 1, transform: 'translateX(0) scale(1)', filter: 'brightness(1)' },
    { opacity: 1, transform: 'translateX(0) scale(1.02)',
      filter: 'brightness(1.22) drop-shadow(0 0 16px rgba(52,211,153,.52))', offset: .24 },
    { opacity: .72, transform: 'translateX(18px) scale(.995)', offset: .55 },
    { opacity: 0, transform: 'translateX(62px) scale(.965)', filter: 'blur(5px) brightness(1.15)' },
  ], { duration: MOTION.durations.complete, easing: MOTION.springSoft, fill: 'forwards' });
  animation.finished.finally(() => ghost.remove());
}

export function rejectWithMotion(surface) {
  haptic('reject');
  if (!surface || reducedMotion() || typeof surface.animate !== 'function') return;
  surface.animate([
    { opacity: 0, transform: 'translateX(34px)' },
    { opacity: 1, transform: 'translateX(0)', offset: .36 },
    { transform: 'translateX(-5px)', offset: .55 },
    { transform: 'translateX(4px)', offset: .7 },
    { transform: 'translateX(-2px)', offset: .84 },
    { transform: 'translateX(0)' },
  ], { duration: MOTION.durations.rollback, easing: MOTION.springSoft });
}

/** Horizontal mobile gesture with a vertical-scroll escape hatch. The row's
    two real action buttons stay visible behind the moving surface, so the
    gesture never relies on colour alone. */
export function bindSwipeActions(node, { onRight, onLeft } = {}) {
  const surface = node?.querySelector('.mobile-queue-surface');
  if (!node || !surface || typeof PointerEvent === 'undefined') return node;
  let pointer = null;

  const reset = () => {
    surface.style.transition = `transform ${MOTION.durations.confirm}ms ${MOTION.spring}`;
    surface.style.transform = '';
    node.classList.remove('swiping', 'swipe-right', 'swipe-left');
    setTimeout(() => { surface.style.transition = ''; }, MOTION.durations.confirm);
  };

  node.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse'
        || event.target.closest('button,input,select,textarea,a')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, horizontal: null };
    surface.style.transition = 'none';
    node.setPointerCapture?.(event.pointerId);
  });

  node.addEventListener('pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (pointer.horizontal == null && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      pointer.horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
    }
    if (!pointer.horizontal) return;
    pointer.dx = Math.max(-MOTION.swipe.limit, Math.min(MOTION.swipe.limit, dx));
    surface.style.transform = `translateX(${pointer.dx}px)`;
    node.classList.toggle('swipe-right', pointer.dx > 0);
    node.classList.toggle('swipe-left', pointer.dx < 0);
    node.classList.add('swiping');
  });

  const finish = (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const { dx, horizontal } = pointer;
    pointer = null;
    if (!horizontal || Math.abs(dx) < MOTION.swipe.commit) {
      reset();
      return;
    }
    surface.style.transition = `transform ${MOTION.durations.confirm}ms ${MOTION.spring}`;
    surface.style.transform = `translateX(${dx > 0 ? MOTION.swipe.limit : -MOTION.swipe.limit}px)`;
    const action = dx > 0 ? onRight : onLeft;
    setTimeout(() => {
      action?.();
      reset();
    }, MOTION.durations.confirm - 30);
  };
  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', () => { pointer = null; reset(); });
  return node;
}

export function pulseSyncMerge() {
  const root = document.documentElement;
  root.classList.remove('sync-merge-pulse');
  // Reflow lets a second merge restart the keyframe instead of being ignored.
  void root.offsetWidth;
  root.classList.add('sync-merge-pulse');
  setTimeout(() => root.classList.remove('sync-merge-pulse'), MOTION.durations.sync);
}

let activeViewTransition = null;

export function transitionView(update) {
  if (reducedMotion() || typeof document.startViewTransition !== 'function') return update();
  try {
    // Fast operators can change centres before the previous 360ms transition
    // ends. Finish the old visual snapshot and always run the new update;
    // dropping a navigation because a transition overlaps would be far worse
    // than shortening the decoration around it.
    if (activeViewTransition) {
      activeViewTransition.skipTransition?.();
      activeViewTransition = null;
      // Chromium does not allow a second transition to begin until the first
      // one has fully settled. The operator's latest navigation still wins
      // immediately; only its decoration is shortened.
      return update();
    }
    const transition = document.startViewTransition(update);
    activeViewTransition = transition;
    transition.finished.finally(() => {
      if (activeViewTransition === transition) activeViewTransition = null;
    });
    return transition;
  } catch {
    return update();
  }
}
