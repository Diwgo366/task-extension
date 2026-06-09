const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
chrome.runtime.sendMessage({ type: 'SET_THEME', theme: dark ? 'dark' : 'light' });

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

let tasks = [], projects = [];
let selectedProject = '';

function formatDays(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const n = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((a - b) / 86400000);
}

function daysLabel(dateStr) {
  const d = formatDays(dateStr);
  if (d === null) return '';
  if (d < 0) return `🔴${-d}d`;
  if (d === 0) return '🔴hoy';
  if (d === 1) return '🟡1d';
  return `🟢${d}d`;
}

const GROUP_DEFS = [
  { key: 'overdue',  label: 'Vencidas',     dot: 'danger',  test: d => d < 0 },
  { key: 'today',    label: 'Vence hoy',    dot: 'danger',  test: d => d === 0 },
  { key: 'tomorrow', label: 'Vence mañana', dot: 'warning', test: d => d === 1 },
  { key: 'week',     label: 'Esta semana',  dot: 'accent',  test: d => d >= 2 && d <= 7 },
  { key: 'future',   label: 'Próximas',     dot: 'dim',     test: d => d > 7 },
  { key: 'nodate',   label: 'Sin fecha',    dot: 'dim',     test: d => d === null },
];

function populateProjectFilter() {
  const sel = document.getElementById('projectFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos los proyectos</option>' +
    projects.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
  sel.value = cur;
}

async function load() {
  const r = await Promise.all([
    send({ type: 'GET_TASKS' }),
    send({ type: 'GET_PROJECTS' }),
  ]);
  tasks = r[0];
  projects = r[1];
  populateProjectFilter();
  render();
}

function render() {
  let pending = tasks.filter(t => !t.done);
  const total = tasks.length;

  if (selectedProject) {
    pending = pending.filter(t => t.project === selectedProject || (t.project && t.project.startsWith(selectedProject + '/')));
  }

  document.getElementById('meta').textContent =
    `${pending.length}/${total}`;

  const groups = {};
  for (const g of GROUP_DEFS) groups[g.key] = [];

  for (const t of pending) {
    const days = formatDays(t.dueDate);
    const group = GROUP_DEFS.find(g => g.test(days));
    if (group) groups[group.key].push(t);
  }

  let html = '';
  for (const g of GROUP_DEFS) {
    const items = groups[g.key];
    if (items.length === 0) continue;

    items.sort((a, b) => {
      const aD = formatDays(a.dueDate) ?? 999;
      const bD = formatDays(b.dueDate) ?? 999;
      return aD - bD;
    });

    html += `<div class="day-group">
      <div class="day-header">
        <span class="dot ${g.dot}"></span>
        ${g.label}
        <span class="count">${items.length}</span>
      </div>`;

    for (const t of items) {
      const daysLeft = daysLabel(t.dueDate);
      html += `<div class="task-row" data-id="${t.id}">
        <div class="task-check" role="checkbox" tabindex="0" aria-checked="false" aria-label="Marcar como completada: ${escHtml(t.text)}"></div>
        <span class="task-text" title="${escHtml(t.text)}">${escHtml(t.text)}</span>
        <span class="task-tags">
          ${daysLeft ? `<span class="tag days">${daysLeft}</span>` : ''}
          ${t.project ? `<span class="tag project">${escHtml(t.project)}</span>` : ''}
          ${t.recurrence ? '<span class="tag recurrence">↻</span>' : ''}
        </span>
      </div>`;
    }

    html += `</div>`;
  }

  if (!html) {
    const hasTasks = total > 0;
    html = `<div class="empty-state">
      <span>${hasTasks ? '✅' : '📋'}</span>
      ${hasTasks ? 'Todas completadas' : 'No hay tareas'}
      ${!hasTasks ? '<div class="sub">Añade desde la <a href="#" id="goOptions">gestión</a></div>' : ''}
    </div>`;
  }

  document.getElementById('groups').innerHTML = html;

  const goOpts = document.getElementById('goOptions');
  if (goOpts) goOpts.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

document.getElementById('groups').addEventListener('click', async (e) => {
  const check = e.target.closest('.task-check');
  if (!check) return;
  const row = check.closest('.task-row');
  if (!row) return;
  check.classList.add('checked');
  await send({ type: 'TOGGLE_TASK', id: row.dataset.id });
  load();
});

document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('projectFilter').addEventListener('change', (e) => {
  selectedProject = e.target.value;
  render();
});

load();
