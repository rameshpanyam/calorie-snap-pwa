/* =====================================================================
   Calorie Snap — app.js
   Core: IndexedDB, tab nav, settings, today/goal rendering, first-run.
   IMPORTANT: cross-script globals are declared with `var` so features.js
   can read them via window.* (lesson from Expense Tracker v25.3).
   ===================================================================== */

'use strict';

/* ───────────── Cross-script state (must be var) ───────────── */
var DB           = null;        // IndexedDB handle
var settings     = {};          // { geminiApiKey, units, ... }
var goals        = {};          // { kcalDaily, proteinDaily?, carbsDaily?, fatDaily? }
var todayMeals   = [];          // array of meal objects for today
var foodsDB      = [];          // [{ key, name, kcal_per_100g, p, c, f, default_g, cuisine }]
var customFoods  = [];          // user-saved meals
var pendingMeal  = null;        // staging area for AI/barcode/search result before "Log"

/* ───────────── Constants ───────────── */
var DB_NAME = 'calorieSnap';
var DB_VERSION = 1;
var STORES = ['meals', 'customFoods', 'goals', 'settings', 'foodsCache'];

/* ───────────── DB helpers ───────────── */
function openDB() {
  return new Promise((resolve, reject) => {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('meals'))       db.createObjectStore('meals',       { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('customFoods')) db.createObjectStore('customFoods', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('goals'))       db.createObjectStore('goals',       { keyPath: 'key' });
      if (!db.objectStoreNames.contains('settings'))    db.createObjectStore('settings',    { keyPath: 'key' });
      if (!db.objectStoreNames.contains('foodsCache'))  db.createObjectStore('foodsCache',  { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbTx(store, mode) {
  return DB.transaction(store, mode).objectStore(store);
}

function dbPut(store, obj) {
  return new Promise((resolve, reject) => {
    var r = dbTx(store, 'readwrite').put(obj);
    r.onsuccess = () => resolve(r.result);
    r.onerror   = () => reject(r.error);
  });
}

function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    var r = dbTx(store, 'readonly').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror   = () => reject(r.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    var r = dbTx(store, 'readonly').getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror   = () => reject(r.error);
  });
}

function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    var r = dbTx(store, 'readwrite').delete(key);
    r.onsuccess = () => resolve();
    r.onerror   = () => reject(r.error);
  });
}

function dbClear(store) {
  return new Promise((resolve, reject) => {
    var r = dbTx(store, 'readwrite').clear();
    r.onsuccess = () => resolve();
    r.onerror   = () => reject(r.error);
  });
}

/* ───────────── Pure helpers (exported for tests) ───────────── */
function ymd(d) {
  d = d || new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function mealTypeFromHour(hour) {
  if (hour < 5)  return 'dinner';   // post-midnight snacking → dinner
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 19) return 'snack';
  return 'dinner';
}

function sumItems(items) {
  var out = { kcal: 0, p: 0, c: 0, f: 0 };
  if (!items || !items.length) return out;
  for (var i = 0; i < items.length; i++) {
    out.kcal += +items[i].kcal || 0;
    out.p    += +items[i].p    || 0;
    out.c    += +items[i].c    || 0;
    out.f    += +items[i].f    || 0;
  }
  out.kcal = Math.round(out.kcal);
  out.p = Math.round(out.p * 10) / 10;
  out.c = Math.round(out.c * 10) / 10;
  out.f = Math.round(out.f * 10) / 10;
  return out;
}

function scaleItemToGrams(item, newGrams) {
  // item must have a per_100g or original grams reference
  var base = item.baseGrams || item.grams || 100;
  var ratio = newGrams / base;
  return {
    name:  item.name,
    grams: newGrams,
    baseGrams: base,
    kcal:  Math.round((item.kcal || 0) * ratio),
    p:     Math.round((item.p    || 0) * ratio * 10) / 10,
    c:     Math.round((item.c    || 0) * ratio * 10) / 10,
    f:     Math.round((item.f    || 0) * ratio * 10) / 10,
    source: item.source,
    confidence: item.confidence,
    notes: item.notes
  };
}

function kcalFromPerHundred(food, grams) {
  // food: { kcal_per_100g, p, c, f } per 100g
  var ratio = grams / 100;
  return {
    name:  food.name,
    grams: grams,
    baseGrams: grams,
    kcal:  Math.round((food.kcal_per_100g || 0) * ratio),
    p:     Math.round((food.p || 0) * ratio * 10) / 10,
    c:     Math.round((food.c || 0) * ratio * 10) / 10,
    f:     Math.round((food.f || 0) * ratio * 10) / 10,
    source: food.source || 'search',
    confidence: 1.0
  };
}

function macroCalories(p, c, f) {
  // 4-4-9 rule
  return Math.round((+p || 0) * 4 + (+c || 0) * 4 + (+f || 0) * 9);
}

function streakOf(mealsByDate) {
  // mealsByDate: { 'YYYY-MM-DD': true, ... }
  // streak = consecutive days ending today (or yesterday if today has none yet)
  var d = new Date();
  var streak = 0;
  // If today has no meals, the streak as of "now" is whatever ends yesterday.
  var todayKey = ymd(d);
  if (!mealsByDate[todayKey]) {
    d.setDate(d.getDate() - 1);
  }
  while (true) {
    var key = ymd(d);
    if (mealsByDate[key]) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

/* ───────────── Settings + Goals ───────────── */
async function loadSettings() {
  var rows = await dbGetAll('settings');
  settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  // Defaults
  if (settings.units == null) settings.units = 'g';
}

async function saveSetting(key, value) {
  settings[key] = value;
  await dbPut('settings', { key: key, value: value });
}

async function loadGoals() {
  var row = await dbGet('goals', 'current');
  goals = row ? row.value : { kcalDaily: 2000 };
}

async function saveGoals(g) {
  goals = g;
  await dbPut('goals', { key: 'current', value: g });
}

/* ───────────── Today ───────────── */
async function loadTodayMeals() {
  var all = await dbGetAll('meals');
  var today = ymd();
  todayMeals = all.filter(m => m.date === today).sort((a, b) => a.timestamp - b.timestamp);
  return todayMeals;
}

async function loadCustomFoods() {
  customFoods = await dbGetAll('customFoods');
  customFoods.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
}

/* ───────────── Foods DB ───────────── */
async function loadFoodsDB() {
  try {
    var res = await fetch('foods-db.json?v=1.0.2');
    foodsDB = await res.json();
  } catch (e) {
    console.warn('foods-db.json failed to load', e);
    foodsDB = [];
  }
}

/* ───────────── Toast ───────────── */
function toast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2400);
}

/* ───────────── Tab navigation ───────────── */
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'today')    renderToday();
  if (name === 'insights') window.renderInsights && window.renderInsights();
  if (name === 'snap')     refreshSnapHints();
  if (name === 'settings') renderSettings();
}

function refreshSnapHints() {
  document.getElementById('snapKeyHint').hidden = !!settings.geminiApiKey;
}

/* ───────────── Mode (Snap tab inner switcher) ───────────── */
function switchMode(mode) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.mode-panel').forEach(p => p.hidden = p.dataset.panel !== mode);
  // Refresh content
  if (mode === 'custom') renderCustomFoodsList();
  if (mode === 'search') {
    var inp = document.getElementById('searchInput');
    inp.value = '';
    document.getElementById('searchResults').innerHTML = '';
    setTimeout(() => inp.focus(), 80);
  }
}

/* ───────────── TODAY rendering ───────────── */
async function renderToday() {
  await loadTodayMeals();

  var totals = { kcal: 0, p: 0, c: 0, f: 0 };
  todayMeals.forEach(m => {
    totals.kcal += m.totalKcal || 0;
    totals.p    += m.totalP    || 0;
    totals.c    += m.totalC    || 0;
    totals.f    += m.totalF    || 0;
  });
  totals.kcal = Math.round(totals.kcal);
  totals.p = Math.round(totals.p * 10) / 10;
  totals.c = Math.round(totals.c * 10) / 10;
  totals.f = Math.round(totals.f * 10) / 10;

  var goal = goals.kcalDaily || 2000;
  var pct  = Math.min(1, totals.kcal / goal);

  // Ring
  var ringEl = document.getElementById('todayRing');
  var circ = 2 * Math.PI * 42; // ≈263.9
  ringEl.style.strokeDasharray  = circ;
  ringEl.style.strokeDashoffset = circ * (1 - pct);
  ringEl.classList.toggle('over', totals.kcal > goal);

  document.getElementById('todayKcalNum').textContent  = totals.kcal;
  document.getElementById('todayKcalGoal').textContent = goal;

  // Top pill (visible on non-today tabs too)
  var pill = document.getElementById('topGoalPill');
  pill.hidden = false;
  document.getElementById('topGoalText').textContent = totals.kcal + ' / ' + goal;
  var topFill = document.getElementById('topGoalFill');
  topFill.style.width = (pct * 100).toFixed(0) + '%';
  topFill.classList.toggle('over', totals.kcal > goal);

  // Date
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  // Macros
  document.getElementById('todayP').textContent = totals.p;
  document.getElementById('todayC').textContent = totals.c;
  document.getElementById('todayF').textContent = totals.f;
  var pG = goals.proteinDaily || (goal * 0.20 / 4);
  var cG = goals.carbsDaily   || (goal * 0.50 / 4);
  var fG = goals.fatDaily     || (goal * 0.30 / 9);
  document.getElementById('todayPBar').style.width = Math.min(100, totals.p / pG * 100).toFixed(0) + '%';
  document.getElementById('todayCBar').style.width = Math.min(100, totals.c / cG * 100).toFixed(0) + '%';
  document.getElementById('todayFBar').style.width = Math.min(100, totals.f / fG * 100).toFixed(0) + '%';

  // Status line
  var stat = document.getElementById('todayStatus');
  if (totals.kcal === 0) {
    stat.textContent = '';
    stat.className = 'today-status';
  } else if (totals.kcal > goal * 1.1) {
    stat.textContent = 'Over goal by ' + (totals.kcal - goal) + ' kcal — easy on dinner.';
    stat.className = 'today-status warn';
  } else if (totals.kcal > goal) {
    stat.textContent = 'Just over goal (' + (totals.kcal - goal) + ' kcal). Still in range.';
    stat.className = 'today-status warn';
  } else {
    stat.textContent = (goal - totals.kcal) + ' kcal remaining today.';
    stat.className = 'today-status ok';
  }

  // Meal groups
  var groups = { breakfast: [], lunch: [], snack: [], dinner: [] };
  todayMeals.forEach(m => { if (groups[m.mealType]) groups[m.mealType].push(m); });

  var emoji = { breakfast: '🌅 Breakfast', lunch: '🍱 Lunch', snack: '🍪 Snack', dinner: '🌙 Dinner' };
  var host = document.getElementById('todayMealGroups');
  host.innerHTML = '';

  var anyShown = false;
  Object.keys(groups).forEach(mt => {
    var arr = groups[mt];
    if (!arr.length) return;
    anyShown = true;
    var sub = sumItems(arr.map(m => ({ kcal: m.totalKcal, p: m.totalP, c: m.totalC, f: m.totalF })));
    var html = '<div class="meal-group">' +
      '<div class="meal-group-h"><span>' + emoji[mt] + '</span><span class="meal-group-kcal">~' + sub.kcal + ' kcal</span></div>';
    arr.forEach(m => {
      var time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var names = (m.items || []).map(it => it.name + (it.grams ? ' (' + it.grams + 'g)' : '')).join(', ');
      html += '<div class="meal-item">' +
        '<div><div>' + (names || '(empty)') + '</div><div class="mi-meta">' + time + '</div></div>' +
        '<div class="mi-kcal">~' + Math.round(m.totalKcal || 0) + '</div>' +
        '<div class="mi-actions"><button data-act="del" data-id="' + m.id + '" title="Delete">🗑️</button></div>' +
        '</div>';
    });
    html += '</div>';
    host.insertAdjacentHTML('beforeend', html);
  });

  document.getElementById('todayEmpty').hidden = anyShown;

  // Wire delete buttons
  host.querySelectorAll('button[data-act="del"]').forEach(btn => {
    btn.onclick = async () => {
      var id = +btn.dataset.id;
      if (!confirm('Delete this meal?')) return;
      await dbDelete('meals', id);
      toast('Deleted', 'ok');
      renderToday();
    };
  });
}

/* ───────────── Custom foods list ───────────── */
function renderCustomFoodsList() {
  var host = document.getElementById('customList');
  if (!customFoods.length) {
    host.innerHTML = '<li class="empty">No saved meals yet. Save any logged meal as a custom for one-tap re-logging.</li>';
    return;
  }
  host.innerHTML = '';
  customFoods.forEach(cf => {
    var sub = sumItems(cf.items || []);
    var li = document.createElement('li');
    li.innerHTML = '<div><div class="cf-name">' + cf.name + '</div>' +
                   '<div class="cf-kcal">~' + sub.kcal + ' kcal · ' +
                   (cf.items || []).length + ' items</div></div>' +
                   '<button class="cf-log" data-id="' + cf.id + '">+ Log</button>';
    li.querySelector('.cf-log').onclick = () => logCustomFood(cf.id);
    host.appendChild(li);
  });
}

async function logCustomFood(id) {
  var cf = customFoods.find(c => c.id === id);
  if (!cf) return;
  // Stage as pending meal for confirmation
  pendingMeal = {
    items: JSON.parse(JSON.stringify(cf.items)),
    photoUrl: null,
    source: 'custom',
    mealType: mealTypeFromHour(new Date().getHours())
  };
  window.showResultPanel && window.showResultPanel();
  // Bump lastUsedAt
  cf.lastUsedAt = Date.now();
  cf.useCount = (cf.useCount || 0) + 1;
  await dbPut('customFoods', cf);
}

/* ───────────── Settings rendering ───────────── */
function renderSettings() {
  document.getElementById('geminiKey').value = settings.geminiApiKey || '';
  document.getElementById('goalKcal').value  = goals.kcalDaily || 2000;
  document.getElementById('goalP').value     = goals.proteinDaily || '';
  document.getElementById('goalC').value     = goals.carbsDaily || '';
  document.getElementById('goalF').value     = goals.fatDaily || '';
  document.getElementById('sheetsStatus').textContent = settings.sheetsId ? 'On' : 'Off';
}

/* ───────────── Quick-action URL handler ───────────── */
function handleQuickParam() {
  var q = new URLSearchParams(location.search).get('quick');
  if (!q) return;
  switchView('snap');
  if (q === 'snap')    switchMode('camera');
  if (q === 'barcode') switchMode('barcode');
  if (q === 'search')  switchMode('search');
  if (q === 'today')   switchView('today');
}

/* ───────────── First-run / onboarding ───────────── */
function showOnboardIfNeeded() {
  if (settings._onboarded) return;
  document.getElementById('onboardModal').hidden = false;
}

/* ───────────── Wipe everything ───────────── */
async function wipeAll() {
  for (var s of STORES) await dbClear(s);
  todayMeals = []; customFoods = []; goals = { kcalDaily: 2000 }; settings = { units: 'g' };
  await saveGoals(goals);
  toast('All data cleared', 'ok');
  renderSettings();
  renderToday();
}

/* ───────────── Boot ───────────── */
async function boot() {
  DB = await openDB();
  await loadSettings();
  await loadGoals();
  await loadCustomFoods();
  await loadFoodsDB();

  // Wire bottom nav
  document.querySelectorAll('.nav-btn').forEach(b => b.onclick = () => switchView(b.dataset.view));
  // Wire mode switch
  document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => switchMode(b.dataset.mode));

  // Wire onboarding
  document.getElementById('onboardSkip').onclick = async () => {
    await saveSetting('_onboarded', true);
    document.getElementById('onboardModal').hidden = true;
  };
  document.getElementById('onboardGo').onclick = async () => {
    await saveSetting('_onboarded', true);
    document.getElementById('onboardModal').hidden = true;
    switchView('settings');
  };

  // Settings: save key
  document.getElementById('btnToggleKeyVis').onclick = () => {
    var inp = document.getElementById('geminiKey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };
  document.getElementById('btnSaveKey').onclick = async () => {
    var key = document.getElementById('geminiKey').value.trim();
    var st = document.getElementById('keyStatus');
    if (!key) { st.textContent = 'Empty'; st.className = 'set-status err'; return; }
    st.textContent = 'Testing…'; st.className = 'set-status';
    var ok = window.testGeminiKey ? await window.testGeminiKey(key) : true;
    if (ok) {
      await saveSetting('geminiApiKey', key);
      st.textContent = '✓ Saved'; st.className = 'set-status ok';
      refreshSnapHints();
    } else {
      st.textContent = '✗ Invalid'; st.className = 'set-status err';
    }
  };
  document.getElementById('btnSaveGoals').onclick = async () => {
    var g = {
      kcalDaily:    +document.getElementById('goalKcal').value || 2000,
      proteinDaily: +document.getElementById('goalP').value || undefined,
      carbsDaily:   +document.getElementById('goalC').value || undefined,
      fatDaily:     +document.getElementById('goalF').value || undefined
    };
    await saveGoals(g);
    toast('Goals saved', 'ok');
  };

  // Settings: sync / export / wipe
  document.getElementById('btnSheetsToggle').onclick = () => window.toggleSheetsSync && window.toggleSheetsSync();
  document.getElementById('btnExport').onclick      = exportAll;
  document.getElementById('btnClear').onclick       = () => { document.getElementById('wipeModal').hidden = false; };
  document.getElementById('wipeCancel').onclick     = () => { document.getElementById('wipeModal').hidden = true; };
  document.getElementById('wipeConfirm').onclick    = async () => {
    document.getElementById('wipeModal').hidden = true;
    await wipeAll();
  };

  // Snap → Settings shortcut
  document.getElementById('toSettings').onclick = (e) => { e.preventDefault(); switchView('settings'); };
  // Today empty → Snap
  document.getElementById('btnGoSnap').onclick = () => { switchView('snap'); switchMode('camera'); };

  // SW register
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Render initial
  renderToday();
  refreshSnapHints();
  showOnboardIfNeeded();
  handleQuickParam();
}

/* ───────────── Export ───────────── */
async function exportAll() {
  var dump = {
    exportedAt: new Date().toISOString(),
    meals:       await dbGetAll('meals'),
    customFoods: await dbGetAll('customFoods'),
    goals:       (await dbGet('goals', 'current')) || null,
    settings:    (await dbGetAll('settings')).filter(r => r.key !== 'geminiApiKey')
  };
  var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'calorie-snap-export-' + ymd() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Exported', 'ok');
}

/* ───────────── Expose for features.js + tests ───────────── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ymd, mealTypeFromHour, sumItems, scaleItemToGrams,
    kcalFromPerHundred, macroCalories, streakOf
  };
} else {
  window.ymd               = ymd;
  window.mealTypeFromHour  = mealTypeFromHour;
  window.sumItems          = sumItems;
  window.scaleItemToGrams  = scaleItemToGrams;
  window.kcalFromPerHundred= kcalFromPerHundred;
  window.macroCalories     = macroCalories;
  window.streakOf          = streakOf;
  window.toast             = toast;
  window.switchView        = switchView;
  window.switchMode        = switchMode;
  window.renderToday       = renderToday;
  window.renderCustomFoodsList = renderCustomFoodsList;
  window.dbPut             = dbPut;
  window.dbGet             = dbGet;
  window.dbGetAll          = dbGetAll;
  window.dbDelete          = dbDelete;

  // Auto-boot when DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
