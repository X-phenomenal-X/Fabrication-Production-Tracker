/* Editable department directory and the much smaller list of tracker users.

   The public website contains no roster. A supervisor can load the internal
   workbook here, then edit the operational fields that are shared with the
   department. Employee IDs and other HR details never enter tracker state. */

import { el, icon, toast, modal, fmtNum, confirmDialog } from '../ui.js';
import {
  me, employeeDirectory, employeeCanUseApp,
  EMPLOYEE_ROLES, EMPLOYEE_ROLE_LABELS,
  setCurrentAppUser,
} from '../store.js';
import { upsertEmployee, importEmployees, archiveEmployee } from '../employees.js';

const view = { q: '', scope: 'all' };

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function initials(name) {
  const parts = cleanName(name).split(' ').filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : parts[0]?.slice(0, 2) || '?').toUpperCase();
}

function shiftLabel(shift) {
  if (shift === 'AFTERNOON') return 'Afternoon shift';
  if (shift === 'DAY') return 'Day shift';
  return 'Shift not set';
}

function roleLabel(record) {
  return record.legacy ? 'Role not reviewed' : EMPLOYEE_ROLE_LABELS[record.role] || 'Employee';
}

async function loadCrewFile(file, rerender) {
  toast(`Reading ${file.name}…`, 60000);
  try {
    const { importEmployeeRoster } = await import('../import-employees.js');
    const result = await importEmployeeRoster(await file.arrayBuffer(), { fileName: file.name });
    const saved = importEmployees(result.employees);
    modal('Abhay’s crew imported', el('div', {},
      el('div.stats.import-stats', {},
        el('div.stat', {}, el('div.n', {}, fmtNum(result.report.count)), el('div.k', {}, 'Active crew')),
        el('div.stat', {}, el('div.n', {}, fmtNum(saved.added)), el('div.k', {}, 'New records')),
        el('div.stat', {}, el('div.n', {}, fmtNum(saved.updated)), el('div.k', {}, 'Records updated'))),
      el('div.banner.info.employee-import-note', {}, icon('users', { size: 17 }),
        el('span', {}, 'Imported employees are directory-only. They do not appear in the tracker user picker unless you change their role and turn on tracker access.')),
      el('p.small.muted', {}, 'Name, department and shift were saved. Employee IDs, clothing sizes and source rows were discarded.')));
    toast(`${fmtNum(saved.total)} employee record${saved.total === 1 ? '' : 's'} checked`);
    rerender();
  } catch (error) {
    modal('Roster import failed', el('div', {},
      el('p', {}, error.message),
      el('p.small.muted', {}, 'Nothing already listed has been changed. Choose the UNION employee listing that contains the Abhay sheet.')));
  }
}

function chooseCrewFile(rerender) {
  const input = el('input', { type: 'file', accept: '.xlsx', style: { display: 'none' } });
  input.addEventListener('change', () => {
    if (input.files[0]) loadCrewFile(input.files[0], rerender);
  });
  document.body.append(input);
  input.click();
  input.remove();
}

function openEmployeeEditor(record, rerender, origin = null) {
  const editing = !!record;
  const legacy = !!record?.legacy;
  const name = el('input.employee-name-input', {
    type: 'text', autocomplete: 'name', value: record?.name || '',
    placeholder: 'Full name', 'aria-label': 'Employee name',
  });
  const department = el('input.employee-department-input', {
    type: 'text', value: record?.department || '', placeholder: 'Cutting',
    'aria-label': 'Department',
  });
  const shift = el('select.employee-shift-input', { 'aria-label': 'Employee shift' },
    el('option', { value: '', selected: !record?.shift }, 'Not set'),
    el('option', { value: 'DAY', selected: record?.shift === 'DAY' }, 'Day · 07:00–15:30'),
    el('option', { value: 'AFTERNOON', selected: record?.shift === 'AFTERNOON' }, 'Afternoon · 15:30–00:00'));
  const role = el('select.employee-role-input', { 'aria-label': 'Employee role' },
    legacy ? el('option', { value: '', selected: true, disabled: true }, 'Choose a role') : null,
    ...EMPLOYEE_ROLES.map((key) => el('option', {
      value: key,
      selected: !legacy && (record?.role || 'EMPLOYEE') === key,
    }, EMPLOYEE_ROLE_LABELS[key])));
  const active = el('input.employee-active-input', { type: 'checkbox', checked: record?.active !== false });
  const access = el('input.employee-access-input', { type: 'checkbox', checked: !legacy && !!record?.appAccess });
  const accessTitle = el('strong', {}, 'Show in app user picker');
  const accessHelp = el('span', {}, 'Only lead hands, supervisors and managers can be enabled.');
  const error = el('div.banner.bad.employee-form-error', { role: 'alert', hidden: true });

  const syncAccess = () => {
    const eligible = active.checked && ['LEAD_HAND', 'SUPERVISOR', 'MANAGER'].includes(role.value);
    access.disabled = !eligible;
    if (!eligible) access.checked = false;
    accessTitle.textContent = eligible ? 'Show in app user picker' : 'Directory only';
    accessHelp.textContent = !active.checked
      ? 'Inactive employees cannot use the tracker.'
      : role.value === 'EMPLOYEE' || !role.value
        ? 'Employees stay in the directory and assignment lists, but not the tracker user picker.'
        : 'Enabled people appear in the “Who are you?” picker on every synced device.';
  };
  role.addEventListener('change', syncAccess);
  active.addEventListener('change', syncAccess);
  syncAccess();

  const body = el('div.employee-editor', {},
    legacy ? el('div.banner.warn', {}, icon('alert', { size: 17 }),
      el('span', {}, 'This name came from the older user list. Choose the person’s real role before saving.')) : null,
    error,
    el('div.employee-form-grid', {},
      el('label.field.employee-form-name', {}, el('span', {}, 'Name'), name),
      el('label.field', {}, el('span', {}, 'Department'), department),
      el('label.field', {}, el('span', {}, 'Shift'), shift),
      el('label.field', {}, el('span', {}, 'Role'), role)),
    el('div.employee-permissions', {},
      el('label.employee-check', {}, active,
        el('span', {}, el('strong', {}, 'Active employee'),
          el('span', {}, 'Inactive people remain in history but disappear from current assignment lists.'))),
      el('label.employee-check', {}, access,
        el('span', {}, accessTitle, accessHelp))));

  const actions = [];
  if (editing) actions.push({
    label: 'Archive employee', class: 'danger', onClick: async (dlg) => {
      const confirmed = await confirmDialog(
        `Archive ${record.name}?`,
        'The employee will leave the directory, assignment lists and tracker user picker. Existing production history will remain unchanged.',
        { confirmLabel: 'Archive', danger: true });
      if (!confirmed) return;
      archiveEmployee(record);
      dlg.close();
      toast(`${record.name} archived`);
      rerender();
    },
  });
  actions.push({
    label: editing ? 'Save changes' : 'Add employee', class: 'primary', onClick: (dlg) => {
      error.hidden = true;
      if (!role.value) {
        error.textContent = 'Choose the employee’s role.';
        error.hidden = false;
        role.focus();
        return;
      }
      try {
        const saved = upsertEmployee({
          id: record?.id,
          originalName: record?.name,
          aliases: record?.aliases,
          name: name.value,
          department: department.value,
          shift: shift.value,
          role: role.value,
          active: active.checked,
          appAccess: access.checked,
        });
        dlg.close();
        toast(`${saved.name} ${editing ? 'updated' : 'added'}`);
        rerender();
      } catch (saveError) {
        error.textContent = saveError.message;
        error.hidden = false;
      }
    },
  });

  const dlg = modal(editing ? 'Edit employee' : 'Add employee', body, { actions, origin });
  requestAnimationFrame(() => name.focus());
  return dlg;
}

function employeeCard(record, rerender) {
  const access = employeeCanUseApp(record);
  const current = me() === record.name;
  const meta = [record.department || 'Department not set', shiftLabel(record.shift)].join(' · ');
  return el('article.employee-card' + (current ? '.current' : '') + (!record.active ? '.inactive' : ''), {},
    el('span.employee-avatar', { 'aria-hidden': 'true' }, initials(record.name)),
    el('div.employee-name', {},
      el('strong', {}, record.name),
      el('span', {}, meta),
      el('div.employee-badges', {},
        el('span.chip.' + (record.legacy ? 'warn' : 'mute'), {}, roleLabel(record)),
        !record.active
          ? el('span.chip.bad', {}, 'Inactive')
          : access
            ? el('span.chip.ok', {}, 'App user')
            : el('span.chip.mute', {}, 'Directory only'))),
    el('div.employee-actions', {},
      el('button.employee-edit', {
        type: 'button', 'aria-label': `Edit ${record.name}`,
        onclick: (event) => openEmployeeEditor(record, rerender, event.currentTarget),
      }, icon('pencil', { size: 16 }), 'Edit'),
      access
        ? current
          ? el('span.employee-current', {}, icon('check', { size: 15 }), 'Current app user')
          : el('button.employee-use', {
              type: 'button',
              'aria-label': `Use tracker as ${record.name}`,
              onclick: () => {
                setCurrentAppUser(record.name);
                toast(`Tracker is now set to ${record.name}`);
                rerender();
              },
            }, 'Use as this person')
        : null));
}

function scopeButton(key, label, count, rerender) {
  return el('button.employee-scope' + (view.scope === key ? '.on' : ''), {
    type: 'button',
    'aria-pressed': String(view.scope === key),
    onclick: () => { view.scope = key; rerender(); },
  }, label, el('span', {}, String(count)));
}

export function renderEmployees(rerender) {
  const records = employeeDirectory();
  const appUsers = records.filter(employeeCanUseApp);
  const inactive = records.filter((record) => !record.active);
  const query = view.q.trim().toLocaleLowerCase();
  const scoped = view.scope === 'access' ? appUsers
    : view.scope === 'inactive' ? inactive : records;
  const shown = query ? scoped.filter((record) => [
    record.name, record.department, shiftLabel(record.shift), roleLabel(record),
  ].some((value) => String(value || '').toLocaleLowerCase().includes(query))) : scoped;

  return el('div.centre.employees-page', {},
    el('div.centre-head', {},
      el('div.row.centre-title-row', {},
        el('div.centre-ident', {},
          el('span.centre-rail', { 'aria-hidden': 'true' }),
          el('div', {},
            el('h1.centre-title', {}, 'Employees'),
            el('div.centre-sub', {}, `${records.length} in directory · ${appUsers.length} tracker user${appUsers.length === 1 ? '' : 's'} · this device: ${me()}`))))),

    el('section.employee-summary', { 'aria-label': 'Employee directory summary' },
      el('div', {}, el('strong', {}, fmtNum(records.length)), el('span', {}, 'Employees')),
      el('div', {}, el('strong', {}, fmtNum(appUsers.length)), el('span', {}, 'Tracker users')),
      el('div', {}, el('strong', {}, fmtNum(inactive.length)), el('span', {}, 'Inactive'))),

    el('section.panel.employee-tools', {},
      el('header', {}, icon('users', { size: 17 }), el('h2', {}, 'Department directory')),
      el('div.body.employee-toolbar', {},
        el('label.employee-search', {},
          el('span', {}, 'Find an employee'),
          el('span.employee-input', {}, icon('search', { size: 17 }),
            el('input', {
              type: 'search', value: view.q, placeholder: 'Search name, department or role',
              oninput: (event) => { view.q = event.target.value; rerender(); },
            }))),
        el('div.employee-tool-actions', {},
          el('button.employee-add-open.primary', {
            type: 'button', onclick: (event) => openEmployeeEditor(null, rerender, event.currentTarget),
          }, icon('plus', { size: 17 }), 'Add employee'),
          el('button.employee-import', { type: 'button', onclick: () => chooseCrewFile(rerender) },
            icon('upload', { size: 17 }), 'Import Abhay’s crew'))),
      el('div.employee-scopes', { role: 'group', 'aria-label': 'Filter employees' },
        scopeButton('all', 'All', records.length, rerender),
        scopeButton('access', 'Tracker users', appUsers.length, rerender),
        scopeButton('inactive', 'Inactive', inactive.length, rerender))),

    records.length
      ? el('div.employee-grid', {},
          ...shown.map((record) => employeeCard(record, rerender)),
          !shown.length ? el('div.empty.employee-empty', {},
            el('h3', {}, 'No matching employee'),
            el('p', {}, 'Try a shorter search or another filter.')) : null)
      : el('div.panel', {}, el('div.empty', {},
          el('div.empty-icon', {}, icon('users', { size: 28 })),
          el('h3', {}, 'No employees yet'),
          el('p', {}, 'Add one person or import Abhay’s crew from the internal workbook.'))),

    el('div.employee-privacy', {},
      icon('cloud', { size: 16 }),
      el('span', {}, 'The directory syncs name, department, shift, role and app-user status. The picker is not a login. Roster files, employee IDs and HR details are never uploaded or built into the public website.')));
}
