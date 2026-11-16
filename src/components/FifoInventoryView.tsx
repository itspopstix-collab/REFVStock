import React, { useState } from 'react';
import {
  AppDatabaseState,
  Ingredient,
  IngredientLot,
  PackagingItem,
  PackagingLot,
} from '../types';
import { SystemSimulationResult } from '../services/fifoEngine';
import { formatBaht } from '../services/storage';
import {
  Package,
  Scale,
  Plus,
  Trash2,
  Store,
  Calendar,
  Layers,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

interface Props {
  state: AppDatabaseState;
  sim: SystemSimulationResult;
  onUpdateState: (updater: (prev: AppDatabaseState) => AppDatabaseState) => void;
}

export const FifoInventoryView: React.FC<Props> = ({ state, sim, onUpdateState }) => {
  const [subTab, setSubTab] = useState<'packaging' | 'ingredients'>('packaging');

  // Sum of raw purchase costs for all ingredient lots
  const totalPurchaseCost = state.ingredientLots.reduce((s, lot) => s + (lot.totalPrice ?? 0), 0);

  const today = new Date().toISOString().slice(0, 10);

  // ฟอร์มเพิ่มล็อตซื้อแพ็กเกจจิ้ง (แก้ว/ช้อน)
  const [pkgItemId, setPkgItemId] = useState<string>(state.packagingItems[0]?.id || '');
  const [pkgDate, setPkgDate] = useState(today);
  const [pkgVendor, setPkgVendor] = useState('');
  const [pkgQty, setPkgQty] = useState('');
  const [pkgTotal, setPkgTotal] = useState('');
  const [pkgNote, setPkgNote] = useState('');

  // ฟอร์มเพิ่มชนิดแพ็กเกจจิ้งใหม่
  const [showNewPkgItem, setShowNewPkgItem] = useState(false);
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgUnit, setNewPkgUnit] = useState('ชิ้น');
  const [newPkgUsage, setNewPkgUsage] = useState('1');

  // ฟอร์มเพิ่มล็อตซื้อวัตถุดิบ (กรัม / กก. / ชิ้น)
  const [ingId, setIngId] = useState<string>(state.ingredients[0]?.id || '');
  const [ingDate, setIngDate] = useState(today);
  const [ingVendor, setIngVendor] = useState('');
  const [ingWeightInput, setIngWeightInput] = useState('');
  const [ingWeightUnit, setIngWeightUnit] = useState<'g' | 'kg' | 'pcs'>('g');
  const [ingTotalPrice, setIngTotalPrice] = useState('');
  const [ingNote, setIngNote] = useState('');

  // ฟอร์มเพิ่มรายการวัตถุดิบใหม่
  const [showNewIngModal, setShowNewIngModal] = useState(false);
  const [newIngName, setNewIngName] = useState('');
  const [newIngCat, setNewIngCat] = useState<Ingredient['category']>('flavoring');

  // คำนวณราคาต่อชิ้นของแพ็กเกจจิ้งแบบ Real-time
  const parsedPkgQty = parseFloat(pkgQty) || 0;
  const parsedPkgTotal = parseFloat(pkgTotal) || 0;
  const previewPkgUnitCost = parsedPkgQty > 0 ? parsedPkgTotal / parsedPkgQty : 0;

  // คำนวณราคาต่อกรัมของวัตถุดิบแบบ Real-time
  const parsedIngWeightRaw = parseFloat(ingWeightInput) || 0;
  const parsedIngGrams = ingWeightUnit === 'kg' ? parsedIngWeightRaw * 1000 : parsedIngWeightRaw;
  const parsedIngTotal = parseFloat(ingTotalPrice) || 0;
  const previewCostPerGram = parsedIngGrams > 0 ? parsedIngTotal / parsedIngGrams : 0;

  const handleAddPackagingLot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pkgItemId || parsedPkgQty <= 0 || parsedPkgTotal < 0) return;

    const newLot: PackagingLot = {
      id: 'lot-pkg-' + Date.now(),
      itemId: pkgItemId,
      purchaseDate: pkgDate,
      vendor: pkgVendor.trim() || 'ไม่ระบุร้านค้า',
      quantity: parsedPkgQty,
      totalPrice: parsedPkgTotal,
      unitCost: previewPkgUnitCost,
      note: pkgNote.trim() || undefined,
    };

    onUpdateState((prev) => ({
      ...prev,
      packagingLots: [...prev.packagingLots, newLot],
    }));

    setPkgVendor('');
    setPkgQty('');
    setPkgTotal('');
    setPkgNote('');
  };

  const handleDeletePackagingLot = (lotId: string) => {
    if (!window.confirm('ต้องการลบล็อตการซื้อนี้หรือไม่?')) return;
    onUpdateState((prev) => ({
      ...prev,
      packagingLots: prev.packagingLots.filter((l) => l.id !== lotId),
    }));
  };

  const handleAddPackagingItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPkgName.trim()) return;
    const newId = 'pkg-' + Date.now();
    const parsedUsage = parseFloat(newPkgUsage);
    const newItem: PackagingItem = {
      id: newId,
      name: newPkgName.trim(),
      unit: newPkgUnit.trim() || 'ชิ้น',
      usagePerCup: isNaN(parsedUsage) ? 1 : Math.max(0, parsedUsage),
      applyToType: 'all',
    };
    onUpdateState((prev) => ({
      ...prev,
      packagingItems: [...prev.packagingItems, newItem],
    }));
    setPkgItemId(newId);
    setNewPkgName('');
    setShowNewPkgItem(false);
  };

  const handleAddIngredientLot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingId || parsedIngGrams <= 0 || parsedIngTotal < 0) return;

    const newLot: IngredientLot = {
      id: 'ilot-' + Date.now(),
      ingredientId: ingId,
      purchaseDate: ingDate,
      vendor: ingVendor.trim() || 'ไม่ระบุร้านค้า',
      weightGrams: parsedIngGrams,
      unit: ingWeightUnit === 'pcs' ? 'pcs' : 'g',
      totalPrice: parsedIngTotal,
      costPerGram: previewCostPerGram,
      note: ingNote.trim() || undefined,
    };

    onUpdateState((prev) => ({
      ...prev,
      ingredientLots: [...prev.ingredientLots, newLot],
    }));

    setIngVendor('');
    setIngWeightInput('');
    setIngTotalPrice('');
    setIngNote('');
  };

  const handleDeleteIngredientLot = (lotId: string) => {
    if (!window.confirm('ต้องการลบล็อตการซื้อวัตถุดิบนี้หรือไม่?')) return;
    onUpdateState((prev) => ({
      ...prev,
      ingredientLots: prev.ingredientLots.filter((l) => l.id !== lotId),
    }));
  };

  const handleAddNewIngredient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIngName.trim()) return;
    const newId = 'ing-' + Date.now();
    const item: Ingredient = {
      id: newId,
      name: newIngName.trim(),
      category: newIngCat,
    };
    onUpdateState((prev) => ({
      ...prev,
      ingredients: [...prev.ingredients, item],
    }));
    setIngId(newId);
    setNewIngName('');
    setShowNewIngModal(false);
  };

  return (
    <div className="space-y-6">
      {/* สลับหมวดหมู่: แพ็กเกจจิ้ง/ของใช้เก็บข้ามงาน vs วัตถุดิบทำไอติม */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#eae3cf] flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2 bg-[#fef9ec] p-1.5 rounded-xl border border-[#eae3cf]">
          <button
            onClick={() => setSubTab('packaging')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-extrabold text-sm transition cursor-pointer ${
              subTab === 'packaging'
                ? 'bg-[#118cd1] text-white shadow-xs'
                : 'text-[#6b8799] hover:text-[#0d3a57]'
            }`}
          >
            <Package className="w-4 h-4" />
            1. ของใช้ & แพ็กเกจจิ้งเก็บข้ามงาน (แก้ว / ช้อน / ทิชชู่)
          </button>
          <button
            onClick={() => setSubTab('ingredients')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-extrabold text-sm transition cursor-pointer ${
              subTab === 'ingredients'
                ? 'bg-[#118cd1] text-white shadow-xs'
                : 'text-[#6b8799] hover:text-[#0d3a57]'
            }`}
          >
            <Scale className="w-4 h-4" />
            2. วัตถุดิบทำไอติม (บันทึกน้ำหนักกรัม & ราคา/กรัม)
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="bg-[#fef9ec] px-3.5 py-1.5 rounded-xl border border-[#eae3cf] text-xs">
            <span className="text-[#6b8799] font-medium">ยอดซื้อวัตถุดิบทั้งหมดที่บันทึก: </span>
            <b className="text-[#0d3a57] font-extrabold text-sm">{formatBaht(totalPurchaseCost)}</b>
          </div>
          <div className="text-xs text-[#6b8799] font-medium hidden md:block">
            💡 ระบบตัดต้นทุนตามสูตรที่ทำไอติมจริง ไม่ได้เหมาต้นทุนซื้อทั้งหมดเข้าบูธ
          </div>
        </div>
      </div>

      {subTab === 'packaging' ? (
        <div className="space-y-6">
          {/* ฟอร์มบันทึกล็อตซื้อแพ็กเกจจิ้ง */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-extrabold text-[#0d3a57] flex items-center gap-2">
                  <Plus className="w-5 h-5 text-[#118cd1]" />
                  บันทึกการซื้อของใช้ / แพ็กเกจจิ้งเข้าคลัง (Purchase Lot)
                </h3>
                <p className="text-xs text-[#6b8799]">
                  บันทึกแยกตามรอบที่ซื้อและระบุชื่อ Vendor ได้อิสระ (เช่น ซื้อ 100 ชิ้น ใช้ไป 80 ชิ้น เหลือ 20 ชิ้น แล้วซื้อเจ้าใหม่อีก 100 ชิ้น)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewPkgItem(true)}
                className="text-xs font-bold text-[#118cd1] bg-[#90d4ec]/25 hover:bg-[#90d4ec]/40 px-3 py-2 rounded-xl cursor-pointer"
              >
                + เพิ่มประเภทของใช้ใหม่
              </button>
            </div>

            <form
              onSubmit={handleAddPackagingLot}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 bg-[#fef9ec] p-4 rounded-xl border border-[#eae3cf]"
            >
              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">รายการของใช้ *</label>
                <select
                  value={pkgItemId}
                  onChange={(e) => setPkgItemId(e.target.value)}
                  className="w-full bg-white border border-[#eae3cf] rounded-lg px-3 py-2 text-sm font-bold text-[#0d3a57]"
                >
                  {state.packagingItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">วันที่ซื้อ *</label>
                <input
                  type="date"
                  value={pkgDate}
                  onChange={(e) => setPkgDate(e.target.value)}
                  className="w-full bg-white border border-[#eae3cf] rounded-lg px-3 py-2 text-sm font-semibold text-[#0d3a57]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">
                  ชื่อร้านค้า / Vendor *
                </label>
                <input
                  type="text"
                  placeholder="เช่น ร้าน A, Shopee, Makro"
                  value={pkgVendor}
                  onChange={(e) => setPkgVendor(e.target.value)}
                  className="w-full bg-white border border-[#eae3cf] rounded-lg px-3 py-2 text-sm font-semibold text-[#0d3a57]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">จำนวนที่ซื้อ (ชิ้น) *</label>
                <input
                  type="number"
                  step="any"
                  placeholder="เช่น 100"
                  value={pkgQty}
                  onChange={(e) => setPkgQty(e.target.value)}
                  className="w-full bg-white border border-[#eae3cf] rounded-lg px-3 py-2 text-sm font-bold text-[#0d3a57]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">ราคารวมที่ซื้อ (บาท) *</label>
                <input
                  type="number"
                  step="any"
                  placeholder="เช่น 250"
                  value={pkgTotal}
                  onChange={(e) => setPkgTotal(e.target.value)}
                  className="w-full bg-white border border-[#eae3cf] rounded-lg px-3 py-2 text-sm font-bold text-[#0d3a57]"
                  required
                />
              </div>

              <div className="flex flex-col justify-between">
                <div className="text-xs text-[#6b8799]">
                  ราคาต่อชิ้น:{' '}
                  <b className="text-[#118cd1] text-sm">{formatBaht(previewPkgUnitCost, 2)}/ชิ้น</b>
                </div>
                <button
                  type="submit"
                  className="w-full bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold py-2 px-4 rounded-lg text-sm transition cursor-pointer mt-1"
                >
                  + บันทึกล็อตซื้อเข้า
                </button>
              </div>
            </form>
          </div>

          {/* แสดงการ์ดสต็อกและคิว FIFO ของแต่ละรายการแพ็กเกจจิ้ง */}
          <div className="space-y-4">
            {state.packagingItems.map((item) => {
              const lotStates = sim.packagingLotStates[item.id] || [];
              const totalPurchased = lotStates.reduce((s, l) => s + l.initialQty, 0);
              const totalUsed = lotStates.reduce((s, l) => s + l.usedQty, 0);
              const totalRemaining = lotStates.reduce((s, l) => s + l.remainingQty, 0);
              const activeLot = lotStates.find((l) => l.remainingQty > 0);

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf] space-y-4"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#eae3cf]">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-lg font-extrabold text-[#0d3a57]">{item.name}</h4>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#90d4ec]/30 text-[#0d3a57]">
                          ตัดอัตโนมัติ {item.usagePerCup} {item.unit} / 1 ถ้วยที่ขายใน POS
                        </span>
                      </div>
                      <p className="text-xs text-[#6b8799] mt-0.5">
                        ล็อตที่กำลังถูกใช้งานปัจจุบัน:{' '}
                        <b className="text-[#118cd1]">
                          {activeLot
                            ? `${activeLot.vendor} (${formatBaht(activeLot.unitCost)}/${item.unit})`
                            : 'ใช้หมดทุกล็อตแล้ว'}
                        </b>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <div className="bg-[#fef9ec] px-3.5 py-2 rounded-xl border border-[#eae3cf]">
                        <span className="text-xs text-[#6b8799] block">ซื้อเข้าสะสม</span>
                        <b className="text-[#0d3a57]">
                          {totalPurchased.toLocaleString()} {item.unit}
                        </b>
                      </div>
                      <div className="bg-[#fef9ec] px-3.5 py-2 rounded-xl border border-[#eae3cf]">
                        <span className="text-xs text-[#6b8799] block">ใช้ในบูธไปแล้ว</span>
                        <b className="text-amber-700">
                          {totalUsed.toLocaleString()} {item.unit}
                        </b>
                      </div>
                      <div className="bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200">
                        <span className="text-xs text-emerald-700 block font-semibold">
                          คงเหลือพร้อมใช้
                        </span>
                        <b className="text-emerald-800 text-base">
                          {totalRemaining.toLocaleString()} {item.unit}
                        </b>
                      </div>
                    </div>
                  </div>

                  {/* ตารางแสดงแต่ละ Lot ตามลำดับ FIFO */}
                  <div className="space-y-2.5">
                    {lotStates.length === 0 ? (
                      <p className="text-xs text-[#6b8799] py-2">
                        ยังไม่มีประวัติการซื้อสำหรับรายการนี้
                      </p>
                    ) : (
                      lotStates.map((lot, idx) => {
                        const pctRemaining =
                          lot.initialQty > 0 ? (lot.remainingQty / lot.initialQty) * 100 : 0;
                        const isExhausted = lot.remainingQty <= 0;
                        return (
                          <div
                            key={lot.lotId}
                            className={`p-3.5 rounded-xl border transition ${
                              isExhausted
                                ? 'bg-slate-50 border-slate-200 opacity-85'
                                : 'bg-[#fef9ec]/70 border-[#90d4ec]'
                            }`}
                          >
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`px-2.5 py-0.5 rounded-lg text-xs font-extrabold ${
                                    isExhausted
                                      ? 'bg-slate-200 text-slate-600'
                                      : 'bg-[#118cd1] text-white'
                                  }`}
                                >
                                  Lot #{idx + 1} {isExhausted ? '(ใช้หมดแล้ว)' : '(มีของพร้อมตัด)'}
                                </span>
                                <span className="text-xs font-bold text-[#6b8799] flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5" /> {lot.purchaseDate}
                                </span>
                                <span className="text-sm font-extrabold text-[#0d3a57] flex items-center gap-1">
                                  <Store className="w-4 h-4 text-[#118cd1]" /> {lot.vendor}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-4 text-xs">
                                <span>
                                  ซื้อมา: <b>{lot.initialQty.toLocaleString()}</b> {item.unit} (รวม{' '}
                                  <b>{formatBaht(lot.totalPrice)}</b>)
                                </span>
                                <span className="px-2.5 py-1 rounded-lg bg-white border border-[#eae3cf] font-extrabold text-[#118cd1]">
                                  ราคา {formatBaht(lot.unitCost)} / {item.unit}
                                </span>
                                <span>
                                  ใช้ไปแล้ว: <b className="text-amber-700">{lot.usedQty}</b>{' '}
                                  {item.unit}
                                </span>
                                <span className="font-extrabold text-sm text-emerald-700">
                                  คงเหลือ: {lot.remainingQty.toLocaleString()} {item.unit}
                                </span>
                                <button
                                  onClick={() => handleDeletePackagingLot(lot.lotId)}
                                  className="text-rose-500 hover:bg-rose-50 p-1 rounded"
                                  title="ลบล็อตนี้"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* แถบ Progress Bar และประวัติว่าบูธไหนดึงล็อตนี้ไปใช้เท่าไหร่ */}
                            <div className="mt-2.5 flex flex-col sm:flex-row sm:items-center gap-3">
                              <div className="w-full sm:w-48 h-2 bg-slate-200 rounded-full overflow-hidden shrink-0">
                                <div
                                  className="h-full bg-[#1a9a5b] transition-all"
                                  style={{ width: `${pctRemaining}%` }}
                                />
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                {lot.usageByEvent.length === 0 ? (
                                  <span className="text-[#6b8799]">ยังไม่ถูกตัดใช้ในงานออกบูธ</span>
                                ) : (
                                  lot.usageByEvent.map((u, i) => (
                                    <span
                                      key={`${u.eventId}-${i}`}
                                      className="inline-flex items-center gap-1 bg-white px-2.5 py-0.5 rounded-md border border-[#eae3cf] text-[#0d3a57] font-semibold"
                                    >
                                      <ArrowRight className="w-3 h-3 text-[#118cd1]" />
                                      {u.eventName}: ใช้ <b>{u.qtyUsed}</b> {item.unit} (
                                      {formatBaht(u.cost)})
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* แท็บที่ 2: วัตถุดิบทำไอติม (Raw Ingredients) */
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-extrabold text-[#0d3a57] flex items-center gap-2">
                  <Scale className="w-5 h-5 text-[#118cd1]" />
                  บันทึกการซื้อวัตถุดิบทำไอติม (น้ำหนักกรัม → คำนวณราคาต่อกรัมอัตโนมัติ)
                </h3>
                <p className="text-xs text-[#6b8799]">
                  เมื่อบันทึกน้ำหนักและราคารวม ระบบจะคำนวณ <b>ราคาต่อกรัม (บาท/กรัม)</b> และนำไปอัปเดตต้นทุนต่อถ้วยของทุกรสชาติทันที
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewIngModal(true)}
                className="text-xs font-bold text-[#118cd1] bg-[#90d4ec]/25 hover:bg-[#90d4ec]/40 px-3 py-2 rounded-xl cursor-pointer"
              >
                + เพิ่มชื่อวัตถุดิบใหม่
              </button>
            </div>

            <form
              onSubmit={handleAddIngredientLot}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 bg-[#fef9ec] p-4 rounded-xl border border-[#eae3cf]"
            >
              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">วัตถุดิบ *</label>
                <select
                  value={ingId}
                  onChange={(e) => setIngId(e.target.value)}
                  className="w-full bg-white border border-[#eae3cf] rounded-lg px-3 py-2 text-sm font-bold text-[#0d3a57]"
                >
                  {state.ingredients.map((ing) => (
                    <option key={ing.id} value={ing.id}>
                      {ing.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">วันที่ซื้อ *</label>
                <input
                  type="date"
                  value={ingDate}
                  onChange={(e) => setIngDate(e.target.value)}
                  className="w-full bg-white border border-[#eae3cf] rounded-lg px-3 py-2 text-sm font-semibold text-[#0d3a57]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">
                  ร้านค้า / Vendor *
                </label>
                <input
                  type="text"
                  placeholder="เช่น Makro, ProBake, Importer"
                  value={ingVendor}
                  onChange={(e) => setIngVendor(e.target.value)}
                  className="w-full bg-white border border-[#eae3cf] rounded-lg px-3 py-2 text-sm font-semibold text-[#0d3a57]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">
                  จำนวนที่ซื้อ *
                </label>
                <div className="flex">
                  <input
                    type="number"
                    step="any"
                    placeholder={
                      ingWeightUnit === 'g'
                        ? 'เช่น 1000'
                        : ingWeightUnit === 'kg'
                          ? 'เช่น 1.5'
                          : 'เช่น 10'
                    }
                    value={ingWeightInput}
                    onChange={(e) => setIngWeightInput(e.target.value)}
                    className="w-full bg-white border border-[#eae3cf] rounded-l-lg px-3 py-2 text-sm font-bold text-[#0d3a57]"
                    required
                  />
                  <select
                    value={ingWeightUnit}
                    onChange={(e) => setIngWeightUnit(e.target.value as 'g' | 'kg' | 'pcs')}
                    className="bg-[#90d4ec]/30 border border-l-0 border-[#eae3cf] rounded-r-lg px-2 text-xs font-extrabold text-[#0d3a57]"
                  >
                    <option value="g">กรัม (g)</option>
                    <option value="kg">กก. (kg)</option>
                    <option value="pcs">ชิ้น</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">
                  ราคารวมที่ซื้อ (บาท) *
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="เช่น 450"
                  value={ingTotalPrice}
                  onChange={(e) => setIngTotalPrice(e.target.value)}
                  className="w-full bg-white border border-[#eae3cf] rounded-lg px-3 py-2 text-sm font-bold text-[#0d3a57]"
                  required
                />
              </div>

              <div className="flex flex-col justify-between">
                <div className="text-xs text-[#6b8799]">
                  {ingWeightUnit === 'pcs' ? 'ราคาต่อชิ้น:' : 'ราคาต่อกรัม:'}{' '}
                  <b className="text-[#118cd1] text-sm">
                    {formatBaht(previewCostPerGram, 4)}/
                    {ingWeightUnit === 'pcs' ? 'ชิ้น' : 'กรัม'}
                  </b>
                </div>
                <button
                  type="submit"
                  className="w-full bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold py-2 px-4 rounded-lg text-sm transition cursor-pointer mt-1"
                >
                  + บันทึกล็อตวัตถุดิบ
                </button>
              </div>
            </form>
          </div>

          {/* ตารางแสดงวัตถุดิบและล็อตการซื้อทั้งหมด */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-[#eae3cf] space-y-4">
            <h3 className="font-extrabold text-[#0d3a57] flex items-center gap-2">
              <Layers className="w-5 h-5 text-[#118cd1]" />
              รายการวัตถุดิบทั้งหมดและราคาต่อหน่วย (กรัม / ชิ้น)
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-[#eae3cf] text-xs text-[#6b8799] uppercase">
                    <th className="py-2.5 px-3">วัตถุดิบ</th>
                    <th className="py-2.5 px-3">วันที่ซื้อ (Lot)</th>
                    <th className="py-2.5 px-3">ร้านค้า / Vendor</th>
                    <th className="py-2.5 px-3 text-right">จำนวนที่ซื้อ</th>
                    <th className="py-2.5 px-3 text-right">ราคารวม (บาท)</th>
                    <th className="py-2.5 px-3 text-right">ราคาต่อหน่วย</th>
                    <th className="py-2.5 px-3 text-right">ใช้ไปในบูธ</th>
                    <th className="py-2.5 px-3 text-right">คงเหลือ</th>
                    <th className="py-2.5 px-3 text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eae3cf]">
                  {state.ingredients.map((ing) => {
                    const lots = sim.ingredientLotStates[ing.id] || [];
                    if (lots.length === 0) {
                      return (
                        <tr key={ing.id} className="hover:bg-[#fef9ec]/50">
                          <td className="py-2.5 px-3 font-extrabold text-[#0d3a57]">{ing.name}</td>
                          <td colSpan={8} className="py-2.5 px-3 text-xs text-[#6b8799]">
                            ยังไม่มีประวัติการซื้อวัตถุดิบนี้
                          </td>
                        </tr>
                      );
                    }
                    return lots.map((lot, idx) => {
                      const rawLot = state.ingredientLots.find((l) => l.id === lot.lotId);
                      const unitLabel = rawLot?.unit === 'pcs' ? 'ชิ้น' : 'g';
                      return (
                        <tr key={lot.lotId} className="hover:bg-[#fef9ec]/60">
                          <td className="py-2.5 px-3 font-extrabold text-[#0d3a57]">
                            {idx === 0 ? (
                              ing.name
                            ) : (
                              <span className="text-[#6b8799] pl-3">↳ ล็อตถัดไป</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-xs font-semibold">{lot.purchaseDate}</td>
                          <td className="py-2.5 px-3 font-semibold">{lot.vendor}</td>
                          <td className="py-2.5 px-3 text-right font-semibold">
                            {lot.initialQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}{' '}
                            {unitLabel}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold">
                            {formatBaht(lot.totalPrice)}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span className="px-2.5 py-0.5 rounded-lg bg-[#90d4ec]/30 text-[#0d3a57] font-extrabold">
                              {formatBaht(lot.unitCost, 4)} / {unitLabel}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-amber-700 font-semibold">
                            {lot.usedQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}{' '}
                            {unitLabel}
                          </td>
                          <td className="py-2.5 px-3 text-right font-extrabold text-emerald-700">
                            {lot.remainingQty.toLocaleString(undefined, {
                              maximumFractionDigits: 1,
                            })}{' '}
                            {unitLabel}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              onClick={() => handleDeleteIngredientLot(lot.lotId)}
                              className="text-rose-500 hover:bg-rose-50 p-1 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal เพิ่มประเภทแพ็กเกจจิ้งใหม่ */}
      {showNewPkgItem && (
        <div className="fixed inset-0 bg-[#0d3a57]/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#eae3cf]">
            <h3 className="text-lg font-extrabold text-[#0d3a57]">เพิ่มประเภทของใช้ / แพ็กเกจจิ้ง</h3>
            <form onSubmit={handleAddPackagingItem} className="space-y-3.5 mt-4">
              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">ชื่อของใช้ *</label>
                <input
                  type="text"
                  placeholder="เช่น ฝาปิดถ้วย, ถุงเก็บความเย็น"
                  value={newPkgName}
                  onChange={(e) => setNewPkgName(e.target.value)}
                  className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">หน่วยนับ</label>
                  <input
                    type="text"
                    placeholder="เช่น ใบ, ชิ้น, คัน"
                    value={newPkgUnit}
                    onChange={(e) => setNewPkgUnit(e.target.value)}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#6b8799] mb-1">
                    จำนวนที่ใช้ต่อ 1 ถ้วยที่ขาย
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={newPkgUsage}
                    onChange={(e) => setNewPkgUsage(e.target.value)}
                    className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  />
                  <p className="text-[11px] text-[#6b8799] mt-1">
                    * ใส่ 0 ได้ หากไม่ได้ตัดตามถ้วยอัตโนมัติ (เช่น ช้อนชิม ที่กรอกจำนวนใช้จริงตามบูธ)
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewPkgItem(false)}
                  className="px-4 py-2 rounded-xl font-bold text-sm text-[#6b8799]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl font-bold text-sm bg-[#118cd1] text-white"
                >
                  บันทึก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal เพิ่มชื่อวัตถุดิบใหม่ */}
      {showNewIngModal && (
        <div className="fixed inset-0 bg-[#0d3a57]/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#eae3cf]">
            <h3 className="text-lg font-extrabold text-[#0d3a57]">เพิ่มรายการวัตถุดิบใหม่</h3>
            <form onSubmit={handleAddNewIngredient} className="space-y-3.5 mt-4">
              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">ชื่อวัตถุดิบ *</label>
                <input
                  type="text"
                  placeholder="เช่น สตรอว์เบอร์รีเพียวเร่, ครีมชีส"
                  value={newIngName}
                  onChange={(e) => setNewIngName(e.target.value)}
                  className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#6b8799] mb-1">หมวดวัตถุดิบ</label>
                <select
                  value={newIngCat}
                  onChange={(e) => setNewIngCat(e.target.value as Ingredient['category'])}
                  className="w-full border-2 border-[#eae3cf] rounded-xl px-3 py-2 text-sm font-semibold"
                >
                  <option value="dairy">นม / ครีม (Dairy)</option>
                  <option value="base">เบส / น้ำตาล / สารคงตัว (Base)</option>
                  <option value="flavoring">รสชาติหลัก / ผลไม้ / ช็อกโกแลต (Flavoring)</option>
                  <option value="topping">ท็อปปิ้ง / ถั่ว (Topping)</option>
                  <option value="beverage">เครื่องดื่ม / กาแฟ (Beverage)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewIngModal(false)}
                  className="px-4 py-2 rounded-xl font-bold text-sm text-[#6b8799]"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl font-bold text-sm bg-[#118cd1] text-white"
                >
                  เพิ่มวัตถุดิบ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

