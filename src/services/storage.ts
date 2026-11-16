import { AppDatabaseState, IngredientLot, PackagingLot, PosConnectionSettings } from '../types';
import { fetchSheetGvizRows } from './posSync';
import { createInitialSeedState } from './seedData';

const STORAGE_KEY = 'refv_cost_pnl_db_v2_clean';
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

  return {
    settings: local.settings || disk.settings,
    packagingItems: mergeById(disk.packagingItems, local.packagingItems),
    packagingLots: mergeById(disk.packagingLots, local.packagingLots),
    ingredients: mergeById(disk.ingredients, local.ingredients),
    ingredientLots: mergeById(disk.ingredientLots, local.ingredientLots),
    recipes: mergedRecipes,
    events: mergeById(disk.events, local.events),
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

  // 2. อ่านตาราง Tax_Packaging_Lots และ Tax_Ingredient_Lots จากชีทเผื่อมีการแก้ไขบนชีทโดยตรง
  if (baseState) {
    try {
      const pkgRows = await fetchSheetGvizRows(settings.sheetId, 'Tax_Packaging_Lots');
      if (pkgRows && pkgRows.length > 0) {
        const lots: PackagingLot[] = [];
        for (const r of pkgRows) {
          const id = String(r[0] || '').trim();
          if (!id || id === 'Lot ID') continue;
          const qty = Number(r[5]) || 0;
          const total = Number(r[6]) || 0;
          lots.push({
            id,
            itemId: String(r[1] || 'pkg-cup').trim(),
            purchaseDate: String(r[3] || '').trim(),
            vendor: String(r[4] || '').trim(),
            quantity: qty,
            totalPrice: total,
            unitCost: Number(r[7]) || (qty > 0 ? total / qty : 0),
            note: String(r[8] || '').trim() || undefined,
          });
        }
        if (lots.length > 0) {
          baseState.packagingLots = lots;
        }
      }
    } catch {
      // ignore
    }

    try {
      const ingRows = await fetchSheetGvizRows(settings.sheetId, 'Tax_Ingredient_Lots');
      if (ingRows && ingRows.length > 0) {
        const lots: IngredientLot[] = [];
        for (const r of ingRows) {
          const id = String(r[0] || '').trim();
          if (!id || id === 'Lot ID') continue;
          const weight = Number(r[5]) || 0;
          const total = Number(r[6]) || 0;
          lots.push({
            id,
            ingredientId: String(r[1] || '').trim(),
            purchaseDate: String(r[3] || '').trim(),
            vendor: String(r[4] || '').trim(),
            weightGrams: weight,
            totalPrice: total,
            costPerGram: Number(r[7]) || (weight > 0 ? total / weight : 0),
            note: String(r[8] || '').trim() || undefined,
          });
        }
        if (lots.length > 0) {
          baseState.ingredientLots = lots;
        }
      }
    } catch {
      // ignore
    }

    // 3. อ่านตาราง Tax_Recipes จากชีทเผื่อมีการแก้ปริมาณกรัมหรือเปลี่ยนล็อตใน Google Sheet โดยตรง
    try {
      const recRows = await fetchSheetGvizRows(settings.sheetId, 'Tax_Recipes');
      if (recRows && recRows.length > 0) {
        const recipeLinesMap = new Map<
          string,
          {
            category: string;
            mode: 'per_cup' | 'per_batch';
            batchYieldCups: number;
            ingredients: { ingredientId: string; gramsPerBatch: number; selectedLotId?: string }[];
          }
        >();

        for (const r of recRows) {
          const flavorName = String(r[0] || '').trim();
          if (!flavorName || flavorName === 'Flavor Name') continue;
          const category = String(r[1] || 'Original').trim();
          const modeRaw = String(r[2] || 'per_cup').trim();
          const mode: 'per_cup' | 'per_batch' = modeRaw === 'per_batch' ? 'per_batch' : 'per_cup';
          const batchYieldCups = Number(r[3]) || 1;
          const ingredientId = String(r[4] || '').trim();
          const grams = Number(r[6]) || 0;
          const selectedLotId = String(r[7] || 'fifo').trim();

          if (!recipeLinesMap.has(flavorName)) {
            recipeLinesMap.set(flavorName, {
              category,
              mode,
              batchYieldCups,
              ingredients: [],
            });
          }
          if (ingredientId && grams > 0) {
            recipeLinesMap.get(flavorName)!.ingredients.push({
              ingredientId,
              gramsPerBatch: grams,
              selectedLotId,
            });
          }
        }

        if (recipeLinesMap.size > 0) {
          baseState.recipes = baseState.recipes.map((rec) => {
            const fromSheet = recipeLinesMap.get(rec.name);
            if (!fromSheet) return rec;
            return {
              ...rec,
              mode: fromSheet.mode,
              batchYieldCups: fromSheet.batchYieldCups,
              ingredients: fromSheet.ingredients,
            };
          });
        }
      }
    } catch {
      // ignore
    }
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
