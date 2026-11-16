import React, { useRef, useState } from 'react';
import {
  AppDatabaseState,
  BoothEvent,
  BoothFlavorBatch,
  BoothFlavorBatchIngredient,
  EventExpense,
  EventFlavorProductionUsage,
  EventIngredientLotAllocation,
  EventPackagingLotAllocation,
  ExpenseCategory,
  IngredientLot,
  PackagingLot,
  PosSaleRow,
} from '../types';
import { SystemSimulationResult } from '../services/fifoEngine';
import { formatBaht, formatSignedBaht } from '../services/storage';
import {
  fetchAllPosSalesFromCloud,
  filterSalesForEventWindow,
  parseRefvPosCsvText,
} from '../services/posSync';
import {
  Calendar,
  MapPin,
  RefreshCw,
  Upload,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Package,
  IceCream,
  Receipt,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Scale,
  BarChart3,
} from 'lucide-react';

interface Props {
  state: AppDatabaseState;
  sim: SystemSimulationResult;
  onUpdateState: (updater: (prev: AppDatabaseState) => AppDatabaseState) => void;
}

const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, { label: string; badge: string }> = {
  venue: { label: 'ค่าเช่าสถานที่ / บูธ', badge: 'bg-purple-100 text-purple-800' },
  ice_power: { label: 'ค่าน้ำแข็งแห้ง / ค่าไฟ / ตู้แช่', badge: 'bg-sky-100 text-sky-800' },
  transport: { label: 'ค่าขนส่ง / เดินทาง', badge: 'bg-amber-100 text-amber-800' },
  labor: { label: 'ค่าแรงพนักงาน / Part-time', badge: 'bg-emerald-100 text-emerald-800' },
  marketing: { label: 'ค่าป้าย / ตกแต่งบูธ / การตลาด', badge: 'bg-pink-100 text-pink-800' },
  other: { label: 'ค่าใช้จ่ายอื่นๆ', badge: 'bg-slate-100 text-slate-800' },
};

export const EventPnLView: React.FC<Props> = ({ state, sim, onUpdateState }) => {
  const [selectedEventId, setSelectedEventId] = useState<string>(
    state.events[state.events.length - 1]?.id || ''
  );
  const [showNewEventModal, setShowNewEventModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showRawPosRows, setShowRawPosRows] = useState(false);

  // ฟอร์มสร้าง Event ใหม่
  const today = new Date().toISOString().slice(0, 10);
  const [newEvName, setNewEvName] = useState('');
  const [newEvLoc, setNewEvLoc] = useState('');
  const [newEvStart, setNewEvStart] = useState(today);
  const [newEvEnd, setNewEvEnd] = useState(today);
  const [newEvStartTime, setNewEvStartTime] = useState('00:00');
  const [newEvEndTime, setNewEvEndTime] = useState('23:59');
  const [autoSyncOnCreate, setAutoSyncOnCreate] = useState(true);
  const [cloudSalesPreview, setCloudSalesPreview] = useState<PosSaleRow[]>([]);
  const [loadingCloudPreview, setLoadingCloudPreview] = useState(false);

  // ฟอร์มเพิ่มค่าใช้จ่ายประจำบูธ
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('venue');
  const [expTitle, setExpTitle] = useState('');
  const [expVendor, setExpVendor] = useState('');
  const [expAmount, setExpAmount] = useState('');

  // ฟอร์มด่วนสำหรับบันทึกซื้อแพ็กเกจจิ้งเพิ่มหน้างาน (กรณีของหมดกลางทางแล้วต้องซื้อเพิ่มในบูธ)
  const [quickAddPkgItemId, setQuickAddPkgItemId] = useState<string | null>(null);
  const [quickPkgVendor, setQuickPkgVendor] = useState('');
  const [quickPkgDate, setQuickPkgDate] = useState(today);
  const [quickPkgBuyQty, setQuickPkgBuyQty] = useState('');
  const [quickPkgTotalPrice, setQuickPkgTotalPrice] = useState('');
  const [quickPkgUseQty, setQuickPkgUseQty] = useState('');

  // ฟอร์มด่วนสำหรับบันทึกซื้อวัตถุดิบ (กรัม/บาท) และเพิ่มวัตถุดิบที่ใช้ในบูธนี้โดยตรง
  const [quickAddIngId, setQuickAddIngId] = useState<string | null>(null);
  const [quickIngVendor, setQuickIngVendor] = useState('');
  const [quickIngDate, setQuickIngDate] = useState(today);
  const [quickIngBuyGrams, setQuickIngBuyGrams] = useState('');
  const [quickIngTotalPrice, setQuickIngTotalPrice] = useState('');
  const [quickIngUseGrams, setQuickIngUseGrams] = useState('');
  const [isIngredientVendorExpanded, setIsIngredientVendorExpanded] = useState(false);

  const [manualIngId, setManualIngId] = useState<string>(state.ingredients[0]?.id || '');
  const [manualIngLotId, setManualIngLotId] = useState<string>('latest');
  const [manualIngGrams, setManualIngGrams] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedEvent: BoothEvent | undefined =
    state.events.find((e) => e.id === selectedEventId) || state.events[0];
  const pnl = selectedEvent ? sim.eventResults[selectedEvent.id] : undefined;

  const handleOpenNewEventModal = async () => {
    setShowNewEventModal(true);
    setLoadingCloudPreview(true);
    try {
      const { sales } = await fetchAllPosSalesFromCloud(state.settings);
      setCloudSalesPreview(sales);
    } catch {
      // ignore preview error
    } finally {
      setLoadingCloudPreview(false);
    }
  };

  // คำนวณรายการขายในชีทที่ตรงกับช่วงวัน-เวลาที่กำลังตั้งค่าใน Modal สร้างบูธใหม่
  const previewMatchedSales = filterSalesForEventWindow(
    cloudSalesPreview,
    newEvStart,
    newEvEnd || newEvStart,
    newEvStartTime || '00:00',
    newEvEndTime || '23:59'
  );
  const previewMatchedRevenue = previewMatchedSales.reduce((acc, r) => acc + (r.amount || 0), 0);

  // สรุปวันที่ที่มีข้อมูลขายในชีท Sales เพื่อให้กดเลือกช่วงวันได้สะดวก
  const availableDatesMap = cloudSalesPreview.reduce<Record<string, number>>((acc, row) => {
    if (row.date) {
      acc[row.date] = (acc[row.date] || 0) + 1;
    }
    return acc;
  }, {});
  const availableDatesSorted = Object.keys(availableDatesMap).sort();

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEvName.trim()) return;
    const newId = 'ev-' + Date.now();
    // บันทึก Snapshot ของสูตรและล็อตวัตถุดิบ ณ วันที่สร้างบูธ เพื่อไม่ให้การแก้สูตรในอนาคตไปกระทบย้อนหลัง
    const snapshotRecipes = JSON.parse(JSON.stringify(state.recipes));

    let initialPosSales: PosSaleRow[] = [];
    let syncedStamp: string | undefined = undefined;

    if (autoSyncOnCreate) {
      let sourceRows = cloudSalesPreview;
      if (sourceRows.length === 0) {
        try {
          const fetched = await fetchAllPosSalesFromCloud(state.settings);
          sourceRows = fetched.sales;
        } catch {
          // ignore
        }
      }
      initialPosSales = filterSalesForEventWindow(
        sourceRows,
        newEvStart,
        newEvEnd || newEvStart,
        newEvStartTime || '00:00',
        newEvEndTime || '23:59'
      );
      if (initialPosSales.length > 0) {
        syncedStamp = new Date().toLocaleString('th-TH');
      }
    }

    const newEvent: BoothEvent = {
      id: newId,
      name: newEvName.trim(),
      location: newEvLoc.trim() || '-',
      startDate: newEvStart,
      endDate: newEvEnd || newEvStart,
      startTime: newEvStartTime || '00:00',
      endTime: newEvEndTime || '23:59',
      status: 'active',
      isLocked: false,
      recipeSnapshots: snapshotRecipes,
      expenses: [],
      posSales: initialPosSales,
      lastSyncedAt: syncedStamp,
      ingredientLotOverrides: {},
    };
    onUpdateState((prev) => ({
      ...prev,
      events: [...prev.events, newEvent],
    }));
    setSelectedEventId(newId);
    setNewEvName('');
    setNewEvLoc('');
    setShowNewEventModal(false);
    if (autoSyncOnCreate) {
      setSyncMessage({
        type: initialPosSales.length > 0 ? 'ok' : 'err',
        text:
          initialPosSales.length > 0
            ? `สร้างบูธ "${newEvent.name}" และดึงยอดขายเฉพาะช่วง ${newEvent.startDate} (${newEvent.startTime}) ถึง ${newEvent.endDate} (${newEvent.endTime}) จำนวน ${initialPosSales.length} ถ้วย เรียบร้อยแล้ว!`
            : `สร้างบูธ "${newEvent.name}" เรียบร้อยแล้ว (ยังไม่พบรายการขายในช่วงเวลา ${newEvent.startDate} ${newEvent.startTime} - ${newEvent.endDate} ${newEvent.endTime} สามารถกด Sync ภายหลังได้)`,
      });
    }
  };

  const handleToggleLockEvent = () => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        if (ev.id !== selectedEvent.id) return ev;
        const nextLock = !ev.isLocked;
        const snapshots =
          ev.recipeSnapshots && ev.recipeSnapshots.length > 0
            ? ev.recipeSnapshots
            : JSON.parse(JSON.stringify(prev.recipes));
        return {
          ...ev,
          isLocked: nextLock,
          recipeSnapshots: snapshots,
        };
      }),
    }));
  };

  const handleApplyCurrentMasterRecipesToThisEvent = () => {
    if (!selectedEvent) return;
    if (selectedEvent.isLocked) {
      alert('บูธนี้ถูกล็อกต้นทุนไว้แล้ว กรุณากดปลดล็อกก่อนหากต้องการอัปเดตสูตรใหม่เข้าสู่บูธนี้');
      return;
    }
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              recipeSnapshots: JSON.parse(JSON.stringify(prev.recipes)),
            }
          : ev
      ),
    }));
    setSyncMessage({
      type: 'ok',
      text: `อัปเดตสูตรและล็อตวัตถุดิบล่าสุดมาใช้กับ "${selectedEvent.name}" เรียบร้อยแล้ว (ไม่กระทบบูธก่อนหน้า)`,
    });
  };

  const handleDeleteEvent = (eventId: string) => {
    const target = state.events.find((e) => e.id === eventId);
    if (!target) return;
    if (!window.confirm(`ต้องการลบงานออกบูธ "${target.name}" หรือไม่?`)) return;
    onUpdateState((prev) => {
      const next = prev.events.filter((e) => e.id !== eventId);
      if (selectedEventId === eventId) {
        setSelectedEventId(next[next.length - 1]?.id || '');
      }
      return { ...prev, events: next };
    });
  };

  const handleSetEventIngredientLotOverride = (ingredientId: string, lotSelection: string) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              ingredientLotOverrides: {
                ...(ev.ingredientLotOverrides || {}),
                [ingredientId]: lotSelection,
              },
            }
          : ev
      ),
    }));
  };

  const handleSetExtraPackagingUsage = (itemId: string, extraQty: number) => {
    if (!selectedEvent) return;
    const cleanQty = Math.max(0, isNaN(extraQty) ? 0 : extraQty);
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              extraPackagingUsage: {
                ...(ev.extraPackagingUsage || {}),
                [itemId]: cleanQty,
              },
            }
          : ev
      ),
    }));
  };

  const handleSetIngredientCostMode = (mode: 'pos_cups' | 'produced_batches') => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        if (ev.id !== selectedEvent.id) return ev;
        let nextUsages = [...(ev.flavorProductionUsages || [])];
        if (mode === 'produced_batches' && nextUsages.length === 0) {
          const soldFlavorNames = new Set<string>();
          for (const row of ev.posSales || []) {
            if (row.flavor1) soldFlavorNames.add(row.flavor1.trim().toLowerCase());
            if (row.flavor2) soldFlavorNames.add(row.flavor2.trim().toLowerCase());
          }
          for (const r of prev.recipes) {
            if (soldFlavorNames.has(r.name.trim().toLowerCase())) {
              const defaultRunId =
                r.productionRuns && r.productionRuns.length > 0
                  ? r.productionRuns[0].id
                  : 'master';
              nextUsages.push({
                id: 'fpu-' + r.id + '-1',
                recipeId: r.id,
                runId: defaultRunId,
                batchesUsed: 1,
              });
            }
          }
        }
        return {
          ...ev,
          ingredientCostMode: mode,
          flavorProductionUsages: nextUsages,
        };
      }),
    }));
  };

  const handleToggleFlavorInBooth = (recipeId: string, checked: boolean) => {
    if (!selectedEvent) return;
    const rec = state.recipes.find((r) => r.id === recipeId);
    const defaultRunId =
      rec && rec.productionRuns && rec.productionRuns.length > 0
        ? rec.productionRuns[0].id
        : 'master';

    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        if (ev.id !== selectedEvent.id) return ev;
        const current = ev.flavorProductionUsages || [];
        const next = checked
          ? [
              ...current,
              {
                id: 'fpu-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
                recipeId,
                runId: defaultRunId,
                batchesUsed: 1,
              },
            ]
          : current.filter((u) => u.recipeId !== recipeId);
        return {
          ...ev,
          flavorProductionUsages: next,
        };
      }),
    }));
  };

  const handleAddFlavorRunUsageRow = (recipeId: string) => {
    if (!selectedEvent) return;
    const rec = state.recipes.find((r) => r.id === recipeId);
    const existingForFlavor = (selectedEvent.flavorProductionUsages || []).filter(
      (u) => u.recipeId === recipeId
    );
    const usedRunIds = new Set(existingForFlavor.map((u) => u.runId));
    const nextCandidateRun =
      (rec?.productionRuns || []).find((pr) => !usedRunIds.has(pr.id)) ||
      (rec?.productionRuns && rec.productionRuns.length > 0
        ? rec.productionRuns[rec.productionRuns.length - 1]
        : undefined);

    const newRow: EventFlavorProductionUsage = {
      id: 'fpu-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      recipeId,
      runId: nextCandidateRun ? nextCandidateRun.id : 'master',
      batchesUsed: 1,
    };

    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              flavorProductionUsages: [...(ev.flavorProductionUsages || []), newRow],
            }
          : ev
      ),
    }));
  };

  const handleUpdateFlavorRunUsageRow = (
    usageId: string,
    field: 'runId' | 'batchesUsed',
    value: string | number
  ) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              flavorProductionUsages: (ev.flavorProductionUsages || []).map((u) =>
                u.id === usageId ? { ...u, [field]: value } : u
              ),
            }
          : ev
      ),
    }));
  };

  const handleRemoveFlavorRunUsageRow = (usageId: string) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              flavorProductionUsages: (ev.flavorProductionUsages || []).filter(
                (u) => u.id !== usageId
              ),
            }
          : ev
      ),
    }));
  };

  // ==========================================
  // Flow ใหม่: บันทึกการปั่น / เตรียม Stock ประจำบูธ (BoothBatches)
  // ==========================================

  // 1. เพิ่มรอบการปั่นใหม่ (ดึงสูตรมาตรฐานมาเป็นค่าเริ่มต้น พร้อมสัดส่วนกรัม)
  const handleAddBoothBatch = (recipeId: string) => {
    if (!selectedEvent) return;
    const rec = state.recipes.find((r) => r.id === recipeId);
    if (!rec) return;

    const existingBatches = (selectedEvent.boothBatches || []).filter((b) => b.recipeId === recipeId);
    const batchNumber = existingBatches.length + 1;

    const defaultIngredients: BoothFlavorBatchIngredient[] = rec.ingredients.map((line) => {
      const allLots = state.ingredientLots
        .filter((l) => l.ingredientId === line.ingredientId)
        .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
      const chosenLot = allLots.length > 0 ? allLots[allLots.length - 1].id : 'latest';
      return {
        id: 'bi-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
        ingredientId: line.ingredientId,
        lotId: chosenLot,
        grams: line.gramsPerBatch,
      };
    });

    const newBatch: BoothFlavorBatch = {
      id: 'bb-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      recipeId,
      batchNumber,
      label: batchNumber === 1 ? 'รอบที่ 1 (เตรียมเปิดบูธ)' : `รอบที่ ${batchNumber} (ปั่นเติม Stock)`,
      ingredients: defaultIngredients,
    };

    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              ingredientCostMode: 'produced_batches',
              boothBatches: [...(ev.boothBatches || []), newBatch],
            }
          : ev
      ),
    }));
  };

  // 2. Clone จากรอบก่อนหน้า (สำหรับเติม Stock โดยไม่ต้องกรอกใหม่)
  const handleCloneBoothBatch = (sourceBatchId: string) => {
    if (!selectedEvent) return;
    const sourceBatch = (selectedEvent.boothBatches || []).find((b) => b.id === sourceBatchId);
    if (!sourceBatch) return;

    const existingForFlavor = (selectedEvent.boothBatches || []).filter(
      (b) => b.recipeId === sourceBatch.recipeId
    );
    const nextNumber = existingForFlavor.length + 1;

    const clonedIngredients: BoothFlavorBatchIngredient[] = sourceBatch.ingredients.map((ing) => ({
      ...ing,
      id: 'bi-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
    }));

    const clonedBatch: BoothFlavorBatch = {
      id: 'bb-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      recipeId: sourceBatch.recipeId,
      batchNumber: nextNumber,
      label: `รอบที่ ${nextNumber} (Clone จากรอบที่ ${sourceBatch.batchNumber})`,
      ingredients: clonedIngredients,
    };

    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              boothBatches: [...(ev.boothBatches || []), clonedBatch],
            }
          : ev
      ),
    }));
  };

  // 3. ลบรอบการปั่น
  const handleDeleteBoothBatch = (batchId: string) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              boothBatches: (ev.boothBatches || []).filter((b) => b.id !== batchId),
            }
          : ev
      ),
    }));
  };

  // 4. แตกแถววัตถุดิบซ้ำในรอบเดียวกัน (กรณี Lot เก่าไม่พอ ต้องการ Add Lot ใหม่ลงไป)
  const handleDuplicateBatchIngredientRow = (batchId: string, ingredientId: string) => {
    if (!selectedEvent) return;
    const allLots = state.ingredientLots
      .filter((l) => l.ingredientId === ingredientId)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
    const nextLotId = allLots.length > 0 ? allLots[allLots.length - 1].id : 'latest';

    const newRow: BoothFlavorBatchIngredient = {
      id: 'bi-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      ingredientId,
      lotId: nextLotId,
      grams: 0,
    };

    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        if (ev.id !== selectedEvent.id) return ev;
        return {
          ...ev,
          boothBatches: (ev.boothBatches || []).map((b) =>
            b.id === batchId
              ? {
                  ...b,
                  ingredients: [...b.ingredients, newRow],
                }
              : b
          ),
        };
      }),
    }));
  };

  // 5. อัปเดตข้อมูลในแถววัตถุดิบของรอบนั้น (เปลี่ยน Lot หรือแก้จำนวนกรัม)
  const handleUpdateBatchIngredient = (
    batchId: string,
    rowId: string,
    field: 'lotId' | 'grams',
    value: string | number
  ) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        if (ev.id !== selectedEvent.id) return ev;
        return {
          ...ev,
          boothBatches: (ev.boothBatches || []).map((b) =>
            b.id === batchId
              ? {
                  ...b,
                  ingredients: b.ingredients.map((row) =>
                    row.id === rowId ? { ...row, [field]: value } : row
                  ),
                }
              : b
          ),
        };
      }),
    }));
  };

  // 6. ลบแถววัตถุดิบที่แตกเพิ่มออกมา
  const handleRemoveBatchIngredientRow = (batchId: string, rowId: string) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        if (ev.id !== selectedEvent.id) return ev;
        return {
          ...ev,
          boothBatches: (ev.boothBatches || []).map((b) =>
            b.id === batchId
              ? {
                  ...b,
                  ingredients: b.ingredients.filter((row) => row.id !== rowId),
                }
              : b
          ),
        };
      }),
    }));
  };


  // ดึงรายการล็อตแพ็กเกจจิ้งที่เลือกใช้ในบูธนี้ (ถ้ายังไม่เคยเลือก ให้ใช้ล็อตแรกที่มีเป็นค่าเริ่มต้น 1 แถว)
  const getEffectivePackagingAllocations = (
    itemId: string,
    totalQtyNeeded: number
  ): EventPackagingLotAllocation[] => {
    if (!selectedEvent) return [];
    const existing = selectedEvent.packagingLotAllocations?.[itemId];
    if (existing && existing.length > 0) {
      if (existing.length === 1 && existing[0].autoFillTotal !== false) {
        return [{ ...existing[0], quantity: totalQtyNeeded }];
      }
      return existing;
    }
    const itemLots = state.packagingLots
      .filter((l) => l.itemId === itemId)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
    if (itemLots.length === 0) return [];
    return [
      {
        id: `alloc-default-${itemId}`,
        lotId: itemLots[0].id,
        quantity: totalQtyNeeded,
        autoFillTotal: true,
      },
    ];
  };

  const updateEventPackagingAllocations = (
    itemId: string,
    nextAllocations: EventPackagingLotAllocation[]
  ) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              packagingLotAllocations: {
                ...(ev.packagingLotAllocations || {}),
                [itemId]: nextAllocations,
              },
            }
          : ev
      ),
    }));
  };

  const handleChangePackagingLotId = (
    itemId: string,
    rowIndex: number,
    newLotId: string,
    totalQtyNeeded: number
  ) => {
    const current = getEffectivePackagingAllocations(itemId, totalQtyNeeded);
    const next = current.map((row, idx) =>
      idx === rowIndex ? { ...row, lotId: newLotId } : row
    );
    updateEventPackagingAllocations(itemId, next);
  };

  const handleChangePackagingLotQuantity = (
    itemId: string,
    rowIndex: number,
    rawQty: number,
    totalQtyNeeded: number
  ) => {
    const cleanQty = Math.max(0, isNaN(rawQty) ? 0 : rawQty);
    const current = getEffectivePackagingAllocations(itemId, totalQtyNeeded);
    const next = current.map((row, idx) => {
      if (idx === rowIndex) {
        return { ...row, quantity: cleanQty, autoFillTotal: false };
      }
      // ถ้ามี 2 เจ้าในบูธเดียว เมื่อแก้จำนวนของเจ้าที่ 1 ให้ปรับจำนวนส่วนที่เหลือไปที่เจ้าที่ 2 อัตโนมัติ (หรือในทางกลับกัน)
      if (current.length === 2 && idx !== rowIndex) {
        return {
          ...row,
          quantity: Math.max(0, totalQtyNeeded - cleanQty),
          autoFillTotal: false,
        };
      }
      return { ...row, autoFillTotal: false };
    });
    updateEventPackagingAllocations(itemId, next);
  };

  const handleAddPackagingLotRow = (itemId: string, totalQtyNeeded: number) => {
    const itemLots = state.packagingLots
      .filter((l) => l.itemId === itemId)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
    if (itemLots.length === 0) return;

    const current = getEffectivePackagingAllocations(itemId, totalQtyNeeded).map((r) => ({
      ...r,
      autoFillTotal: false,
    }));
    const usedLotIds = new Set(current.map((r) => r.lotId));
    const nextCandidateLot =
      itemLots.find((l) => !usedLotIds.has(l.id)) || itemLots[itemLots.length - 1];

    const currentSum = current.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const remainingToAllocate = Math.max(0, totalQtyNeeded - currentSum);

    const next = [
      ...current,
      {
        id: 'alloc-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        lotId: nextCandidateLot.id,
        quantity: remainingToAllocate,
        autoFillTotal: false,
      },
    ];
    updateEventPackagingAllocations(itemId, next);
  };

  const handleRemovePackagingLotRow = (
    itemId: string,
    rowIndex: number,
    totalQtyNeeded: number
  ) => {
    const current = getEffectivePackagingAllocations(itemId, totalQtyNeeded);
    const filtered = current.filter((_, idx) => idx !== rowIndex);
    if (filtered.length === 1) {
      updateEventPackagingAllocations(itemId, [
        { ...filtered[0], quantity: totalQtyNeeded, autoFillTotal: true },
      ]);
    } else {
      updateEventPackagingAllocations(itemId, filtered);
    }
  };

  const handleBalancePackagingLotRow = (
    itemId: string,
    rowIndex: number,
    totalQtyNeeded: number
  ) => {
    const current = getEffectivePackagingAllocations(itemId, totalQtyNeeded);
    const otherSum = current.reduce(
      (s, r, idx) => (idx === rowIndex ? s : s + (Number(r.quantity) || 0)),
      0
    );
    const neededHere = Math.max(0, totalQtyNeeded - otherSum);
    const next = current.map((r, idx) =>
      idx === rowIndex ? { ...r, quantity: neededHere, autoFillTotal: false } : r
    );
    updateEventPackagingAllocations(itemId, next);
  };

  const handleQuickCreatePackagingLotAndUse = (
    e: React.FormEvent,
    itemId: string,
    totalQtyNeeded: number
  ) => {
    e.preventDefault();
    if (!selectedEvent) return;
    const buyQty = parseFloat(quickPkgBuyQty);
    const totalPrice = parseFloat(quickPkgTotalPrice);
    const useQtyRaw = parseFloat(quickPkgUseQty);
    if (isNaN(buyQty) || buyQty <= 0 || isNaN(totalPrice) || totalPrice < 0) return;

    const unitCost = totalPrice / buyQty;
    const newLotId = 'lot-pkg-' + Date.now();
    const newLot: PackagingLot = {
      id: newLotId,
      itemId,
      purchaseDate: quickPkgDate || selectedEvent.startDate || today,
      vendor: quickPkgVendor.trim() || 'ซื้อเพิ่มหน้างาน',
      quantity: buyQty,
      totalPrice,
      unitCost,
      note: `ซื้อเพิ่มระหว่างงาน ${selectedEvent.name}`,
    };

    const current = getEffectivePackagingAllocations(itemId, totalQtyNeeded).map((r) => ({
      ...r,
      autoFillTotal: false,
    }));
    const useQty = !isNaN(useQtyRaw) && useQtyRaw >= 0 ? useQtyRaw : 0;

    // ถ้าเดิมมี 1 เจ้าที่ถือยอดเต็มอยู่ แล้วเราระบุว่าใช้ของที่ซื้อเพิ่มหน้างาน X ชิ้น ให้หักเจ้าแรกออก X ชิ้นอัตโนมัติ
    let adjustedCurrent = [...current];
    if (
      adjustedCurrent.length === 1 &&
      adjustedCurrent[0].quantity === totalQtyNeeded &&
      useQty > 0 &&
      useQty <= totalQtyNeeded
    ) {
      adjustedCurrent = [
        {
          ...adjustedCurrent[0],
          quantity: Math.max(0, totalQtyNeeded - useQty),
          autoFillTotal: false,
        },
      ];
    }

    const nextAllocations: EventPackagingLotAllocation[] = [
      ...adjustedCurrent,
      {
        id: 'alloc-' + Date.now(),
        lotId: newLotId,
        quantity: useQty,
        autoFillTotal: adjustedCurrent.length === 0,
      },
    ];

    onUpdateState((prev) => ({
      ...prev,
      packagingLots: [...prev.packagingLots, newLot],
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              packagingLotAllocations: {
                ...(ev.packagingLotAllocations || {}),
                [itemId]: nextAllocations,
              },
            }
          : ev
      ),
    }));

    setQuickAddPkgItemId(null);
    setQuickPkgVendor('');
    setQuickPkgBuyQty('');
    setQuickPkgTotalPrice('');
    setQuickPkgUseQty('');
  };

  // --- จัดการการเลือกล็อต/Vendor และปริมาณกรัมของวัตถุดิบแต่ละตัวในบูธนี้โดยตรง (ไม่ต้องพึ่ง FIFO จากบูธเก่า) ---
  const getEffectiveIngredientAllocations = (
    ingredientId: string,
    recipeGramsNeeded: number
  ): EventIngredientLotAllocation[] => {
    if (!selectedEvent) return [];
    const existing = selectedEvent.ingredientLotAllocations?.[ingredientId];
    if (existing && existing.length > 0) {
      if (existing.length === 1 && existing[0].autoFillTotal !== false && recipeGramsNeeded > 0) {
        return [{ ...existing[0], gramsUsed: Number(recipeGramsNeeded.toFixed(2)) }];
      }
      return existing;
    }
    const ingLots = state.ingredientLots
      .filter((l) => l.ingredientId === ingredientId)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
    if (ingLots.length === 0) return [];
    const defaultLot = ingLots[ingLots.length - 1];
    return [
      {
        id: `ing-alloc-default-${ingredientId}`,
        lotId: defaultLot.id,
        gramsUsed: Number(recipeGramsNeeded.toFixed(2)),
        autoFillTotal: true,
      },
    ];
  };

  const updateEventIngredientAllocations = (
    ingredientId: string,
    nextAllocations: EventIngredientLotAllocation[]
  ) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              ingredientLotAllocations: {
                ...(ev.ingredientLotAllocations || {}),
                [ingredientId]: nextAllocations,
              },
            }
          : ev
      ),
    }));
  };

  const handleChangeIngredientLotId = (
    ingredientId: string,
    rowIndex: number,
    newLotId: string,
    recipeGramsNeeded: number
  ) => {
    const current = getEffectiveIngredientAllocations(ingredientId, recipeGramsNeeded);
    const next = current.map((row, idx) =>
      idx === rowIndex ? { ...row, lotId: newLotId } : row
    );
    updateEventIngredientAllocations(ingredientId, next);
  };

  const handleChangeIngredientLotGrams = (
    ingredientId: string,
    rowIndex: number,
    rawGrams: number,
    recipeGramsNeeded: number
  ) => {
    const cleanGrams = Math.max(0, isNaN(rawGrams) ? 0 : rawGrams);
    const current = getEffectiveIngredientAllocations(ingredientId, recipeGramsNeeded);
    const next = current.map((row, idx) => {
      if (idx === rowIndex) {
        return { ...row, gramsUsed: cleanGrams, autoFillTotal: false };
      }
      if (current.length === 2 && idx !== rowIndex && recipeGramsNeeded > 0) {
        return {
          ...row,
          gramsUsed: Number(Math.max(0, recipeGramsNeeded - cleanGrams).toFixed(2)),
          autoFillTotal: false,
        };
      }
      return { ...row, autoFillTotal: false };
    });
    updateEventIngredientAllocations(ingredientId, next);
  };

  const handleAddIngredientLotRow = (ingredientId: string, recipeGramsNeeded: number) => {
    const ingLots = state.ingredientLots
      .filter((l) => l.ingredientId === ingredientId)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
    if (ingLots.length === 0) return;

    const current = getEffectiveIngredientAllocations(ingredientId, recipeGramsNeeded).map(
      (r) => ({
        ...r,
        autoFillTotal: false,
      })
    );
    const usedLotIds = new Set(current.map((r) => r.lotId));
    const nextCandidateLot =
      ingLots.find((l) => !usedLotIds.has(l.id)) || ingLots[ingLots.length - 1];

    const currentSum = current.reduce((s, r) => s + (Number(r.gramsUsed) || 0), 0);
    const remainingToAllocate = Number(Math.max(0, recipeGramsNeeded - currentSum).toFixed(2));

    const next = [
      ...current,
      {
        id: 'ing-alloc-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        lotId: nextCandidateLot.id,
        gramsUsed: remainingToAllocate,
        autoFillTotal: false,
      },
    ];
    updateEventIngredientAllocations(ingredientId, next);
  };

  const handleRemoveIngredientLotRow = (
    ingredientId: string,
    rowIndex: number,
    recipeGramsNeeded: number
  ) => {
    const current = getEffectiveIngredientAllocations(ingredientId, recipeGramsNeeded);
    const filtered = current.filter((_, idx) => idx !== rowIndex);
    if (filtered.length === 1 && recipeGramsNeeded > 0) {
      updateEventIngredientAllocations(ingredientId, [
        {
          ...filtered[0],
          gramsUsed: Number(recipeGramsNeeded.toFixed(2)),
          autoFillTotal: true,
        },
      ]);
    } else {
      updateEventIngredientAllocations(ingredientId, filtered);
    }
  };

  const handleQuickCreateIngredientLotAndUse = (
    e: React.FormEvent,
    ingredientId: string,
    recipeGramsNeeded: number
  ) => {
    e.preventDefault();
    if (!selectedEvent) return;
    const buyGrams = parseFloat(quickIngBuyGrams);
    const totalPrice = parseFloat(quickIngTotalPrice);
    const useGramsRaw = parseFloat(quickIngUseGrams);
    if (isNaN(buyGrams) || buyGrams <= 0 || isNaN(totalPrice) || totalPrice < 0) return;

    const costPerGram = totalPrice / buyGrams;
    const newLotId = 'ilot-' + Date.now();
    const newLot: IngredientLot = {
      id: newLotId,
      ingredientId,
      purchaseDate: quickIngDate || selectedEvent.startDate || today,
      vendor: quickIngVendor.trim() || 'ไม่ระบุร้านค้า',
      weightGrams: buyGrams,
      totalPrice,
      costPerGram,
    };

    const current = getEffectiveIngredientAllocations(ingredientId, recipeGramsNeeded).map(
      (r) => ({
        ...r,
        autoFillTotal: false,
      })
    );
    const useGrams =
      !isNaN(useGramsRaw) && useGramsRaw > 0
        ? useGramsRaw
        : Number(recipeGramsNeeded.toFixed(2));

    let adjustedCurrent = [...current];
    if (
      adjustedCurrent.length === 1 &&
      Math.abs(adjustedCurrent[0].gramsUsed - recipeGramsNeeded) < 0.1 &&
      useGrams > 0 &&
      useGrams < recipeGramsNeeded
    ) {
      adjustedCurrent = [
        {
          ...adjustedCurrent[0],
          gramsUsed: Number(Math.max(0, recipeGramsNeeded - useGrams).toFixed(2)),
          autoFillTotal: false,
        },
      ];
    }

    const nextAllocations: EventIngredientLotAllocation[] =
      adjustedCurrent.length === 0
        ? [
            {
              id: 'ing-alloc-' + Date.now(),
              lotId: newLotId,
              gramsUsed: useGrams,
              autoFillTotal: false,
            },
          ]
        : [
            ...adjustedCurrent,
            {
              id: 'ing-alloc-' + Date.now(),
              lotId: newLotId,
              gramsUsed: useGrams,
              autoFillTotal: false,
            },
          ];

    onUpdateState((prev) => ({
      ...prev,
      ingredientLots: [...prev.ingredientLots, newLot],
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? {
              ...ev,
              ingredientLotAllocations: {
                ...(ev.ingredientLotAllocations || {}),
                [ingredientId]: nextAllocations,
              },
            }
          : ev
      ),
    }));

    setQuickAddIngId(null);
    setQuickIngVendor('');
    setQuickIngBuyGrams('');
    setQuickIngTotalPrice('');
    setQuickIngUseGrams('');
  };

  const handleAddManualIngredientToBooth = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent || !manualIngId) return;
    const g = parseFloat(manualIngGrams);
    if (isNaN(g) || g <= 0) return;

    const ingLots = state.ingredientLots
      .filter((l) => l.ingredientId === manualIngId)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
    const chosenLotId =
      manualIngLotId && manualIngLotId !== 'latest'
        ? manualIngLotId
        : ingLots[ingLots.length - 1]?.id || 'latest';

    const existing = selectedEvent.ingredientLotAllocations?.[manualIngId] || [];
    const next: EventIngredientLotAllocation[] = [
      ...existing.map((r) => ({ ...r, autoFillTotal: false })),
      {
        id: 'ing-alloc-' + Date.now(),
        lotId: chosenLotId,
        gramsUsed: g,
        autoFillTotal: false,
      },
    ];
    updateEventIngredientAllocations(manualIngId, next);
    setManualIngGrams('');
  };

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvent) return;
    const amt = parseFloat(expAmount);
    if (!expTitle.trim() || isNaN(amt) || amt <= 0) return;

    const newExp: EventExpense = {
      id: 'exp-' + Date.now(),
      category: expCategory,
      title: expTitle.trim(),
      vendor: expVendor.trim() || undefined,
      amount: amt,
      date: selectedEvent.startDate,
    };

    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id ? { ...ev, expenses: [...ev.expenses, newExp] } : ev
      ),
    }));

    setExpTitle('');
    setExpVendor('');
    setExpAmount('');
  };

  const handleDeleteExpense = (expId: string) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? { ...ev, expenses: ev.expenses.filter((x) => x.id !== expId) }
          : ev
      ),
    }));
  };

  const handleSyncFromRefvPosCloud = async (filterByDate: boolean) => {
    if (!selectedEvent) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const { sales: allCloudSales, source } = await fetchAllPosSalesFromCloud(state.settings);
      if (allCloudSales.length === 0) {
        setSyncMessage({
          type: 'err',
          text: `เชื่อมต่อสำเร็จ (${source}) แต่ยังไม่พบรายการขายในชีท Sales หรือคุณสามารถอัปโหลดไฟล์ CSV จาก REFV POS ได้ทันที`,
        });
        setSyncing(false);
        return;
      }

      const matched = filterByDate
        ? filterSalesForEventWindow(
            allCloudSales,
            selectedEvent.startDate,
            selectedEvent.endDate,
            selectedEvent.startTime,
            selectedEvent.endTime
          )
        : allCloudSales;

      if (matched.length === 0 && filterByDate) {
        setSyncMessage({
          type: 'err',
          text: `พบข้อมูลใน REFV POS ทั้งหมด ${allCloudSales.length} ถ้วย แต่ไม่มีรายการที่ตรงกับวันที่ ${selectedEvent.startDate} ถึง ${selectedEvent.endDate} (กดปุ่ม "ดึงทุกรายการในชีท" ได้หากต้องการนำเข้าทั้งหมด)`,
        });
        setSyncing(false);
        return;
      }

      applyPosSalesToSelectedEvent(
        matched,
        `Sync จาก ${source} สำเร็จ: ดึงยอดขายจำนวน ${matched.length} ถ้วย เรียบร้อยแล้ว!`
      );
    } catch (err) {
      setSyncMessage({
        type: 'err',
        text: `เกิดข้อผิดพลาดในการเชื่อมต่อ: ${String(err)}`,
      });
    } finally {
      setSyncing(false);
    }
  };

  const applyPosSalesToSelectedEvent = (rows: PosSaleRow[], msg: string) => {
    if (!selectedEvent) return;
    const nowStr = new Date().toLocaleString('th-TH');
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id
          ? { ...ev, posSales: rows, lastSyncedAt: nowStr }
          : ev
      ),
    }));
    setSyncMessage({ type: 'ok', text: msg });
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedEvent) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseRefvPosCsvText(text);
      if (parsed.length === 0) {
        setSyncMessage({
          type: 'err',
          text: 'ไม่พบข้อมูลที่ถูกต้องในไฟล์ CSV กรุณาใช้ไฟล์ที่กด Download CSV จาก REFV POS',
        });
        return;
      }

      const matched = filterSalesForEventWindow(
        parsed,
        selectedEvent.startDate,
        selectedEvent.endDate,
        selectedEvent.startTime,
        selectedEvent.endTime
      );

      if (matched.length > 0) {
        applyPosSalesToSelectedEvent(
          matched,
          `นำเข้าจากไฟล์ "${file.name}" สำเร็จ (กรองตามช่วงเวลาบูธได้ ${matched.length} ถ้วย จากทั้งหมด ${parsed.length} ถ้วย)`
        );
      } else {
        if (
          window.confirm(
            `ในไฟล์ CSV มีทั้งหมด ${parsed.length} ถ้วย แต่เป็นคนละวันที่กับบูธนี้ (${selectedEvent.startDate} - ${selectedEvent.endDate})\nต้องการนำเข้าทั้ง ${parsed.length} ถ้วยเข้าสู่บูธนี้เลยหรือไม่?`
          )
        ) {
          applyPosSalesToSelectedEvent(
            parsed,
            `นำเข้าข้อมูลทั้งหมด ${parsed.length} ถ้วย จากไฟล์ "${file.name}" เรียบร้อยแล้ว`
          );
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleUpdateEventDates = (
    field: 'startDate' | 'endDate' | 'startTime' | 'endTime' | 'name' | 'location',
    value: string
  ) => {
    if (!selectedEvent) return;
    onUpdateState((prev) => ({
      ...prev,
      events: prev.events.map((ev) =>
        ev.id === selectedEvent.id ? { ...ev, [field]: value } : ev
      ),
    }));
  };

  return (
    <div className="space-y-6">
      {/* แถบเลือก Event และการสร้างรอบออกบูธใหม่ */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-[#0d3a57] flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#118cd1]" />
              เลือกรอบการออกบูธ (Event / Booth P&L)
            </h2>
            <p className="text-sm text-[#6b8799] mt-0.5">
              ระบบจะตัดสต็อกแก้ว ช้อน แบบ FIFO และสามารถเลือกระบุได้ว่าแต่ละบูธใช้วัตถุดิบจากการซื้อครั้งไหน
            </p>
          </div>
          <button
            onClick={handleOpenNewEventModal}
            className="inline-flex items-center gap-2 bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold px-4 py-2.5 rounded-xl shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            สร้างงานออกบูธใหม่
          </button>
        </div>

        {/* รายการการ์ด Event */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          {state.events.map((ev, index) => {
            const evPnl = sim.eventResults[ev.id];
            const isSelected = selectedEvent?.id === ev.id;
            const profit = evPnl?.netProfit || 0;
            return (
              <div
                key={ev.id}
                onClick={() => {
                  setSelectedEventId(ev.id);
                  setSyncMessage(null);
                }}
                className={`p-4 rounded-xl border-2 transition cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'border-[#118cd1] bg-[#90d4ec]/15 shadow-sm'
                    : 'border-[#eae3cf] bg-[#fef9ec]/50 hover:border-[#90d4ec]'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#118cd1]/10 text-[#118cd1]">
                      ลำดับบูธ #{index + 1}
                    </span>
                    <span className="text-xs text-[#6b8799] font-medium">
                      {ev.startDate} {ev.endDate !== ev.startDate ? `→ ${ev.endDate}` : ''}
                    </span>
                  </div>
                  <h3 className="font-bold text-[#0d3a57] mt-2 line-clamp-1">{ev.name}</h3>
                  <p className="text-xs text-[#6b8799] flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3.5 h-3.5" /> {ev.location}
                  </p>
                </div>

                <div className="mt-3 pt-3 border-t border-[#eae3cf] flex items-center justify-between text-sm">
                  <span className="text-xs text-[#6b8799] font-semibold">
                    ขาย {evPnl?.totalCupsSold || 0} ถ้วย ({formatBaht(evPnl?.netRevenue || 0, 0)})
                  </span>
                  <span
                    className={`font-extrabold ${
                      profit >= 0 ? 'text-[#1a9a5b]' : 'text-rose-600'
                    }`}
                  >
                    {formatSignedBaht(profit, 0)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!selectedEvent || !pnl ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-[#eae3cf]">
          <p className="text-[#6b8799] font-medium">
            ยังไม่มีงานออกบูธ กรุณากดปุ่ม &ldquo;สร้างงานออกบูธใหม่&rdquo; ด้านบน
          </p>
        </div>
      ) : (
        <>
          {/* แผงควบคุมบูธที่เลือก + Sync REFV POS */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf] space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#eae3cf]">
              <div className="space-y-2 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={selectedEvent.name}
                    onChange={(e) => handleUpdateEventDates('name', e.target.value)}
                    className="text-xl font-extrabold text-[#0d3a57] bg-transparent border-b border-dashed border-[#6b8799]/40 focus:border-[#118cd1] focus:outline-none px-1 py-0.5 min-w-[280px]"
                  />
                  <button
                    onClick={() => handleDeleteEvent(selectedEvent.id)}
                    className="text-xs text-rose-600 hover:bg-rose-50 px-2.5 py-1 rounded-lg font-semibold inline-flex items-center gap-1"
                    title="ลบบูธนี้"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> ลบบูธ
                  </button>
                  <button
                    onClick={handleToggleLockEvent}
                    className={`text-xs px-3 py-1 rounded-lg font-extrabold inline-flex items-center gap-1 border cursor-pointer transition ${
                      selectedEvent.isLocked
                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                        : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                    }`}
                    title="เมื่อล็อกแล้ว การไปแก้สูตรหรือเปลี่ยนล็อตวัตถุดิบในอนาคตจะไม่กระทบยอดของบูธนี้"
                  >
                    {selectedEvent.isLocked
                      ? '🔒 ล็อกสูตร & ต้นทุนบูธนี้แล้ว (คลิกเพื่อปลดล็อก)'
                      : '🔓 กดเพื่อล็อกสูตร & ปิดจ๊อบบูธนี้'}
                  </button>
                  {!selectedEvent.isLocked && (
                    <button
                      onClick={handleApplyCurrentMasterRecipesToThisEvent}
                      className="text-xs bg-[#fef9ec] hover:bg-[#90d4ec]/30 text-[#0d3a57] border border-[#eae3cf] px-2.5 py-1 rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer"
                      title="ดึงสูตรล่าสุดจากหน้าสูตรมาใช้กับเฉพาะบูธนี้ โดยไม่กระทบบูธก่อนหน้า"
                    >
                      <RefreshCw className="w-3 h-3 text-[#118cd1]" />
                      ดึงสูตรล่าสุดมาใช้เฉพาะบูธนี้
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-[#0d3a57]">
                  <label className="flex items-center gap-1.5 bg-[#fef9ec] px-3 py-1.5 rounded-lg border border-[#eae3cf]">
                    <MapPin className="w-3.5 h-3.5 text-[#118cd1]" />
                    <span className="font-semibold text-[#6b8799]">สถานที่:</span>
                    <input
                      type="text"
                      value={selectedEvent.location}
                      onChange={(e) => handleUpdateEventDates('location', e.target.value)}
                      className="bg-transparent font-bold focus:outline-none w-36"
                    />
                  </label>

                  <label className="flex items-center gap-1.5 bg-[#fef9ec] px-3 py-1.5 rounded-lg border border-[#eae3cf]">
                    <Calendar className="w-3.5 h-3.5 text-[#118cd1]" />
                    <span className="font-semibold text-[#6b8799]">เริ่ม:</span>
                    <input
                      type="date"
                      value={selectedEvent.startDate}
                      onChange={(e) => handleUpdateEventDates('startDate', e.target.value)}
                      className="bg-transparent font-bold focus:outline-none"
                    />
                    <input
                      type="time"
                      value={selectedEvent.startTime}
                      onChange={(e) => handleUpdateEventDates('startTime', e.target.value)}
                      className="bg-transparent font-bold focus:outline-none"
                    />
                  </label>

                  <label className="flex items-center gap-1.5 bg-[#fef9ec] px-3 py-1.5 rounded-lg border border-[#eae3cf]">
                    <Clock className="w-3.5 h-3.5 text-[#118cd1]" />
                    <span className="font-semibold text-[#6b8799]">ถึง:</span>
                    <input
                      type="date"
                      value={selectedEvent.endDate}
                      onChange={(e) => handleUpdateEventDates('endDate', e.target.value)}
                      className="bg-transparent font-bold focus:outline-none"
                    />
                    <input
                      type="time"
                      value={selectedEvent.endTime}
                      onChange={(e) => handleUpdateEventDates('endTime', e.target.value)}
                      className="bg-transparent font-bold focus:outline-none"
                    />
                  </label>
                </div>
              </div>

              {/* ปุ่ม Sync กับ REFV POS */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleSyncFromRefvPosCloud(true)}
                  disabled={syncing}
                  className="inline-flex items-center gap-2 bg-[#118cd1] hover:bg-[#0e78b5] disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl shadow-sm transition cursor-pointer text-sm"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'กำลังดึงข้อมูล...' : 'Sync ยอดขายจาก REFV POS (ตามช่วงเวลาบูธ)'}
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 bg-[#90d4ec]/30 hover:bg-[#90d4ec]/50 text-[#0d3a57] font-bold px-3.5 py-2.5 rounded-xl transition cursor-pointer text-sm"
                >
                  <Upload className="w-4 h-4 text-[#118cd1]" />
                  นำเข้า CSV จาก POS
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCsvFileUpload}
                  className="hidden"
                />
              </div>
            </div>

            {syncMessage && (
              <div
                className={`p-3.5 rounded-xl flex items-center justify-between gap-3 text-sm font-semibold ${
                  syncMessage.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-amber-50 text-amber-900 border border-amber-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {syncMessage.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span>{syncMessage.text}</span>
                </div>
                {syncMessage.type === 'err' && (
                  <button
                    onClick={() => handleSyncFromRefvPosCloud(false)}
                    className="bg-amber-200/70 hover:bg-amber-300 text-amber-950 px-3 py-1 rounded-lg text-xs font-bold shrink-0"
                  >
                    ดึงทุกรายการในชีทโดยไม่กรองวันที่
                  </button>
                )}
              </div>
            )}

            {/* 4 KPI Cards สรุปผลประกอบการ (Revenue - Costs = Net Profit -/+) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 1. รายได้รวมจาก POS */}
              <div className="bg-[#fef9ec] rounded-2xl p-4 border border-[#eae3cf]">
                <div className="flex items-center justify-between text-xs font-bold text-[#6b8799]">
                  <span>1. ยอดขายสุทธิจาก POS</span>
                  <FileSpreadsheet className="w-4 h-4 text-[#118cd1]" />
                </div>
                <div className="text-2xl font-extrabold text-[#0d3a57] mt-1">
                  {formatBaht(pnl.netRevenue)}
                </div>
                <div className="mt-2 text-xs text-[#6b8799] space-y-0.5">
                  <div className="flex justify-between">
                    <span>จำนวนที่ขายได้:</span>
                    <b className="text-[#0d3a57]">
                      {pnl.totalCupsSold} ถ้วย ({pnl.totalOrders} ออเดอร์)
                    </b>
                  </div>
                  <div className="flex justify-between">
                    <span>QR / เงินสด:</span>
                    <span>
                      {formatBaht(pnl.qrRevenue, 0)} / {formatBaht(pnl.cashRevenue, 0)}
                    </span>
                  </div>
                  {pnl.totalDiscount > 0 && (
                    <div className="flex justify-between text-rose-600">
                      <span>ส่วนลดโปรโมชั่น:</span>
                      <span>-{formatBaht(pnl.totalDiscount)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. ต้นทุนวัตถุดิบ + แพ็กเกจจิ้ง */}
              <div className="bg-[#fef9ec] rounded-2xl p-4 border border-[#eae3cf]">
                <div className="flex items-center justify-between text-xs font-bold text-[#6b8799]">
                  <span>2. ต้นทุนเนื้อไอติม + แพ็กเกจ</span>
                  <IceCream className="w-4 h-4 text-[#118cd1]" />
                </div>
                <div className="text-2xl font-extrabold text-[#0d3a57] mt-1">
                  {formatBaht(pnl.totalIngredientCost + pnl.totalPackagingCost)}
                </div>
                <div className="mt-2 text-xs text-[#6b8799] space-y-0.5">
                  <div className="flex justify-between">
                    <span>ค่าเนื้อไอติม (ตามล็อตที่เลือก):</span>
                    <b className="text-[#0d3a57]">{formatBaht(pnl.totalIngredientCost)}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>ค่าแก้ว/ช้อน/แพ็กเกจ (ตามล็อตที่เลือก):</span>
                    <b className="text-[#0d3a57]">{formatBaht(pnl.totalPackagingCost)}</b>
                  </div>
                  <div className="flex justify-between text-[#118cd1] font-semibold">
                    <span>เฉลี่ยต่อถ้วย:</span>
                    <span>
                      {formatBaht(
                        pnl.totalCupsSold > 0
                          ? (pnl.totalIngredientCost + pnl.totalPackagingCost) / pnl.totalCupsSold
                          : 0
                      )}
                      /ถ้วย
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. ค่าสถานที่และค่าใช้จ่ายหน้างาน */}
              <div className="bg-[#fef9ec] rounded-2xl p-4 border border-[#eae3cf]">
                <div className="flex items-center justify-between text-xs font-bold text-[#6b8799]">
                  <span>3. ค่าสถานที่ & ค่าใช้จ่ายบูธ</span>
                  <Receipt className="w-4 h-4 text-[#118cd1]" />
                </div>
                <div className="text-2xl font-extrabold text-[#0d3a57] mt-1">
                  {formatBaht(pnl.totalFixedExpenses)}
                </div>
                <div className="mt-2 text-xs text-[#6b8799] space-y-0.5">
                  <div className="flex justify-between">
                    <span>ค่าเช่าสถานที่:</span>
                    <b className="text-[#0d3a57]">
                      {formatBaht(pnl.expensesByCategory.venue || 0)}
                    </b>
                  </div>
                  <div className="flex justify-between">
                    <span>น้ำแข็งแห้ง/ขนส่ง/อื่นๆ:</span>
                    <b className="text-[#0d3a57]">
                      {formatBaht(pnl.totalFixedExpenses - (pnl.expensesByCategory.venue || 0))}
                    </b>
                  </div>
                  <div className="flex justify-between">
                    <span>รวมต้นทุนทั้งสิ้น (2+3):</span>
                    <b className="text-rose-700">{formatBaht(pnl.totalAllCosts)}</b>
                  </div>
                </div>
              </div>

              {/* 4. สรุปกำไร-ขาดทุนสุทธิ (-/+) */}
              <div
                className={`rounded-2xl p-4 border-2 ${
                  pnl.netProfit >= 0
                    ? 'bg-emerald-50/70 border-emerald-400'
                    : 'bg-rose-50/70 border-rose-400'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className={pnl.netProfit >= 0 ? 'text-emerald-800' : 'text-rose-800'}>
                    4. ผลประกอบการสุทธิ (-/+)
                  </span>
                  {pnl.netProfit >= 0 ? (
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-rose-600" />
                  )}
                </div>
                <div
                  className={`text-2xl font-black mt-1 ${
                    pnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'
                  }`}
                >
                  {formatSignedBaht(pnl.netProfit)}
                </div>
                <div className="mt-2 text-xs space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-[#6b8799]">คิดเป็นอัตรากำไรสุทธิ:</span>
                    <b className={pnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                      {pnl.profitMarginPct.toFixed(1)}%
                    </b>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6b8799]">กำไรสุทธิเฉลี่ยต่อถ้วย:</span>
                    <b className="text-[#0d3a57]">
                      {formatSignedBaht(
                        pnl.totalCupsSold > 0 ? pnl.netProfit / pnl.totalCupsSold : 0
                      )}
                      /ถ้วย
                    </b>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ส่วนเลือกล็อตแพ็กเกจจิ้งที่ใช้ในบูธ (รองรับหลายเจ้าในบูธเดียว) + ค่าใช้จ่ายประจำบูธ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ซ้าย: เลือกตัดสต็อกแพ็กเกจจิ้งตามล็อตที่สั่งซื้อ (รองรับมากกว่า 1 เจ้าในบูธเดียว) */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf] space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-[#0d3a57] flex items-center gap-2">
                    <Package className="w-5 h-5 text-[#118cd1]" />
                    การเลือกตัดสต็อกแพ็กเกจจิ้งตามล็อตที่สั่งซื้อ ({pnl.totalCupsSold} ถ้วย)
                  </h3>
                  <p className="text-xs text-[#6b8799] mt-0.5">
                    เลือกได้เลยว่าใช้ของจากการสั่งซื้อครั้งไหน และสามารถเพิ่มได้มากกว่า 1 เจ้าในบูธเดียว (เช่น ของหมดกลางทางแล้วซื้อเพิ่มหน้างาน)
                  </p>
                </div>
                <span className="text-base font-extrabold text-[#118cd1]">
                  รวม {formatBaht(pnl.totalPackagingCost)}
                </span>
              </div>

              {pnl.packagingUsages.length === 0 ? (
                <p className="text-sm text-[#6b8799] py-4 text-center">
                  ยังไม่มีรายการวัสดุแพ็กเกจจิ้ง
                </p>
              ) : (
                <div className="space-y-3.5">
                  {pnl.packagingUsages.map((u) => {
                    const itemLots = state.packagingLots
                      .filter((l) => l.itemId === u.itemId)
                      .sort(
                        (a, b) =>
                          a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id)
                      );
                    const lotStates = sim.packagingLotStates[u.itemId] || [];
                    const allocations = getEffectivePackagingAllocations(
                      u.itemId,
                      u.totalQuantityNeeded
                    );
                    const allocatedSum = allocations.reduce(
                      (s, r) => s + (Number(r.quantity) || 0),
                      0
                    );
                    const diffFromNeeded = u.totalQuantityNeeded - allocatedSum;

                    return (
                      <div
                        key={u.itemId}
                        className="bg-[#fef9ec] rounded-xl p-3.5 border border-[#eae3cf] space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-sm text-[#0d3a57]">
                          <div>
                            <span>
                              {u.itemName} — ต้องใช้รวม {u.totalQuantityNeeded.toLocaleString()}{' '}
                              {u.unit}
                            </span>
                            <span className="text-xs font-normal text-[#6b8799] ml-1.5">
                              (ตามถ้วย POS {u.posQuantityNeeded.toLocaleString()}{' '}
                              {u.extraQuantityNeeded > 0
                                ? `+ ใช้เพิ่ม/ช้อนชิม ${u.extraQuantityNeeded.toLocaleString()}`
                                : ''}
                              )
                            </span>
                          </div>
                          <span className="text-[#118cd1]">{formatBaht(u.totalCost)}</span>
                        </div>

                        {/* ช่องกรอกจำนวนที่ใช้เพิ่มในบูธนี้ เช่น ช้อนชิม / ลูกค้าขอเพิ่ม / ของเสีย */}
                        <div className="flex flex-wrap items-center justify-between gap-2 bg-white/80 px-3 py-1.5 rounded-lg border border-dashed border-[#eae3cf] text-xs">
                          <span className="text-[#6b8799] font-semibold">
                            + บวกใช้เพิ่มในบูธนี้ (เช่น ช้อนชิม / ขอเพิ่ม / เสีย):
                          </span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={
                                selectedEvent.extraPackagingUsage?.[u.itemId] !== undefined
                                  ? selectedEvent.extraPackagingUsage[u.itemId]
                                  : ''
                              }
                              placeholder="0"
                              onChange={(e) =>
                                handleSetExtraPackagingUsage(
                                  u.itemId,
                                  e.target.value === '' ? 0 : parseFloat(e.target.value)
                                )
                              }
                              className="w-20 text-right font-bold bg-white border border-[#eae3cf] focus:border-[#118cd1] focus:outline-none rounded-md px-2 py-1 text-[#0d3a57]"
                            />
                            <span className="font-semibold text-[#6b8799]">{u.unit}</span>
                          </div>
                        </div>

                        {/* รายการเลือกล็อตที่สั่งซื้อมาใช้ (เลือกได้มากกว่า 1 เจ้าในบูธเดียว) */}
                        {itemLots.length === 0 ? (
                          <div className="text-xs bg-amber-50 text-amber-900 px-3 py-2 rounded-lg border border-amber-200 flex flex-wrap items-center justify-between gap-2">
                            <span>
                              ⚠️ ยังไม่มีประวัติล็อตสั่งซื้อของ <b>{u.itemName}</b>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setQuickAddPkgItemId(u.itemId);
                                setQuickPkgDate(selectedEvent.startDate || today);
                                setQuickPkgUseQty(String(u.totalQuantityNeeded || ''));
                              }}
                              className="text-xs font-extrabold text-[#118cd1] hover:underline cursor-pointer"
                            >
                              + เพิ่มล็อตสั่งซื้อตอนนี้เลย
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {allocations.map((alloc, idx) => {
                              const selectedLot =
                                itemLots.find((l) => l.id === alloc.lotId) || itemLots[0];
                              const rowCost =
                                (Number(alloc.quantity) || 0) * (selectedLot?.unitCost || 0);

                              return (
                                <div
                                  key={alloc.id || `${u.itemId}-${idx}`}
                                  className="bg-white p-2.5 rounded-xl border border-[#eae3cf] space-y-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-extrabold px-2 py-0.5 rounded bg-[#90d4ec]/30 text-[#0d3a57]">
                                      เจ้าที่ {idx + 1} ที่นำมาใช้ในบูธนี้
                                    </span>
                                    {allocations.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleRemovePackagingLotRow(
                                            u.itemId,
                                            idx,
                                            u.totalQuantityNeeded
                                          )
                                        }
                                        className="text-[11px] text-rose-600 hover:bg-rose-50 px-2 py-0.5 rounded font-bold inline-flex items-center gap-1 cursor-pointer"
                                      >
                                        <Trash2 className="w-3 h-3" /> ลบเจ้าที่ {idx + 1}
                                      </button>
                                    )}
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                                    <div className="sm:col-span-7">
                                      <select
                                        value={selectedLot?.id || ''}
                                        onChange={(e) =>
                                          handleChangePackagingLotId(
                                            u.itemId,
                                            idx,
                                            e.target.value,
                                            u.totalQuantityNeeded
                                          )
                                        }
                                        className="w-full text-xs font-bold bg-[#fef9ec] border border-[#eae3cf] focus:border-[#118cd1] focus:outline-none rounded-lg px-2.5 py-2 text-[#0d3a57]"
                                      >
                                        {itemLots.map((lot, lotIdx) => {
                                          const st = lotStates.find((s) => s.lotId === lot.id);
                                          const rem = st ? st.remainingQty : lot.quantity;
                                          return (
                                            <option key={lot.id} value={lot.id}>
                                              ครั้งที่ {lotIdx + 1}: {lot.purchaseDate} ·{' '}
                                              {lot.vendor} ({formatBaht(lot.unitCost)}/{u.unit} ·
                                              เหลือในคลัง {rem.toLocaleString()} {u.unit})
                                            </option>
                                          );
                                        })}
                                      </select>
                                    </div>

                                    <div className="sm:col-span-5 flex items-center justify-between sm:justify-end gap-1.5 text-xs">
                                      <span className="text-[#6b8799] font-semibold shrink-0">
                                        ใช้:
                                      </span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={alloc.quantity}
                                        onChange={(e) =>
                                          handleChangePackagingLotQuantity(
                                            u.itemId,
                                            idx,
                                            e.target.value === '' ? 0 : parseFloat(e.target.value),
                                            u.totalQuantityNeeded
                                          )
                                        }
                                        className="w-16 text-right font-extrabold bg-[#fef9ec] border border-[#eae3cf] focus:border-[#118cd1] focus:outline-none rounded-lg px-2 py-1.5 text-[#0d3a57]"
                                      />
                                      <span className="text-[#6b8799] font-semibold shrink-0">
                                        {u.unit}
                                      </span>
                                      <span className="font-extrabold text-[#0d3a57] min-w-[70px] text-right">
                                        = {formatBaht(rowCost)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}

                            {/* แจ้งเตือนกรณีแบ่งจำนวนหลายเจ้าแล้วยอดรวมยังไม่ตรงกับจำนวนที่ใช้ในบูธ */}
                            {Math.abs(diffFromNeeded) > 0.001 && (
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-amber-50 text-amber-900 px-3 py-2 rounded-lg border border-amber-200">
                                <span>
                                  {diffFromNeeded > 0
                                    ? `⚠️ ระบุจำนวนรวมไว้ ${allocatedSum.toLocaleString()} ${u.unit} (ยังขาดอีก ${diffFromNeeded.toLocaleString()} ${u.unit} จากยอดใช้จริง ${u.totalQuantityNeeded.toLocaleString()} ${u.unit})`
                                    : `ℹ️ ระบุจำนวนรวมไว้ ${allocatedSum.toLocaleString()} ${u.unit} (มากกว่ายอดตามถ้วย ${Math.abs(diffFromNeeded).toLocaleString()} ${u.unit})`}
                                </span>
                                {allocations.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleBalancePackagingLotRow(
                                        u.itemId,
                                        allocations.length - 1,
                                        u.totalQuantityNeeded
                                      )
                                    }
                                    className="text-xs font-extrabold bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-md cursor-pointer"
                                  >
                                    ปรับเจ้าที่ {allocations.length} ให้ครบ{' '}
                                    {u.totalQuantityNeeded.toLocaleString()} {u.unit}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* ปุ่มเพิ่มเจ้าที่ 2 ในบูธเดียวกัน หรือบันทึกซื้อเพิ่มหน้างานด่วน */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {itemLots.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                handleAddPackagingLotRow(u.itemId, u.totalQuantityNeeded)
                              }
                              className="text-xs font-bold text-[#118cd1] bg-white hover:bg-[#90d4ec]/20 border border-[#90d4ec] px-3 py-1.5 rounded-lg inline-flex items-center gap-1 transition cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              เพิ่มล็อต/ร้านที่ใช้ร่วมในบูธนี้ (ใช้มากกว่า 1 เจ้า)
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              if (quickAddPkgItemId === u.itemId) {
                                setQuickAddPkgItemId(null);
                              } else {
                                setQuickAddPkgItemId(u.itemId);
                                setQuickPkgDate(selectedEvent.startDate || today);
                                setQuickPkgVendor('');
                                setQuickPkgBuyQty('');
                                setQuickPkgTotalPrice('');
                                setQuickPkgUseQty(
                                  String(diffFromNeeded > 0 ? diffFromNeeded : '')
                                );
                              }
                            }}
                            className="text-xs font-bold text-[#0d3a57] bg-white hover:bg-slate-100 border border-[#eae3cf] px-3 py-1.5 rounded-lg inline-flex items-center gap-1 transition cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-emerald-600" />
                            ซื้อเพิ่มหน้างาน (เพิ่ม Vendor ใหม่เข้าคลัง & ใช้ในบูธนี้)
                          </button>
                        </div>

                        {/* ฟอร์มด่วน: บันทึกซื้อแพ็กเกจจิ้งเพิ่มหน้างานแล้วนำมาตัดในบูธนี้ทันที */}
                        {quickAddPkgItemId === u.itemId && (
                          <form
                            onSubmit={(e) =>
                              handleQuickCreatePackagingLotAndUse(
                                e,
                                u.itemId,
                                u.totalQuantityNeeded
                              )
                            }
                            className="bg-white p-3 rounded-xl border-2 border-[#118cd1] space-y-2.5 mt-2"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-extrabold text-[#0d3a57]">
                                🛒 บันทึกซื้อ &ldquo;{u.itemName}&rdquo; เพิ่มหน้างาน (เพิ่มเข้าคลัง
                                + ดึงมาใช้ในบูธนี้)
                              </span>
                              <button
                                type="button"
                                onClick={() => setQuickAddPkgItemId(null)}
                                className="text-xs text-[#6b8799] hover:text-rose-600 font-bold cursor-pointer"
                              >
                                ปิด ×
                              </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[11px] font-bold text-[#6b8799] mb-0.5">
                                  ชื่อร้าน / Vendor ที่ซื้อเพิ่ม *
                                </label>
                                <input
                                  type="text"
                                  placeholder="เช่น ร้านหน้างาน, Makro, 7-Eleven"
                                  value={quickPkgVendor}
                                  onChange={(e) => setQuickPkgVendor(e.target.value)}
                                  className="w-full text-xs font-semibold bg-[#fef9ec] border border-[#eae3cf] rounded-lg px-2.5 py-1.5"
                                  required
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-[#6b8799] mb-0.5">
                                  วันที่ซื้อ
                                </label>
                                <input
                                  type="date"
                                  value={quickPkgDate}
                                  onChange={(e) => setQuickPkgDate(e.target.value)}
                                  className="w-full text-xs font-semibold bg-[#fef9ec] border border-[#eae3cf] rounded-lg px-2.5 py-1.5"
                                  required
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div>
                                <label className="block text-[11px] font-bold text-[#6b8799] mb-0.5">
                                  จำนวนที่ซื้อมาทั้งหมด ({u.unit}) *
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  step="any"
                                  placeholder="เช่น 100"
                                  value={quickPkgBuyQty}
                                  onChange={(e) => setQuickPkgBuyQty(e.target.value)}
                                  className="w-full text-xs font-bold bg-[#fef9ec] border border-[#eae3cf] rounded-lg px-2.5 py-1.5"
                                  required
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-[#6b8799] mb-0.5">
                                  ราคารวมที่จ่าย (บาท) *
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  placeholder="เช่น 300"
                                  value={quickPkgTotalPrice}
                                  onChange={(e) => setQuickPkgTotalPrice(e.target.value)}
                                  className="w-full text-xs font-bold bg-[#fef9ec] border border-[#eae3cf] rounded-lg px-2.5 py-1.5"
                                  required
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-[#118cd1] mb-0.5">
                                  แบ่งมาใช้ในบูธนี้กี่ {u.unit}?
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  placeholder="เช่น 16"
                                  value={quickPkgUseQty}
                                  onChange={(e) => setQuickPkgUseQty(e.target.value)}
                                  className="w-full text-xs font-extrabold bg-white border-2 border-[#118cd1]/50 rounded-lg px-2.5 py-1.5 text-[#0d3a57]"
                                />
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[11px] text-[#6b8799]">
                                {parseFloat(quickPkgBuyQty) > 0 &&
                                parseFloat(quickPkgTotalPrice) >= 0
                                  ? `ตกชิ้นละ ${formatBaht(
                                      parseFloat(quickPkgTotalPrice) / parseFloat(quickPkgBuyQty)
                                    )}/${u.unit}`
                                  : 'ระบบจะเก็บส่วนที่เหลือเข้าคลังแพ็กเกจจิ้งให้อัตโนมัติ'}
                              </span>
                              <button
                                type="submit"
                                className="bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold text-xs px-3.5 py-1.5 rounded-lg cursor-pointer"
                              >
                                บันทึกล็อตใหม่ & นำมาใช้ในบูธนี้
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ขวา: ค่าใช้จ่ายประจำบูธ (ค่าเช่าสถานที่, น้ำแข็งแห้ง, ขนส่ง, อื่นๆ) */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf] space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-[#0d3a57] flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-[#118cd1]" />
                    ค่าสถานที่ & ค่าใช้จ่ายอื่นๆ ประจำบูธ
                  </h3>
                  <p className="text-xs text-[#6b8799] mt-0.5">
                    บันทึกค่าเช่าบูธ ค่าน้ำแข็งแห้ง ค่าเดินทาง ค่าแรงพนักงานของงานนี้
                  </p>
                </div>
                <span className="text-base font-extrabold text-[#0d3a57]">
                  รวม {formatBaht(pnl.totalFixedExpenses)}
                </span>
              </div>

              {/* ฟอร์มเพิ่มค่าใช้จ่าย */}
              <form
                onSubmit={handleAddExpense}
                className="bg-[#fef9ec] p-3.5 rounded-xl border border-[#eae3cf] grid grid-cols-1 sm:grid-cols-12 gap-2.5"
              >
                <div className="sm:col-span-4">
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
                    className="w-full text-xs font-bold bg-white border border-[#eae3cf] rounded-lg px-2.5 py-2 text-[#0d3a57]"
                  >
                    {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-5">
                  <input
                    type="text"
                    placeholder="รายการ (เช่น ค่าเช่าบูธ, น้ำแข็งแห้ง 20 กก.)"
                    value={expTitle}
                    onChange={(e) => setExpTitle(e.target.value)}
                    className="w-full text-xs bg-white border border-[#eae3cf] rounded-lg px-2.5 py-2 text-[#0d3a57]"
                    required
                  />
                </div>
                <div className="sm:col-span-3 flex gap-1.5">
                  <input
                    type="number"
                    step="any"
                    placeholder="จำนวนเงิน (฿)"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className="w-full text-xs font-bold bg-white border border-[#eae3cf] rounded-lg px-2.5 py-2 text-[#0d3a57]"
                    required
                  />
                  <button
                    type="submit"
                    className="bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold px-3 py-2 rounded-lg text-xs shrink-0 cursor-pointer"
                  >
                    + เพิ่ม
                  </button>
                </div>
              </form>

              {/* รายการค่าใช้จ่ายที่บันทึกไว้ */}
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {selectedEvent.expenses.length === 0 ? (
                  <p className="text-sm text-[#6b8799] py-4 text-center">
                    ยังไม่มีรายการค่าสถานที่หรือค่าใช้จ่ายอื่นๆ ในบูธนี้
                  </p>
                ) : (
                  selectedEvent.expenses.map((exp) => {
                    const catInfo =
                      EXPENSE_CATEGORY_LABELS[exp.category] || EXPENSE_CATEGORY_LABELS.other;
                    return (
                      <div
                        key={exp.id}
                        className="flex items-center justify-between gap-2 bg-[#fef9ec]/60 px-3.5 py-2.5 rounded-xl border border-[#eae3cf] text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold shrink-0 ${catInfo.badge}`}
                          >
                            {catInfo.label}
                          </span>
                          <span className="font-bold text-[#0d3a57] truncate">{exp.title}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-extrabold text-[#0d3a57] text-sm">
                            {formatBaht(exp.amount)}
                          </span>
                          <button
                            onClick={() => handleDeleteExpense(exp.id)}
                            className="text-rose-500 hover:bg-rose-50 p-1 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ส่วนระบุว่าในบูธนี้ วัตถุดิบแต่ละตัวใช้จาก Vendor / ล็อตไหน และใช้ไปกี่กรัม (แผนภูมิแท่ง Vendor Bar Chart & Expandable) */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-extrabold text-[#0d3a57] flex items-center gap-2">
                  <Scale className="w-5 h-5 text-[#118cd1]" />
                  <span>วัตถุดิบที่ใช้ในงานออกบูธนี้ แยกตาม Vendor</span>
                  <span className="text-xs bg-[#118cd1]/15 text-[#118cd1] font-extrabold px-2.5 py-0.5 rounded-full">
                    {pnl.ingredientUsages.length} รายการ
                  </span>
                </h3>
                <p className="text-xs text-[#6b8799] mt-0.5">
                  แผนภูมิแท่งแสดงสัดส่วนปริมาณกรัม (g) และต้นทุนที่ดึงใช้จริงจากแต่ละ Vendor ในบูธนี้
                </p>
              </div>

              <div className="flex items-center gap-2.5 self-start sm:self-auto">
                <span className="text-sm font-extrabold text-[#118cd1]">
                  รวมต้นทุนวัตถุดิบ: {formatBaht(pnl.totalIngredientCost)}
                </span>
                <button
                  type="button"
                  onClick={() => setIsIngredientVendorExpanded(!isIngredientVendorExpanded)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs bg-[#fef9ec] hover:bg-[#eae3cf]/60 border border-[#eae3cf] text-[#0d3a57] transition cursor-pointer"
                >
                  <BarChart3 className="w-3.5 h-3.5 text-[#118cd1]" />
                  <span>
                    {isIngredientVendorExpanded
                      ? 'ย่อแผนภูมิ ▲'
                      : `ขยายดูแผนภูมิแท่ง (${pnl.ingredientUsages.length}) ▼`}
                  </span>
                </button>
              </div>
            </div>

            {/* Collapsed Preview Bar */}
            {!isIngredientVendorExpanded && pnl.ingredientUsages.length > 0 && (
              <div
                onClick={() => setIsIngredientVendorExpanded(true)}
                className="bg-[#fef9ec] hover:bg-[#eae3cf]/40 transition rounded-xl p-3.5 border border-[#eae3cf] flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-2.5 text-xs text-[#6b8799]">
                  <BarChart3 className="w-4 h-4 text-[#118cd1] shrink-0" />
                  <span>
                    ใช้วัตถุดิบทั้งหมด <b className="text-[#0d3a57]">{pnl.ingredientUsages.length} รายการ</b>{' '}
                    (ใช้รวม{' '}
                    <b className="text-[#0d3a57]">
                      {pnl.ingredientUsages
                        .reduce((s, u) => s + u.totalGramsNeeded, 0)
                        .toLocaleString(undefined, { maximumFractionDigits: 1 })}{' '}
                      g
                    </b>{' '}
                    · {formatBaht(pnl.totalIngredientCost)})
                  </span>
                </div>
                <span className="text-xs font-bold text-[#118cd1] group-hover:underline flex items-center gap-1 shrink-0">
                  ขยายดูแผนภูมิ <ChevronDown className="w-3.5 h-3.5" />
                </span>
              </div>
            )}

            {/* Expanded Bar Charts */}
            {isIngredientVendorExpanded && (
              <>
                {pnl.ingredientUsages.length === 0 ? (
                  <div className="text-xs text-[#6b8799] bg-[#fef9ec] p-4 rounded-xl border border-[#eae3cf] text-center">
                    ยังไม่มีรายการวัตถุดิบที่คำนวณในบูธนี้
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {pnl.ingredientUsages.map((u) => {
                      // จัดกลุ่ม slices ตาม Vendor
                      const vendorGroups = new Map<
                        string,
                        {
                          vendor: string;
                          grams: number;
                          totalCost: number;
                          lotDates: string[];
                          unitCost: number;
                        }
                      >();

                      if (u.slices && u.slices.length > 0) {
                        for (const s of u.slices) {
                          const vName = (s.vendor || 'ไม่ระบุ Vendor').trim();
                          const existing = vendorGroups.get(vName);
                          if (!existing) {
                            vendorGroups.set(vName, {
                              vendor: vName,
                              grams: s.quantityUsed,
                              totalCost: s.totalCost,
                              lotDates: s.purchaseDate ? [s.purchaseDate] : [],
                              unitCost: s.unitCost,
                            });
                          } else {
                            existing.grams += s.quantityUsed;
                            existing.totalCost += s.totalCost;
                            if (s.purchaseDate && !existing.lotDates.includes(s.purchaseDate)) {
                              existing.lotDates.push(s.purchaseDate);
                            }
                          }
                        }
                      } else if (u.totalGramsNeeded > 0) {
                        const lots = state.ingredientLots.filter((l) => l.ingredientId === u.ingredientId);
                        const fallbackVendor = lots.length > 0 ? lots[lots.length - 1].vendor : 'ยังไม่มีล็อตซื้อ';
                        vendorGroups.set(fallbackVendor, {
                          vendor: fallbackVendor,
                          grams: u.totalGramsNeeded,
                          totalCost: u.totalCost,
                          lotDates: [],
                          unitCost: u.totalGramsNeeded > 0 ? u.totalCost / u.totalGramsNeeded : 0,
                        });
                      }

                      const vendorList = Array.from(vendorGroups.values());
                      const barPalette = [
                        'bg-[#118cd1]', // primary blue
                        'bg-[#0284c7]', // sky
                        'bg-[#0d9488]', // teal
                        'bg-[#f59e0b]', // amber
                        'bg-[#8b5cf6]', // violet
                        'bg-[#ec4899]', // pink
                      ];

                      return (
                        <div
                          key={u.ingredientId}
                          className="bg-[#fef9ec] rounded-2xl p-4 border border-[#eae3cf] shadow-xs flex flex-col justify-between space-y-3"
                        >
                          {/* Card Header */}
                          <div className="flex items-start justify-between gap-2 border-b border-[#eae3cf]/60 pb-2.5">
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-extrabold text-sm text-[#0d3a57]">
                                  {u.ingredientName}
                                </span>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#118cd1]/15 text-[#118cd1]">
                                  {vendorList.length} Vendor
                                </span>
                              </div>
                              <div className="text-[11px] text-[#6b8799] mt-0.5">
                                ใช้รวม:{' '}
                                <b className="text-[#0d3a57]">
                                  {u.totalGramsNeeded.toLocaleString(undefined, {
                                    maximumFractionDigits: 1,
                                  })}{' '}
                                  g
                                </b>
                                {u.recipeGramsNeeded > 0 && (
                                  <span className="ml-1 text-[10px]">
                                    (ตามสูตร {u.recipeGramsNeeded.toLocaleString(undefined, { maximumFractionDigits: 1 })} g)
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <span className="font-extrabold text-sm text-rose-700 block">
                                {formatBaht(u.totalCost)}
                              </span>
                              <span className="text-[10px] text-[#6b8799]">
                                เฉลี่ย {formatBaht(u.totalGramsNeeded > 0 ? u.totalCost / u.totalGramsNeeded : 0, 3)}/g
                              </span>
                            </div>
                          </div>

                          {/* แผนภูมิแท่ง: แสดง 1 แท่งต่อ 1 Vendor */}
                          <div className="space-y-2.5">
                            {vendorList.map((vg, vIdx) => {
                              const pct = u.totalGramsNeeded > 0 ? (vg.grams / u.totalGramsNeeded) * 100 : 100;
                              const barColor = barPalette[vIdx % barPalette.length];

                              return (
                                <div key={vg.vendor} className="space-y-1">
                                  <div className="flex items-center justify-between text-xs gap-2">
                                    <div className="font-bold text-[#0d3a57] flex items-center gap-1.5 truncate">
                                      <span className={`w-2.5 h-2.5 rounded-full ${barColor} shrink-0`} />
                                      <span className="truncate">{vg.vendor}</span>
                                      {vg.lotDates.length > 0 && (
                                        <span className="text-[10px] text-[#6b8799] font-normal truncate">
                                          ({vg.lotDates.join(', ')})
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-right shrink-0 text-xs">
                                      <b className="text-[#0d3a57]">
                                        {vg.grams.toLocaleString(undefined, { maximumFractionDigits: 1 })} g
                                      </b>
                                      <span className="text-[#6b8799] text-[11px] ml-1">
                                        ({pct.toFixed(0)}%)
                                      </span>
                                      <span className="text-rose-700 font-extrabold ml-1.5">
                                        · {formatBaht(vg.totalCost)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Bar container */}
                                  <div className="w-full bg-[#eae3cf]/60 h-3 rounded-full overflow-hidden flex">
                                    <div
                                      className={`h-full ${barColor} rounded-full transition-all duration-500`}
                                      style={{ width: `${Math.min(100, Math.max(4, pct))}%` }}
                                      title={`${vg.vendor}: ${vg.grams.toLocaleString()} g (${pct.toFixed(1)}%) — ${formatBaht(vg.totalCost)}`}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* แถบเพิ่มวัตถุดิบที่ใช้ในบูธนี้โดยตรง (เช่น ท็อปปิ้ง หรือวัตถุดิบที่อยากระบุกรัม & Vendor เอง) */}
                <form
                  onSubmit={handleAddManualIngredientToBooth}
                  className="bg-[#fef9ec] p-3.5 rounded-xl border border-[#eae3cf] grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end mt-4"
                >
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-extrabold text-[#0d3a57] mb-1">
                      + เพิ่มวัตถุดิบอื่นๆ ที่ใช้ในบูธนี้โดยตรง (ระบุกรัมเอง):
                    </label>
                    <select
                      value={manualIngId}
                      onChange={(e) => {
                        setManualIngId(e.target.value);
                        setManualIngLotId('latest');
                      }}
                      className="w-full text-xs font-bold bg-white border border-[#eae3cf] rounded-lg px-2.5 py-2 text-[#0d3a57]"
                    >
                      {state.ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-bold text-[#6b8799] mb-1">
                      ระบุล็อตซื้อ / Vendor ที่นำมาใช้:
                    </label>
                    <select
                      value={manualIngLotId}
                      onChange={(e) => setManualIngLotId(e.target.value)}
                      className="w-full text-xs font-bold bg-white border border-[#eae3cf] rounded-lg px-2.5 py-2 text-[#0d3a57]"
                    >
                      <option value="latest">ล็อตล่าสุด (Latest)</option>
                      <option value="fifo">ตามคิว FIFO เก่าสุด (FIFO)</option>
                      {state.ingredientLots
                        .filter((l) => l.ingredientId === manualIngId)
                        .sort(
                          (a, b) =>
                            a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id)
                        )
                        .map((lot, idx) => (
                          <option key={lot.id} value={lot.id}>
                            ครั้งที่ {idx + 1}: {lot.purchaseDate} · {lot.vendor} (
                            {formatBaht(lot.costPerGram, 4)}/g)
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3 flex gap-1.5">
                    <div className="w-full">
                      <label className="block text-[11px] font-bold text-[#6b8799] mb-1">
                        ใช้ไปกี่กรัม (g):
                      </label>
                      <input
                        type="number"
                        min="0.1"
                        step="any"
                        placeholder="เช่น 250"
                        value={manualIngGrams}
                        onChange={(e) => setManualIngGrams(e.target.value)}
                        className="w-full text-xs font-extrabold bg-white border border-[#eae3cf] rounded-lg px-2.5 py-2 text-[#0d3a57]"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      className="bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold px-3.5 py-2 rounded-lg text-xs shrink-0 cursor-pointer self-end"
                    >
                      + เพิ่ม
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>

          {/* ตารางสรุปยอดขายและต้นทุนวัตถุดิบแยกตามรสชาติในบูธนี้ */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf] space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="font-extrabold text-[#0d3a57] flex items-center gap-2">
                  <IceCream className="w-5 h-5 text-[#118cd1]" />
                  สรุปยอดขายและต้นทุนวัตถุดิบแยกตามรสชาติ (Flavor Costing Breakdown)
                </h3>
                <p className="text-xs text-[#6b8799] mt-0.5">
                  เลือกได้ว่าจะให้คิดต้นทุนเฉพาะรสที่ตักขายไปจริงใน POS อัตโนมัติ หรือเลือกติ๊กเองว่าบูธนี้ปั่นรสอะไรไปกี่หม้อ
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-[#fef9ec] p-1.5 rounded-xl border border-[#eae3cf] text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => handleSetIngredientCostMode('pos_cups')}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      (selectedEvent.ingredientCostMode || 'pos_cups') === 'pos_cups'
                        ? 'bg-[#118cd1] text-white'
                        : 'text-[#6b8799]'
                    }`}
                  >
                    1. คิดเฉพาะรสและถ้วยที่ขายใน POS อัตโนมัติ
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetIngredientCostMode('produced_batches')}
                    className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                      selectedEvent.ingredientCostMode === 'produced_batches'
                        ? 'bg-[#118cd1] text-white'
                        : 'text-[#6b8799]'
                    }`}
                  >
                    2. เลือกรสที่ทำไปออกบูธนี้ (คิดตามจำนวนหม้อที่ผลิต)
                  </button>
                </div>
                <span className="text-sm font-extrabold text-[#118cd1]">
                  รวมต้นทุนเนื้อไอติม: {formatBaht(pnl.totalIngredientCost)}
                </span>
              </div>
            </div>

            {selectedEvent.ingredientCostMode === 'produced_batches' && (
              <div className="bg-[#fef9ec] p-4 rounded-xl border border-[#eae3cf] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-extrabold text-sm text-[#0d3a57] flex items-center gap-1.5">
                      🥣 บันทึกรอบการปั่น & เติม Stock สำหรับบูธนี้ (สามารถแตกแถวเลือกหลาย Lot และ Clone รอบได้)
                    </span>
                    <p className="text-xs text-[#6b8799] mt-0.5">
                      เลือกรสที่ต้องการปั่น ระบบจะดึงสัดส่วนตามสูตรมาให้อัตโนมัติ เลือกล็อตที่หยิบมาใช้จริง และหากล็อตเก่าไม่พอ สามารถกด <b>+ เพิ่ม Lot อื่น</b> เพื่อใส่วัตถุดิบเดิมซ้ำได้ทันที
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {state.recipes.map((rec) => {
                    const batchesForFlavor = (selectedEvent.boothBatches || []).filter(
                      (b) => b.recipeId === rec.id
                    );
                    const hasBatches = batchesForFlavor.length > 0;

                    return (
                      <div
                        key={rec.id}
                        className={`rounded-2xl border transition p-4 ${
                          hasBatches
                            ? 'bg-white border-[#118cd1] shadow-xs'
                            : 'bg-white/60 border-[#eae3cf]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#eae3cf]">
                          <div className="flex items-center gap-3">
                            <span className="font-extrabold text-base text-[#0d3a57]">{rec.name}</span>
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#90d4ec]/30 text-[#0d3a57]">
                              {rec.category}
                            </span>
                            {hasBatches && (
                              <span className="text-xs font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg">
                                ปั่น {batchesForFlavor.length} รอบสำหรับงานนี้
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleAddBoothBatch(rec.id)}
                            className="bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold text-xs px-3.5 py-1.5 rounded-xl inline-flex items-center gap-1 transition cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            {hasBatches ? '+ ปั่นเพิ่มอีก 1 รอบ' : '+ บันทึกการปั่นรสชาตินี้'}
                          </button>
                        </div>

                        {/* แสดงรายการแต่ละรอบการปั่นของรสชาตินี้ */}
                        {hasBatches && (
                          <div className="space-y-3 mt-3">
                            {batchesForFlavor.map((batch) => {
                              const batchTotalGrams = batch.ingredients.reduce(
                                (s, l) => s + (Number(l.grams) || 0),
                                0
                              );
                              let batchTotalCost = 0;
                              batch.ingredients.forEach((l) => {
                                const queue = state.ingredientLots.filter((lot) => lot.ingredientId === l.ingredientId);
                                const matchedLot = queue.find((lot) => lot.id === l.lotId) || queue[queue.length - 1];
                                batchTotalCost += (Number(l.grams) || 0) * (matchedLot?.costPerGram || 0);
                              });

                              return (
                                <div
                                  key={batch.id}
                                  className="bg-[#fef9ec] p-3 rounded-xl border border-[#eae3cf] space-y-2.5"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <div className="flex items-center gap-2">
                                      <span className="font-extrabold text-[#118cd1] text-sm">
                                        รอบที่ {batch.batchNumber}:
                                      </span>
                                      <span className="font-bold text-[#0d3a57]">{batch.label}</span>
                                      <span className="text-[#6b8799]">
                                        (น้ำหนักรวม {batchTotalGrams.toLocaleString()}g · ต้นทุน {formatBaht(batchTotalCost)})
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleCloneBoothBatch(batch.id)}
                                        className="bg-white hover:bg-emerald-50 text-emerald-700 border border-emerald-300 font-extrabold text-[11px] px-2.5 py-1 rounded-lg inline-flex items-center gap-1 cursor-pointer transition"
                                        title="คัดลอกสูตรและล็อตที่เลือกทั้งหมดไปเป็นรอบใหม่ทันที"
                                      >
                                        📋 Clone รอบนี้ (เติม Stock)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteBoothBatch(batch.id)}
                                        className="text-rose-500 hover:bg-rose-50 px-2 py-1 rounded text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                                        title="ลบรอบนี้"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" /> ลบรอบนี้
                                      </button>
                                    </div>
                                  </div>

                                  {/* ตารางวัตถุดิบในรอบนี้ พร้อมตัวเลือกล็อตและปุ่มแตกแถวซ้ำ */}
                                  <div className="bg-white rounded-lg border border-[#eae3cf] overflow-hidden">
                                    <table className="w-full text-left text-xs">
                                      <thead className="bg-[#eae3cf]/40 text-[#6b8799] font-bold">
                                        <tr>
                                          <th className="py-2 px-3">วัตถุดิบตามสูตร</th>
                                          <th className="py-2 px-3">หยิบมาจาก Lot / Vendor ไหน</th>
                                          <th className="py-2 px-3 text-right">จำนวนที่ใช้ (กรัม)</th>
                                          <th className="py-2 px-3 text-right">คิดเป็นเงิน</th>
                                          <th className="py-2 px-3 text-center">จัดการ</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#eae3cf]">
                                        {batch.ingredients.map((ingLine) => {
                                          const ingMeta = state.ingredients.find((i) => i.id === ingLine.ingredientId);
                                          const allLots = state.ingredientLots
                                            .filter((l) => l.ingredientId === ingLine.ingredientId)
                                            .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));
                                          const selectedLot = allLots.find((l) => l.id === ingLine.lotId) || allLots[allLots.length - 1];
                                          const lineCost = (Number(ingLine.grams) || 0) * (selectedLot?.costPerGram || 0);

                                          return (
                                            <tr key={ingLine.id} className="hover:bg-[#fef9ec]/40">
                                              <td className="py-2 px-3 font-extrabold text-[#0d3a57]">
                                                {ingMeta?.name || ingLine.ingredientId}
                                              </td>
                                              <td className="py-2 px-3">
                                                {allLots.length === 0 ? (
                                                  <span className="text-amber-700 font-semibold text-[11px]">
                                                    ⚠️ ยังไม่มีประวัติซื้อวัตถุดิบนี้
                                                  </span>
                                                ) : (
                                                  <select
                                                    value={selectedLot?.id || ''}
                                                    onChange={(e) =>
                                                      handleUpdateBatchIngredient(
                                                        batch.id,
                                                        ingLine.id,
                                                        'lotId',
                                                        e.target.value
                                                      )
                                                    }
                                                    className="w-full text-xs font-bold bg-[#fef9ec] border border-[#eae3cf] rounded-md px-2 py-1 text-[#0d3a57]"
                                                  >
                                                    {allLots.map((lot, lIdx) => (
                                                      <option key={lot.id} value={lot.id}>
                                                        ครั้งที่ {lIdx + 1}: {lot.purchaseDate} · {lot.vendor} ({formatBaht(lot.costPerGram, 4)}/{lot.unit === 'pcs' ? 'ชิ้น' : 'g'})
                                                      </option>
                                                    ))}
                                                  </select>
                                                )}
                                              </td>
                                              <td className="py-2 px-3 text-right">
                                                <input
                                                  type="number"
                                                  step="any"
                                                  min="0"
                                                  value={ingLine.grams}
                                                  onChange={(e) =>
                                                    handleUpdateBatchIngredient(
                                                      batch.id,
                                                      ingLine.id,
                                                      'grams',
                                                      Math.max(0, parseFloat(e.target.value) || 0)
                                                    )
                                                  }
                                                  className="w-20 text-right font-extrabold bg-[#fef9ec] border border-[#eae3cf] rounded-md px-2 py-1 text-[#0d3a57]"
                                                />
                                                <span className="ml-1 text-[11px] text-[#6b8799]">g</span>
                                              </td>
                                              <td className="py-2 px-3 text-right font-extrabold text-[#0d3a57]">
                                                {formatBaht(lineCost)}
                                              </td>
                                              <td className="py-2 px-3 text-center space-x-1">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleDuplicateBatchIngredientRow(
                                                      batch.id,
                                                      ingLine.ingredientId
                                                    )
                                                  }
                                                  className="text-[11px] bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-300 font-bold px-2 py-0.5 rounded cursor-pointer"
                                                  title="กรณี Lot นี้ไม่พอ กดเพื่อเลือก Lot อื่นมาเติมกรัมที่เหลือ"
                                                >
                                                  + เพิ่ม Lot อื่น
                                                </button>
                                                {batch.ingredients.filter((x) => x.ingredientId === ingLine.ingredientId).length > 1 && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      handleRemoveBatchIngredientRow(batch.id, ingLine.id)
                                                    }
                                                    className="text-rose-500 hover:bg-rose-50 p-1 rounded cursor-pointer"
                                                    title="ลบแถวนี้"
                                                  >
                                                    <Trash2 className="w-3 h-3" />
                                                  </button>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}


            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-[#eae3cf] text-xs text-[#6b8799] uppercase">
                    <th className="py-2.5 px-3">รสชาติ (Flavor)</th>
                    <th className="py-2.5 px-3">หมวด</th>
                    <th className="py-2.5 px-3 text-center">สั่งเดี่ยว (1 รส)</th>
                    <th className="py-2.5 px-3 text-center">สั่งคู่ (2 รส)</th>
                    <th className="py-2.5 px-3 text-center">Affogato</th>
                    <th className="py-2.5 px-3 text-right">เทียบเท่าถ้วยเต็ม</th>
                    <th className="py-2.5 px-3 text-right">ยอดขายรสนี้</th>
                    <th className="py-2.5 px-3 text-right">ต้นทุนวัตถุดิบ</th>
                    <th className="py-2.5 px-3 text-right">กำไรขั้นต้น (เฉพาะเนื้อไอติม)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eae3cf]">
                  {pnl.flavorSummaries.map((fl) => {
                    const gross = fl.revenueAttributed - fl.ingredientCost;
                    const margin =
                      fl.revenueAttributed > 0 ? (gross / fl.revenueAttributed) * 100 : 0;
                    return (
                      <tr key={fl.flavorName} className="hover:bg-[#fef9ec]/60">
                        <td className="py-2.5 px-3 font-extrabold text-[#0d3a57]">
                          {fl.flavorName}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#90d4ec]/30 text-[#0d3a57]">
                            {fl.category}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-semibold">
                          {fl.fullScoopCount} ถ้วย
                        </td>
                        <td className="py-2.5 px-3 text-center font-semibold">
                          {fl.halfScoopCount} ครั้ง
                        </td>
                        <td className="py-2.5 px-3 text-center font-semibold">
                          {fl.affogatoCount} ถ้วย
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-[#118cd1]">
                          {fl.equivalentFullCups.toFixed(1)} ถ้วย
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold">
                          {formatBaht(fl.revenueAttributed)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-rose-700">
                          {formatBaht(fl.ingredientCost)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-extrabold text-[#1a9a5b]">
                          {formatBaht(gross)}{' '}
                          <span className="text-xs font-normal text-[#6b8799]">
                            ({margin.toFixed(0)}%)
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ปุ่มเปิดดูรายการขายรายถ้วยจาก POS */}
            <div className="pt-2 border-t border-[#eae3cf]">
              <button
                onClick={() => setShowRawPosRows(!showRawPosRows)}
                className="text-xs font-bold text-[#118cd1] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                {showRawPosRows ? (
                  <>
                    <ChevronUp className="w-4 h-4" /> ซ่อนรายการขายรายถ้วยจาก REFV POS
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" /> ดูรายการขายรายถ้วยจาก REFV POS ทั้งหมด (
                    {selectedEvent.posSales.length} แถว)
                  </>
                )}
              </button>

              {showRawPosRows && (
                <div className="mt-3 max-h-72 overflow-y-auto border border-[#eae3cf] rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#fef9ec] sticky top-0 border-b border-[#eae3cf] text-[#6b8799]">
                      <tr>
                        <th className="p-2">Order ID</th>
                        <th className="p-2">Date</th>
                        <th className="p-2">Time</th>
                        <th className="p-2">Type</th>
                        <th className="p-2">Flavors/Cup</th>
                        <th className="p-2">Flavor 1</th>
                        <th className="p-2">Flavor 2</th>
                        <th className="p-2">Payment</th>
                        <th className="p-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eae3cf]">
                      {selectedEvent.posSales.map((r, i) => (
                        <tr key={`${r.orderId}-${i}`} className="hover:bg-[#fef9ec]/50">
                          <td className="p-2 font-mono font-semibold">{r.orderId}</td>
                          <td className="p-2">{r.date}</td>
                          <td className="p-2">{r.time}</td>
                          <td className="p-2 capitalize">{r.type}</td>
                          <td className="p-2 text-center">{r.flavorsPerCup}</td>
                          <td className="p-2 font-bold">{r.flavor1}</td>
                          <td className="p-2 font-bold">{r.flavor2 || '-'}</td>
                          <td className="p-2">{r.payment}</td>
                          <td className="p-2 text-right font-bold">{formatBaht(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal สร้างงานออกบูธใหม่ */}
      {showNewEventModal && (
        <div className="fixed inset-0 bg-[#0d3a57]/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-[#eae3cf] max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-extrabold text-[#0d3a57]">สร้างงานออกบูธใหม่ (New Event)</h3>
            <p className="text-xs text-[#6b8799] mt-1">
              แม้ว่ารายการขายทุกบูธจะรวมอยู่ในชีท Sales เดียวกัน ระบบจะกรองดึงเฉพาะรายการที่อยู่ใน{' '}
              <b>วันที่เริ่ม + เวลาเปิด</b> ถึง <b>วันที่สิ้นสุด + เวลาปิด</b> ของบูธนี้เท่านั้น
            </p>
            <form onSubmit={handleCreateEvent} className="space-y-3.5 mt-4">
              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">
                  ชื่องานออกบูธ / อีเวนต์ *
                </label>
                <input
                  type="text"
                  placeholder="เช่น ออกบูธงานเกษตรแฟร์, บูธ Central Ladprao"
                  value={newEvName}
                  onChange={(e) => setNewEvName(e.target.value)}
                  className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold focus:border-[#118cd1] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">สถานที่จัดงาน</label>
                <input
                  type="text"
                  placeholder="เช่น ลานโปรโมชั่น ชั้น 1"
                  value={newEvLoc}
                  onChange={(e) => setNewEvLoc(e.target.value)}
                  className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold focus:border-[#118cd1] focus:outline-none"
                />
              </div>

              {/* แถบตัวช่วยเลือกวันที่มีข้อมูลขายในชีท Sales */}
              {availableDatesSorted.length > 0 && (
                <div className="bg-[#fef9ec] border border-[#eae3cf] rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#0d3a57]">
                      📅 วันที่ที่พบรายการขายในชีท Sales (คลิกเพื่อเลือกวันได้ทันที):
                    </span>
                    {availableDatesSorted.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setNewEvStart(availableDatesSorted[0]);
                          setNewEvEnd(availableDatesSorted[availableDatesSorted.length - 1]);
                          setNewEvStartTime('00:00');
                          setNewEvEndTime('23:59');
                        }}
                        className="text-[11px] font-bold text-[#118cd1] hover:underline cursor-pointer"
                      >
                        เลือกทั้งช่วง ({availableDatesSorted[0]} →{' '}
                        {availableDatesSorted[availableDatesSorted.length - 1]})
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {availableDatesSorted.map((d) => {
                      const isPicked = newEvStart === d && newEvEnd === d;
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            setNewEvStart(d);
                            setNewEvEnd(d);
                          }}
                          className={`text-xs px-2.5 py-1 rounded-lg font-bold border transition cursor-pointer ${
                            isPicked
                              ? 'bg-[#118cd1] text-white border-[#118cd1]'
                              : 'bg-white text-[#0d3a57] border-[#eae3cf] hover:border-[#118cd1]'
                          }`}
                        >
                          {d} ({availableDatesMap[d]} ถ้วย)
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">วันที่เริ่มงาน *</label>
                  <input
                    type="date"
                    value={newEvStart}
                    onChange={(e) => {
                      setNewEvStart(e.target.value);
                      if (newEvEnd < e.target.value) setNewEvEnd(e.target.value);
                    }}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">วันที่สิ้นสุดงาน *</label>
                  <input
                    type="date"
                    value={newEvEnd}
                    onChange={(e) => setNewEvEnd(e.target.value)}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">
                    เวลาเริ่มนับยอด (วันแรก)
                  </label>
                  <input
                    type="time"
                    value={newEvStartTime}
                    onChange={(e) => setNewEvStartTime(e.target.value)}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">
                    เวลาสิ้นสุดนับยอด (วันสุดท้าย)
                  </label>
                  <input
                    type="time"
                    value={newEvEndTime}
                    onChange={(e) => setNewEvEndTime(e.target.value)}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  />
                </div>
              </div>

              {/* แสดงผลลัพธ์การกรองยอดขายตามช่วงวัน-เวลาแบบสดๆ */}
              <div
                className={`rounded-xl p-3 border text-xs ${
                  previewMatchedSales.length > 0
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-[#6b8799]'
                }`}
              >
                {loadingCloudPreview ? (
                  <span className="font-semibold">
                    ⏳ กำลังตรวจสอบรายการขายจาก Google Sheet (Sales)...
                  </span>
                ) : previewMatchedSales.length > 0 ? (
                  <div className="flex items-center justify-between font-bold">
                    <span>
                      ✅ พบรายการขายตรงช่วงเวลานี้: {previewMatchedSales.length.toLocaleString()} ถ้วย
                    </span>
                    <span className="text-emerald-700">
                      ยอดขายรวม {formatBaht(previewMatchedRevenue)}
                    </span>
                  </div>
                ) : (
                  <span>
                    ℹ️ ยังไม่พบรายการขายในช่วง {newEvStart} ({newEvStartTime}) ถึง {newEvEnd} (
                    {newEvEndTime}) — สามารถสร้างบูธไว้ก่อนแล้วกด Sync ทีหลังได้
                  </span>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs font-bold text-[#0d3a57] cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={autoSyncOnCreate}
                  onChange={(e) => setAutoSyncOnCreate(e.target.checked)}
                  className="w-4 h-4 accent-[#118cd1] rounded"
                />
                <span>
                  Sync ดึงรายการขายเฉพาะช่วงวัน-เวลานี้เข้าบูธอัตโนมัติทันทีที่กดสร้าง
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewEventModal(false)}
                  className="px-4 py-2 rounded-xl font-bold text-sm text-[#6b8799] hover:bg-slate-100 cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl font-bold text-sm bg-[#118cd1] text-white hover:bg-[#0e78b5] cursor-pointer"
                >
                  สร้างงานออกบูธ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
