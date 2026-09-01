/* Photo to To-Do — a review gate between a temporary shop-floor photo and the
   ordinary Today list.

   The image exists only in this dialog and in one Edge Function request. It is
   never written to app state, localStorage or the shared cloud document. The
   model proposes text; an operator edits, selects and explicitly adds it. */

import { el, icon, modal, toast } from './ui.js';
import { addTodo, cloudConfig } from './store.js';

const LS_ACCESS = 'bv.cutting.photo-todo.access.v1';
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_DATA_URL = 5_200_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function accessKey() {
  try { return localStorage.getItem(LS_ACCESS) || ''; } catch { return ''; }
}

function setAccessKey(value) {
  const key = String(value || '').trim();
  try {
    if (key) localStorage.setItem(LS_ACCESS, key);
    else localStorage.removeItem(LS_ACCESS);
  } catch { /* The request can still use the in-memory value this session. */ }
  return key;
}

function cleanText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Keep model output inside the same small, named-person To-Do model the app
    already trusts. Exported so the regression can exercise hostile/loose JSON
    without sending a real photo or using an API key. */
export function normalizePhotoTodoResult(value, people = []) {
  const source = value && typeof value === 'object' ? value : {};
  const known = new Map(people.map((name) => [String(name).trim().toLowerCase(), name]));
  const tasks = (Array.isArray(source.tasks) ? source.tasks : [])
    .slice(0, 12)
    .map((task) => {
      const text = cleanText(task?.text);
      const proposed = cleanText(task?.assignee, 80);
      const assignee = proposed ? (known.get(proposed.toLowerCase()) || null) : null;
      const confidence = Math.max(0, Math.min(1, Number(task?.confidence) || 0));
      return {
        text,
        assignee,
        unmatchedAssignee: proposed && !assignee ? proposed : null,
        evidence: cleanText(task?.evidence, 180),
        confidence,
        needsReview: !!task?.needsReview || confidence < 0.75 || (!!proposed && !assignee),
        selected: !!text,
      };
    })
    .filter((task) => task.text);
  return {
    summary: cleanText(source.summary, 300)
      || (tasks.length ? `I found ${tasks.length} possible To-Do${tasks.length === 1 ? '' : 's'}.` : 'I could not find a clear action.'),
    tasks,
  };
}

function imageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That image could not be read. Try a JPEG, PNG or WebP photo.'));
    image.src = url;
  });
}

/** Downscale before upload: whiteboard text remains legible at 1600px while a
    modern phone photo drops from many megabytes to a bounded request. */
export async function preparePhoto(file) {
  if (!file || !ALLOWED_TYPES.has(String(file.type).toLowerCase())) {
    throw new Error('Choose a JPEG, PNG or WebP photo.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('That photo is over 15 MB. Choose a smaller image.');
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await imageElement(url);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) throw new Error('That image has no readable dimensions.');
    const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('This browser could not prepare the photo.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (dataUrl.length > MAX_DATA_URL) dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    if (dataUrl.length > MAX_DATA_URL) {
      throw new Error('That photo is still too detailed to send. Crop it closer and try again.');
    }
    return { dataUrl, width, height, name: cleanText(file.name, 120) || 'Photo' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function requestCandidates({ cfg, key, image, guidance }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let response;
  try {
    response = await fetch(`${cfg.url}/functions/v1/photo-to-todos`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        'x-photo-todo-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image, guidance: cleanText(guidance, 500) }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('The photo took too long to read. Try again.');
    throw new Error('Photo analysis needs an internet connection. Your regular To-Do list still works offline.');
  } finally {
    clearTimeout(timer);
  }

  let body = {};
  try { body = await response.json(); } catch { /* user-friendly status below */ }
  if (!response.ok) {
    const message = cleanText(body?.error || body?.message, 220);
    const fallback = response.status === 404 || response.status === 503
      ? 'Photo to To-Do is not switched on for this site yet. Ask a supervisor to finish cloud setup.'
      : response.status === 429
        ? 'Photo analysis is busy right now. Wait a moment and try again.'
        : `Photo analysis failed (${response.status}).`;
    const error = new Error(message || fallback);
    error.status = response.status;
    throw error;
  }
  return body;
}

export function openPhotoTodoDialog({
  ref, people = [], defaultAssignee = null, rerender, go, origin = null,
} = {}) {
  const cfg = cloudConfig();
  const state = {
    phase: !cfg ? 'cloud' : (accessKey() ? 'choose' : 'access'),
    key: accessKey(), photo: null, guidance: '', result: null, error: '',
  };
  const flow = el('div.photo-todo-flow', { 'aria-live': 'polite' });
  const dlg = modal('Photo to To-Do', flow, { wide: true, origin });
  dlg.classList.add('photo-todo-dialog');
  const footer = el('footer.photo-todo-footer');
  const cameraInput = el('input.photo-todo-file', {
    type: 'file', accept: 'image/jpeg,image/png,image/webp', capture: 'environment',
    'aria-label': 'Take a photo for To-Do conversion', style: { display: 'none' },
  });
  const uploadInput = el('input.photo-todo-file', {
    type: 'file', accept: 'image/jpeg,image/png,image/webp',
    'aria-label': 'Choose a photo for To-Do conversion', style: { display: 'none' },
  });
  dlg.append(cameraInput, uploadInput, footer);

  const action = (label, onClick, className = '', props = {}) =>
    el('button', { class: className, onclick: onClick, ...props }, label);
  const close = () => dlg.close();
  const selectedCount = () => state.result?.tasks.filter((task) => task.selected && task.text.trim()).length || 0;

  async function takeFile(file) {
    if (!file) return;
    state.phase = 'prepare'; state.error = ''; render();
    try {
      state.photo = await preparePhoto(file);
      state.phase = 'preview';
    } catch (error) {
      state.error = error.message;
      state.phase = 'choose';
    }
    cameraInput.value = '';
    uploadInput.value = '';
    render();
  }
  cameraInput.addEventListener('change', () => takeFile(cameraInput.files?.[0]));
  uploadInput.addEventListener('change', () => takeFile(uploadInput.files?.[0]));

  async function analyse() {
    if (!navigator.onLine) {
      state.error = 'Photo analysis needs an internet connection. Your regular To-Do list still works offline.';
      render(); return;
    }
    state.phase = 'analyse'; state.error = ''; render();
    try {
      const raw = await requestCandidates({
        cfg, key: state.key, image: state.photo.dataUrl, guidance: state.guidance,
      });
      state.result = normalizePhotoTodoResult(raw, people);
      for (const task of state.result.tasks) {
        if (!task.assignee && !task.unmatchedAssignee) task.assignee = defaultAssignee || null;
      }
      state.phase = 'review';
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        setAccessKey(''); state.key = ''; state.phase = 'access';
        state.error = 'That department access code was not accepted. Enter it again.';
      } else {
        state.phase = 'preview'; state.error = error.message;
      }
    }
    render();
  }

  function addSelected() {
    const chosen = state.result.tasks.filter((task) => task.selected && task.text.trim());
    for (const task of chosen) {
      addTodo(task.text, { date: ref, assignee: task.assignee || null });
    }
    if (!chosen.length) return;
    toast(`${chosen.length} To-Do${chosen.length === 1 ? '' : 's'} added from the photo`);
    close();
    rerender?.();
  }

  function errorBanner() {
    return state.error ? el('div.photo-todo-error', { role: 'alert' }, icon('alert', { size: 17 }), state.error) : null;
  }

  function privacyNote() {
    return el('div.photo-todo-privacy', {},
      icon('cloud', { size: 15 }),
      el('span', {}, el('strong', {}, 'Online review only. '),
        'The photo is not saved; only To-Dos you approve are synced.'));
  }

  function renderAccess() {
    const input = el('input', {
      type: 'password', autocomplete: 'off', value: state.key,
      placeholder: 'Department access code', 'aria-label': 'Photo to To-Do department access code',
      oninput: (event) => { state.key = event.target.value; },
      onkeydown: (event) => { if (event.key === 'Enter') saveAccess(); },
    });
    const saveAccess = () => {
      const key = setAccessKey(state.key);
      if (!key) { state.error = 'Enter the department access code.'; render(); return; }
      state.key = key; state.phase = 'choose'; state.error = ''; render();
    };
    flow.replaceChildren(
      el('div.photo-todo-intro', {},
        el('div.photo-todo-mark', {}, icon('sparkles', { size: 24 })),
        el('div', {}, el('h2', {}, 'Connect this device once'),
          el('p', {}, 'This code protects the department’s AI allowance. It stays on this device and never joins the shared tracker data.'))),
      errorBanner(),
      el('label.photo-todo-field', {}, el('span', {}, 'Department access code'), input),
      privacyNote());
    footer.replaceChildren(action('Cancel', close), action('Continue', saveAccess, 'primary'));
    input.focus();
  }

  function renderChoose() {
    flow.replaceChildren(
      el('div.photo-todo-intro', {},
        el('div.photo-todo-mark', {}, icon('camera', { size: 24 })),
        el('div', {}, el('h2', {}, 'Turn floor notes into a clean list'),
          el('p', {}, 'Photograph a handwritten list, whiteboard or printed note. You will review every item before anything is added.'))),
      errorBanner(),
      el('div.photo-todo-picks', {},
        el('button.photo-todo-pick.primary', { onclick: () => cameraInput.click() },
          icon('camera', { size: 21 }), el('span', {}, el('strong', {}, 'Take photo'), el('small', {}, 'Use the rear camera'))),
        el('button.photo-todo-pick', { onclick: () => uploadInput.click() },
          icon('upload', { size: 21 }), el('span', {}, el('strong', {}, 'Choose image'), el('small', {}, 'JPEG, PNG or WebP')))),
      privacyNote());
    footer.replaceChildren(
      action('Change access code', () => { setAccessKey(''); state.key = ''; state.phase = 'access'; render(); }),
      action('Cancel', close));
  }

  function renderBusy(label, copy) {
    flow.replaceChildren(el('div.photo-todo-busy', {},
      el('span.spinner', { 'aria-hidden': 'true' }),
      el('strong', {}, label), el('p', {}, copy)));
    footer.replaceChildren(action('Cancel', close));
  }

  function renderPreview() {
    const guidance = el('textarea', {
      rows: 2, maxlength: 500, value: state.guidance,
      placeholder: 'Optional: “Only actions for afternoon shift”',
      'aria-label': 'Optional guidance for the photo',
      oninput: (event) => { state.guidance = event.target.value; },
    });
    flow.replaceChildren(
      errorBanner(),
      el('div.photo-todo-preview', {},
        el('img', { src: state.photo.dataUrl, alt: 'Photo selected for To-Do review' }),
        el('div', {}, el('strong', {}, state.photo.name),
          el('span.small.muted', {}, `${state.photo.width} × ${state.photo.height} prepared for review`))),
      el('label.photo-todo-field', {}, el('span', {}, 'Anything I should focus on?'), guidance),
      privacyNote());
    footer.replaceChildren(
      action('Choose another', () => { state.phase = 'choose'; state.error = ''; render(); }),
      action('Find To-Dos', analyse, 'primary'));
  }

  function renderReview() {
    const list = el('div.photo-todo-candidates');
    state.result.tasks.forEach((task, index) => {
      const checkbox = el('input', {
        type: 'checkbox', checked: task.selected,
        'aria-label': `Include To-Do ${index + 1}`,
        onchange: (event) => { task.selected = event.target.checked; renderFooter(); },
      });
      const text = el('textarea', {
        rows: 2, value: task.text, maxlength: 240,
        'aria-label': `To-Do ${index + 1} text`,
        oninput: (event) => { task.text = event.target.value; renderFooter(); },
      });
      const who = el('select', {
        'aria-label': `Assign To-Do ${index + 1}`,
        onchange: (event) => { task.assignee = event.target.value || null; },
      },
      el('option', { value: '', selected: !task.assignee },
        task.unmatchedAssignee ? `Unassigned · “${task.unmatchedAssignee}” not recognized` : 'Anyone'),
      ...people.map((person) => el('option', { value: person, selected: task.assignee === person }, person)));
      list.append(el('article.photo-todo-candidate' + (task.needsReview ? '.review' : ''), {},
        el('label.photo-todo-select', {}, checkbox, el('span', {}, `To-Do ${index + 1}`),
          task.needsReview ? el('span.photo-todo-review-flag', {}, 'Check wording') : null),
        text,
        el('div.photo-todo-candidate-meta', {}, who,
          task.evidence ? el('span', {}, `Read from photo: ${task.evidence}`) : null)));
    });
    flow.replaceChildren(
      el('div.photo-todo-answer', {}, icon('sparkles', { size: 20 }),
        el('div', {}, el('strong', {}, 'Photo assistant'), el('p', {}, state.result.summary))),
      list,
      state.result.tasks.length ? privacyNote() : el('div.empty', {},
        el('h3', {}, 'No clear actions found'),
        el('p', {}, 'Try a closer photo or tell me what part of the note matters.')));
    renderFooter();
  }

  function renderFooter() {
    if (state.phase !== 'review') return;
    const count = selectedCount();
    footer.replaceChildren(
      action('Back to photo', () => { state.phase = 'preview'; render(); }),
      action(`Add selected (${count})`, addSelected, 'primary', { disabled: !count }));
  }

  function render() {
    if (state.phase === 'cloud') {
      flow.replaceChildren(el('div.photo-todo-intro', {},
        el('div.photo-todo-mark', {}, icon('cloud', { size: 24 })),
        el('div', {}, el('h2', {}, 'Connect Sync across devices first'),
          el('p', {}, 'Photo analysis runs through the department’s protected cloud function. The normal To-Do list remains available without it.'))));
      footer.replaceChildren(action('Cancel', close), action('Open Setup', () => { close(); go?.('setup'); }, 'primary'));
    } else if (state.phase === 'access') renderAccess();
    else if (state.phase === 'choose') renderChoose();
    else if (state.phase === 'prepare') renderBusy('Preparing the photo…', 'Shrinking it on this device before anything is sent.');
    else if (state.phase === 'preview') renderPreview();
    else if (state.phase === 'analyse') renderBusy('Reading the photo…', 'Looking only for explicit, actionable work.');
    else if (state.phase === 'review') renderReview();
  }

  // Detaching the image and dropping these references is the final privacy
  // boundary. No photo value is ever passed to save().
  dlg.addEventListener('close', () => {
    state.photo = null; state.result = null;
    cameraInput.value = ''; uploadInput.value = '';
  }, { once: true });
  render();
  return dlg;
}
