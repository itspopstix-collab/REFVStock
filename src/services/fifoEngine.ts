import {
  AppDatabaseState,
  BoothEvent,
  EventPnLResult,
  ExpenseCategory,
  FifoLotUsageSlice,
  FlavorCategory,
  FlavorEventSummary,
  FlavorRecipe,
  IngredientEventUsage,
  PackagingEventUsage,
} from '../types';

export const POS_SELLING_PRICE: Record<FlavorCategory, { single: number; half: number; affogato: number }> = {
  Original: { single: 79, half: 40, affogato: 79 },
  Premium: { single: 89, half: 45, affogato: 84 },
  Signature: { single: 99, half: 50, affogato: 89 },
};

export interface LotRemainingState {
  lotId: string;
  itemId: string;
  purchaseDate: string;
  vendor: string;
  initialQty: number;
  usedQty: number;
  remainingQty: number;
  unitCost: number;
  totalPrice: number;
  usageByEvent: { eventId: string; eventName: string; qtyUsed: number; cost: number }[];
}

export interface SystemSimulationResult {
  packagingLotStates: Record<string, LotRemainingState[]>;
  ingredientLotStates: Record<string, LotRemainingState[]>;
  eventResults: Record<string, EventPnLResult>;
}

/**
 * คำนวณราคาต่อกรัมของวัตถุดิบ โดยรองรับการเลือกเจาะจงว่าใช้การซื้อครั้งไหน (Lot ไหน):
 * - selectedLotId === undefined หรือ 'fifo': ดึงจากล็อตเก่าสุดที่ยังมีของเหลือ (FIFO)
 * - selectedLotId === 'latest': ดึงจากล็อตล่าสุดที่ซื้อเข้ามา
 * - selectedLotId === '<lotId>': ดึงจากล็อตการซื้อครั้งนั้นโดยตรง
 */
export function getActiveIngredientCostPerGram(
  ingredientId: string,
  state: AppDatabaseState,
  sim?: SystemSimulationResult,
  selectedLotId?: string
): { costPerGram: number; activeVendor: string; remainingGrams: number; resolvedLotId: string } {
  const lots = state.ingredientLots
    .filter((l) => l.ingredientId === ingredientId)
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));

  if (lots.length === 0) {
    return {
      costPerGram: 0,
      activeVendor: 'ยังไม่มีประวัติซื้อ',
      remainingGrams: 0,
      resolvedLotId: 'fifo',
    };
  }

  const lotStates = sim?.ingredientLotStates[ingredientId];
  const totalRemaining = lotStates
    ? lotStates.reduce((s, l) => s + l.remainingQty, 0)
    : lots.reduce((s, l) => s + l.weightGrams, 0);

  // 1. กรณีผู้ใช้ระบุเจาะจงว่าใช้การซื้อครั้งไหน (Specific Lot ID)
  if (selectedLotId && selectedLotId !== 'fifo' && selectedLotId !== 'latest') {
    const matchedLot = lots.find((l) => l.id === selectedLotId);
    if (matchedLot) {
      const matchedState = lotStates?.find((l) => l.lotId === selectedLotId);
      const idx = lots.findIndex((l) => l.id === selectedLotId) + 1;
      return {
        costPerGram: matchedLot.costPerGram,
        activeVendor: `ครั้งที่ ${idx}: ${matchedLot.purchaseDate} · ${matchedLot.vendor}`,
        remainingGrams: matchedState ? matchedState.remainingQty : matchedLot.weightGrams,
        resolvedLotId: matchedLot.id,
      };
    }
  }

  // 2. กรณีเลือกใช้ราคาล็อตล่าสุด (Latest Lot)
  if (selectedLotId === 'latest') {
    const lastLot = lots[lots.length - 1];
    const lastState = lotStates?.find((l) => l.lotId === lastLot.id);
    return {
      costPerGram: lastLot.costPerGram,
      activeVendor: `ครั้งล่าสุด (#${lots.length}): ${lastLot.purchaseDate} · ${lastLot.vendor}`,
      remainingGrams: lastState ? lastState.remainingQty : lastLot.weightGrams,
      resolvedLotId: 'latest',
    };
  }

  // 3. ค่าเริ่มต้น: FIFO (ล็อตแรกที่ยังมีของเหลืออยู่)
  if (lotStates) {
    const firstAvailableIdx = lotStates.findIndex((l) => l.remainingQty > 0.001);
    if (firstAvailableIdx >= 0) {
      const firstAvailable = lotStates[firstAvailableIdx];
      return {
        costPerGram: firstAvailable.unitCost,
        activeVendor: `FIFO (ครั้งที่ ${firstAvailableIdx + 1}: ${firstAvailable.purchaseDate} · ${firstAvailable.vendor})`,
        remainingGrams: totalRemaining,
        resolvedLotId: 'fifo',
      };
    }
    const lastLot = lotStates[lotStates.length - 1];
    return {
      costPerGram: lastLot.unitCost,
      activeVendor: `${lastLot.vendor} (ล็อตล่าสุด)`,
      remainingGrams: 0,
      resolvedLotId: 'fifo',
    };
  }

  const first = lots[0];
  return {
    costPerGram: first.costPerGram,
    activeVendor: `FIFO (ครั้งที่ 1: ${first.purchaseDate} · ${first.vendor})`,
    remainingGrams: totalRemaining,
    resolvedLotId: 'fifo',
  };
}

export function getActivePackagingUnitCost(
  itemId: string,
  state: AppDatabaseState,
  sim?: SystemSimulationResult
): { unitCost: number; activeVendor: string; remainingQty: number } {
  const lots = state.packagingLots
    .filter((l) => l.itemId === itemId)
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));

  if (lots.length === 0) {
    return { unitCost: 0, activeVendor: 'ยังไม่มีประวัติซื้อ', remainingQty: 0 };
  }

  if (sim && sim.packagingLotStates[itemId]) {
    const lotStates = sim.packagingLotStates[itemId];
    const totalRemaining = lotStates.reduce((s, l) => s + l.remainingQty, 0);
    const firstAvailable = lotStates.find((l) => l.remainingQty > 0.001);
    if (firstAvailable) {
      return {
        unitCost: firstAvailable.unitCost,
        activeVendor: firstAvailable.vendor,
        remainingQty: totalRemaining,
      };
    }
    const lastLot = lotStates[lotStates.length - 1];
    return {
      unitCost: lastLot.unitCost,
      activeVendor: `${lastLot.vendor} (ล็อตล่าสุด)`,
      remainingQty: 0,
    };
  }

  const last = lots[lots.length - 1];
  const totalQty = lots.reduce((s, l) => s + l.quantity, 0);
  return {
    unitCost: last.unitCost,
    activeVendor: last.vendor,
    remainingQty: totalQty,
  };
}

/**
 * คำนวณน้ำหนักรวมต่อหม้อปั่น (กรัม/หม้อ), น้ำหนักตักต่อถ้วย (กรัม/ถ้วย) และจำนวนถ้วยที่ได้ต่อหม้อ
 */
export function resolveRecipeYieldMetrics(recipe: FlavorRecipe) {
  const rawTotalBatchGrams = recipe.ingredients.reduce(
    (s, l) => s + (Number(l.gramsPerBatch) || 0),
    0
  );
  if (recipe.mode === 'per_cup') {
    const servingGramsPerCup =
      rawTotalBatchGrams > 0 ? rawTotalBatchGrams : recipe.gramsPerCup || 80;
    const halfRatio = recipe.halfScoopRatio || 0.5;
    const servingGramsPerHalfCup =
      recipe.gramsPerHalfCup && recipe.gramsPerHalfCup > 0
        ? recipe.gramsPerHalfCup
        : servingGramsPerCup * halfRatio;
    return {
      rawTotalBatchGrams,
      effectiveBatchGrams: rawTotalBatchGrams,
      servingGramsPerCup,
      servingGramsPerHalfCup,
      yieldCups: 1,
      halfRatio: servingGramsPerCup > 0 ? servingGramsPerHalfCup / servingGramsPerCup : halfRatio,
    };
  }

  // โหมดต่อ 1 หม้อปั่น (per_batch): ใช้หน่วยกรัม (กรัม/หม้อ และ กรัม/ถ้วย) เป็นหลัก
  const effectiveBatchGrams =
    recipe.batchYieldGrams && recipe.batchYieldGrams > 0
      ? recipe.batchYieldGrams
      : rawTotalBatchGrams;
  const servingGramsPerCup =
    recipe.gramsPerCup && recipe.gramsPerCup > 0 ? recipe.gramsPerCup : 80;
  const yieldCups =
    effectiveBatchGrams > 0 && servingGramsPerCup > 0
      ? effectiveBatchGrams / servingGramsPerCup
      : Math.max(1, recipe.batchYieldCups || 1);
  const servingGramsPerHalfCup =
    recipe.gramsPerHalfCup && recipe.gramsPerHalfCup > 0
      ? recipe.gramsPerHalfCup
      : servingGramsPerCup * (recipe.halfScoopRatio || 0.5);
  const halfRatio =
    servingGramsPerCup > 0
      ? servingGramsPerHalfCup / servingGramsPerCup
      : recipe.halfScoopRatio || 0.5;

  return {
    rawTotalBatchGrams,
    effectiveBatchGrams,
    servingGramsPerCup,
    servingGramsPerHalfCup,
    yieldCups,
    halfRatio,
  };
}

/**
 * คำนวณต้นทุนต่อถ้วยของสูตรรสชาติ (รองรับการเลือกว่าแต่ละวัตถุดิบใช้ราคาจากการซื้อครั้งไหน และรองรับการเลือกดูตาม "ครั้งที่ทำ / เติม Stock")
 */
export function calculateRecipeUnitCost(
  recipe: FlavorRecipe,
  state: AppDatabaseState,
  sim?: SystemSimulationResult,
  activeRunId?: string
) {
  const matchedRun =
    activeRunId && activeRunId !== 'master'
      ? (recipe.productionRuns || []).find((r) => r.id === activeRunId)
      : undefined;
  const effectiveRecipe: FlavorRecipe = matchedRun
    ? {
        ...recipe,
        batchYieldGrams: matchedRun.batchYieldGrams ?? recipe.batchYieldGrams,
        ingredients: matchedRun.ingredients,
      }
    : recipe;

  const {
    rawTotalBatchGrams,
    effectiveBatchGrams,
    servingGramsPerCup,
    servingGramsPerHalfCup,
    yieldCups,
    halfRatio,
  } = resolveRecipeYieldMetrics(effectiveRecipe);
  let totalBatchGrams = 0;
  let totalBatchCost = 0;

  const lineBreakdowns = effectiveRecipe.ingredients.map((line) => {
    const ing = state.ingredients.find((i) => i.id === line.ingredientId);
    const { costPerGram, activeVendor, remainingGrams } = getActiveIngredientCostPerGram(
      line.ingredientId,
      state,
      sim,
      line.selectedLotId
    );
    const gramsPerCup = yieldCups > 0 ? line.gramsPerBatch / yieldCups : 0;
    const costPerCup = gramsPerCup * costPerGram;
    totalBatchGrams += line.gramsPerBatch;
    totalBatchCost += line.gramsPerBatch * costPerGram;

    return {
      ingredientId: line.ingredientId,
      ingredientName: ing?.name || 'ไม่ทราบชื่อวัตถุดิบ',
      selectedLotId: line.selectedLotId || 'fifo',
      gramsPerBatch: line.gramsPerBatch,
      gramsPerCup,
      costPerGram,
      activeVendor,
      remainingGrams,
      costPerCup,
    };
  });

  const costPerGramOfFinishedIceCream =
    effectiveBatchGrams > 0 ? totalBatchCost / effectiveBatchGrams : 0;
  const ingredientCostPerFullCup =
    recipe.mode === 'per_cup' ? totalBatchCost : totalBatchCost / yieldCups;
  const gramsPerFullCup =
    recipe.mode === 'per_cup' ? totalBatchGrams : servingGramsPerCup;
  const ingredientCostPerHalfCup = ingredientCostPerFullCup * halfRatio;

  let packagingCostPerCup = 0;
  const packagingBreakdown = state.packagingItems
    .filter((p) => p.usagePerCup > 0 && (p.applyToType === 'all' || p.applyToType === 'gelato'))
    .map((p) => {
      const { unitCost, activeVendor } = getActivePackagingUnitCost(p.id, state, sim);
      const cost = p.usagePerCup * unitCost;
      packagingCostPerCup += cost;
      return {
        itemId: p.id,
        name: p.name,
        usagePerCup: p.usagePerCup,
        unitCost,
        activeVendor,
        cost,
      };
    });

  const totalFullCupCost = ingredientCostPerFullCup + packagingCostPerCup;
  const sellingPriceSingle = POS_SELLING_PRICE[recipe.category]?.single ?? 79;
  const grossProfitSingle = sellingPriceSingle - totalFullCupCost;
  const grossMarginPct = sellingPriceSingle > 0 ? (grossProfitSingle / sellingPriceSingle) * 100 : 0;

  return {
    yieldCups,
    rawTotalBatchGrams,
    effectiveBatchGrams,
    servingGramsPerCup,
    servingGramsPerHalfCup,
    totalBatchCost,
    costPerGramOfFinishedIceCream,
    gramsPerFullCup,
    ingredientCostPerFullCup,
    ingredientCostPerHalfCup,
    packagingCostPerCup,
    totalFullCupCost,
    sellingPriceSingle,
    grossProfitSingle,
    grossMarginPct,
    lineBreakdowns,
    packagingBreakdown,
  };
}

/**
 * จำลองการตัดสต็อกแบบ FIFO (หรือตามล็อตที่ระบุเจาะจงในแต่ละสูตร/แต่ละงานออกบูธ)
 */
export function runFifoSimulation(state: AppDatabaseState): SystemSimulationResult {
  const packagingLotStates: Record<string, LotRemainingState[]> = {};
  for (const item of state.packagingItems) {
    const lots = state.packagingLots
      .filter((l) => l.itemId === item.id)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
    packagingLotStates[item.id] = lots.map((l) => ({
      lotId: l.id,
      itemId: l.itemId,
      purchaseDate: l.purchaseDate,
      vendor: l.vendor,
      initialQty: l.quantity,
      usedQty: 0,
      remainingQty: l.quantity,
      unitCost: l.unitCost,
      totalPrice: l.totalPrice,
      usageByEvent: [],
    }));
  }

  const ingredientLotStates: Record<string, LotRemainingState[]> = {};
  for (const ing of state.ingredients) {
    const lots = state.ingredientLots
      .filter((l) => l.ingredientId === ing.id)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
    ingredientLotStates[ing.id] = lots.map((l) => ({
      lotId: l.id,
      itemId: l.ingredientId,
      purchaseDate: l.purchaseDate,
      vendor: l.vendor,
      initialQty: l.weightGrams,
      usedQty: 0,
      remainingQty: l.weightGrams,
      unitCost: l.costPerGram,
      totalPrice: l.totalPrice,
      usageByEvent: [],
    }));
  }

  const sortedEvents = [...state.events].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)
  );

  const eventResults: Record<string, EventPnLResult> = {};

  for (const ev of sortedEvents) {
    eventResults[ev.id] = computeSingleEventFifo(
      ev,
      state,
      packagingLotStates,
      ingredientLotStates
    );
  }

  return {
    packagingLotStates,
    ingredientLotStates,
    eventResults,
  };
}

/**
 * ตัดสต็อกจากคิวล็อต โดยรองรับทั้ง:
 * - 'fifo': ตัดจากล็อตเก่าสุดไปใหม่สุด
 * - 'latest': ตัดจากล็อตใหม่สุดก่อน
 * - '<lotId>': ตัดจากล็อตที่ผู้ใช้ระบุเจาะจงก่อน (และใช้ราคาของล็อตที่ระบุเป็นหลัก)
 */
function consumeFromLotQueue(
  queue: LotRemainingState[],
  qtyNeeded: number,
  eventId: string,
  eventName: string,
  preferredLotMode: string = 'fifo'
): {
  slices: FifoLotUsageSlice[];
  unfulfilledQty: number;
  fallbackUnitCost: number;
  totalCost: number;
} {
  let remainingToFulfill = qtyNeeded;
  const slices: FifoLotUsageSlice[] = [];

  // จัดลำดับคิวที่จะดึงตามโหมดที่ผู้ใช้เลือก
  let orderedQueue = [...queue];
  let pinnedLot: LotRemainingState | undefined;

  if (preferredLotMode === 'latest') {
    orderedQueue = [...queue].reverse();
    pinnedLot = orderedQueue[0];
  } else if (preferredLotMode && preferredLotMode !== 'fifo') {
    pinnedLot = queue.find((l) => l.lotId === preferredLotMode);
    if (pinnedLot) {
      orderedQueue = [pinnedLot, ...queue.filter((l) => l.lotId !== preferredLotMode)];
    }
  }

  for (const lot of orderedQueue) {
    if (remainingToFulfill <= 0.0001) break;
    if (lot.remainingQty <= 0.0001) continue;

    const take = Math.min(lot.remainingQty, remainingToFulfill);
    const sliceCost = take * lot.unitCost;

    lot.usedQty += take;
    lot.remainingQty = Math.max(0, lot.initialQty - lot.usedQty);
    remainingToFulfill -= take;

    lot.usageByEvent.push({
      eventId,
      eventName,
      qtyUsed: take,
      cost: sliceCost,
    });

    slices.push({
      lotId: lot.lotId,
      purchaseDate: lot.purchaseDate,
      vendor: lot.vendor,
      quantityUsed: take,
      unitCost: lot.unitCost,
      totalCost: sliceCost,
    });
  }

  const unfulfilledQty = remainingToFulfill > 0.001 ? remainingToFulfill : 0;
  const fallbackUnitCost = pinnedLot
    ? pinnedLot.unitCost
    : queue.length > 0
      ? queue[queue.length - 1].unitCost
      : 0;
  const fallbackCost = unfulfilledQty * fallbackUnitCost;
  const totalCost = slices.reduce((s, sl) => s + sl.totalCost, 0) + fallbackCost;

  return {
    slices,
    unfulfilledQty,
    fallbackUnitCost,
    totalCost,
  };
}

function computeSingleEventFifo(
  ev: BoothEvent,
  state: AppDatabaseState,
  packagingLotStates: Record<string, LotRemainingState[]>,
  ingredientLotStates: Record<string, LotRemainingState[]>
): EventPnLResult {
  // ใช้สูตร Snapshot ประจำบูธนั้นๆ เป็นหลัก (ถ้ามีวัตถุดิบในสูตรแล้ว) เพื่อไม่ให้การแก้สูตรในอนาคตไปกระทบยอดขายของบูธเก่าๆ ย้อนหลัง
  // แต่ถ้าตอนสร้างบูธ สูตรของรสนั้นยังว่างอยู่ (ingredients.length === 0) และบูธยังไม่ได้ล็อก ให้ดึงสูตรจากหน้าสูตรหลักมาใช้อัตโนมัติทันทีที่ผู้ใช้กรอกสูตรเสร็จ
  const effectiveRecipes: FlavorRecipe[] =
    ev.recipeSnapshots && ev.recipeSnapshots.length > 0
      ? ev.recipeSnapshots
      : state.recipes;

  const normalizeFlavorKey = (s: string) =>
    s.trim().toLowerCase().replace(/\s*&\s*/g, '&').replace(/\s+/g, ' ');

  const findRecipeForEvent = (flavorName: string): FlavorRecipe | undefined => {
    const key = normalizeFlavorKey(flavorName);
    const snapMatch = effectiveRecipes.find((r) => normalizeFlavorKey(r.name) === key);
    const masterMatch = state.recipes.find((r) => normalizeFlavorKey(r.name) === key);
    const base =
      snapMatch && snapMatch.ingredients.length > 0
        ? snapMatch
        : !ev.isLocked && masterMatch && masterMatch.ingredients.length > 0
          ? masterMatch
          : snapMatch || masterMatch;
    if (!base) return undefined;
    if (masterMatch && masterMatch.productionRuns && masterMatch.productionRuns.length > 0) {
      return {
        ...base,
        productionRuns: masterMatch.productionRuns,
      };
    }
    return base;
  };

  const sales = ev.posSales || [];
  const uniqueOrders = new Set(sales.map((r) => r.orderId).filter(Boolean));
  const totalOrders = uniqueOrders.size || sales.length;
  const totalCupsSold = sales.length;

  let totalDiscount = 0;
  let netRevenue = 0;
  let cashRevenue = 0;
  let qrRevenue = 0;
  let gelatoCups = 0;
  let affogatoCups = 0;

  const flavorStatsMap = new Map<
    string,
    {
      flavorName: string;
      category: string;
      fullScoopCount: number;
      halfScoopCount: number;
      affogatoCount: number;
      revenueAttributed: number;
    }
  >();

  const ensureFlavorStat = (name: string, cat: string) => {
    const matchedRecipe = findRecipeForEvent(name);
    const canonicalName = matchedRecipe ? matchedRecipe.name : name.trim();
    if (!flavorStatsMap.has(canonicalName)) {
      flavorStatsMap.set(canonicalName, {
        flavorName: canonicalName,
        category: cat || matchedRecipe?.category || 'Original',
        fullScoopCount: 0,
        halfScoopCount: 0,
        affogatoCount: 0,
        revenueAttributed: 0,
      });
    }
    return flavorStatsMap.get(canonicalName)!;
  };

  for (const row of sales) {
    const amt = Number(row.amount) || 0;
    const disc = Number(row.discountAmount) || 0;
    netRevenue += amt;
    totalDiscount += disc;

    if (String(row.payment).toUpperCase() === 'QR') {
      qrRevenue += amt;
    } else {
      cashRevenue += amt;
    }

    const isAffogato = String(row.type).toLowerCase() === 'affogato';
    if (isAffogato) {
      affogatoCups += 1;
    } else {
      gelatoCups += 1;
    }

    const f1 = (row.flavor1 || '').trim();
    const f2 = (row.flavor2 || '').trim();
    const isTwoFlavors = Number(row.flavorsPerCup) === 2 && Boolean(f2);

    if (isAffogato && f1) {
      const st = ensureFlavorStat(f1, row.category1);
      st.affogatoCount += 1;
      st.revenueAttributed += amt;
    } else if (isTwoFlavors) {
      if (f1) {
        const st1 = ensureFlavorStat(f1, row.category1);
        st1.halfScoopCount += 1;
        st1.revenueAttributed += amt / 2;
      }
      if (f2) {
        const st2 = ensureFlavorStat(f2, row.category2);
        st2.halfScoopCount += 1;
        st2.revenueAttributed += amt / 2;
      }
    } else if (f1) {
      const st = ensureFlavorStat(f1, row.category1);
      st.fullScoopCount += 1;
      st.revenueAttributed += amt;
    }
  }

  const grossRevenue = netRevenue + totalDiscount;

  // 1. คำนวณและตัดสต็อกแพ็กเกจจิ้งตามล็อตที่ผู้ใช้เลือก (รองรับการเลือกมากกว่า 1 ล็อต/Vendor ในบูธเดียว)
  const packagingUsages: PackagingEventUsage[] = [];
  for (const item of state.packagingItems) {
    let applicableCups = totalCupsSold;
    if (item.applyToType === 'gelato') applicableCups = gelatoCups;
    if (item.applyToType === 'affogato') applicableCups = affogatoCups;

    const posQuantityNeeded = applicableCups * item.usagePerCup;
    const extraQuantityNeeded = Math.max(0, Number(ev.extraPackagingUsage?.[item.id]) || 0);
    const totalQuantityNeeded = posQuantityNeeded + extraQuantityNeeded;

    const queue = packagingLotStates[item.id] || [];
    const userAllocations = ev.packagingLotAllocations?.[item.id];
    const slices: FifoLotUsageSlice[] = [];

    if (userAllocations && userAllocations.length > 0) {
      userAllocations.forEach((alloc) => {
        const qtyToUse =
          userAllocations.length === 1 && alloc.autoFillTotal !== false
            ? totalQuantityNeeded
            : Math.max(0, Number(alloc.quantity) || 0);
        const targetLot = queue.find((l) => l.lotId === alloc.lotId) || queue[0];
        if (targetLot && qtyToUse > 0) {
          const sliceCost = qtyToUse * targetLot.unitCost;
          targetLot.usedQty += qtyToUse;
          targetLot.remainingQty = Math.max(0, targetLot.initialQty - targetLot.usedQty);
          targetLot.usageByEvent.push({
            eventId: ev.id,
            eventName: ev.name,
            qtyUsed: qtyToUse,
            cost: sliceCost,
          });
          slices.push({
            lotId: targetLot.lotId,
            purchaseDate: targetLot.purchaseDate,
            vendor: targetLot.vendor,
            quantityUsed: qtyToUse,
            unitCost: targetLot.unitCost,
            totalCost: sliceCost,
          });
        }
      });
    } else if (queue.length > 0 && totalQuantityNeeded > 0) {
      // ค่าเริ่มต้นกรณีผู้ใช้ยังไม่ได้กดเลือกล็อต: เลือกล็อตแรกที่มีของเหลืออยู่เพียง 1 เจ้า (ไม่หั่นข้ามเจ้าอัตโนมัติ)
      const defaultLot = queue.find((l) => l.remainingQty > 0.001) || queue[queue.length - 1];
      if (defaultLot) {
        const sliceCost = totalQuantityNeeded * defaultLot.unitCost;
        defaultLot.usedQty += totalQuantityNeeded;
        defaultLot.remainingQty = Math.max(0, defaultLot.initialQty - defaultLot.usedQty);
        defaultLot.usageByEvent.push({
          eventId: ev.id,
          eventName: ev.name,
          qtyUsed: totalQuantityNeeded,
          cost: sliceCost,
        });
        slices.push({
          lotId: defaultLot.lotId,
          purchaseDate: defaultLot.purchaseDate,
          vendor: defaultLot.vendor,
          quantityUsed: totalQuantityNeeded,
          unitCost: defaultLot.unitCost,
          totalCost: sliceCost,
        });
      }
    }

    const allocatedTotalQty = slices.reduce((s, sl) => s + sl.quantityUsed, 0);
    const totalCost = slices.reduce((s, sl) => s + sl.totalCost, 0);
    const fallbackUnitCost = queue.length > 0 ? queue[queue.length - 1].unitCost : 0;

    packagingUsages.push({
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      posQuantityNeeded,
      extraQuantityNeeded,
      totalQuantityNeeded,
      slices,
      unfulfilledQuantity: Math.max(0, totalQuantityNeeded - allocatedTotalQty),
      fallbackUnitCost,
      totalCost,
    });
  }

  const totalPackagingCost = packagingUsages.reduce((s, u) => s + u.totalCost, 0);

  // 2. คำนวณปริมาณกรัมวัตถุดิบที่ใช้ และตรวจสอบว่ามีการเลือกล็อตการซื้อครั้งไหนไว้
  const ingredientGramsNeededMap = new Map<string, number>();
  const ingredientPreferredLotMap = new Map<string, string>();
  const flavorIngredientGramsMap = new Map<string, Map<string, number>>();

  const isBatchMode = ev.ingredientCostMode === 'produced_batches';
  const hasExplicitProductionUsages =
    isBatchMode &&
    Array.isArray(ev.flavorProductionUsages) &&
    ev.flavorProductionUsages.length > 0;

  if (hasExplicitProductionUsages) {
    // กรณีผู้ใช้ระบุรายการ "ครั้งที่ทำ / เติม Stock" ที่นำมาใช้ในบูธนี้ (รองรับหลายครั้งที่ทำในรสเดียวกัน ซึ่งแต่ละครั้งอาจใช้ปริมาณกรัมไม่เท่ากัน)
    for (const usage of ev.flavorProductionUsages!) {
      const batchesUsed = Math.max(0, Number(usage.batchesUsed) || 0);
      if (batchesUsed <= 0) continue;

      const masterMatch = state.recipes.find((r) => r.id === usage.recipeId);
      const snapMatch = effectiveRecipes.find((r) => r.id === usage.recipeId);
      const recipe = masterMatch || snapMatch;
      if (!recipe) continue;

      const stat = ensureFlavorStat(recipe.name, recipe.category);
      const fKey = stat.flavorName;
      if (!flavorIngredientGramsMap.has(fKey)) {
        flavorIngredientGramsMap.set(fKey, new Map<string, number>());
      }
      const perFlavorIngMap = flavorIngredientGramsMap.get(fKey)!;

      const matchedRun =
        usage.runId && usage.runId !== 'master'
          ? (masterMatch?.productionRuns || recipe.productionRuns || []).find(
              (r) => r.id === usage.runId
            )
          : undefined;
      const linesToUse = matchedRun ? matchedRun.ingredients : recipe.ingredients;

      for (const line of linesToUse) {
        const totalGramsForThisRun = line.gramsPerBatch * batchesUsed;
        if (totalGramsForThisRun <= 0) continue;

        if (line.selectedLotId && line.selectedLotId !== 'fifo') {
          ingredientPreferredLotMap.set(line.ingredientId, line.selectedLotId);
        }

        perFlavorIngMap.set(
          line.ingredientId,
          (perFlavorIngMap.get(line.ingredientId) || 0) + totalGramsForThisRun
        );
        ingredientGramsNeededMap.set(
          line.ingredientId,
          (ingredientGramsNeededMap.get(line.ingredientId) || 0) + totalGramsForThisRun
        );
      }
    }
  } else {
    if (isBatchMode && ev.producedBatches) {
      for (const [keyOrId, batchCount] of Object.entries(ev.producedBatches)) {
        if ((Number(batchCount) || 0) <= 0) continue;
        const matchedRec =
          effectiveRecipes.find(
            (r) => r.id === keyOrId || normalizeFlavorKey(r.name) === normalizeFlavorKey(keyOrId)
          ) ||
          state.recipes.find(
            (r) => r.id === keyOrId || normalizeFlavorKey(r.name) === normalizeFlavorKey(keyOrId)
          );
        if (matchedRec) {
          ensureFlavorStat(matchedRec.name, matchedRec.category);
        }
      }
    }

    for (const [fKey, stat] of flavorStatsMap.entries()) {
      const recipe = findRecipeForEvent(stat.flavorName);
      if (!recipe) continue;

      const { yieldCups, halfRatio } = resolveRecipeYieldMetrics(recipe);
      const equivalentFullCups =
        stat.fullScoopCount + stat.affogatoCount + stat.halfScoopCount * halfRatio;

      const batchesMade = Number(
        ev.producedBatches?.[recipe.id] ?? ev.producedBatches?.[recipe.name] ?? 0
      );

      const perFlavorIngMap = new Map<string, number>();
      flavorIngredientGramsMap.set(fKey, perFlavorIngMap);

      // หากในโหมดถ้วยขาย POS รสนั้นมีประวัติ "ครั้งที่ทำ" ล่าสุด ให้ใช้สัดส่วนจากครั้งที่ทำล่าสุด หรือใช้สูตรตั้งต้น
      const activeLines =
        !isBatchMode &&
        recipe.productionRuns &&
        recipe.productionRuns.length > 0 &&
        recipe.ingredients.length === 0
          ? recipe.productionRuns[recipe.productionRuns.length - 1].ingredients
          : recipe.ingredients;

      for (const line of activeLines) {
        const totalGramsForThisFlavor = isBatchMode
          ? line.gramsPerBatch * Math.max(0, batchesMade)
          : (line.gramsPerBatch / yieldCups) * equivalentFullCups;
        if (totalGramsForThisFlavor <= 0) continue;

        if (line.selectedLotId && line.selectedLotId !== 'fifo') {
          ingredientPreferredLotMap.set(line.ingredientId, line.selectedLotId);
        }

        perFlavorIngMap.set(
          line.ingredientId,
          (perFlavorIngMap.get(line.ingredientId) || 0) + totalGramsForThisFlavor
        );
        ingredientGramsNeededMap.set(
          line.ingredientId,
          (ingredientGramsNeededMap.get(line.ingredientId) || 0) + totalGramsForThisFlavor
        );
      }
    }
  }

  // 3. คำนวณและตัดสต็อกวัตถุดิบ (กรัม) ตามล็อต/Vendor และปริมาณกรัมที่ผู้ใช้ระบุในแต่ละบูธ (ไม่บังคับตัด FIFO ข้ามบูธเก่า)
  const ingredientUsages: IngredientEventUsage[] = [];
  const effectiveIngredientCostPerGramInEvent = new Map<string, number>();

  for (const ing of state.ingredients) {
    const recipeGramsNeeded = ingredientGramsNeededMap.get(ing.id) || 0;
    const userAllocations = ev.ingredientLotAllocations?.[ing.id];
    if (recipeGramsNeeded <= 0 && (!userAllocations || userAllocations.length === 0)) {
      continue;
    }

    const queue = ingredientLotStates[ing.id] || [];
    const selectedLotMode =
      ev.ingredientLotOverrides?.[ing.id] ||
      ingredientPreferredLotMap.get(ing.id) ||
      'latest';

    const slices: FifoLotUsageSlice[] = [];

    if (userAllocations && userAllocations.length > 0) {
      userAllocations.forEach((alloc) => {
        const gramsToUse =
          userAllocations.length === 1 && alloc.autoFillTotal !== false && recipeGramsNeeded > 0
            ? recipeGramsNeeded
            : Math.max(0, Number(alloc.gramsUsed) || 0);
        const targetLot =
          (alloc.lotId && alloc.lotId !== 'fifo' && alloc.lotId !== 'latest'
            ? queue.find((l) => l.lotId === alloc.lotId)
            : undefined) || queue[queue.length - 1];
        if (targetLot && gramsToUse > 0) {
          const sliceCost = gramsToUse * targetLot.unitCost;
          targetLot.usedQty += gramsToUse;
          targetLot.remainingQty = Math.max(0, targetLot.initialQty - targetLot.usedQty);
          targetLot.usageByEvent.push({
            eventId: ev.id,
            eventName: ev.name,
            qtyUsed: gramsToUse,
            cost: sliceCost,
          });
          slices.push({
            lotId: targetLot.lotId,
            purchaseDate: targetLot.purchaseDate,
            vendor: targetLot.vendor,
            quantityUsed: gramsToUse,
            unitCost: targetLot.unitCost,
            totalCost: sliceCost,
          });
        }
      });
    } else if (queue.length > 0 && recipeGramsNeeded > 0) {
      const defaultLot =
        (selectedLotMode && selectedLotMode !== 'fifo' && selectedLotMode !== 'latest'
          ? queue.find((l) => l.lotId === selectedLotMode)
          : undefined) || queue[queue.length - 1];
      if (defaultLot) {
        const sliceCost = recipeGramsNeeded * defaultLot.unitCost;
        defaultLot.usedQty += recipeGramsNeeded;
        defaultLot.remainingQty = Math.max(0, defaultLot.initialQty - defaultLot.usedQty);
        defaultLot.usageByEvent.push({
          eventId: ev.id,
          eventName: ev.name,
          qtyUsed: recipeGramsNeeded,
          cost: sliceCost,
        });
        slices.push({
          lotId: defaultLot.lotId,
          purchaseDate: defaultLot.purchaseDate,
          vendor: defaultLot.vendor,
          quantityUsed: recipeGramsNeeded,
          unitCost: defaultLot.unitCost,
          totalCost: sliceCost,
        });
      }
    }

    const allocatedGrams = slices.reduce((s, sl) => s + sl.quantityUsed, 0);
    const totalGramsNeeded =
      userAllocations && userAllocations.length > 0 ? allocatedGrams : recipeGramsNeeded;
    const totalCost = slices.reduce((s, sl) => s + sl.totalCost, 0);
    const fallbackCostPerGram = queue.length > 0 ? queue[queue.length - 1].unitCost : 0;
    const effectiveRate = totalGramsNeeded > 0 ? totalCost / totalGramsNeeded : fallbackCostPerGram;
    effectiveIngredientCostPerGramInEvent.set(ing.id, effectiveRate);

    ingredientUsages.push({
      ingredientId: ing.id,
      ingredientName: ing.name,
      selectedLotMode,
      recipeGramsNeeded,
      totalGramsNeeded,
      slices,
      unfulfilledGrams: Math.max(0, recipeGramsNeeded - allocatedGrams),
      fallbackCostPerGram,
      totalCost,
    });
  }

  const totalIngredientCost = ingredientUsages.reduce((s, u) => s + u.totalCost, 0);

  // 4. สรุปต้นทุนแยกตามรสชาติที่ขายใน Event นี้
  const flavorSummaries: FlavorEventSummary[] = [];
  for (const [fKey, stat] of flavorStatsMap.entries()) {
    const recipe = findRecipeForEvent(stat.flavorName);
    const halfRatio = recipe ? resolveRecipeYieldMetrics(recipe).halfRatio : 0.5;
    const equivalentFullCups =
      stat.fullScoopCount + stat.affogatoCount + stat.halfScoopCount * halfRatio;

    const perFlavorIngMap = flavorIngredientGramsMap.get(fKey);
    let flavorIngCost = 0;
    if (perFlavorIngMap) {
      for (const [ingId, grams] of perFlavorIngMap.entries()) {
        const rate = effectiveIngredientCostPerGramInEvent.get(ingId) || 0;
        flavorIngCost += grams * rate;
      }
    }

    flavorSummaries.push({
      flavorName: stat.flavorName,
      category: stat.category,
      fullScoopCount: stat.fullScoopCount,
      halfScoopCount: stat.halfScoopCount,
      affogatoCount: stat.affogatoCount,
      equivalentFullCups,
      revenueAttributed: stat.revenueAttributed,
      ingredientCost: flavorIngCost,
    });
  }

  flavorSummaries.sort((a, b) => b.revenueAttributed - a.revenueAttributed);

  // 5. รวมค่าสถานที่และค่าใช้จ่ายอื่นๆ ในการออกบูธ
  const expensesByCategory: Record<ExpenseCategory, number> = {
    venue: 0,
    ice_power: 0,
    transport: 0,
    labor: 0,
    marketing: 0,
    other: 0,
  };

  for (const exp of ev.expenses || []) {
    const cat = exp.category || 'other';
    expensesByCategory[cat] = (expensesByCategory[cat] || 0) + (Number(exp.amount) || 0);
  }

  const totalFixedExpenses = Object.values(expensesByCategory).reduce((a, b) => a + b, 0);
  const totalAllCosts = totalPackagingCost + totalIngredientCost + totalFixedExpenses;
  const netProfit = netRevenue - totalAllCosts;
  const profitMarginPct = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;

  return {
    eventId: ev.id,
    totalOrders,
    totalCupsSold,
    totalDiscount,
    grossRevenue,
    netRevenue,
    cashRevenue,
    qrRevenue,
    packagingUsages,
    totalPackagingCost,
    ingredientUsages,
    totalIngredientCost,
    flavorSummaries,
    expensesByCategory,
    totalFixedExpenses,
    totalAllCosts,
    netProfit,
    profitMarginPct,
  };
}
