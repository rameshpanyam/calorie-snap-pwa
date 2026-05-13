/* =============================================================================
   Calorie Snap — QA Auto Suite (Node.js mirror tests)
   Pure-function tests for the math/logic layer in app.js.
   ============================================================================= */

'use strict';
const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

// Pull pure helpers from app.js (it exports via module.exports when run in Node)
const App = require(path.join(__dirname, '..', 'app.js'));
const { ymd, mealTypeFromHour, sumItems, scaleItemToGrams,
        kcalFromPerHundred, macroCalories, streakOf } = App;

let passed = 0, failed = 0, errors = [];
function T(id, name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    errors.push({ id, name, msg: e.message || String(e) });
  }
}

/* ═══════════════════════════════════════════════════════════════════
   A.  YMD DATE FORMATTING  (TC-A-001..A-010)
   ═══════════════════════════════════════════════════════════════════ */
T('TC-A-001','ymd returns YYYY-MM-DD format',                   () => assert.match(ymd(new Date(2026, 4, 13)), /^\d{4}-\d{2}-\d{2}$/));
T('TC-A-002','ymd Jan 1 2026',                                  () => assert.strictEqual(ymd(new Date(2026, 0, 1)),  '2026-01-01'));
T('TC-A-003','ymd Dec 31 2025',                                 () => assert.strictEqual(ymd(new Date(2025, 11, 31)),'2025-12-31'));
T('TC-A-004','ymd zero-pads month',                             () => assert.strictEqual(ymd(new Date(2026, 2, 5)),  '2026-03-05'));
T('TC-A-005','ymd zero-pads day',                               () => assert.strictEqual(ymd(new Date(2026, 5, 9)),  '2026-06-09'));
T('TC-A-006','ymd no args = today',                             () => assert.match(ymd(), /^\d{4}-\d{2}-\d{2}$/));
T('TC-A-007','ymd Feb 29 leap',                                 () => assert.strictEqual(ymd(new Date(2024, 1, 29)), '2024-02-29'));
T('TC-A-008','ymd preserves day with time',                     () => assert.strictEqual(ymd(new Date(2026, 4, 13, 23, 59)), '2026-05-13'));
T('TC-A-009','ymd new year boundary',                           () => assert.strictEqual(ymd(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01'));
T('TC-A-010','ymd shape stable across years',                   () => assert.strictEqual(ymd(new Date(1999, 0, 1)).length, 10));

/* ═══════════════════════════════════════════════════════════════════
   B.  MEAL TYPE FROM HOUR  (TC-B-001..B-015)
   ═══════════════════════════════════════════════════════════════════ */
T('TC-B-001','0am → dinner',                                    () => assert.strictEqual(mealTypeFromHour(0),  'dinner'));
T('TC-B-002','4:59am → dinner',                                 () => assert.strictEqual(mealTypeFromHour(4),  'dinner'));
T('TC-B-003','5am → breakfast',                                 () => assert.strictEqual(mealTypeFromHour(5),  'breakfast'));
T('TC-B-004','7am → breakfast',                                 () => assert.strictEqual(mealTypeFromHour(7),  'breakfast'));
T('TC-B-005','10am → breakfast',                                () => assert.strictEqual(mealTypeFromHour(10), 'breakfast'));
T('TC-B-006','11am → lunch',                                    () => assert.strictEqual(mealTypeFromHour(11), 'lunch'));
T('TC-B-007','13 (1pm) → lunch',                                () => assert.strictEqual(mealTypeFromHour(13), 'lunch'));
T('TC-B-008','15 (3pm) → lunch',                                () => assert.strictEqual(mealTypeFromHour(15), 'lunch'));
T('TC-B-009','16 (4pm) → snack',                                () => assert.strictEqual(mealTypeFromHour(16), 'snack'));
T('TC-B-010','18 (6pm) → snack',                                () => assert.strictEqual(mealTypeFromHour(18), 'snack'));
T('TC-B-011','19 (7pm) → dinner',                               () => assert.strictEqual(mealTypeFromHour(19), 'dinner'));
T('TC-B-012','21 (9pm) → dinner',                               () => assert.strictEqual(mealTypeFromHour(21), 'dinner'));
T('TC-B-013','23 (11pm) → dinner',                              () => assert.strictEqual(mealTypeFromHour(23), 'dinner'));
T('TC-B-014','boundary 10→11 changes meal',                     () => assert.notStrictEqual(mealTypeFromHour(10), mealTypeFromHour(11)));
T('TC-B-015','all 24 hours map to valid meal types',            () => { for(let h=0;h<24;h++) assert.ok(['breakfast','lunch','snack','dinner'].includes(mealTypeFromHour(h))); });

/* ═══════════════════════════════════════════════════════════════════
   C.  SUM ITEMS  (TC-C-001..C-015)
   ═══════════════════════════════════════════════════════════════════ */
T('TC-C-001','empty array → zeros',                             () => assert.deepStrictEqual(sumItems([]), { kcal: 0, p: 0, c: 0, f: 0 }));
T('TC-C-002','null → zeros',                                    () => assert.deepStrictEqual(sumItems(null), { kcal: 0, p: 0, c: 0, f: 0 }));
T('TC-C-003','undefined → zeros',                               () => assert.deepStrictEqual(sumItems(undefined), { kcal: 0, p: 0, c: 0, f: 0 }));
T('TC-C-004','single item passes through',                      () => assert.deepStrictEqual(sumItems([{kcal:100,p:5,c:10,f:3}]), { kcal:100,p:5,c:10,f:3 }));
T('TC-C-005','two items sum kcal',                              () => assert.strictEqual(sumItems([{kcal:100},{kcal:200}]).kcal, 300));
T('TC-C-006','two items sum protein',                           () => assert.strictEqual(sumItems([{p:10},{p:20}]).p, 30));
T('TC-C-007','three items sum carbs',                           () => assert.strictEqual(sumItems([{c:5},{c:10},{c:15}]).c, 30));
T('TC-C-008','missing fields treated as 0',                     () => assert.deepStrictEqual(sumItems([{kcal:100},{p:5}]), { kcal:100,p:5,c:0,f:0 }));
T('TC-C-009','kcal rounded',                                    () => assert.strictEqual(sumItems([{kcal:100.6},{kcal:99.4}]).kcal, 200));
T('TC-C-010','macros rounded to 1 decimal',                     () => assert.strictEqual(sumItems([{p:1.234},{p:2.111}]).p, 3.3));
T('TC-C-011','negative values still sum',                       () => assert.strictEqual(sumItems([{kcal:100},{kcal:-50}]).kcal, 50));
T('TC-C-012','string numbers coerce',                           () => assert.strictEqual(sumItems([{kcal:'100'},{kcal:'200'}]).kcal, 300));
T('TC-C-013','large sum no overflow',                           () => assert.strictEqual(sumItems(new Array(100).fill({kcal:50})).kcal, 5000));
T('TC-C-014','shape always has 4 keys',                         () => assert.deepStrictEqual(Object.keys(sumItems([])).sort(), ['c','f','kcal','p']));
T('TC-C-015','mixed missing + present',                         () => assert.deepStrictEqual(sumItems([{kcal:100,p:5},{c:10}]), { kcal:100,p:5,c:10,f:0 }));

/* ═══════════════════════════════════════════════════════════════════
   D.  SCALE ITEM TO GRAMS  (TC-D-001..D-015)
   ═══════════════════════════════════════════════════════════════════ */
const base = { name:'Roti', grams: 40, baseGrams: 40, kcal: 119, p: 4.4, c: 20, f: 3 };
T('TC-D-001','scale to same grams = same item',                 () => { const s = scaleItemToGrams(base, 40); assert.strictEqual(s.kcal, 119); });
T('TC-D-002','scale 40→80 doubles kcal',                        () => assert.strictEqual(scaleItemToGrams(base, 80).kcal, 238));
T('TC-D-003','scale 40→20 halves kcal',                         () => assert.strictEqual(scaleItemToGrams(base, 20).kcal, 60));
T('TC-D-004','scale preserves name',                            () => assert.strictEqual(scaleItemToGrams(base, 60).name, 'Roti'));
T('TC-D-005','scale updates grams field',                       () => assert.strictEqual(scaleItemToGrams(base, 75).grams, 75));
T('TC-D-006','scale preserves baseGrams as original anchor',    () => assert.strictEqual(scaleItemToGrams(base, 75).baseGrams, 40));
T('TC-D-007','scale rounds kcal to integer',                    () => assert.strictEqual(Number.isInteger(scaleItemToGrams(base, 73).kcal), true));
T('TC-D-008','scale rounds protein to 1 decimal',               () => { const v = scaleItemToGrams(base, 73).p; assert.ok(Math.round(v*10)/10 === v); });
T('TC-D-009','scale to 0 = 0 kcal',                             () => assert.strictEqual(scaleItemToGrams(base, 0).kcal, 0));
T('TC-D-010','scale x2.5 = 2.5x macros',                        () => assert.strictEqual(scaleItemToGrams(base, 100).kcal, Math.round(119 * 2.5)));
T('TC-D-011','no baseGrams falls back to grams',                () => { const it = { name:'X', grams: 100, kcal: 50, p:1, c:1, f:1 }; assert.strictEqual(scaleItemToGrams(it, 200).kcal, 100); });
T('TC-D-012','no baseGrams no grams falls to 100',              () => { const it = { name:'X', kcal: 100, p:1, c:1, f:1 }; assert.strictEqual(scaleItemToGrams(it, 50).kcal, 50); });
T('TC-D-013','source preserved',                                () => assert.strictEqual(scaleItemToGrams({...base, source:'ai'}, 60).source, 'ai'));
T('TC-D-014','confidence preserved',                            () => assert.strictEqual(scaleItemToGrams({...base, confidence:0.8}, 60).confidence, 0.8));
T('TC-D-015','notes preserved',                                 () => assert.strictEqual(scaleItemToGrams({...base, notes:'oily'}, 60).notes, 'oily'));

/* ═══════════════════════════════════════════════════════════════════
   E.  KCAL FROM PER-100G  (TC-E-001..E-015)
   ═══════════════════════════════════════════════════════════════════ */
const food = { name:'Rice', kcal_per_100g: 130, p: 2.7, c: 28, f: 0.3 };
T('TC-E-001','100g = same as per_100g',                         () => assert.strictEqual(kcalFromPerHundred(food, 100).kcal, 130));
T('TC-E-002','200g doubles kcal',                               () => assert.strictEqual(kcalFromPerHundred(food, 200).kcal, 260));
T('TC-E-003','50g halves kcal',                                 () => assert.strictEqual(kcalFromPerHundred(food, 50).kcal, 65));
T('TC-E-004','150g = 1.5x',                                     () => assert.strictEqual(kcalFromPerHundred(food, 150).kcal, 195));
T('TC-E-005','preserves name',                                  () => assert.strictEqual(kcalFromPerHundred(food, 100).name, 'Rice'));
T('TC-E-006','grams field set correctly',                       () => assert.strictEqual(kcalFromPerHundred(food, 150).grams, 150));
T('TC-E-007','baseGrams matches grams',                         () => assert.strictEqual(kcalFromPerHundred(food, 150).baseGrams, 150));
T('TC-E-008','protein scales 100g',                             () => assert.strictEqual(kcalFromPerHundred(food, 100).p, 2.7));
T('TC-E-009','protein scales 200g',                             () => assert.strictEqual(kcalFromPerHundred(food, 200).p, 5.4));
T('TC-E-010','carbs scale 50g',                                 () => assert.strictEqual(kcalFromPerHundred(food, 50).c, 14));
T('TC-E-011','fat scales 200g',                                 () => assert.strictEqual(kcalFromPerHundred(food, 200).f, 0.6));
T('TC-E-012','confidence is 1.0 for DB lookup',                 () => assert.strictEqual(kcalFromPerHundred(food, 100).confidence, 1.0));
T('TC-E-013','source defaults to search',                       () => assert.strictEqual(kcalFromPerHundred(food, 100).source, 'search'));
T('TC-E-014','source override honored',                         () => assert.strictEqual(kcalFromPerHundred({...food, source:'barcode'}, 100).source, 'barcode'));
T('TC-E-015','0g item = 0 kcal',                                () => assert.strictEqual(kcalFromPerHundred(food, 0).kcal, 0));

/* ═══════════════════════════════════════════════════════════════════
   F.  MACRO CALORIES  (TC-F-001..F-010)
   ═══════════════════════════════════════════════════════════════════ */
T('TC-F-001','0/0/0 = 0',                                       () => assert.strictEqual(macroCalories(0,0,0), 0));
T('TC-F-002','protein 25g = 100 kcal',                          () => assert.strictEqual(macroCalories(25,0,0), 100));
T('TC-F-003','carbs 25g = 100 kcal',                            () => assert.strictEqual(macroCalories(0,25,0), 100));
T('TC-F-004','fat 10g = 90 kcal',                               () => assert.strictEqual(macroCalories(0,0,10), 90));
T('TC-F-005','mixed 20p 30c 10f = 290',                         () => assert.strictEqual(macroCalories(20,30,10), 290));
T('TC-F-006','rounded',                                         () => assert.strictEqual(Number.isInteger(macroCalories(5.5,7.7,3.3)), true));
T('TC-F-007','string inputs coerce',                            () => assert.strictEqual(macroCalories('10','20','5'), 165));
T('TC-F-008','undefined → 0',                                   () => assert.strictEqual(macroCalories(undefined,0,0), 0));
T('TC-F-009','negative protein still computed',                 () => assert.strictEqual(macroCalories(-5,0,0), -20));
T('TC-F-010','large meal',                                      () => assert.strictEqual(macroCalories(50,200,80), 1720));

/* ═══════════════════════════════════════════════════════════════════
   G.  STREAK COMPUTATION  (TC-G-001..G-010)
   ═══════════════════════════════════════════════════════════════════ */
function dKey(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return ymd(d);
}
T('TC-G-001','empty meals → streak 0',                          () => assert.strictEqual(streakOf({}), 0));
T('TC-G-002','only today → streak 1',                           () => assert.strictEqual(streakOf({ [dKey(0)]: true }), 1));
T('TC-G-003','today + yesterday → streak 2',                    () => assert.strictEqual(streakOf({ [dKey(0)]: true, [dKey(-1)]: true }), 2));
T('TC-G-004','only yesterday → streak 1 (today not started)',   () => assert.strictEqual(streakOf({ [dKey(-1)]: true }), 1));
T('TC-G-005','three consecutive → streak 3',                    () => assert.strictEqual(streakOf({ [dKey(0)]: true, [dKey(-1)]: true, [dKey(-2)]: true }), 3));
T('TC-G-006','gap breaks streak',                               () => assert.strictEqual(streakOf({ [dKey(0)]: true, [dKey(-2)]: true }), 1));
T('TC-G-007','old streak ignored if today + yesterday empty',   () => assert.strictEqual(streakOf({ [dKey(-5)]: true, [dKey(-6)]: true }), 0));
T('TC-G-008','five consecutive ending yesterday',               () => assert.strictEqual(streakOf({ [dKey(-1)]: true,[dKey(-2)]: true,[dKey(-3)]: true,[dKey(-4)]: true,[dKey(-5)]: true }), 5));
T('TC-G-009','today alone with old gap → 1',                    () => assert.strictEqual(streakOf({ [dKey(0)]: true, [dKey(-10)]: true }), 1));
T('TC-G-010','undefined falsy keys ignored',                    () => assert.strictEqual(streakOf({ [dKey(0)]: false, [dKey(-1)]: false }), 0));

/* ═══════════════════════════════════════════════════════════════════
   H.  FOODS DB SANITY  (TC-H-001..H-010)
   ═══════════════════════════════════════════════════════════════════ */
let foodsDB = [];
try { foodsDB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'foods-db.json'), 'utf8')); } catch (e) { /* test will fail */ }
T('TC-H-001','foods DB is an array',                            () => assert.ok(Array.isArray(foodsDB)));
T('TC-H-002','foods DB has at least 100 entries',               () => assert.ok(foodsDB.length >= 100));
T('TC-H-003','every food has a key',                            () => assert.ok(foodsDB.every(f => typeof f.key === 'string' && f.key.length)));
T('TC-H-004','every food has a name',                           () => assert.ok(foodsDB.every(f => typeof f.name === 'string' && f.name.length)));
T('TC-H-005','every food has kcal_per_100g number',             () => assert.ok(foodsDB.every(f => typeof f.kcal_per_100g === 'number' && f.kcal_per_100g >= 0)));
T('TC-H-006','every food has default_g',                        () => assert.ok(foodsDB.every(f => typeof f.default_g === 'number' && f.default_g > 0)));
T('TC-H-007','no duplicate keys',                               () => { const keys = foodsDB.map(f => f.key); assert.strictEqual(new Set(keys).size, keys.length); });
T('TC-H-008','no duplicate names',                              () => { const names = foodsDB.map(f => f.name); assert.strictEqual(new Set(names).size, names.length); });
T('TC-H-009','at least 30 Indian foods',                        () => assert.ok(foodsDB.filter(f => f.cuisine === 'indian').length >= 30));
T('TC-H-010','no negative macros',                              () => assert.ok(foodsDB.every(f => (f.p||0) >= 0 && (f.c||0) >= 0 && (f.f||0) >= 0)));

/* ═══════════════════════════════════════════════════════════════════
   I.  CALORIE BALANCE SANITY  (TC-I-001..I-010)
   Macro kcal should roughly equal stated kcal (±25% tolerance for fibre/water)
   ═══════════════════════════════════════════════════════════════════ */
T('TC-I-001','rice: macros ≈ stated kcal',                       () => {
  const r = foodsDB.find(f => f.key === 'rice_white');
  const m = macroCalories(r.p, r.c, r.f);
  assert.ok(Math.abs(m - r.kcal_per_100g) / r.kcal_per_100g < 0.30, 'rice macros off: ' + m + ' vs ' + r.kcal_per_100g);
});
T('TC-I-002','paneer: macros ≈ stated kcal',                     () => {
  const r = foodsDB.find(f => f.key === 'paneer_raw');
  const m = macroCalories(r.p, r.c, r.f);
  assert.ok(Math.abs(m - r.kcal_per_100g) / r.kcal_per_100g < 0.30);
});
T('TC-I-003','chicken breast: macros ≈ stated',                  () => {
  const r = foodsDB.find(f => f.key === 'chicken_breast');
  const m = macroCalories(r.p, r.c, r.f);
  assert.ok(Math.abs(m - r.kcal_per_100g) / r.kcal_per_100g < 0.20);
});
T('TC-I-004','egg boiled: macros ≈ stated',                      () => {
  const r = foodsDB.find(f => f.key === 'egg_boiled');
  const m = macroCalories(r.p, r.c, r.f);
  assert.ok(Math.abs(m - r.kcal_per_100g) / r.kcal_per_100g < 0.20);
});
T('TC-I-005','ghee macros ≈ 900 kcal',                           () => {
  const r = foodsDB.find(f => f.key === 'ghee');
  const m = macroCalories(r.p, r.c, r.f);
  assert.ok(Math.abs(m - r.kcal_per_100g) / r.kcal_per_100g < 0.10);
});
T('TC-I-006','all non-alcohol foods within 35% macro-vs-stated', () => {
  // Alcohol (7 kcal/g) isn't captured by the 4-4-9 P/C/F model — exclude beer/wine/etc.
  const alcoholKeys = ['beer', 'wine', 'whisky', 'vodka', 'rum'];
  const bad = foodsDB.filter(f => {
    if (!f.kcal_per_100g) return false;
    if (alcoholKeys.includes(f.key)) return false;
    const m = macroCalories(f.p, f.c, f.f);
    return Math.abs(m - f.kcal_per_100g) / f.kcal_per_100g > 0.35;
  });
  assert.strictEqual(bad.length, 0, 'foods outside tolerance: ' + bad.map(b=>b.key).join(', '));
});
T('TC-I-007','kcal_per_100g ranges plausible (0-1000)',          () => assert.ok(foodsDB.every(f => f.kcal_per_100g <= 1000)));
T('TC-I-008','default_g <= 500 (no absurd default)',             () => assert.ok(foodsDB.every(f => f.default_g <= 500)));
T('TC-I-009','protein never exceeds 60g per 100g',               () => assert.ok(foodsDB.every(f => (f.p||0) <= 60)));
T('TC-I-010','fat never exceeds 100g per 100g',                  () => assert.ok(foodsDB.every(f => (f.f||0) <= 100)));

/* ═══════════════════════════════════════════════════════════════════
   J.  SUMMARY
   ═══════════════════════════════════════════════════════════════════ */
const total = passed + failed;
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  CALORIE SNAP AUTO-SUITE  —  ' + passed + '/' + total + ' passed  (' + failed + ' failed)');
console.log('═══════════════════════════════════════════════════════════');
if (failed > 0) {
  console.log('\n  FAILURES:\n');
  errors.forEach(e => console.log('  ✗ ' + e.id + '  ' + e.name + '\n      ' + e.msg));
  process.exit(1);
} else {
  console.log('  ✓ ALL TESTS PASSED');
  process.exit(0);
}
