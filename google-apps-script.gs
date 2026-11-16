/**
 * ============================================================================
 * REFV POS + REFV Cost & P&L (Unified Google Apps Script Backend)
 * ============================================================================
 * วิธีติดตั้ง (ใช้ร่วมกับชีท REFV POS เดิมได้ทันที โดยไม่กระทบข้อมูลขายเดิม):
 * 1. เปิด Google Sheet ของ REFV POS
 * 2. ไปที่เมนู Extensions (ส่วนขยาย) > Apps Script
 * 3. วางโค้ดนี้ทับของเดิม แล้วกด Save (แผ่นดิสก์)
 * 4. กด Deploy > Manage deployments > คลิกปุ่มดินสอ (Edit)
 *    > ช่อง Version เลือก "New version" > กด Deploy
 *
 * แท็บใน Google Sheet ที่ระบบสร้างและใช้งานอัตโนมัติ:
 *   [ฝั่ง REFV POS เดิม]
 *   - "Sales"               : รายการขายรายถ้วยจาก POS
 *   - "Flavor"              : รายชื่อรสชาติไอติม
 *   - "Promotion"           : โปรโมชั่นส่วนลด
 *   - "Settings"            : ตั้งค่าเบอร์ PromptPay
 *
 *   [ฝั่ง REFV Cost & P&L ใหม่]
 *   - "Tax_Recipes"         : ตารางสูตรไอติมแต่ละรสชาติ (ดู/แก้ไขในชีทได้)
 *   - "Tax_Packaging_Lots"  : ประวัติการซื้อแก้ว/ช้อน/แพ็กเกจจิ้ง (FIFO)
 *   - "Tax_Ingredient_Lots" : ประวัติการซื้อวัตถุดิบ (กรัม, ราคา, บาท/กรัม)
 *   - "Tax_Events"          : รายการออกบูธและค่าใช้จ่ายหน้างาน
 *   - "Tax_DB_State"        : ข้อมูลระบบทั้งหมดสำหรับ Sync ข้ามเครื่อง 100%
 */

const SALES = 'Sales';
const FLAVORS = 'Flavor';
const SETTINGS = 'Settings';
const PROMOTIONS = 'Promotion';

const TAX_RECIPES = 'Tax_Recipes';
const TAX_PKG_LOTS = 'Tax_Packaging_Lots';
const TAX_ING_LOTS = 'Tax_Ingredient_Lots';
const TAX_EVENTS = 'Tax_Events';
const TAX_DB_STATE = 'Tax_DB_State';

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (name === FLAVORS) {
    return ss.getSheetByName('Flavor') || ss.getSheetByName('Flavors') || ss.insertSheet('Flavor');
  }
  if (name === PROMOTIONS) {
    return ss.getSheetByName('Promotion') || ss.getSheetByName('Promotions') || ss.insertSheet('Promotion');
  }
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getPP_() {
  const sh = sheet_(SETTINGS), v = sh.getDataRange().getValues();
  for (const r of v) if (r[0] === 'pp') return String(r[1] || '');
  return '';
}

function setPP_(pp) {
  const sh = sheet_(SETTINGS), v = sh.getDataRange().getValues();
  for (let i = 0; i < v.length; i++) {
    if (v[i][0] === 'pp') { sh.getRange(i + 1, 2).setNumberFormat('@').setValue(pp); return; }
  }
  sh.appendRow(['pp', '']);
  sh.getRange(sh.getLastRow(), 2).setNumberFormat('@').setValue(pp);
}

function readFlavors_() {
  const sh = sheet_(FLAVORS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Flavor Name', 'Category', 'Status', 'Image URL']);
    sh.setFrozenRows(1);
    const defaults = [
      ['Holy Cow!', 'Original', 'Active', ''],
      ['Thai Tea', 'Original', 'Active', ''],
      ["Pecan't Sleep", 'Premium', 'Active', ''],
      ['70% Into Dark Side', 'Premium', 'Active', ''],
      ['Weirdly Wonderful', 'Premium', 'Active', ''],
      ['Nutting to Prove', 'Signature', 'Active', ''],
      ['Matcha Snob', 'Signature', 'Active', '']
    ];
    sh.getRange(2, 1, defaults.length, 4).setValues(defaults);
  }
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, 4).getValues();
  const list = [];
  rows.forEach(r => {
    const name = String(r[0] || '').trim();
    const cat = String(r[1] || 'Original').trim();
    const status = String(r[2] || 'Active').trim().toLowerCase();
    const img = String(r[3] || '').trim();
    if (!name) return;
    if (status === 'inactive' || status === 'disabled' || status === 'hidden') return;
    list.push({ n: name, c: cat, i: img || 'g6' });
  });
  return list;
}

function readPromotions_() {
  const sh = sheet_(PROMOTIONS);
  if (sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  const list = [];
  rows.forEach(r => {
    const name = String(r[0] || '').trim();
    const type = String(r[1] || 'Each').trim();
    const discType = String(r[2] || 'Amount').trim();
    const val = Number(r[3]) || 0;
    if (!name || name.toLowerCase().includes('name')) return;
    list.push({ name, type, discType, val });
  });
  return list;
}

/** อ่านข้อมูลระบบ REFV Cost & P&L จากแท็บ Tax_DB_State (รองรับการต่อ Chunk หลายแถว) */
function readTaxState_() {
  const sh = sheet_(TAX_DB_STATE);
  if (sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  const chunks = [];
  rows.forEach(r => {
    const c0 = String(r[0] || '').trim();
    const c1 = String(r[1] || '');
    if (c0.startsWith('{') && c0.includes('"recipes"')) {
      chunks.push({ idx: 0, text: c0 });
    } else if (c1) {
      chunks.push({ idx: Number(c0) || 0, text: c1 });
    }
  });
  if (!chunks.length) return null;
  chunks.sort((a, b) => a.idx - b.idx);
  try {
    return JSON.parse(chunks.map(c => c.text).join(''));
  } catch (e) {
    return null;
  }
}

/** บันทึกข้อมูล REFV Cost & P&L ลงทั้งแท็บตารางอ่านง่าย และแท็บ Tax_DB_State (แบ่ง Chunk ไม่ให้เกิน 50,000 ตัวอักษรต่อเซลล์) */
function saveTaxState_(state) {
  if (!state) return;

  // 1. บันทึก JSON Snapshot ลง Tax_DB_State แบบแบ่ง Chunk ละ 35,000 ตัวอักษร
  const shState = sheet_(TAX_DB_STATE);
  shState.clear();
  shState.appendRow(['CHUNK_INDEX', 'JSON_CHUNK', 'UPDATED_AT']);
  shState.setFrozenRows(1);
  const compact = JSON.stringify(state);
  const chunkSize = 35000;
  const now = new Date().toISOString();
  const stateRows = [];
  for (let i = 0, idx = 0; i < compact.length; i += chunkSize, idx++) {
    stateRows.push([String(idx), compact.slice(i, i + chunkSize), now]);
  }
  if (stateRows.length > 0) {
    shState.getRange(2, 1, stateRows.length, 3).setValues(stateRows);
  }

  // 2. เขียนตารางสูตรไอติมลงแท็บ Tax_Recipes ให้อ่าน/ตรวจสอบใน Google Sheet ได้ง่าย
  const shRec = sheet_(TAX_RECIPES);
  shRec.clear();
  shRec.appendRow(['Flavor Name', 'Category', 'Mode', 'Batch Yield (Cups)', 'Ingredient ID', 'Ingredient Name', 'Grams']);
  shRec.setFrozenRows(1);
  const ingMap = {};
  (state.ingredients || []).forEach(i => { ingMap[i.id] = i.name; });
  const recRows = [];
  (state.recipes || []).forEach(r => {
    (r.ingredients || []).forEach(line => {
      recRows.push([
        r.name,
        r.category,
        r.mode,
        r.batchYieldCups || 1,
        line.ingredientId,
        ingMap[line.ingredientId] || line.ingredientId,
        line.gramsPerBatch
      ]);
    });
  });
  if (recRows.length > 0) {
    shRec.getRange(2, 1, recRows.length, 7).setValues(recRows);
  }

  // 3. เขียนตารางล็อตซื้อแพ็กเกจจิ้งลงแท็บ Tax_Packaging_Lots
  const shPkg = sheet_(TAX_PKG_LOTS);
  shPkg.clear();
  shPkg.appendRow(['Lot ID', 'Item ID', 'Item Name', 'Purchase Date', 'Vendor', 'Quantity', 'Total Price (THB)', 'Unit Cost (THB)']);
  shPkg.setFrozenRows(1);
  const pkgMap = {};
  (state.packagingItems || []).forEach(p => { pkgMap[p.id] = p.name; });
  const pkgRows = (state.packagingLots || []).map(l => [
    l.id, l.itemId, pkgMap[l.itemId] || l.itemId, l.purchaseDate, l.vendor, l.quantity, l.totalPrice, l.unitCost
  ]);
  if (pkgRows.length > 0) {
    shPkg.getRange(2, 1, pkgRows.length, 8).setValues(pkgRows);
  }

  // 4. เขียนตารางล็อตซื้อวัตถุดิบลงแท็บ Tax_Ingredient_Lots
  const shIng = sheet_(TAX_ING_LOTS);
  shIng.clear();
  shIng.appendRow(['Lot ID', 'Ingredient ID', 'Ingredient Name', 'Purchase Date', 'Vendor', 'Weight (Grams)', 'Total Price (THB)', 'Cost per Gram (THB/g)']);
  shIng.setFrozenRows(1);
  const ingRows = (state.ingredientLots || []).map(l => [
    l.id, l.ingredientId, ingMap[l.ingredientId] || l.ingredientId, l.purchaseDate, l.vendor, l.weightGrams, l.totalPrice, l.costPerGram
  ]);
  if (ingRows.length > 0) {
    shIng.getRange(2, 1, ingRows.length, 8).setValues(ingRows);
  }

  // 5. เขียนตารางงานออกบูธลงแท็บ Tax_Events
  const shEv = sheet_(TAX_EVENTS);
  shEv.clear();
  shEv.appendRow(['Event ID', 'Event Name', 'Location', 'Start Date', 'End Date', 'Cups Sold (POS)', 'Fixed Expenses Total (THB)']);
  shEv.setFrozenRows(1);
  const evRows = (state.events || []).map(ev => {
    const expSum = (ev.expenses || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    return [ev.id, ev.name, ev.location, ev.startDate, ev.endDate, (ev.posSales || []).length, expSum];
  });
  if (evRows.length > 0) {
    shEv.getRange(2, 1, evRows.length, 7).setValues(evRows);
  }
}

function doGet(e) {
  const mode = e && e.parameter && e.parameter.mode;
  if (mode === 'config') return json_({ pp: getPP_(), flavors: readFlavors_(), promotions: readPromotions_() });
  if (mode === 'flavors') return json_({ flavors: readFlavors_() });
  if (mode === 'promotions') return json_({ promotions: readPromotions_() });
  if (mode === 'report') return json_({ sales: readSales_() });
  if (mode === 'tax_state') return json_({ state: readTaxState_(), sales: readSales_() });
  return ContentService.createTextOutput('REFV POS & Cost P&L ready');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.type === 'save_tax_state') {
      saveTaxState_(data.state);
      return ContentService.createTextOutput('ok');
    }
    if (data.type === 'config') {
      setPP_(String(data.pp || ''));
      return ContentService.createTextOutput('ok');
    }
    if (data.type === 'new_flavor') {
      const sh = sheet_(FLAVORS);
      if (sh.getLastRow() === 0) readFlavors_();
      sh.appendRow([String(data.n || '').trim(), String(data.c || 'Original').trim(), 'Active', '']);
      return ContentService.createTextOutput('ok');
    }
    if (data.type === 'delete_flavor') {
      const sh = sheet_(FLAVORS);
      const rows = sh.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).trim().toLowerCase() === String(data.n).trim().toLowerCase()) {
          sh.getRange(i + 1, 3).setValue('Inactive');
          return ContentService.createTextOutput('ok');
        }
      }
      return ContentService.createTextOutput('ok');
    }
    const rows = data.rows || [], head = data.head || [];
    if (!rows.length) return ContentService.createTextOutput('ok');
    const sh = sheet_(SALES);
    if (sh.getLastRow() === 0) {
      sh.appendRow(head);
      sh.setFrozenRows(1);
    }
    const have = {};
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(r => have[r[0]] = true);
    }
    const fresh = rows.filter(r => !have[r[0]]);
    if (fresh.length) {
      const start = sh.getLastRow() + 1;
      sh.getRange(start, 1, fresh.length, 3).setNumberFormat('@');
      sh.getRange(start, 1, fresh.length, fresh[0].length).setValues(fresh);
    }
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error ' + err);
  } finally {
    lock.releaseLock();
  }
}

function readSales_() {
  const sh = sheet_(SALES);
  if (sh.getLastRow() < 2) return [];
  const numCols = Math.max(13, sh.getLastColumn());
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, numCols).getValues();
  const map = {}, order = [];
  rows.forEach(r => {
    const id = r[0];
    if (!id) return;
    const key = String(id);
    const date = r[1], time = r[2], type = r[3], cups = r[4], f1 = r[5], f2 = r[6], c1 = r[7], c2 = r[8], pay = r[9];
    const is13 = r.length >= 13;
    const promo = is13 ? String(r[10] || '') : '';
    const disc = is13 ? (Number(r[11]) || 0) : 0;
    const amt = is13 ? (Number(r[12]) || 0) : (Number(r[10]) || 0);
    if (!map[key]) {
      const d = new Date(String(date) + 'T' + String(time) + '+07:00');
      map[key] = {
        id: key, ts: isNaN(d) ? Date.now() : d.getTime(), items: [], total: 0,
        pay: String(pay).toUpperCase() === 'QR' ? 'qr' : 'cash', synced: 1,
        promo: promo || undefined
      };
      order.push(key);
    }
    const price = Number(amt) || 0, n = Number(cups) || 1;
    const parts = [{ name: f1, cat: c1, price: n === 2 ? price / 2 : price }];
    if (f2) parts.push({ name: f2, cat: c2, price: price / 2 });
    map[key].items.push({ type: String(type), cups: n, drink: '', parts, price, discount: disc, promo });
    map[key].total += price;
  });
  return order.map(k => { map[k].recv = map[k].total; return map[k]; });
}

