/* The screen a phone shows when the shared board will no longer accept the
   public key. Work already on the phone stays put, and there is an export
   here so a shift is never stuck without a copy. */

import { el, icon, download, toast } from '../ui.js';
import { exportJson } from '../store.js';
import {
  authSession, membershipRole, requestMagicLink, refreshMembership, signOut,
} from '../cloud.js';

export function renderAuthGate({ gate, onReady } = {}) {
  const signingIn = gate === 'signing-in';
  const missing = gate === 'not-a-member';
  const session = authSession();
  const title = signingIn
    ? 'Signing you in'
    : missing
      ? 'Not on the list yet'
      : 'Please sign in';
  const copy = signingIn
    ? 'Opening your sign-in link. Your work stays on this phone either way.'
    : missing
      ? 'This email is signed in, but a supervisor still needs to add it as an editor or as the view-only wall screen. Nothing on this phone was deleted.'
      : 'The shared board is locked. Sign in with the email a supervisor invited. Everything you already did is still saved on this phone.';

  const screen = el('main.signin-screen', {},
    el('p.signin-kicker', {}, 'BV Cutting'),
    el('h1', {}, title),
    el('p.signin-copy', {}, copy));

  if (!signingIn && !missing) screen.append(emailForm());
  if (missing) {
    screen.append(el('p.signin-copy', {}, session?.email || 'Signed in'));
    screen.append(el('div.signin-actions', {},
      el('button.primary', {
        type: 'button',
        onclick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await refreshMembership();
            await onReady?.();
          } catch (error) {
            toast(error.message);
          } finally {
            button.disabled = false;
          }
        },
      }, 'Check again'),
      el('button', { type: 'button', onclick: () => signOut() }, 'Use a different email')));
  }

  screen.append(el('div.signin-actions', {},
    el('button', {
      type: 'button',
      onclick: () => {
        download(`cutting-tracker-${new Date().toISOString().slice(0, 10)}.json`, exportJson());
        toast('Backup saved');
      },
    }, icon('download', { size: 16 }), ' Export a backup')));

  if (membershipRole() === 'viewer') {
    screen.append(el('p.signin-note', {}, 'This account can only view the board.'));
  }
  return screen;
}

export function emailForm({ compact = false } = {}) {
  const session = authSession();
  if (session?.email && (session.role === 'editor' || session.role === 'viewer' || session.role === 'legacy')) {
    const label = session.role === 'viewer' ? 'View only' : session.role === 'legacy' ? 'Signed in' : 'Editor';
    return el('div.signin-signed-in', {},
      el('p', {}, el('strong', {}, session.email), el('span.signin-role', {}, label)),
      el('button', {
        type: 'button',
        onclick: () => signOut(),
      }, 'Sign out'));
  }

  let message = '';
  const status = el('p.signin-status', { role: 'status' });
  const input = el('input', {
    type: 'email',
    inputmode: 'email',
    autocomplete: 'email',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: 'name@company.com',
    'aria-label': 'Email address',
  });
  const button = el('button.primary', { type: 'button' }, 'Email me a sign-in link');
  button.addEventListener('click', async () => {
    button.disabled = true;
    message = '';
    status.textContent = '';
    try {
      message = await requestMagicLink(input.value);
      status.textContent = message;
    } catch (error) {
      message = error.message;
      status.textContent = message;
    } finally {
      button.disabled = false;
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') button.click();
  });

  return el('form.signin-form', {
    onsubmit: (event) => event.preventDefault(),
  },
  compact ? null : el('label.field', {}, el('span', {}, 'Invited email'), input),
  compact ? input : null,
  button,
  status,
  el('p.signin-note', {}, 'There is no sign-up. A supervisor invites you, then the link in that email signs you in.'));
}
