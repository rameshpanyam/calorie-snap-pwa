/* =====================================================================
   Calorie Snap — features.js
   Modules (IIFE):
     - F1. Gemini vision integration (BYO key)
     - F2. Barcode scanning (ZXing + Open Food Facts)
     - F3. Local foods search
     - F4. Result panel + edit modal
     - F5. Insights charts
     - F6. Sheets sync (lightweight)
     - F7. Custom food save
   Reads cross-script state via window.* — see app.js for var declarations.
   ===================================================================== */

(function () {
  'use strict';

  /* ═════════════════ The locked Gemini system prompt ═════════════════ */
  var GEMINI_SYSTEM = [
    'You are a food recognition expert specialising in Indian cuisine with broad global coverage.',
    'Given a photo of food, return ONLY valid JSON in this exact shape — no prose, no markdown:',
    '{',
    '  "items": [',
    '    {',
    '      "name": "<canonical food name>",',
    '      "estimated_portion": "<human-readable, e.g. \'1 piece\', \'½ cup\'>",',
    '      "estimated_grams": <number>,',
    '      "kcal": <number>,',
    '      "protein_g": <number>,',
    '      "carbs_g": <number>,',
    '      "fat_g": <number>,',
    '      "confidence": <0.0 to 1.0>,',
    '      "notes": "<short hedge if ambiguous, else empty>"',
    '    }',
    '  ],',
    '  "overall_confidence": <0.0 to 1.0>,',
    '  "cuisine_hint": "<indian|global|ambiguous>"',
    '}',
    '',
    'Rules:',
    '- Prefer Indian food names when ambiguous: "dosa" not "pancake", "sabzi" not "stir fry", "dal" not "lentil soup".',
    '- If the dish contains visible oil/ghee, assume restaurant prep (add 10-15% kcal). If clearly homemade-looking, no adjustment.',
    '- For mixed plates (thali, combo meal), return ONE item per dish.',
    '- If you cannot identify anything, return items: [].',
    '- Round kcal to nearest 10, macros to nearest 1g.',
    '- Confidence < 0.5 means user MUST review — flag in notes.'
  ].join('\n');

  var GEMINI_MODEL = 'gemini-2.0-flash';
  var GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models/';

  /* ═════════════════ Helpers ═════════════════ */
  function $(id) { return document.getElementById(id); }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      var r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function compressImage(dataUrl, maxEdge) {
    return new Promise((resolve) => {
      var img = new Image();
      img.onload = () => {
        var w = img.width, h = img.height;
        var s = Math.min(1, maxEdge / Math.max(w, h));
        var cw = Math.round(w * s), ch = Math.round(h * s);
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    });
  }

  function dataUrlToBase64(dataUrl) {
    return dataUrl.split(',')[1] || '';
  }

  function stripJsonFences(s) {
    if (!s) return '';
    s = String(s).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return s.trim();
  }

  /* ═════════════════ F1. Gemini vision ═════════════════ */
  async function testGeminiKey(key) {
    try {
      var url = GEMINI_BASE + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(key);
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }]
        })
      });
      if (!res.ok) return false;
      var j = await res.json();
      var txt = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
      return !!txt;
    } catch (e) { return false; }
  }

  async function recogniseFoodFromImage(imageDataUrl) {
    var key = (window.settings && window.settings.geminiApiKey) || null;
    if (!key) throw new Error('No Gemini API key set. Add it in Settings.');

    var compressed = await compressImage(imageDataUrl, 768);
    var b64 = dataUrlToBase64(compressed);

    var url = GEMINI_BASE + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(key);
    var body = {
      systemInstruction: { parts: [{ text: GEMINI_SYSTEM }] },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: b64 } },
          { text: 'Identify all foods in this photo and estimate calories + macros.' }
        ]
      }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
    };

    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var err = await res.text();
      throw new Error('Gemini error ' + res.status + ': ' + err.slice(0, 200));
    }
    var j = await res.json();
    var txt = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
    if (!txt) throw new Error('Gemini returned no text');
    var parsed;
    try { parsed = JSON.parse(stripJsonFences(txt)); }
    catch (e) { throw new Error('Could not parse Gemini JSON: ' + txt.slice(0, 120)); }
    return geminiResultToItems(parsed);
  }

  function geminiResultToItems(r) {
    var raw = (r && r.items) || [];
    return raw.map(it => ({
      name:       it.name || 'Food',
      grams:      Math.max(1, Math.round(+it.estimated_grams || 100)),
      baseGrams:  Math.max(1, Math.round(+it.estimated_grams || 100)),
      kcal:       Math.max(0, Math.round(+it.kcal || 0)),
      p:          Math.max(0, +it.protein_g || 0),
      c:          Math.max(0, +it.carbs_g || 0),
      f:          Math.max(0, +it.fat_g || 0),
      confidence: Math.min(1, Math.max(0, +it.confidence || 0.7)),
      notes:      it.notes || '',
      source:     'ai'
    }));
  }

  /* ═════════════════ F2. Barcode + Open Food Facts ═════════════════ */
  var zxingReader = null;
  async function startBarcodeScan() {
    var stage = $('barcodeVideo');
    $('btnBarcodeStart').hidden = true;
    $('btnBarcodeStop').hidden  = false;
    try {
      if (typeof ZXing === 'undefined') throw new Error('Barcode reader not loaded');
      zxingReader = new ZXing.BrowserMultiFormatReader();
      var devices = await zxingReader.listVideoInputDevices();
      var rear = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[devices.length - 1];
      zxingReader.decodeFromVideoDevice(rear ? rear.deviceId : null, stage, async (result, err) => {
        if (result) {
          var code = result.getText();
          stopBarcodeScan();
          await lookupBarcode(code);
        }
      });
    } catch (e) {
      window.toast('Camera/permission denied', 'err');
      stopBarcodeScan();
    }
  }

  function stopBarcodeScan() {
    try { zxingReader && zxingReader.reset(); } catch (e) {}
    zxingReader = null;
    $('btnBarcodeStart').hidden = false;
    $('btnBarcodeStop').hidden  = true;
  }

  async function lookupBarcode(code) {
    window.toast('Looking up ' + code + '…');
    try {
      var res = await fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json');
      var j = await res.json();
      if (j.status !== 1 || !j.product) { window.toast('Not found in Open Food Facts', 'err'); return; }
      var p = j.product;
      var name = p.product_name || p.product_name_en || ('Item ' + code);
      var nutr = p.nutriments || {};
      var per100 = {
        name: name,
        kcal_per_100g: +nutr['energy-kcal_100g'] || +nutr['energy-kcal'] || 0,
        p: +nutr['proteins_100g'] || 0,
        c: +nutr['carbohydrates_100g'] || 0,
        f: +nutr['fat_100g'] || 0,
        source: 'barcode'
      };
      // Default to a "1 serving" if listed, else 100g
      var serving = +nutr['serving_size'] || 100;
      var item = window.kcalFromPerHundred(per100, isFinite(serving) && serving > 0 ? serving : 100);
      item.confidence = 1.0;
      stagePendingMeal([item], null);
    } catch (e) {
      window.toast('Lookup failed', 'err');
    }
  }

  /* ═════════════════ F3. Local search ═════════════════ */
  function fuzzyMatch(q, name) {
    q = q.toLowerCase(); name = name.toLowerCase();
    if (name.startsWith(q)) return 3;
    if (name.includes(' ' + q)) return 2;
    if (name.includes(q)) return 1;
    return 0;
  }

  function searchFoods(q) {
    if (!q || q.length < 2) return [];
    var scored = [];
    for (var i = 0; i < window.foodsDB.length; i++) {
      var f = window.foodsDB[i];
      var s = fuzzyMatch(q, f.name);
      if (s) scored.push({ f, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 30).map(x => x.f);
  }

  function renderSearchResults(q) {
    var host = $('searchResults');
    var hits = searchFoods(q);
    host.innerHTML = '';
    if (!q || q.length < 2) return;
    if (!hits.length) {
      host.innerHTML = '<li class="empty">No matches. Try a different spelling.</li>';
      return;
    }
    hits.forEach(f => {
      var defaultG = f.default_g || 100;
      var kcalDef  = Math.round((f.kcal_per_100g || 0) * defaultG / 100);
      var li = document.createElement('li');
      li.innerHTML = '<span class="sr-name">' + f.name + '</span>' +
                     '<span class="sr-kcal">' + kcalDef + ' kcal / ' + defaultG + 'g</span>';
      li.onclick = () => {
        var item = window.kcalFromPerHundred(f, defaultG);
        stagePendingMeal([item], null);
      };
      host.appendChild(li);
    });
  }

  /* ═════════════════ F4. Result panel + edit ═════════════════ */
  function stagePendingMeal(items, photoUrl) {
    window.pendingMeal = {
      items: items,
      photoUrl: photoUrl,
      mealType: window.mealTypeFromHour(new Date().getHours())
    };
    showResultPanel();
  }

  function showResultPanel() {
    var p = $('resultPanel');
    p.hidden = false;
    $('resultLoading').hidden = true;
    var photo = $('resultPhoto');
    if (window.pendingMeal && window.pendingMeal.photoUrl) {
      photo.src = window.pendingMeal.photoUrl;
      photo.hidden = false;
    } else {
      photo.hidden = true;
    }
    $('mealType').value = (window.pendingMeal && window.pendingMeal.mealType) || 'lunch';
    renderResultItems();
  }

  function hideResultPanel() {
    $('resultPanel').hidden = true;
    window.pendingMeal = null;
  }

  function renderResultItems() {
    var host = $('resultItems');
    host.innerHTML = '';
    var items = (window.pendingMeal && window.pendingMeal.items) || [];
    if (!items.length) {
      host.innerHTML = '<li class="empty">No items. Tap "+ Add another item" or close.</li>';
    } else {
      items.forEach((it, idx) => {
        var li = document.createElement('li');
        var conf = (it.confidence != null && it.confidence < 0.5) ? '<span class="ri-conf-low" title="Review this">REVIEW</span>' : '';
        li.innerHTML = '<div><div class="ri-name">' + it.name + conf + '</div>' +
                       '<div class="ri-sub">' + (it.grams || 0) + 'g · ' +
                       (it.p || 0) + 'p · ' + (it.c || 0) + 'c · ' + (it.f || 0) + 'f' +
                       (it.notes ? ' · ' + it.notes : '') +
                       '</div></div>' +
                       '<div class="ri-kcal">~' + Math.round(it.kcal || 0) + '</div>';
        li.onclick = () => openEditItem(idx);
        host.appendChild(li);
      });
    }
    // Totals
    var t = window.sumItems(items);
    $('totalKcal').textContent = t.kcal;
    $('totalP').textContent = t.p;
    $('totalC').textContent = t.c;
    $('totalF').textContent = t.f;
  }

  var editingIdx = -1;
  function openEditItem(idx) {
    editingIdx = idx;
    var it = window.pendingMeal.items[idx];
    $('editName').value  = it.name || '';
    $('editGrams').value = it.grams || 100;
    $('editKcal').value  = it.kcal || 0;
    $('editP').value     = it.p || 0;
    $('editC').value     = it.c || 0;
    $('editF').value     = it.f || 0;
    $('editItemModal').hidden = false;
  }

  function saveEdit() {
    if (editingIdx < 0) return;
    var oldItem = window.pendingMeal.items[editingIdx];
    var newGrams = +$('editGrams').value || oldItem.grams;
    // If user changed grams, rescale macros proportionally — unless they also edited macros
    // We trust the explicit fields they entered.
    var item = {
      name:  $('editName').value.trim() || oldItem.name,
      grams: newGrams,
      baseGrams: newGrams,
      kcal:  Math.max(0, Math.round(+$('editKcal').value || 0)),
      p:     Math.max(0, +$('editP').value || 0),
      c:     Math.max(0, +$('editC').value || 0),
      f:     Math.max(0, +$('editF').value || 0),
      source: oldItem.source,
      confidence: oldItem.confidence
    };
    window.pendingMeal.items[editingIdx] = item;
    closeEdit();
    renderResultItems();
  }

  function deleteEdit() {
    if (editingIdx < 0) return;
    window.pendingMeal.items.splice(editingIdx, 1);
    closeEdit();
    renderResultItems();
  }

  function closeEdit() {
    $('editItemModal').hidden = true;
    editingIdx = -1;
  }

  function applyPortionChip(mult) {
    if (editingIdx < 0) return;
    var it = window.pendingMeal.items[editingIdx];
    var newGrams = Math.round((it.baseGrams || it.grams || 100) * mult);
    var scaled = window.scaleItemToGrams(it, newGrams);
    $('editGrams').value = scaled.grams;
    $('editKcal').value  = scaled.kcal;
    $('editP').value     = scaled.p;
    $('editC').value     = scaled.c;
    $('editF').value     = scaled.f;
  }

  async function logPendingMeal() {
    if (!window.pendingMeal || !window.pendingMeal.items.length) {
      window.toast('Add at least one item', 'err');
      return;
    }
    var totals = window.sumItems(window.pendingMeal.items);
    var now = Date.now();
    var meal = {
      date:      window.ymd(),
      timestamp: now,
      mealType:  $('mealType').value || 'lunch',
      items:     window.pendingMeal.items,
      photoUrl:  window.pendingMeal.photoUrl || null,
      totalKcal: totals.kcal,
      totalP:    totals.p,
      totalC:    totals.c,
      totalF:    totals.f,
      source:    window.pendingMeal.items[0] && window.pendingMeal.items[0].source || 'manual'
    };
    await window.dbPut('meals', meal);
    window.toast('Logged ~' + totals.kcal + ' kcal', 'ok');
    hideResultPanel();
    if (window.maybeSyncToSheets) window.maybeSyncToSheets(meal);
    window.renderToday();
  }

  /* ═════════════════ F7. Custom food save ═════════════════ */
  function openSaveCustom() {
    if (!window.pendingMeal || !window.pendingMeal.items.length) {
      window.toast('Nothing to save', 'err'); return;
    }
    $('customName').value = '';
    $('saveCustomModal').hidden = false;
  }
  async function confirmSaveCustom() {
    var name = $('customName').value.trim();
    if (!name) { window.toast('Enter a name', 'err'); return; }
    var cf = {
      name: name,
      items: JSON.parse(JSON.stringify(window.pendingMeal.items)),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0
    };
    await window.dbPut('customFoods', cf);
    window.customFoods.push(cf);
    $('saveCustomModal').hidden = true;
    window.toast('Saved "' + name + '"', 'ok');
  }

  /* ═════════════════ F5. Insights ═════════════════ */
  var kcalChart = null, macroChart = null;

  async function renderInsights() {
    var all = await window.dbGetAll('meals');
    var today = new Date();
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(today); d.setDate(today.getDate() - i);
      days.push({ key: window.ymd(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }), kcal: 0, p: 0, c: 0, f: 0 });
    }
    var goal = (window.goals && window.goals.kcalDaily) || 2000;
    var byDate = {};
    all.forEach(m => { byDate[m.date] = true; });
    all.forEach(m => {
      var hit = days.find(d => d.key === m.date);
      if (hit) {
        hit.kcal += m.totalKcal || 0;
        hit.p    += m.totalP    || 0;
        hit.c    += m.totalC    || 0;
        hit.f    += m.totalF    || 0;
      }
    });

    // Kcal trend bar chart
    var ctx1 = $('kcalChart').getContext('2d');
    if (kcalChart) kcalChart.destroy();
    if (typeof Chart === 'undefined') return;
    kcalChart = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: days.map(d => d.label),
        datasets: [{
          label: 'kcal',
          data: days.map(d => Math.round(d.kcal)),
          backgroundColor: days.map(d => d.kcal > goal ? 'rgba(245,158,11,0.9)' : 'rgba(34,197,94,0.85)'),
          borderRadius: 6,
          borderSkipped: false
        }, {
          label: 'goal',
          type: 'line',
          data: days.map(() => goal),
          borderColor: 'rgba(232,232,238,0.4)',
          borderDash: [5, 5],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#9e9eb1' } },
          y: { ticks: { color: '#9e9eb1' }, grid: { color: '#2c2c38' } }
        }
      }
    });

    // Macro donut: avg of last 7 days
    var totP = days.reduce((s, d) => s + d.p, 0);
    var totC = days.reduce((s, d) => s + d.c, 0);
    var totF = days.reduce((s, d) => s + d.f, 0);
    var ctx2 = $('macroChart').getContext('2d');
    if (macroChart) macroChart.destroy();
    macroChart = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['Protein', 'Carbs', 'Fat'],
        datasets: [{
          data: [totP * 4, totC * 4, totF * 9],
          backgroundColor: ['#3b82f6', '#a855f7', '#ec4899'],
          borderColor: '#1a1a22',
          borderWidth: 3
        }]
      },
      options: {
        cutout: '60%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9e9eb1' } },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + Math.round(ctx.parsed) + ' kcal' } }
        }
      }
    });

    // Callouts
    var loggedDays = days.filter(d => d.kcal > 0);
    var avg = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.kcal, 0) / loggedDays.length) : 0;
    var best = loggedDays.slice().sort((a, b) => Math.abs(a.kcal - goal) - Math.abs(b.kcal - goal))[0];
    var worst = loggedDays.slice().sort((a, b) => b.kcal - a.kcal)[0];
    var overDays = loggedDays.filter(d => d.kcal > goal * 1.1).length;

    var co = $('callouts');
    if (!loggedDays.length) {
      co.innerHTML = '<li class="empty">Log a few meals to see insights.</li>';
    } else {
      var html = '';
      html += '<li>📊 7-day average: <b>' + avg + '</b> kcal/day</li>';
      if (best) html += '<li>🎯 Closest to goal: <b>' + best.label + '</b> (' + Math.round(best.kcal) + ' kcal)</li>';
      if (worst && worst.kcal > goal) html += '<li>⚠️ Highest day: <b>' + worst.label + '</b> (' + Math.round(worst.kcal) + ' kcal)</li>';
      if (overDays > 0) html += '<li>🔥 Over goal: <b>' + overDays + '</b> of ' + loggedDays.length + ' tracked days</li>';
      html += '<li>📈 Tracked: <b>' + loggedDays.length + '</b> / 7 days</li>';
      co.innerHTML = html;
    }

    // Streak
    var streak = window.streakOf(byDate);
    $('streakNum').textContent = streak;
    $('streakHint').textContent = streak === 0 ? 'Log a meal today to start' : (streak === 1 ? 'Keep going tomorrow!' : 'Nice — keep it up!');
  }

  /* ═════════════════ F6. Sheets sync (lightweight) ═════════════════ */
  // Reuses the same pattern as Expense Tracker — but kept minimal here.
  function toggleSheetsSync() {
    // Full Google OAuth flow is a substantial subsystem. For v1 we expose a
    // manual "paste your sheet ID + we'll generate an API approach in v1.1".
    window.toast('Sheets sync coming in v1.1. Use Export JSON in the meantime.', 'err');
  }
  function maybeSyncToSheets(/* meal */) { /* no-op for now */ }

  /* ═════════════════ Wire up DOM events ═════════════════ */
  function wire() {
    // Camera capture (the input[type=file] picker is most reliable on iOS)
    $('btnCapture').onclick = () => $('fileCapture').click();
    $('btnGallery').onclick = () => $('fileGallery').click();
    $('fileCapture').onchange = handleFilePicked;
    $('fileGallery').onchange = handleFilePicked;

    // Barcode
    $('btnBarcodeStart').onclick = startBarcodeScan;
    $('btnBarcodeStop').onclick  = stopBarcodeScan;

    // Search
    $('searchInput').oninput = (e) => renderSearchResults(e.target.value);

    // Result panel CTAs
    $('resultClose').onclick   = hideResultPanel;
    $('addItem').onclick       = () => {
      if (!window.pendingMeal) window.pendingMeal = { items: [], mealType: window.mealTypeFromHour(new Date().getHours()) };
      window.pendingMeal.items.push({ name: 'New item', grams: 100, baseGrams: 100, kcal: 0, p: 0, c: 0, f: 0, source: 'manual', confidence: 1 });
      renderResultItems();
      openEditItem(window.pendingMeal.items.length - 1);
    };
    $('btnLogMeal').onclick    = logPendingMeal;
    $('btnSaveCustom').onclick = openSaveCustom;

    // Edit modal
    document.querySelectorAll('.portion-chips .chip').forEach(btn => {
      btn.onclick = () => applyPortionChip(+btn.dataset.mult);
    });
    $('editSave').onclick   = saveEdit;
    $('editDelete').onclick = deleteEdit;
    $('editCancel').onclick = closeEdit;

    // Save-as-custom modal
    $('customSaveBtn').onclick = confirmSaveCustom;
    $('customCancel').onclick  = () => { $('saveCustomModal').hidden = true; };
  }

  async function handleFilePicked(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = ''; // reset so same file can be picked again
    if (!file) return;
    if (!window.settings || !window.settings.geminiApiKey) {
      window.toast('Set Gemini key in Settings first', 'err');
      window.switchView('settings');
      return;
    }
    var dataUrl = await fileToDataURL(file);
    // Show loading state
    $('resultPanel').hidden = false;
    $('resultLoading').hidden = false;
    $('resultPhoto').src = dataUrl; $('resultPhoto').hidden = false;
    $('resultItems').innerHTML = '';
    $('totalKcal').textContent = '…';

    try {
      var items = await recogniseFoodFromImage(dataUrl);
      if (!items.length) {
        window.toast('Could not identify any food. Try a clearer photo.', 'err');
        hideResultPanel(); return;
      }
      window.pendingMeal = {
        items: items,
        photoUrl: dataUrl,
        mealType: window.mealTypeFromHour(new Date().getHours())
      };
      showResultPanel();
    } catch (err) {
      console.error(err);
      window.toast(err.message || 'Recognition failed', 'err');
      $('resultLoading').hidden = true;
    }
  }

  /* ═════════════════ Boot wiring after app.js ═════════════════ */
  function init() {
    wire();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* ═════════════════ Expose ═════════════════ */
  window.testGeminiKey       = testGeminiKey;
  window.recogniseFood       = recogniseFoodFromImage;
  window.searchFoods         = searchFoods;
  window.renderInsights      = renderInsights;
  window.toggleSheetsSync    = toggleSheetsSync;
  window.maybeSyncToSheets   = maybeSyncToSheets;
  window.showResultPanel     = showResultPanel;
  window.hideResultPanel     = hideResultPanel;
  window.stagePendingMeal    = stagePendingMeal;
  window.GEMINI_SYSTEM       = GEMINI_SYSTEM;
})();
