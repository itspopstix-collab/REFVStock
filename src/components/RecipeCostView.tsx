import React, { useState } from 'react';
import {
  AppDatabaseState,
  FlavorCategory,
  FlavorProductionRun,
  FlavorRecipe,
  Ingredient,
  IngredientLot,
} from '../types';
import {
  calculateRecipeUnitCost,
  POS_SELLING_PRICE,
  SystemSimulationResult,
} from '../services/fifoEngine';
import { formatBaht } from '../services/storage';
import { fetchPosFlavorsFromCloud } from '../services/posSync';
import {
  IceCream,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  Package,
  Calculator,
  Sparkles,
  Scale,
} from 'lucide-react';

interface Props {
  state: AppDatabaseState;
  sim: SystemSimulationResult;
  onUpdateState: (updater: (prev: AppDatabaseState) => AppDatabaseState) => void;
}

const resolveImageUrl = (imgUrl?: string) => {
  if (!imgUrl) return './images/holy-cow.png';
  if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) return imgUrl;
  if (imgUrl.startsWith('/')) return '.' + imgUrl;
  return './' + imgUrl;
};

export const RecipeCostView: React.FC<Props> = ({ state, sim, onUpdateState }) => {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>(state.recipes[0]?.id || '');
  // 'master' = แก้สูตรตั้งต้นของรสนั้น, '<runId>' = แก้ปริมาณกรัม/ล็อตของ "ครั้งที่ทำ / เติม Stock" รอบนั้นโดยเฉพาะ
  const [selectedRunId, setSelectedRunId] = useState<string>('master');
  const [syncingFlavors, setSyncingFlavors] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Modal เพิ่มรสชาติใหม่
  const [showNewFlavorModal, setShowNewFlavorModal] = useState(false);
  const [newFlavorName, setNewFlavorName] = useState('');
  const [newFlavorCat, setNewFlavorCat] = useState<FlavorCategory>('Original');

  // Modal เพิ่มวัตถุดิบใหม่พร้อมใส่ล็อตราคาซื้อแรกได้ทันทีจากหน้าสูตร
  const [showQuickNewIngModal, setShowQuickNewIngModal] = useState(false);
  const [newIngName, setNewIngName] = useState('');
  const [newIngCat, setNewIngCat] = useState<Ingredient['category']>('flavoring');
  const [newIngVendor, setNewIngVendor] = useState('');
  const [newIngWeight, setNewIngWeight] = useState('1000');
  const [newIngPrice, setNewIngPrice] = useState('');
  const [newIngRecipeGrams, setNewIngRecipeGrams] = useState('15');

  // เพิ่มวัตถุดิบที่มีอยู่แล้วลงในสูตรที่เลือก
  const [addIngId, setAddIngId] = useState<string>(state.ingredients[0]?.id || '');
  const [addIngLotId, setAddIngLotId] = useState<string>('fifo');
  const [addIngGrams, setAddIngGrams] = useState<string>('15');

  const selectedRecipe: FlavorRecipe | undefined =
    state.recipes.find((r) => r.id === selectedRecipeId) || state.recipes[0];

  const handleSyncFlavorsFromPos = async () => {
    setSyncingFlavors(true);
    setSyncNotice(null);
    try {
      const cloudFlavors = await fetchPosFlavorsFromCloud(state.settings);
      if (cloudFlavors.length === 0) {
        setSyncNotice('เชื่อมต่อสำเร็จ (ใช้รายการรสชาติมาตรฐาน 8 รสของ REFV POS)');
        setSyncingFlavors(false);
        return;
      }

      let addedCount = 0;
      onUpdateState((prev) => {
        const existingNames = new Set(prev.recipes.map((r) => r.name.toLowerCase()));
        const newRecipes = [...prev.recipes];
        for (const cf of cloudFlavors) {
          if (!existingNames.has(cf.name.toLowerCase())) {
            addedCount++;
            newRecipes.push({
              id: 'rec-' + Date.now() + '-' + addedCount,
              name: cf.name,
              category: cf.category,
              image: '/images/holy-cow.png',
              mode: 'per_cup',
              batchYieldCups: 1,
              halfScoopRatio: 0.5,
              ingredients: [
                {
                  ingredientId: prev.ingredients[0]?.id || 'ing-milk',
                  gramsPerBatch: 60,
                  selectedLotId: 'fifo',
                },
              ],
            });
          }
        }
        return { ...prev, recipes: newRecipes };
      });

      setSyncNotice(
        addedCount > 0
          ? `ดึงรสชาติใหม่จากชีท REFV POS เพิ่ม ${addedCount} รสชาติเรียบร้อยแล้ว!`
          : `รสชาติในระบบตรงกับชีท REFV POS ทั้งหมด (${cloudFlavors.length} รสชาติ) แล้ว`
      );
    } finally {
      setSyncingFlavors(false);
    }
  };

  const handleCreateFlavor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFlavorName.trim()) return;
    const newId = 'rec-' + Date.now();
    const newRec: FlavorRecipe = {
      id: newId,
      name: newFlavorName.trim(),
      category: newFlavorCat,
      image: '/images/holy-cow.png',
      mode: 'per_cup',
      batchYieldCups: 1,
      halfScoopRatio: 0.5,
      ingredients: [],
    };
    onUpdateState((prev) => ({
      ...prev,
      recipes: [...prev.recipes, newRec],
    }));
    setSelectedRecipeId(newId);
    setNewFlavorName('');
    setShowNewFlavorModal(false);
  };

  const handleQuickCreateIngredientAndAddToRecipe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIngName.trim()) return;
    const newIngId = 'ing-' + Date.now();
    const newLotId = 'ilot-' + Date.now();
    const weightG = Math.max(1, parseFloat(newIngWeight) || 1000);
    const totalP = Math.max(0, parseFloat(newIngPrice) || 0);
    const costPerG = totalP / weightG;
    const recipeG = Math.max(0.1, parseFloat(newIngRecipeGrams) || 10);

    const newIng: Ingredient = {
      id: newIngId,
      name: newIngName.trim(),
      category: newIngCat,
    };

    const newLot: IngredientLot = {
      id: newLotId,
      ingredientId: newIngId,
      purchaseDate: new Date().toISOString().slice(0, 10),
      vendor: newIngVendor.trim() || 'ล็อตตั้งต้น',
      weightGrams: weightG,
      totalPrice: totalP,
      costPerGram: costPerG,
    };

    onUpdateState((prev) => ({
      ...prev,
      ingredients: [...prev.ingredients, newIng],
      ingredientLots: totalP > 0 ? [...prev.ingredientLots, newLot] : prev.ingredientLots,
      recipes: prev.recipes.map((r) => {
        if (!selectedRecipe || r.id !== selectedRecipe.id) return r;
        const newLine = {
          ingredientId: newIngId,
          gramsPerBatch: recipeG,
          selectedLotId: totalP > 0 ? newLotId : 'fifo',
        };
        if (selectedRunId !== 'master' && (r.productionRuns || []).some((pr) => pr.id === selectedRunId)) {
          return {
            ...r,
            productionRuns: (r.productionRuns || []).map((pr) =>
              pr.id === selectedRunId
                ? { ...pr, ingredients: [...pr.ingredients, newLine] }
                : pr
            ),
          };
        }
        return {
          ...r,
          ingredients: [...r.ingredients, newLine],
        };
      }),
    }));

    setAddIngId(newIngId);
    setNewIngName('');
    setNewIngVendor('');
    setNewIngPrice('');
    setShowQuickNewIngModal(false);
  };

  const handleCreateNewProductionRun = () => {
    if (!selectedRecipe) return;
    const existingRuns = selectedRecipe.productionRuns || [];
    const nextRunNo = existingRuns.length + 1;
    const todayStr = new Date().toISOString().slice(0, 10);
    const activeRun =
      selectedRunId !== 'master'
        ? existingRuns.find((pr) => pr.id === selectedRunId)
        : undefined;
    const sourceLines = activeRun
      ? activeRun.ingredients
      : selectedRecipe.ingredients.length > 0
        ? selectedRecipe.ingredients
        : existingRuns[existingRuns.length - 1]?.ingredients || [];

    const newRunId = 'run-' + Date.now();
    const newRun: FlavorProductionRun = {
      id: newRunId,
      runNumber: nextRunNo,
      date: todayStr,
      label:
        nextRunNo === 1
          ? `ครั้งที่ 1 (ปั่นรอบแรก)`
          : `ครั้งที่ ${nextRunNo} (เติม Stock)`,
      batchYieldGrams: selectedRecipe.batchYieldGrams,
      ingredients: JSON.parse(JSON.stringify(sourceLines)),
    };

    onUpdateState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) =>
        r.id === selectedRecipe.id
          ? {
              ...r,
              productionRuns: [...(r.productionRuns || []), newRun],
            }
          : r
      ),
    }));
    setSelectedRunId(newRunId);
  };

  const handleUpdateProductionRunMeta = (
    runId: string,
    field: 'label' | 'date' | 'batchYieldGrams',
    value: string | number | undefined
  ) => {
    if (!selectedRecipe) return;
    onUpdateState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) =>
        r.id === selectedRecipe.id
          ? {
              ...r,
              productionRuns: (r.productionRuns || []).map((pr) =>
                pr.id === runId ? { ...pr, [field]: value } : pr
              ),
            }
          : r
      ),
    }));
  };

  const handleDeleteProductionRun = (runId: string) => {
    if (!selectedRecipe) return;
    if (!window.confirm('ต้องการลบประวัติครั้งที่ทำรอบนี้หรือไม่?')) return;
    onUpdateState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) =>
        r.id === selectedRecipe.id
          ? {
              ...r,
              productionRuns: (r.productionRuns || []).filter((pr) => pr.id !== runId),
            }
          : r
      ),
    }));
    if (selectedRunId === runId) {
      setSelectedRunId('master');
    }
  };

  const handleUpdateRecipeField = <K extends keyof FlavorRecipe>(
    field: K,
    value: FlavorRecipe[K]
  ) => {
    if (!selectedRecipe) return;
    onUpdateState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) =>
        r.id === selectedRecipe.id ? { ...r, [field]: value } : r
      ),
    }));
  };

  const handleUpdateIngredientGrams = (ingredientId: string, grams: number) => {
    if (!selectedRecipe) return;
    onUpdateState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) => {
        if (r.id !== selectedRecipe.id) return r;
        if (
          selectedRunId !== 'master' &&
          (r.productionRuns || []).some((pr) => pr.id === selectedRunId)
        ) {
          return {
            ...r,
            productionRuns: (r.productionRuns || []).map((pr) =>
              pr.id === selectedRunId
                ? {
                    ...pr,
                    ingredients: pr.ingredients.map((line) =>
                      line.ingredientId === ingredientId
                        ? { ...line, gramsPerBatch: Math.max(0, grams) }
                        : line
                    ),
                  }
                : pr
            ),
          };
        }
        return {
          ...r,
          ingredients: r.ingredients.map((line) =>
            line.ingredientId === ingredientId
              ? { ...line, gramsPerBatch: Math.max(0, grams) }
              : line
          ),
        };
      }),
    }));
  };

  const handleUpdateIngredientLotSelection = (ingredientId: string, selectedLotId: string) => {
    if (!selectedRecipe) return;
    onUpdateState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) => {
        if (r.id !== selectedRecipe.id) return r;
        if (
          selectedRunId !== 'master' &&
          (r.productionRuns || []).some((pr) => pr.id === selectedRunId)
        ) {
          return {
            ...r,
            productionRuns: (r.productionRuns || []).map((pr) =>
              pr.id === selectedRunId
                ? {
                    ...pr,
                    ingredients: pr.ingredients.map((line) =>
                      line.ingredientId === ingredientId ? { ...line, selectedLotId } : line
                    ),
                  }
                : pr
            ),
          };
        }
        return {
          ...r,
          ingredients: r.ingredients.map((line) =>
            line.ingredientId === ingredientId ? { ...line, selectedLotId } : line
          ),
        };
      }),
    }));
  };

  const handleAddIngredientToRecipe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecipe || !addIngId) return;
    const g = parseFloat(addIngGrams) || 0;
    if (g <= 0) return;

    onUpdateState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) => {
        if (r.id !== selectedRecipe.id) return r;
        const appendOrSum = (lines: typeof r.ingredients) => {
          const exists = lines.some((l) => l.ingredientId === addIngId);
          if (exists) {
            return lines.map((l) =>
              l.ingredientId === addIngId
                ? {
                    ...l,
                    gramsPerBatch: l.gramsPerBatch + g,
                    selectedLotId: addIngLotId || l.selectedLotId || 'fifo',
                  }
                : l
            );
          }
          return [
            ...lines,
            {
              ingredientId: addIngId,
              gramsPerBatch: g,
              selectedLotId: addIngLotId || 'fifo',
            },
          ];
        };

        if (
          selectedRunId !== 'master' &&
          (r.productionRuns || []).some((pr) => pr.id === selectedRunId)
        ) {
          return {
            ...r,
            productionRuns: (r.productionRuns || []).map((pr) =>
              pr.id === selectedRunId ? { ...pr, ingredients: appendOrSum(pr.ingredients) } : pr
            ),
          };
        }

        return {
          ...r,
          ingredients: appendOrSum(r.ingredients),
        };
      }),
    }));
  };

  const handleRemoveIngredientFromRecipe = (ingredientId: string) => {
    if (!selectedRecipe) return;
    onUpdateState((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) => {
        if (r.id !== selectedRecipe.id) return r;
        if (
          selectedRunId !== 'master' &&
          (r.productionRuns || []).some((pr) => pr.id === selectedRunId)
        ) {
          return {
            ...r,
            productionRuns: (r.productionRuns || []).map((pr) =>
              pr.id === selectedRunId
                ? {
                    ...pr,
                    ingredients: pr.ingredients.filter((l) => l.ingredientId !== ingredientId),
                  }
                : pr
            ),
          };
        }
        return {
          ...r,
          ingredients: r.ingredients.filter((l) => l.ingredientId !== ingredientId),
        };
      }),
    }));
  };

  const activeRunObj =
    selectedRecipe && selectedRunId !== 'master'
      ? (selectedRecipe.productionRuns || []).find((pr) => pr.id === selectedRunId)
      : undefined;

  const selectedCost = selectedRecipe
    ? calculateRecipeUnitCost(
        selectedRecipe,
        state,
        sim,
        activeRunObj ? activeRunObj.id : 'master'
      )
    : null;

  // ล็อตของวัตถุดิบที่กำลังเลือกในแถบ "+ เพิ่มวัตถุดิบลงในสูตรนี้"
  const lotsForAddIngredient = state.ingredientLots
    .filter((l) => l.ingredientId === addIngId)
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id));

  return (
    <div className="space-y-6">
      {/* ส่วนหัว: สรุปต้นทุนต่อถ้วยของทุกรสชาติ */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-[#0d3a57] flex items-center gap-2">
              <IceCream className="w-5 h-5 text-[#118cd1]" />
              สูตรไอติมแต่ละรสชาติ & ต้นทุนต่อถ้วย (Flavor BOM & Cost per Cup)
            </h2>
            <p className="text-sm text-[#6b8799] mt-0.5">
              สามารถเพิ่มวัตถุดิบใหม่ และเลือกระบุได้ว่าแต่ละวัตถุดิบจะดึงราคาจาก <b>การซื้อครั้งไหน (Lot ไหน)</b>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowQuickNewIngModal(true)}
              className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs transition cursor-pointer"
            >
              <Scale className="w-3.5 h-3.5" /> + เพิ่มวัตถุดิบใหม่เข้าระบบ
            </button>

            <button
              onClick={handleSyncFlavorsFromPos}
              disabled={syncingFlavors}
              className="inline-flex items-center gap-2 bg-[#90d4ec]/30 hover:bg-[#90d4ec]/50 text-[#0d3a57] font-bold px-3.5 py-2 rounded-xl text-xs transition cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#118cd1] ${syncingFlavors ? 'animate-spin' : ''}`}
              />
              Sync รสชาติจากชีท REFV POS
            </button>

            <button
              onClick={() => setShowNewFlavorModal(true)}
              className="inline-flex items-center gap-2 bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold px-3.5 py-2 rounded-xl text-xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> เพิ่มรสชาติใหม่
            </button>
          </div>
        </div>

        {syncNotice && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            {syncNotice}
          </div>
        )}

        {/* การ์ดแสดงรสชาติทั้ง 8+ รส พร้อมต้นทุนต่อถ้วย */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-4">
          {state.recipes.map((rec) => {
            const cost = calculateRecipeUnitCost(rec, state, sim);
            const isSelected = selectedRecipe?.id === rec.id;

            return (
              <div
                key={rec.id}
                onClick={() => setSelectedRecipeId(rec.id)}
                className={`p-3.5 rounded-2xl border-2 transition cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'border-[#118cd1] bg-[#90d4ec]/15 shadow-sm'
                    : 'border-[#eae3cf] bg-[#fef9ec]/50 hover:border-[#90d4ec]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <img
                    src={resolveImageUrl(rec.image)}
                    alt={rec.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = './images/holy-cow.png';
                      (e.target as HTMLImageElement).style.opacity = '0.3';
                    }}
                    className="w-14 h-14 rounded-xl object-cover bg-[#90d4ec]/30 shrink-0 border border-[#eae3cf]"
                  />
                  <div className="min-w-0">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#90d4ec]/40 text-[#0d3a57]">
                      {rec.category} (ขาย {formatBaht(cost.sellingPriceSingle, 0)})
                    </span>
                    <h3 className="font-extrabold text-[#0d3a57] text-sm truncate mt-1">
                      {rec.name}
                    </h3>
                    <p className="text-[11px] text-[#6b8799]">
                      น้ำหนัก {cost.gramsPerFullCup.toFixed(1)} กรัม/ถ้วย
                    </p>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-[#eae3cf] space-y-1 text-xs">
                  <div className="flex justify-between text-[#6b8799]">
                    <span>ทุนเนื้อไอติม (1 รส):</span>
                    <b className="text-[#0d3a57]">{formatBaht(cost.ingredientCostPerFullCup)}</b>
                  </div>
                  <div className="flex justify-between text-[#6b8799]">
                    <span>ทุนแพ็กเกจจิ้ง (แก้ว+ช้อน):</span>
                    <b className="text-[#0d3a57]">{formatBaht(cost.packagingCostPerCup)}</b>
                  </div>
                  <div className="flex justify-between items-baseline pt-1 border-t border-dashed border-[#eae3cf]">
                    <span className="font-bold text-[#0d3a57]">ต้นทุนรวม/ถ้วย:</span>
                    <span className="text-base font-black text-[#118cd1]">
                      {formatBaht(cost.totalFullCupCost)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px] text-[#1a9a5b] font-bold">
                    <span>กำไรต่อถ้วย:</span>
                    <span>
                      +{formatBaht(cost.grossProfitSingle)} ({cost.grossMarginPct.toFixed(0)}%)
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ส่วนแก้ไขสูตรของรสชาติที่เลือก */}
      {selectedRecipe && selectedCost && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ซ้าย (2 คอลัมน์): ตารางวัตถุดิบในสูตร พร้อมตัวเลือกว่าใช้การซื้อครั้งไหน */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#eae3cf]">
              <div className="flex items-center gap-3">
                <img
                  src={resolveImageUrl(selectedRecipe.image)}
                  alt={selectedRecipe.name}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = './images/holy-cow.png';
                    (e.target as HTMLImageElement).style.opacity = '0.3';
                  }}
                  className="w-12 h-12 rounded-xl object-cover bg-[#90d4ec]/30 border border-[#eae3cf]"
                />
                <div>
                  <h3 className="text-lg font-extrabold text-[#0d3a57]">
                    สูตรการผลิต: {selectedRecipe.name}
                  </h3>
                  <p className="text-xs text-[#6b8799]">
                    เลือก <b>การซื้อครั้งไหน (Lot)</b> และปรับปริมาณกรัมเพื่อดูต้นทุนต่อถ้วยตามราคาวัตถุดิบรอบนั้นๆ
                  </p>
                </div>
              </div>

              {/* เลือกโหมดการกรอกสูตร: ต่อ 1 ถ้วย หรือ ต่อ 1 หม้อปั่น */}
              <div className="flex items-center gap-2 bg-[#fef9ec] p-1.5 rounded-xl border border-[#eae3cf] text-xs font-bold">
                <button
                  onClick={() => {
                    handleUpdateRecipeField('mode', 'per_cup');
                    handleUpdateRecipeField('batchYieldCups', 1);
                  }}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    selectedRecipe.mode === 'per_cup'
                      ? 'bg-[#118cd1] text-white'
                      : 'text-[#6b8799]'
                  }`}
                >
                  กรอกสูตรต่อ 1 ถ้วย
                </button>
                <button
                  onClick={() => {
                    handleUpdateRecipeField('mode', 'per_batch');
                    if (!selectedRecipe.gramsPerCup || selectedRecipe.gramsPerCup <= 0) {
                      handleUpdateRecipeField('gramsPerCup', 80);
                    }
                    if (!selectedRecipe.gramsPerHalfCup || selectedRecipe.gramsPerHalfCup <= 0) {
                      handleUpdateRecipeField('gramsPerHalfCup', 40);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                    selectedRecipe.mode === 'per_batch'
                      ? 'bg-[#118cd1] text-white'
                      : 'text-[#6b8799]'
                  }`}
                >
                  กรอกสูตรต่อ 1 หม้อปั่น (Batch)
                </button>
              </div>
            </div>

            {/* แถบเลือก "ครั้งที่ทำ / การปั่นเติม Stock" ของรสชาตินี้ (แต่ละครั้งใช้ปริมาณกรัมไม่เท่ากันได้) */}
            <div className="bg-[#fef9ec] p-3.5 rounded-xl border border-[#eae3cf] space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-[#0d3a57]">
                  🔄 เลือกสูตรตาม &ldquo;ครั้งที่ทำ / เติม Stock&rdquo; (กรณีแต่ละรอบใช้ปริมาณกรัมไม่เท่ากัน):
                </span>
                <button
                  type="button"
                  onClick={handleCreateNewProductionRun}
                  className="text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg inline-flex items-center gap-1 cursor-pointer transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  เพิ่มครั้งที่ทำใหม่ (ปั่นเพิ่ม / เติม Stock)
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedRunId('master')}
                  className={`text-xs px-3 py-1.5 rounded-lg font-bold border transition cursor-pointer ${
                    !activeRunObj
                      ? 'bg-[#118cd1] text-white border-[#118cd1]'
                      : 'bg-white text-[#0d3a57] border-[#eae3cf] hover:border-[#118cd1]'
                  }`}
                >
                  📋 สูตรตั้งต้น (Master)
                </button>

                {(selectedRecipe.productionRuns || []).map((pr, idx) => {
                  const isSelectedRun = activeRunObj?.id === pr.id;
                  const runTotalGrams = pr.ingredients.reduce(
                    (s, l) => s + (Number(l.gramsPerBatch) || 0),
                    0
                  );
                  return (
                    <button
                      key={pr.id}
                      type="button"
                      onClick={() => setSelectedRunId(pr.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-bold border transition cursor-pointer ${
                        isSelectedRun
                          ? 'bg-[#118cd1] text-white border-[#118cd1]'
                          : 'bg-white text-[#0d3a57] border-[#eae3cf] hover:border-[#118cd1]'
                      }`}
                    >
                      {pr.label || `ครั้งที่ ${idx + 1}`} ({pr.date} ·{' '}
                      {runTotalGrams.toLocaleString()}g)
                    </button>
                  );
                })}
              </div>

              {activeRunObj && (
                <div className="bg-white p-2.5 rounded-lg border border-[#90d4ec] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-extrabold text-[#118cd1]">กำลังแก้ไข:</span>
                    <input
                      type="text"
                      value={activeRunObj.label}
                      onChange={(e) =>
                        handleUpdateProductionRunMeta(activeRunObj.id, 'label', e.target.value)
                      }
                      className="font-bold text-[#0d3a57] bg-[#fef9ec] border border-[#eae3cf] rounded-md px-2 py-1 w-48"
                      placeholder="เช่น ครั้งที่ 2 (เติม Stock)"
                    />
                    <input
                      type="date"
                      value={activeRunObj.date}
                      onChange={(e) =>
                        handleUpdateProductionRunMeta(activeRunObj.id, 'date', e.target.value)
                      }
                      className="font-bold text-[#0d3a57] bg-[#fef9ec] border border-[#eae3cf] rounded-md px-2 py-1"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteProductionRun(activeRunObj.id)}
                    className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> ลบครั้งที่ทำนี้
                  </button>
                </div>
              )}
            </div>

            {selectedRecipe.mode === 'per_batch' && (
              <div className="bg-[#90d4ec]/20 p-4 rounded-xl border border-[#90d4ec] space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-extrabold text-sm text-[#0d3a57]">
                    🥣 โหมดคำนวณต่อหม้อปั่น (คำนวณตามน้ำหนักกรัม)
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-[#90d4ec] font-extrabold text-[#118cd1]">
                    ต้นทุนเนื้อไอติม: {formatBaht(selectedCost.costPerGramOfFinishedIceCream, 4)} /
                    กรัม (ตักได้ ~{selectedCost.yieldCups.toFixed(1)} ถ้วย/หม้อ)
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="bg-white p-2.5 rounded-xl border border-[#eae3cf] flex flex-col justify-between gap-1">
                    <span className="font-bold text-[#6b8799]">
                      1. น้ำหนักรวมที่ได้ต่อ 1 หม้อปั่น:
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder={String(selectedCost.rawTotalBatchGrams || 1000)}
                        value={
                          selectedRecipe.batchYieldGrams && selectedRecipe.batchYieldGrams > 0
                            ? selectedRecipe.batchYieldGrams
                            : ''
                        }
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          handleUpdateRecipeField(
                            'batchYieldGrams',
                            isNaN(val) || val <= 0 ? undefined : val
                          );
                        }}
                        className="w-full bg-[#fef9ec] border border-[#eae3cf] focus:border-[#118cd1] focus:outline-none rounded-lg px-2.5 py-1.5 text-right font-black text-[#0d3a57]"
                      />
                      <span className="font-bold text-[#0d3a57] shrink-0">กรัม / หม้อ</span>
                    </div>
                    <span className="text-[10px] text-[#6b8799]">
                      * เว้นว่างเพื่อใช้ผลรวมวัตถุดิบอัตโนมัติ (
                      {selectedCost.rawTotalBatchGrams.toLocaleString()} กรัม)
                    </span>
                  </label>

                  <label className="bg-white p-2.5 rounded-xl border border-[#eae3cf] flex flex-col justify-between gap-1">
                    <span className="font-bold text-[#6b8799]">
                      2. ปริมาณตักเสิร์ฟต่อ 1 ถ้วย (สั่ง 1 รส):
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={selectedRecipe.gramsPerCup || 80}
                        onChange={(e) => {
                          const gCup = Math.max(1, parseFloat(e.target.value) || 80);
                          handleUpdateRecipeField('gramsPerCup', gCup);
                        }}
                        className="w-full bg-[#fef9ec] border-2 border-[#118cd1] focus:outline-none rounded-lg px-2.5 py-1.5 text-right font-black text-[#118cd1]"
                      />
                      <span className="font-bold text-[#0d3a57] shrink-0">กรัม / ถ้วย</span>
                    </div>
                    <span className="text-[10px] text-[#118cd1] font-bold">
                      = ต้นทุน {formatBaht(selectedCost.ingredientCostPerFullCup)} / ถ้วย
                    </span>
                  </label>

                  <label className="bg-white p-2.5 rounded-xl border border-[#eae3cf] flex flex-col justify-between gap-1">
                    <span className="font-bold text-[#6b8799]">
                      3. ปริมาณตักต่อรส (เมื่อสั่ง 2 รสใน 1 ถ้วย):
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={
                          selectedRecipe.gramsPerHalfCup ||
                          (selectedRecipe.gramsPerCup || 80) * (selectedRecipe.halfScoopRatio || 0.5)
                        }
                        onChange={(e) => {
                          const gHalf = Math.max(1, parseFloat(e.target.value) || 40);
                          const gCup = selectedRecipe.gramsPerCup || 80;
                          handleUpdateRecipeField('gramsPerHalfCup', gHalf);
                          handleUpdateRecipeField('halfScoopRatio', gHalf / gCup);
                        }}
                        className="w-full bg-[#fef9ec] border border-[#eae3cf] focus:border-[#118cd1] focus:outline-none rounded-lg px-2.5 py-1.5 text-right font-black text-[#0d3a57]"
                      />
                      <span className="font-bold text-[#0d3a57] shrink-0">กรัม / รส</span>
                    </div>
                    <span className="text-[10px] text-[#6b8799] font-bold">
                      = ต้นทุน {formatBaht(selectedCost.ingredientCostPerHalfCup)} / รส
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* ตารางส่วนผสมของรสชาตินี้ พร้อม Dropdown เลือกล็อตการซื้อ */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-[#eae3cf] text-xs text-[#6b8799] uppercase">
                    <th className="py-2.5 px-2.5">วัตถุดิบที่ใช้</th>
                    <th className="py-2.5 px-2.5">
                      ใช้วัตถุดิบของการซื้อครั้งไหน (Lot / ราคา)
                    </th>
                    <th className="py-2.5 px-2.5 text-right">ราคา/กรัม</th>
                    <th className="py-2.5 px-2.5 text-right">
                      {selectedRecipe.mode === 'per_cup'
                        ? 'ปริมาณ (กรัม/ถ้วย)'
                        : `ปริมาณ/หม้อ (รวม ${selectedCost.effectiveBatchGrams.toLocaleString()} g)`}
                    </th>
                    <th className="py-2.5 px-2.5 text-right">ต้นทุน/ถ้วย</th>
                    <th className="py-2.5 px-2 text-center">ลบ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eae3cf]">
                  {selectedCost.lineBreakdowns.map((line) => {
                    const ingLots = state.ingredientLots
                      .filter((l) => l.ingredientId === line.ingredientId)
                      .sort(
                        (a, b) =>
                          a.purchaseDate.localeCompare(b.purchaseDate) || a.id.localeCompare(b.id)
                      );

                    return (
                      <tr key={line.ingredientId} className="hover:bg-[#fef9ec]/60">
                        <td className="py-2.5 px-2.5 font-extrabold text-[#0d3a57]">
                          {line.ingredientName}
                        </td>
                        <td className="py-2.5 px-2.5">
                          <select
                            value={line.selectedLotId || 'fifo'}
                            onChange={(e) =>
                              handleUpdateIngredientLotSelection(
                                line.ingredientId,
                                e.target.value
                              )
                            }
                            className="w-full max-w-[270px] bg-[#fef9ec] border border-[#eae3cf] focus:border-[#118cd1] rounded-lg px-2 py-1.5 text-xs font-bold text-[#0d3a57]"
                          >
                            <option value="fifo">
                              🔄 ตัดตามคิว FIFO อัตโนมัติ ({line.activeVendor})
                            </option>
                            <option value="latest">📌 ใช้ราคาล็อตล่าสุดที่ซื้อเข้า</option>
                            {ingLots.map((lot, idx) => (
                              <option key={lot.id} value={lot.id}>
                                ครั้งที่ {idx + 1}: {lot.purchaseDate} · {lot.vendor} (
                                {formatBaht(lot.costPerGram, 4)}/g)
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-xs font-bold text-[#0d3a57]">
                          {formatBaht(line.costPerGram, 4)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={line.gramsPerBatch}
                              onChange={(e) =>
                                handleUpdateIngredientGrams(
                                  line.ingredientId,
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-20 bg-[#fef9ec] border border-[#eae3cf] focus:border-[#118cd1] rounded-lg px-2 py-1 text-right font-extrabold text-[#0d3a57]"
                            />
                            <span className="text-xs text-[#6b8799]">g</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-extrabold text-[#118cd1]">
                          {formatBaht(line.costPerCup, 2)}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <button
                            onClick={() => handleRemoveIngredientFromRecipe(line.ingredientId)}
                            className="text-rose-500 hover:bg-rose-50 p-1 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[#fef9ec] font-extrabold text-[#0d3a57] border-t-2 border-[#eae3cf]">
                    <td colSpan={3} className="py-3 px-2.5">
                      รวมต้นทุนเนื้อไอติมต่อ 1 ถ้วย ({selectedRecipe.name})
                    </td>
                    <td className="py-3 px-2.5 text-right">
                      {selectedCost.gramsPerFullCup.toFixed(1)} g / ถ้วย
                    </td>
                    <td className="py-3 px-2.5 text-right text-base text-[#118cd1]">
                      {formatBaht(selectedCost.ingredientCostPerFullCup, 2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ฟอร์มดึงวัตถุดิบเข้าสูตร พร้อมระบุว่าใช้การซื้อครั้งไหน */}
            <div className="bg-[#fef9ec] p-4 rounded-xl border border-[#eae3cf] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-[#0d3a57]">
                  + ดึงวัตถุดิบเข้าสูตรนี้ (พร้อมเลือกได้ว่าจะใช้วัตถุดิบของการซื้อครั้งไหน):
                </span>
                <button
                  type="button"
                  onClick={() => setShowQuickNewIngModal(true)}
                  className="text-xs font-extrabold text-emerald-700 hover:underline cursor-pointer"
                >
                  + ไม่มีในรายการ? คลิกสร้างวัตถุดิบใหม่ตรงนี้
                </button>
              </div>

              <form
                onSubmit={handleAddIngredientToRecipe}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2.5"
              >
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-bold text-[#6b8799] mb-1">
                    1. เลือกวัตถุดิบ
                  </label>
                  <select
                    value={addIngId}
                    onChange={(e) => {
                      setAddIngId(e.target.value);
                      setAddIngLotId('fifo');
                    }}
                    className="w-full bg-white border border-[#eae3cf] rounded-lg px-2.5 py-2 text-xs font-bold text-[#0d3a57]"
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
                    2. ใช้ราคาจากการซื้อครั้งไหน (Lot)
                  </label>
                  <select
                    value={addIngLotId}
                    onChange={(e) => setAddIngLotId(e.target.value)}
                    className="w-full bg-white border border-[#eae3cf] rounded-lg px-2.5 py-2 text-xs font-bold text-[#0d3a57]"
                  >
                    <option value="fifo">🔄 อัตโนมัติตามคิว FIFO (เข้าก่อน-ออกก่อน)</option>
                    <option value="latest">📌 ล็อตล่าสุดที่ซื้อเข้า</option>
                    {lotsForAddIngredient.map((lot, idx) => (
                      <option key={lot.id} value={lot.id}>
                        ครั้งที่ {idx + 1}: {lot.purchaseDate} · {lot.vendor} (
                        {formatBaht(lot.costPerGram, 4)}/g)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-3 flex items-end gap-1.5">
                  <div className="flex-1">
                    <label className="block text-[11px] font-bold text-[#6b8799] mb-1">
                      3. ปริมาณ (กรัม)
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="กรัม"
                      value={addIngGrams}
                      onChange={(e) => setAddIngGrams(e.target.value)}
                      className="w-full bg-white border border-[#eae3cf] rounded-lg px-2.5 py-2 text-xs font-bold text-right"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold px-3.5 py-2 rounded-lg text-xs cursor-pointer shrink-0"
                  >
                    + ดึงลงสูตร
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* ขวา (1 คอลัมน์): บัตรสรุปต้นทุนรวมต่อถ้วย (1 รส vs 2 รส + แพ็กเกจจิ้ง) */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf] space-y-4">
            <h3 className="font-extrabold text-[#0d3a57] flex items-center gap-2">
              <Calculator className="w-5 h-5 text-[#118cd1]" />
              สรุปโครงสร้างต้นทุนต่อถ้วย
            </h3>

            <div className="bg-[#fef9ec] rounded-xl p-4 border border-[#eae3cf] space-y-2.5 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-[#6b8799]">หมวดราคาใน REFV POS:</span>
                <select
                  value={selectedRecipe.category}
                  onChange={(e) =>
                    handleUpdateRecipeField('category', e.target.value as FlavorCategory)
                  }
                  className="bg-white border border-[#eae3cf] rounded-lg px-2.5 py-1 text-xs font-extrabold text-[#118cd1]"
                >
                  <option value="Original">Original (฿79 / ฿40)</option>
                  <option value="Premium">Premium (฿89 / ฿45)</option>
                  <option value="Signature">Signature (฿99 / ฿50)</option>
                </select>
              </div>

              <div className="flex justify-between text-xs pt-2 border-t border-[#eae3cf]">
                <span className="text-[#6b8799]">1. ต้นทุนเนื้อไอติม (สั่ง 1 รสเต็มถ้วย):</span>
                <b className="text-[#0d3a57]">
                  {formatBaht(selectedCost.ingredientCostPerFullCup)}
                </b>
              </div>

              <div className="flex justify-between text-xs">
                <span className="text-[#6b8799]">
                  • กรณีลูกค้าสั่ง 2 รสในถ้วยเดียว (ครึ่งถ้วย):
                </span>
                <b className="text-[#0d3a57]">
                  {formatBaht(selectedCost.ingredientCostPerHalfCup)}
                </b>
              </div>

              <div className="pt-2 border-t border-[#eae3cf] space-y-1">
                <div className="flex justify-between text-xs font-bold text-[#0d3a57]">
                  <span className="flex items-center gap-1">
                    <Package className="w-3.5 h-3.5 text-[#118cd1]" />
                    2. ต้นทุนแพ็กเกจจิ้งต่อ 1 ถ้วย (FIFO):
                  </span>
                  <span>{formatBaht(selectedCost.packagingCostPerCup)}</span>
                </div>
                {selectedCost.packagingBreakdown.map((pk) => (
                  <div
                    key={pk.itemId}
                    className="flex justify-between text-[11px] text-[#6b8799] pl-4"
                  >
                    <span>
                      - {pk.name} (×{pk.usagePerCup})
                    </span>
                    <span>{formatBaht(pk.cost)}</span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t-2 border-[#eae3cf] flex justify-between items-baseline">
                <span className="font-extrabold text-[#0d3a57]">รวมต้นทุนทั้งสิ้น / 1 ถ้วย:</span>
                <span className="text-xl font-black text-[#118cd1]">
                  {formatBaht(selectedCost.totalFullCupCost)}
                </span>
              </div>
            </div>

            {/* เปรียบเทียบกับราคาขายใน REFV POS */}
            <div className="bg-emerald-50/70 rounded-xl p-4 border border-emerald-200 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-800">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                กำไรต่อถ้วยเมื่อขายใน REFV POS
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-emerald-900">ราคาขาย 1 รส ({selectedRecipe.category}):</span>
                <b className="text-emerald-950">{formatBaht(selectedCost.sellingPriceSingle)}</b>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-emerald-900">หัก ต้นทุนเนื้อไอติม + แพ็กเกจ:</span>
                <b className="text-rose-700">-{formatBaht(selectedCost.totalFullCupCost)}</b>
              </div>
              <div className="pt-2 border-t border-emerald-200 flex justify-between items-baseline">
                <span className="text-xs font-extrabold text-emerald-900">กำไรขั้นต้น / ถ้วย:</span>
                <span className="text-lg font-black text-emerald-700">
                  +{formatBaht(selectedCost.grossProfitSingle)} (
                  {selectedCost.grossMarginPct.toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal เพิ่มวัตถุดิบใหม่พร้อมใส่ล็อตราคาซื้อแรกได้ทันที */}
      {showQuickNewIngModal && (
        <div className="fixed inset-0 bg-[#0d3a57]/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#eae3cf]">
            <h3 className="text-lg font-extrabold text-[#0d3a57]">
              เพิ่มวัตถุดิบใหม่ + บันทึกราคาซื้อล็อตแรก
            </h3>
            <p className="text-xs text-[#6b8799] mt-1">
              สร้างวัตถุดิบใหม่พร้อมคำนวณราคาต่อกรัมและดึงเข้าสูตร {selectedRecipe?.name} ทันที
            </p>
            <form onSubmit={handleQuickCreateIngredientAndAddToRecipe} className="space-y-3 mt-4">
              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">
                  ชื่อวัตถุดิบใหม่ *
                </label>
                <input
                  type="text"
                  placeholder="เช่น ยูซุเพียวเร่, วานิลลามาเลย์, โอรีโอ้บด"
                  value={newIngName}
                  onChange={(e) => setNewIngName(e.target.value)}
                  className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">หมวดหมู่</label>
                  <select
                    value={newIngCat}
                    onChange={(e) => setNewIngCat(e.target.value as Ingredient['category'])}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  >
                    <option value="flavoring">รสชาติหลัก / ผลไม้ / ช็อก</option>
                    <option value="dairy">นม / ครีม (Dairy)</option>
                    <option value="base">น้ำตาล / สารคงตัว (Base)</option>
                    <option value="topping">ท็อปปิ้ง / ถั่ว</option>
                    <option value="beverage">เครื่องดื่ม / กาแฟ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">
                    ชื่อร้านที่ซื้อ (Vendor)
                  </label>
                  <input
                    type="text"
                    placeholder="เช่น ProBake, Makro"
                    value={newIngVendor}
                    onChange={(e) => setNewIngVendor(e.target.value)}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">
                    น้ำหนักที่ซื้อมา (กรัม) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="เช่น 1000"
                    value={newIngWeight}
                    onChange={(e) => setNewIngWeight(e.target.value)}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">
                    ราคารวมที่ซื้อมา (บาท) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="เช่น 450"
                    value={newIngPrice}
                    onChange={(e) => setNewIngPrice(e.target.value)}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-bold"
                    required
                  />
                </div>
              </div>

              <div className="bg-[#fef9ec] p-3 rounded-xl border border-[#eae3cf] flex items-center justify-between text-xs">
                <span className="font-bold text-[#6b8799]">ราคาต่อกรัมที่คำนวณได้:</span>
                <b className="text-sm text-[#118cd1]">
                  {formatBaht(
                    (parseFloat(newIngPrice) || 0) / Math.max(1, parseFloat(newIngWeight) || 1),
                    4
                  )}{' '}
                  / กรัม
                </b>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">
                  ปริมาณที่ใช้ในสูตร &ldquo;{selectedRecipe?.name}&rdquo; (กรัม)
                </label>
                <input
                  type="number"
                  step="any"
                  value={newIngRecipeGrams}
                  onChange={(e) => setNewIngRecipeGrams(e.target.value)}
                  className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-bold"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowQuickNewIngModal(false)}
                  className="px-4 py-2 rounded-xl font-bold text-sm text-[#6b8799]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  บันทึกวัตถุดิบ & ดึงเข้าสูตร
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal สร้างรสชาติใหม่ */}
      {showNewFlavorModal && (
        <div className="fixed inset-0 bg-[#0d3a57]/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#eae3cf]">
            <h3 className="text-lg font-extrabold text-[#0d3a57]">เพิ่มรสชาติไอติมใหม่</h3>
            <form onSubmit={handleCreateFlavor} className="space-y-3.5 mt-4">
              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">
                  ชื่อรสชาติ (ให้ตรงกับใน REFV POS) *
                </label>
                <input
                  type="text"
                  placeholder="เช่น Yuzu Sorbet"
                  value={newFlavorName}
                  onChange={(e) => setNewFlavorName(e.target.value)}
                  className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">หมวดราคา</label>
                <select
                  value={newFlavorCat}
                  onChange={(e) => setNewFlavorCat(e.target.value as FlavorCategory)}
                  className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                >
                  <option value="Original">
                    Original (฿{POS_SELLING_PRICE.Original.single})
                  </option>
                  <option value="Premium">
                    Premium (฿{POS_SELLING_PRICE.Premium.single})
                  </option>
                  <option value="Signature">
                    Signature (฿{POS_SELLING_PRICE.Signature.single})
                  </option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewFlavorModal(false)}
                  className="px-4 py-2 rounded-xl font-bold text-sm text-[#6b8799]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl font-bold text-sm bg-[#118cd1] text-white"
                >
                  เพิ่มรสชาติ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
