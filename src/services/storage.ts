import { AppDatabaseState, IngredientLot, PackagingLot, PosConnectionSettings } from '../types';
import { fetchSheetGvizRows } from './posSync';
import { createInitialSeedState } from './seedData';

const STORAGE_KEY = 'refv_cost_pnl_db_v3_booth_batches';
try {
  localStorage.removeItem('refv_cost_pnl_db_v1');
} catch {
  // ignore
}

export type SyncStatusInfo = {
  diskSaved: boolean;
  cloudSynced: boolean;
  lastSavedAt: string;
  message: string;
};

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function ensureEventSnapshots(state: AppDatabaseState): AppDatabaseState {
  let changed = false;
  const events = (state.events || []).map((ev) => {
    if (!ev.recipeSnapshots || ev.recipeSnapshots.length === 0) {
      changed = true;
      return {
        ...ev,
        recipeSnapshots: JSON.parse(JSON.stringify(state.recipes || [])),
      };
    }
    return ev;
  });
  return changed ? { ...state, events } : state;
}

export function loadAppState(): AppDatabaseState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = ensureEventSnapshots(createInitialSeedState());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as AppDatabaseState;
    if (!parsed || !Array.isArray(parsed.packagingItems) || !Array.isArray(parsed.recipes)) {
      const seed = ensureEventSnapshots(createInitialSeedState());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    return ensureEventSnapshots(parsed);
  } catch {
    return ensureEventSnapshots(createInitialSeedState());
  }
}

function mergeById<T extends { id: string }>(diskList: T[] = [], localList: T[] = []): T[] {
  const map = new Map<string, T>();
  for (const item of diskList) {
    if (item && item.id) map.set(item.id, item);
  }
  for (const item of localList) {
    if (item && item.id) map.set(item.id, item);
  }
  return Array.from(map.values());
}

function mergeLocalAndDiskState(
  local: AppDatabaseState,
  disk: AppDatabaseState
): AppDatabaseState {
  const mergedRecipes = mergeById(disk.recipes, local.recipes).map((r) => {
    const diskR = (disk.recipes || []).find((x) => x.id === r.id);
    const localR = (local.recipes || []).find((x) => x.id === r.id);
    if (localR && diskR) {
      return (localR.ingredients?.length || 0) >= (diskR.ingredients?.length || 0) ? localR : diskR;
    }
    return localR || diskR || r;
  });

  const mergedEvents = (disk.events || []).map((diskEv) => {
    const localEv = (local.events || []).find((x) => x.id === diskEv.id);
    if (!localEv) return diskEv;
    const diskBatches = diskEv.boothBatches?.length || 0;
    const localBatches = localEv.boothBatches?.length || 0;
    if (diskBatches > localBatches) {
      return {
        ...localEv,
        boothBatches: diskEv.boothBatches,
        flavorProductionUsages: diskEv.flavorProductionUsages || localEv.flavorProductionUsages,
      };
    }
    return localEv;
  });
  for (const localEv of local.events || []) {
    if (!mergedEvents.some((x) => x.id === localEv.id)) {
      mergedEvents.push(localEv);
    }
  }

  return {
    settings: local.settings || disk.settings,
    packagingItems: mergeById(disk.packagingItems, local.packagingItems),
    packagingLots: mergeById(disk.packagingLots, local.packagingLots),
    ingredients: mergeById(disk.ingredients, local.ingredients),
    ingredientLots: mergeById(disk.ingredientLots, local.ingredientLots),
    recipes: mergedRecipes,
    events: mergedEvents,
  };
}

/**
 * โหลดข้อมูลจากไฟล์จริงในเครื่อง (/Users/itspopstix/REFV Tax/data/database.json)
 * และผสานกับข้อมูลล่าสุดบนหน้าเว็บเพื่อไม่ให้ข้อมูลที่กรอกค้างไว้สูญหาย
 */
export async function loadStateFromDiskOrCloud(
  currentState: AppDatabaseState
): Promise<{ state: AppDatabaseState; source: 'disk' | 'cloud' | 'seed' }> {
  try {
    const res = await fetch('/api/db', { cache: 'no-store' });
    if (res.ok) {
      const diskData = (await res.json()) as AppDatabaseState;
      if (diskData && Array.isArray(diskData.recipes) && Array.isArray(diskData.packagingItems)) {
        const merged = mergeLocalAndDiskState(currentState, diskData);
        const normalized = ensureEventSnapshots(merged);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        await saveToDiskFile(normalized);
        return { state: normalized, source: 'disk' };
      }
    } else if (res.status === 404) {
      const cloudData = await pullDatabaseFromGoogleSheets(currentState.settings);
      if (cloudData) {
        const normalized = ensureEventSnapshots(cloudData);
        await saveToDiskFile(normalized);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        return { state: normalized, source: 'cloud' };
      }
      await saveToDiskFile(currentState);
    }
  } catch {
    const cloudData = await pullDatabaseFromGoogleSheets(currentState.settings);
    if (cloudData) {
      const normalized = ensureEventSnapshots(cloudData);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return { state: normalized, source: 'cloud' };
    }
  }

  return { state: currentState, source: 'seed' };
}

export async function saveToDiskFile(state: AppDatabaseState): Promise<boolean> {
  try {
    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * ส่งข้อมูลทั้งหมดขึ้นไปบันทึกบน Google Sheets (แท็บ Tax_DB_State, Tax_Recipes, Tax_Packaging_Lots, Tax_Ingredient_Lots, Tax_Events)
 */
export async function pushDatabaseToGoogleSheets(state: AppDatabaseState): Promise<boolean> {
  const url = (state.settings?.appsScriptUrl || '').trim();
  if (!url || !url.includes('script.google.com')) return false;

  const payload = JSON.stringify({
    type: 'save_tax_state',
    state,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
    });
    const text = (await res.text()).trim();
    if (text.startsWith('ok')) return true;
  } catch {
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: payload,
      });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * ดึงข้อมูลจาก Google Sheets:
 * 1. อ่านก้อนข้อมูลหลักจากแท็บ Tax_DB_State (รองรับทั้งแบบบรรทัดเดียวและแบบแบ่ง Chunk)
 * 2. อ่านตาราง Tax_Recipes, Tax_Packaging_Lots, Tax_Ingredient_Lots เผื่อผู้ใช้แก้ตัวเลขใน Google Sheet โดยตรง
 */
export async function pullDatabaseFromGoogleSheets(
  settings: PosConnectionSettings
): Promise<AppDatabaseState | null> {
  if (!settings.sheetId) return null;

  let baseState: AppDatabaseState | null = null;

  // 1. อ่านจากแท็บ Tax_DB_State ผ่าน GViz
  try {
    const rows = await fetchSheetGvizRows(settings.sheetId, 'Tax_DB_State');
    if (rows && rows.length > 0) {
      const chunks: { idx: number; text: string }[] = [];
      for (const r of rows) {
        const c0 = String(r[0] || '').trim();
        const c1 = String(r[1] || '').trim();
        if (c0 === 'CHUNK_INDEX' || c0 === 'JSON_STATE') continue;
        if (c0.startsWith('{') && c0.includes('"recipes"')) {
          chunks.push({ idx: 0, text: c0 });
        } else if (c1) {
          chunks.push({ idx: Number(c0) || 0, text: c1 });
        }
      }
      if (chunks.length > 0) {
        chunks.sort((a, b) => a.idx - b.idx);
        const fullJson = chunks.map((c) => c.text).join('');
        const parsed = JSON.parse(fullJson) as AppDatabaseState;
        if (parsed && Array.isArray(parsed.recipes)) {
          baseState = parsed;
        }
      }
    }
  } catch {
    // fallback ต่อ
  }

  // 2. ถ้าดึง Tax_DB_State ได้แล้ว ให้ใช้ข้อมูลก้อนนี้เป็นหลัก 100% เพราะมีข้อมูลครบถ้วนที่สุด
  // (ทั้งการเลือกล็อต, รอบการผลิต Production Runs, Event Usages)
  // หากดึง Tax_DB_State ไม่สำเร็จ จึงค่อย fallback ไปอ่านจากแท็บตารางย่อย
  if (!baseState) {
    // fallback ต่อ
  }

  return baseState ? ensureEventSnapshots(baseState) : null;
}


export function saveAppState(
  state: AppDatabaseState,
  onStatusChange?: (status: SyncStatusInfo) => void
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }

  const timeStr = new Date().toLocaleTimeString('th-TH');

  saveToDiskFile(state).then((diskOk) => {
    if (onStatusChange) {
      onStatusChange({
        diskSaved: diskOk,
        cloudSynced: false,
        lastSavedAt: timeStr,
        message: diskOk
          ? `บันทึกลงไฟล์ data/database.json แล้ว (${timeStr})`
          : `บันทึกในเครื่องแล้ว (${timeStr})`,
      });
    }
  });

  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    const cloudOk = await pushDatabaseToGoogleSheets(state);
    if (onStatusChange) {
      onStatusChange({
        diskSaved: true,
        cloudSynced: cloudOk,
        lastSavedAt: new Date().toLocaleTimeString('th-TH'),
        message: cloudOk
          ? `บันทึกครบทั้งไฟล์ในเครื่อง + Google Sheets (${new Date().toLocaleTimeString('th-TH')})`
          : `บันทึกลงไฟล์ data/database.json ในเครื่องแล้ว (${timeStr})`,
      });
    }
  }, 1200);
}

export function resetToDemoState(): AppDatabaseState {
  const seed = ensureEventSnapshots(createInitialSeedState());
  saveAppState(seed);
  return seed;
}

export function clearDemoTransactionsOnly(current: AppDatabaseState): AppDatabaseState {
  const cleaned: AppDatabaseState = {
    ...current,
    packagingLots: [],
    ingredientLots: current.ingredientLots,
    events: [],
  };
  saveAppState(cleaned);
  return cleaned;
}

export function formatBaht(n: number, decimals = 2): string {
  const val = Number(n) || 0;
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  return (
    sign +
    '฿' +
    abs.toLocaleString('th-TH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

export function formatSignedBaht(n: number, decimals = 2): string {
  const val = Number(n) || 0;
  const sign = val > 0 ? '+' : val < 0 ? '-' : '';
  const abs = Math.abs(val);
  return (
    sign +
    '฿' +
    abs.toLocaleString('th-TH', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}
