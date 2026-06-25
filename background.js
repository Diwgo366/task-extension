const KEY_TASKS = 'brave_tasks';
const KEY_PROJECTS = 'brave_projects';
const KEY_THEME = 'brave_theme';

// ── Time helpers ──

function localInputToUTC(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function nextDate(recurrence, from, recurrenceDays) {
  const d = new Date(from);
  if (recurrence === 'daily') {
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }
  if (recurrence === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString();
  }
  if (recurrence === 'weekly-days') {
    if (!recurrenceDays) {
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString();
    }
    const days = recurrenceDays.split(',').map(Number).sort((a, b) => a - b);
    const currentDay = d.getUTCDay();
    const nextDay = days.find(day => day > currentDay);
    if (nextDay === undefined) {
      d.setUTCDate(d.getUTCDate() + (7 - currentDay + days[0]));
    } else {
      d.setUTCDate(d.getUTCDate() + (nextDay - currentDay));
    }
    return d.toISOString();
  }
  if (recurrence === 'monthly') {
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString();
  }
  return d.toISOString();
}

// ── Storage helpers with error handling ──

async function storageSyncGet(key) {
  try {
    return await chrome.storage.sync.get(key);
  } catch (e) {
    console.error('[Mis Tareas] Error reading from sync:', e);
    return {};
  }
}

async function storageSyncSet(obj) {
  try {
    await chrome.storage.sync.set(obj);
  } catch (e) {
    console.error('[Mis Tareas] Error writing to sync:', e);
    throw e;
  }
}

async function storageLocalGet(key) {
  try {
    return await chrome.storage.local.get(key);
  } catch (e) {
    console.error('[Mis Tareas] Error reading from local:', e);
    return {};
  }
}

async function storageLocalSet(obj) {
  try {
    await chrome.storage.local.set(obj);
  } catch (e) {
    console.error('[Mis Tareas] Error writing to local:', e);
    throw e;
  }
}

// ── Badge ──

async function updateBadge() {
  try {
    const tasks = await loadTasks();
    const pending = tasks.filter(t => !t.done).length;
    chrome.action.setBadgeText({ text: pending > 0 ? String(pending) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#4a9e4f' });
  } catch (e) {
    console.error('[Mis Tareas] updateBadge error:', e);
  }
}

// ── Optimistic concurrency ──

async function saveWithRetry(key, loadFn, modifyFn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const data = await loadFn();
    modifyFn(data);
    try {
      await storageSyncSet({ [key]: data });
      return;
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      console.warn(`[Mis Tareas] Retry ${attempt + 1} for ${key}:`, e.message);
    }
  }
}

// ── Data access ──

async function loadTasks() {
  const r = await storageSyncGet(KEY_TASKS);
  return r[KEY_TASKS] || [];
}

async function saveTasks(tasks) {
  await storageSyncSet({ [KEY_TASKS]: tasks });
  updateBadge();
}

async function loadProjects() {
  const r = await storageSyncGet(KEY_PROJECTS);
  return r[KEY_PROJECTS] || [];
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
  const r = await storageLocalGet(KEY_THEME);
  setThemeIcon(r[KEY_THEME] || 'light');
}

async function saveTheme(theme) {
  await storageLocalSet({ [KEY_THEME]: theme });
  setThemeIcon(theme);
}

// ── Tasks ──

async function addTask(text, opts) {
  await saveWithRetry(KEY_TASKS, loadTasks, (tasks) => {
    let dueDate = localInputToUTC(opts.dueDate);
    if (!dueDate && opts.recurrence) {
      const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
      dueDate = todayStart;
      let maxIters = 53;
      do {
        const prev = dueDate;
        dueDate = nextDate(opts.recurrence, dueDate, opts.recurrenceDays);
        if (dueDate === prev) break;
        maxIters--;
        if (maxIters <= 0) break;
      } while (dueDate <= todayStart);
    }
    tasks.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text, done: false, createdAt: Date.now(),
      dueDate,
      recurrence: opts.recurrence || null,
      recurrenceDays: opts.recurrenceDays || null,
      project: opts.project || null,
    });
  });
  updateBadge();
}

async function updateTask(id, changes) {
  await saveWithRetry(KEY_TASKS, loadTasks, (tasks) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    if (changes.dueDate !== undefined) {
      changes.dueDate = localInputToUTC(changes.dueDate);
    }
    Object.assign(task, changes);
  });
  updateBadge();
}

async function toggleTask(id) {
  await saveWithRetry(KEY_TASKS, loadTasks, (tasks) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    task.done = !task.done;

    if (task.done && task.recurrence) {
      const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
      let newDueDate = task.dueDate || todayStart;
      let maxIters = 53;
      do {
        const prev = newDueDate;
        newDueDate = nextDate(task.recurrence, newDueDate, task.recurrenceDays);
        if (newDueDate === prev) break;
        maxIters--;
        if (maxIters <= 0) break;
      } while (newDueDate <= todayStart);

      tasks.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: task.text, done: false, createdAt: Date.now(),
        dueDate: newDueDate,
        recurrence: task.recurrence,
        recurrenceDays: task.recurrenceDays || null,
        project: task.project,
      });
    }
  });
  updateBadge();
}

async function deleteTask(id) {
  await saveWithRetry(KEY_TASKS, loadTasks, (tasks) => {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx !== -1) tasks.splice(idx, 1);
  });
  updateBadge();
}

async function deleteDone() {
  await saveWithRetry(KEY_TASKS, loadTasks, (tasks) => {
    for (let i = tasks.length - 1; i >= 0; i--) {
      if (tasks[i].done) tasks.splice(i, 1);
    }
  });
  updateBadge();
}

// ── Projects ──

async function addProject(name) {
  await saveWithRetry(KEY_PROJECTS, loadProjects, (projects) => {
    if (!projects.includes(name)) projects.push(name);
  });
}

async function renameProject(oldName, newName) {
  const prefix = oldName + '/';

  await saveWithRetry(KEY_PROJECTS, loadProjects, (projects) => {
    for (let i = 0; i < projects.length; i++) {
      if (projects[i] === oldName || projects[i].startsWith(prefix)) {
        projects[i] = projects[i] === oldName ? newName : newName + projects[i].slice(prefix.length - 1);
      }
    }
  });

  await saveWithRetry(KEY_TASKS, loadTasks, (tasks) => {
    tasks.forEach(t => {
      if (t.project === oldName) { t.project = newName; }
      else if (t.project && t.project.startsWith(prefix)) {
        t.project = newName + '/' + t.project.slice(prefix.length);
      }
    });
  });
  updateBadge();
}

async function deleteProject(name) {
  const prefix = name + '/';

  await saveWithRetry(KEY_PROJECTS, loadProjects, (projects) => {
    const filtered = projects.filter(p => p !== name && !p.startsWith(prefix));
    projects.length = 0;
    projects.push(...filtered);
  });

  await saveWithRetry(KEY_TASKS, loadTasks, (tasks) => {
    tasks.forEach(t => {
      if (t.project === name || (t.project && t.project.startsWith(prefix))) t.project = null;
    });
  });
  updateBadge();
}

// ── Alarms ──

chrome.runtime.onInstalled.addListener(() => {
  loadTheme();
  chrome.alarms.create('cleanup', { periodInMinutes: 1440 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cleanup') {
    const tasks = await loadTasks();
    const old = tasks.filter(t => t.done && Date.now() - t.createdAt > 7 * 86400000);
    if (old.length) await saveTasks(tasks.filter(t => !old.includes(t)));
  }
});

// ── Sync from other devices ──

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes[KEY_TASKS] || changes[KEY_PROJECTS])) {
    updateBadge();
    // Notify open views (options/popup) to refresh data when sync changes arrive from other devices
    chrome.runtime.sendMessage({ type: 'SYNC_UPDATED' }).catch(() => {});
  }
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
  if (fn) {
    fn().then(sendResponse).catch(e => {
      console.error('[Mis Tareas] Handler error:', msg.type, e);
      sendResponse({ error: e.message });
    });
    return true;
  }
  console.warn('[Mis Tareas] Unknown message type:', msg.type);
  sendResponse({ error: 'Unknown message type' });
});

updateBadge();
