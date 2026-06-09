const KEY_TASKS = 'brave_tasks';
const KEY_PROJECTS = 'brave_projects';
const KEY_NOTIFIED = 'brave_tasks_notified';
const KEY_THEME = 'brave_theme';

function toLocalISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function nextDate(recurrence, from) {
  const d = new Date(from);
  if (recurrence === 'daily') d.setDate(d.getDate() + 1);
  if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
  return toLocalISO(d);
}

async function loadTasks() {
  const r = await chrome.storage.sync.get(KEY_TASKS);
  return r[KEY_TASKS] || [];
}

async function saveTasks(tasks) {
  await chrome.storage.sync.set({ [KEY_TASKS]: tasks });
  const pending = tasks.filter(t => !t.done).length;
  chrome.action.setBadgeText({ text: pending > 0 ? String(pending) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#4a9e4f' });
}

async function loadProjects() {
  const r = await chrome.storage.sync.get(KEY_PROJECTS);
  return r[KEY_PROJECTS] || [];
}

async function saveProjects(projects) {
  await chrome.storage.sync.set({ [KEY_PROJECTS]: projects });
}

async function loadNotified() {
  const r = await chrome.storage.local.get(KEY_NOTIFIED);
  return r[KEY_NOTIFIED] || [];
}

async function saveNotified(list) {
  await chrome.storage.local.set({ [KEY_NOTIFIED]: list });
}

// ── Theme ──

function setThemeIcon(theme) {
  const s = theme === 'dark' ? '-white' : '';
  chrome.action.setIcon({
    path: {
      16: `icons/icon16${s}.png`,
      48: `icons/icon48${s}.png`,
      128: `icons/icon128${s}.png`,
    }
  });
}

async function loadTheme() {
  const r = await chrome.storage.local.get(KEY_THEME);
  setThemeIcon(r[KEY_THEME] || 'light');
}

async function saveTheme(theme) {
  await chrome.storage.local.set({ [KEY_THEME]: theme });
  setThemeIcon(theme);
}

// ── Tasks ──

async function addTask(text, opts) {
  const tasks = await loadTasks();
  tasks.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text, done: false, createdAt: Date.now(),
    dueDate: opts.dueDate || null,
    reminder: opts.reminder !== undefined ? opts.reminder : !!opts.dueDate,
    reminderOffset: opts.reminderOffset !== undefined ? opts.reminderOffset : (opts.dueDate ? 1440 : null),
    recurrence: opts.recurrence || null,
    project: opts.project || null,
  });
  await saveTasks(tasks);
}

async function updateTask(id, changes) {
  const tasks = await loadTasks();
  const task = tasks.find(t => t.id === id);
  if (task) Object.assign(task, changes);
  await saveTasks(tasks);
}

async function toggleTask(id) {
  const tasks = await loadTasks();
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  task.done = !task.done;

  if (!task.done || !task.recurrence || !task.dueDate) {
    await saveTasks(tasks);
    return;
  }

  // Phase 1: save the toggled task as done
  await saveTasks(tasks);

  // Phase 2: load fresh and add the next occurrence
  const fresh = await loadTasks();
  fresh.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: task.text, done: false, createdAt: Date.now(),
    dueDate: nextDate(task.recurrence, task.dueDate),
    reminder: task.reminder,
    reminderOffset: task.reminderOffset,
    recurrence: task.recurrence,
    project: task.project,
  });
  await saveTasks(fresh);
}

async function deleteTask(id) {
  const tasks = await loadTasks();
  await saveTasks(tasks.filter(t => t.id !== id));
}

async function deleteDone() {
  const tasks = await loadTasks();
  await saveTasks(tasks.filter(t => !t.done));
}

async function addProject(name) {
  const projects = await loadProjects();
  if (!projects.includes(name)) {
    projects.push(name);
    await saveProjects(projects);
  }
}

async function renameProject(oldName, newName) {
  const [projects, tasks] = await Promise.all([loadProjects(), loadTasks()]);
  const prefix = oldName + '/';
  let changed = false;
  for (let i = 0; i < projects.length; i++) {
    if (projects[i] === oldName || projects[i].startsWith(prefix)) {
      projects[i] = projects[i] === oldName ? newName : newName + projects[i].slice(prefix.length - 1);
      changed = true;
    }
  }
  tasks.forEach(t => {
    if (t.project === oldName) { t.project = newName; changed = true; }
    else if (t.project && t.project.startsWith(prefix)) {
      t.project = newName + '/' + t.project.slice(prefix.length);
      changed = true;
    }
  });
  if (changed) await Promise.all([saveProjects(projects), saveTasks(tasks)]);
}

async function deleteProject(name) {
  const [projects, tasks] = await Promise.all([loadProjects(), loadTasks()]);
  const prefix = name + '/';
  const filtered = projects.filter(p => p !== name && !p.startsWith(prefix));
  tasks.forEach(t => {
    if (t.project === name || (t.project && t.project.startsWith(prefix))) t.project = null;
  });
  await Promise.all([saveProjects(filtered), saveTasks(tasks)]);
}

async function checkReminders() {
  const tasks = await loadTasks();
  let notified = await loadNotified();
  const now = Date.now();
  let changed = false;

  for (const task of tasks) {
    if (task.done || !task.dueDate || !task.reminder) continue;
    if (notified.includes(task.id)) continue;

    const due = new Date(task.dueDate).getTime();
    const remindAt = due - (task.reminderOffset ?? 1440) * 60000;
    if (now < remindAt) continue;

    const daysLeft = Math.ceil((due - now) / 86400000);
    const title = daysLeft < 0 ? '🕐 Vencida' : daysLeft === 0 ? '⏰ Vence hoy' : '📅 Recordatorio';
    const dt = new Date(task.dueDate);
    const p = n => String(n).padStart(2,'0');
    const dueStr = `${p(dt.getDate())}/${p(dt.getMonth()+1)} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
    let message = `"${task.text}"`;
    if (daysLeft < 0) message += ` venció el ${dueStr}`;
    else if (daysLeft > 0) message += ` — ${daysLeft}d restantes (${dueStr})`;
    if (task.project) message += ` [${task.project}]`;

    chrome.notifications.create(task.id, {
      type: 'basic', iconUrl: 'icons/icon128.png',
      title, message, priority: 2,
      buttons: [{ title: 'Completada' }],
    });

    notified.push(task.id);
    changed = true;
  }
  if (changed) await saveNotified(notified);
}

// ── Alarms ──

chrome.runtime.onInstalled.addListener(() => {
  loadTheme();
  chrome.alarms.create('reminderCheck', { periodInMinutes: 1 });
  chrome.alarms.create('cleanup', { periodInMinutes: 1440 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'reminderCheck') await checkReminders();
  if (alarm.name === 'cleanup') {
    const tasks = await loadTasks();
    const old = tasks.filter(t => t.done && Date.now() - t.createdAt > 7 * 86400000);
    if (old.length) await saveTasks(tasks.filter(t => !old.includes(t)));
  }
});

chrome.notifications.onButtonClicked.addListener(async (id) => {
  await toggleTask(id);
  chrome.notifications.clear(id);
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
  chrome.runtime.openOptionsPage();
});

// ── Message handler ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    GET_TASKS: () => loadTasks(),
    ADD_TASK: () => addTask(msg.text, msg),
    UPDATE_TASK: () => updateTask(msg.id, msg.changes),
    TOGGLE_TASK: () => toggleTask(msg.id),
    DELETE_TASK: () => deleteTask(msg.id),
    DELETE_DONE: () => deleteDone(),
    GET_PROJECTS: () => loadProjects(),
    ADD_PROJECT: () => addProject(msg.name),
    RENAME_PROJECT: () => renameProject(msg.oldName, msg.newName),
    DELETE_PROJECT: () => deleteProject(msg.name),
    SET_THEME: () => saveTheme(msg.theme),
  };
  const fn = handlers[msg.type];
  if (fn) { fn().then(sendResponse); return true; }
});
