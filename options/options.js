const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let tasks = [], projects = [], filter = 'all', editing = null;

function send(msg) { return chrome.runtime.sendMessage(msg); }

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s; return d.innerHTML;
}

function modalConfirm(msg) {
  return new Promise(resolve => {
    $('#modalBody').textContent = msg;
    $('#modal').classList.add('show');
    const done = v => { $('#modal').classList.remove('show'); resolve(v); };
    $('#modalConfirm').onclick = () => done(true);
    $('#modalCancel').onclick = () => done(false);
    $('#modal').onclick = e => { if (e.target === $('#modal')) done(false); };
  });
}

function modalPrompt(msg, val) {
  return new Promise(resolve => {
    $('#modalBody').innerHTML = `<p>${esc(msg)}</p><input type="text" id="modalInput" value="${esc(val||'')}">`;
    $('#modal').classList.add('show');
    const done = v => { $('#modal').classList.remove('show'); resolve(v); };
    $('#modalConfirm').onclick = () => done($('#modalInput').value.trim() || null);
    $('#modalCancel').onclick = () => done(null);
    $('#modal').onclick = e => { if (e.target === $('#modal')) done(null); };
    setTimeout(() => $('#modalInput').focus(), 100);
    $('#modalInput').onkeydown = e => {
      if (e.key === 'Enter') done(e.target.value.trim() || null);
      if (e.key === 'Escape') done(null);
    };
  });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const n = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((a - b) / 86400000);
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toLocalInputDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dueLabel(dateStr) {
  const d = daysUntil(dateStr);
  if (d === null) return '';
  if (d < 0) return `🔴 Vencida hace ${-d}d`;
  if (d === 0) return '🔴 Vence hoy';
  if (d === 1) return '🟡 Vence mañana';
  if (d <= 7) return `🟢 En ${d} días`;
  return `📅 ${fmtDateTime(dateStr)}`;
}

const RECUR = { daily:'Diaria', weekly:'Semanal', monthly:'Mensual' };
const OFFSET = { '-1':'Sin recordatorio', 0:'Al vencer', 30:'30 min', 60:'1 h', 120:'2 h',
  360:'6 h', 720:'12 h', 1440:'1 d', 2880:'2 d', 4320:'3 d', 10080:'1 sem' };

async function load() {
  [tasks, projects] = await Promise.all([
    send({type:'GET_TASKS'}), send({type:'GET_PROJECTS'}),
  ]);
  renderProjects();
  renderTasks();
  populateProjectSelect();
}

// Projects
function buildTree(paths) {
  const root = { name: '', children: {}, path: '' };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (const part of parts) {
      if (!node.children[part]) node.children[part] = { name: part, children: {}, path: node.path ? node.path + '/' + part : part };
      node = node.children[part];
    }
  }
  return root;
}

function countPendingIn(path) {
  if (!path) return tasks.filter(t => !t.done).length;
  return tasks.filter(t => !t.done && (t.project === path || (t.project && t.project.startsWith(path + '/')))).length;
}

function renderTaskRow(t, depth) {
  const due = dueLabel(t.dueDate);
  return `<div class="project-task" data-id="${t.id}" style="padding-left:${32 + depth * 18}px">
    <span class="pt-check${t.done?' done':''}"></span>
    <span class="pt-text${t.done?' done':''}">${esc(t.text)}</span>
    ${due ? `<span class="pt-due">${due}</span>` : ''}
    ${t.recurrence ? '<span class="pt-recur">↻</span>' : ''}
  </div>`;
}

function renderTree(node, depth) {
  const entries = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
  let html = '';
  for (const child of entries) {
    const directTasks = tasks.filter(t => !t.done && t.project === child.path);
    const hasChildren = Object.keys(child.children).length > 0;
    const hasContent = hasChildren || directTasks.length > 0;
    const totalPending = countPendingIn(child.path);

    html += `<div class="project-node" data-path="${esc(child.path)}" style="padding-left:${12 + depth * 18}px">
      <span class="toggle">${hasContent ? '▼' : '·'}</span>
      <span class="name">${esc(child.name)}</span>
      ${totalPending > 0 ? `<span class="count">${totalPending}</span>` : ''}
      <span class="project-actions">
        <button class="add-sub" title="Añadir subproyecto" aria-label="Añadir subproyecto a ${esc(child.name)}">+</button>
        <button class="rename" title="Renombrar" aria-label="Renombrar ${esc(child.name)}">✏️</button>
        <button class="del" title="Eliminar" aria-label="Eliminar ${esc(child.name)}">✕</button>
      </span>
    </div>
    <div class="project-children">`;

    for (const t of directTasks) html += renderTaskRow(t, depth);
    if (hasChildren) html += renderTree(child, depth + 1);

    html += `</div>`;
  }
  return html;
}

function renderProjects() {
  const tree = buildTree(projects);
  $('#projectList').innerHTML = renderTree(tree, 0);
  const sel = $('#parentProject');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Raíz</option>' +
    projects.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  sel.value = cur;
}

$('#addProjectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#projectInput').value.trim();
  if (!name) return;
  const parent = $('#parentProject').value;
  const fullName = parent ? parent + '/' + name : name;
  await send({type:'ADD_PROJECT', name: fullName});
  $('#projectInput').value = '';
  load();
});

$('#projectList').addEventListener('click', async (e) => {
  const taskEl = e.target.closest('.project-task');
  if (taskEl) {
    await send({type:'TOGGLE_TASK', id: taskEl.dataset.id});
    return load();
  }

  const btn = e.target.closest('.project-actions button');
  const node = e.target.closest('.project-node');
  if (!node) return;
  const path = node.dataset.path;

  if (!btn) {
    const ch = node.nextElementSibling;
    if (ch && ch.classList.contains('project-children')) {
      ch.classList.toggle('collapsed');
      const tog = node.querySelector('.toggle');
      if (tog && ch.classList.contains('collapsed')) tog.textContent = '▶';
      else if (tog) tog.textContent = '▼';
    }
    return;
  }

  e.stopPropagation();
  if (btn.classList.contains('del')) {
    const ok = await modalConfirm(`¿Eliminar "${path}" y todos sus subproyectos?`);
    if (!ok) return;
    await send({type:'DELETE_PROJECT', name: path});
    return load();
  }
  if (btn.classList.contains('rename')) {
    const n = await modalPrompt('Nuevo nombre:', path.split('/').pop());
    if (!n || n === path.split('/').pop()) return;
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const newPath = parentPath ? parentPath + '/' + n : n;
    await send({type:'RENAME_PROJECT', oldName: path, newName: newPath});
    return load();
  }
  if (btn.classList.contains('add-sub')) {
    const name = await modalPrompt('Nombre del subproyecto:');
    if (!name) return;
    await send({type:'ADD_PROJECT', name: path + '/' + name});
    return load();
  }
});

// Tasks
function filtered() {
  let f = [...tasks];
  if (filter === 'pending') f = f.filter(t => !t.done);
  if (filter === 'overdue') f = f.filter(t => !t.done && daysUntil(t.dueDate) !== null && daysUntil(t.dueDate) < 0);
  if (filter === 'done') f = f.filter(t => t.done);
  f.sort((a,b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (daysUntil(a.dueDate)??999) - (daysUntil(b.dueDate)??999);
  });
  return f;
}

function renderTasks() {
  const f = filtered();
  const p = tasks.filter(t => !t.done).length;
  $('#taskInfo').textContent = `${p} pendientes · ${f.length} mostradas`;

  if (!tasks.length) {
    $('#taskList').innerHTML = '<div class="empty-state"><span>📋</span>Añade tu primera tarea arriba</div>';
    return;
  }

  $('#taskList').innerHTML = f.map(t => {
    const isOver = !t.done && daysUntil(t.dueDate) !== null && daysUntil(t.dueDate) < 0;
    const due = dueLabel(t.dueDate);
    return `<div class="task-item${t.done?' done':''}${isOver?' overdue':''}" data-id="${t.id}">
      <div class="task-check${t.done?' checked':''}" role="checkbox" tabindex="0" aria-checked="${t.done}" aria-label="Marcar como ${t.done ? 'pendiente' : 'completada'}: ${esc(t.text)}"></div>
      <span class="task-text">${esc(t.text)}</span>
      <span class="task-meta">
        ${t.project ? `<span class="mtag project">${esc(t.project)}</span>` : ''}
        ${t.recurrence ? `<span class="mtag recurrence">${RECUR[t.recurrence]}</span>` : ''}
        ${due ? `<span class="mtag ${isOver?'overdue':'due'}">${due}</span>` : ''}
      </span>
      <span class="task-actions">
        <button class="edit" title="Editar">✏️</button>
        <button class="del" title="Eliminar">✕</button>
      </span>
    </div>${editing === t.id ? editor(t) : ''}`;
  }).join('');
}

function editor(t) {
  const eid = 'e' + t.id;
  return `<div class="inline-editor">
    <div class="field wide">
      <label for="${eid}-text">Nombre</label>
      <input type="text" class="edit-text" id="${eid}-text" value="${esc(t.text)}">
    </div>
    <div class="field">
      <label for="${eid}-date">Fecha límite</label>
      <input type="datetime-local" class="edit-date" id="${eid}-date" value="${toLocalInputDate(t.dueDate)}">
    </div>
    <div class="field">
      <label for="${eid}-offset">Recordatorio</label>
      <select class="edit-offset" id="${eid}-offset">${Object.entries(OFFSET).map(([v,l]) => {
        const sel = !t.reminder ? v === '-1' : (t.reminderOffset??1440)==v;
        return `<option value="${v}"${sel?' selected':''}>${l}</option>`;
      }).join('')}</select>
    </div>
    <div class="field">
      <label for="${eid}-recur">Repetición</label>
      <select class="edit-recur" id="${eid}-recur">
        <option value="">Sin repetición</option>
        ${Object.entries(RECUR).map(([k,l]) =>
          `<option value="${k}"${t.recurrence===k?' selected':''}>${l}</option>`
        ).join('')}
      </select>
    </div>
    <div class="field">
      <label for="${eid}-proj">Proyecto</label>
      <select class="edit-project" id="${eid}-proj">
        <option value="">Sin proyecto</option>
        ${projects.map(p => `<option value="${esc(p)}"${t.project===p?' selected':''}>${esc(p)}</option>`).join('')}
      </select>
    </div>
    <div class="editor-actions">
      <button class="save">Guardar</button>
      <button class="cancel">Cancelar</button>
    </div>
  </div>`;
}

function populateProjectSelect() {
  $('#addProject').innerHTML = '<option value="">Sin proyecto</option>' +
    projects.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
}

// Events
$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#addText').value.trim();
  if (!text) return;
  const offset = parseInt($('#addOffset').value);
  await send({type:'ADD_TASK', text,
    dueDate: $('#addDate').value || null,
    reminderOffset: offset === -1 ? null : offset,
    reminder: offset !== -1 && !!$('#addDate').value,
    recurrence: $('#addRecur').value || null,
    project: $('#addProject').value || null,
  });
  $('#addText').value = '';
  $('#addDate').value = '';
  $('#addRecur').value = '';
  $('#addProject').value = '';
  $('#addText').focus();
  load();
  toast('Tarea añadida');
});

$('#toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  filter = btn.dataset.filter;
  $$('[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
  renderTasks();
});

$('#taskList').addEventListener('click', async (e) => {
  if (e.target.closest('.save')) {
    const ed = e.target.closest('.inline-editor');
    if (!ed) return;
    const item = ed.previousElementSibling;
    if (!item || !item.dataset.id) return;
    const off = parseInt(ed.querySelector('.edit-offset').value);
    const due = ed.querySelector('.edit-date').value || null;
    await send({type:'UPDATE_TASK', id: item.dataset.id, changes: {
      text: ed.querySelector('.edit-text').value.trim(),
      dueDate: due,
      reminderOffset: off === -1 ? null : off,
      recurrence: ed.querySelector('.edit-recur').value || null,
      project: ed.querySelector('.edit-project').value || null,
      reminder: off !== -1 && !!due,
    }});
    editing = null;
    load();
    toast('Actualizada');
    return;
  }

  if (e.target.closest('.cancel')) {
    editing = null;
    renderTasks();
    return;
  }

  const item = e.target.closest('.task-item');
  if (!item) return;
  const id = item.dataset.id;

  if (e.target.closest('.task-check')) {
    await send({type:'TOGGLE_TASK', id});
    return load();
  }
  if (e.target.closest('.del')) {
    await send({type:'DELETE_TASK', id});
    load();
    return toast('Eliminada');
  }
  if (e.target.closest('.edit') || e.target.classList.contains('task-text')) {
    editing = editing === id ? null : id;
    return renderTasks();
  }
});

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// Tabs
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  $$('.tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  $$('.tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  const tab = document.getElementById('tab-' + btn.dataset.tab);
  if (tab) tab.classList.add('active');
  if (btn.dataset.tab === 'tasks') renderTasks();
  if (btn.dataset.tab === 'projects') renderProjects();
});

load();
