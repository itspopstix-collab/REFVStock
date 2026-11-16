export type FlavorCategory = 'Original' | 'Premium' | 'Signature';

export interface PackagingItem {
  id: string;
  name: string;
  unit: string; // เช่น "ชิ้น", "ใบ", "คัน"
  usagePerCup: number; // จำนวนที่ใช้ต่อการขาย 1 ถ้วยใน POS (เช่น แก้ว = 1, ช้อน = 1)
  applyToType: 'all' | 'gelato' | 'affogato'; // ใช้กับทุกถ้วย หรือเฉพาะเมนู
  minStockAlert?: number;
}

export interface PackagingLot {
  id: string;
  itemId: string;
  purchaseDate: string; // YYYY-MM-DD
  vendor: string; // ชื่อร้านค้า/ซัพพลายเออร์ที่ไม่ซ้ำกันได้ในแต่ละรอบ
  quantity: number; // จำนวนชิ้นที่ซื้อ
  totalPrice: number; // ราคารวม (บาท)
  unitCost: number; // ราคาต่อชิ้น (บาท/ชิ้น)
  note?: string;
}

export interface Ingredient {
  id: string;
  name: string;
  category: 'dairy' | 'base' | 'flavoring' | 'topping' | 'beverage';
  note?: string;
}

export interface IngredientLot {
  id: string;
  ingredientId: string;
  purchaseDate: string; // YYYY-MM-DD
  vendor: string; // ชื่อร้านค้า/แหล่งซื้อ
  weightGrams: number; // จำนวนรวมที่ซื้อ (กรัม หรือ ชิ้น)
  unit?: 'g' | 'pcs'; // หน่วยนับ ('g' = กรัม, 'pcs' = ชิ้น)
  totalPrice: number; // ราคารวม (บาท)
  costPerGram: number; // ราคาต่อหน่วย (บาท/กรัม หรือ บาท/ชิ้น)
  note?: string;
}

export interface RecipeIngredientLine {
  ingredientId: string;
  gramsPerBatch: number; // ปริมาณกรัมที่ใช้ (ต่อ 1 ถ้วย หรือ ต่อ 1 หม้อปั่น ขึ้นกับ yieldCups)
  /**
   * ระบุว่าใช้วัตถุดิบจากการซื้อครั้งไหน (Lot ID):
   * - undefined หรือ 'fifo' = ตัดตามคิวเข้าก่อน-ออกก่อน (FIFO)
   * - 'latest' = ใช้ราคาล็อตล่าสุดที่ซื้อเข้า
   * - '<lotId>' = เจาะจงใช้ล็อตการซื้อครั้งนั้นโดยตรง
   */
  selectedLotId?: string;
}

export interface FlavorProductionRun {
  id: string;
  runNumber: number; // ครั้งที่ทำ เช่น 1, 2, 3...
  date: string; // YYYY-MM-DD วันที่ทำ/ปั่น
  label: string; // เช่น "ครั้งที่ 1 (ปั่นรอบแรก)", "ครั้งที่ 2 (เติม Stock)"
  batchYieldGrams?: number; // น้ำหนักเนื้อไอติมที่ได้ในครั้งนี้ (กรัม) ถ้าไม่ระบุใช้ผลรวมวัตถุดิบ
  ingredients: RecipeIngredientLine[]; // ปริมาณกรัมและล็อตวัตถุดิบที่ใช้ในการทำครั้งนี้โดยเฉพาะ
}

export interface FlavorRecipe {
  id: string;
  name: string; // ชื่อรสชาติตรงกับใน REFV POS เช่น "Holy Cow!", "Matcha Snob"
  category: FlavorCategory;
  image?: string;
  mode: 'per_cup' | 'per_batch';
  batchYieldCups: number; // จำนวนถ้วยต่อหม้อ (คำนวณอัตโนมัติจาก กรัม/หม้อ ÷ กรัม/ถ้วย หรือกำหนดเอง)
  /**
   * น้ำหนักเนื้อไอติมที่ได้ต่อ 1 หม้อปั่น (กรัม/หม้อ)
   * หากไม่ระบุ (หรือเป็น 0) ระบบจะใช้ผลรวมน้ำหนักกรัมของวัตถุดิบทั้งหมดในสูตรเป็นน้ำหนักต่อหม้ออัตโนมัติ
   */
  batchYieldGrams?: number;
  /**
   * น้ำหนักเนื้อไอติมที่ตักเสิร์ฟต่อ 1 ถ้วย เมื่อสั่ง 1 รส (กรัม/ถ้วย) เช่น 80 กรัม หรือ 100 กรัม
   */
  gramsPerCup?: number;
  /**
   * น้ำหนักเนื้อไอติมที่ตักต่อ 1 รส เมื่อลูกค้าสั่ง 2 รสใน 1 ถ้วย (กรัม/รส) เช่น 40 กรัม หรือ 50 กรัม
   */
  gramsPerHalfCup?: number;
  halfScoopRatio: number; // สัดส่วนการใช้เนื้อไอติมเมื่อลูกค้าสั่ง 2 รสใน 1 ถ้วย (ค่าเริ่มต้น 0.50 ของ 1 ถ้วย)
  ingredients: RecipeIngredientLine[];
  /**
   * รายการแต่ละ "ครั้งที่ทำ / เติม Stock" ของรสชาตินี้
   * เนื่องจากแต่ละครั้งที่ทำอาจใช้ปริมาณกรัมของวัตถุดิบไม่เท่ากัน หรือใช้วัตถุดิบคนละล็อต
   */
  productionRuns?: FlavorProductionRun[];
  notes?: string;
}

export type ExpenseCategory = 'venue' | 'ice_power' | 'transport' | 'labor' | 'marketing' | 'other';

export interface EventExpense {
  id: string;
  category: ExpenseCategory;
  title: string;
  vendor?: string;
  amount: number;
  date: string;
  note?: string;
}

export interface PosSaleRow {
  orderId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  type: 'gelato' | 'affogato' | string;
  flavorsPerCup: number; // 1 หรือ 2
  flavor1: string;
  flavor2: string;
  category1: string;
  category2: string;
  payment: 'QR' | 'Cash' | string;
  promotion: string;
  discountAmount: number;
  amount: number; // ยอดสุทธิต่อถ้วย (บาท)
}

export interface EventPackagingLotAllocation {
  id: string;
  lotId: string; // ID ของล็อตการซื้อแพ็กเกจจิ้งที่เลือกนำมาใช้
  quantity: number; // จำนวนชิ้นที่ใช้จากล็อตนี้ในบูธนี้
  autoFillTotal?: boolean; // ถ้า true (ค่าเริ่มต้นเมื่อใช้เจ้าเดียว) จะปรับจำนวนตามยอดรวมของบูธอัตโนมัติ
}

export interface EventIngredientLotAllocation {
  id: string;
  lotId: string; // ID ของล็อตการซื้อวัตถุดิบที่เลือกนำมาใช้
  gramsUsed: number; // ปริมาณกรัมที่ใช้จริงจากล็อต/Vendor นี้ในบูธนี้
  autoFillTotal?: boolean; // ถ้า true (ค่าเริ่มต้นเมื่อใช้เจ้าเดียวและยังไม่แก้กรัมเอง) จะดึงปริมาณกรัมตามสูตรอัตโนมัติ
}

export interface EventFlavorProductionUsage {
  id: string;
  recipeId: string;
  /**
   * 'master' = ใช้สูตรตั้งต้นของรสนั้น
   * '<runId>' = ใช้สูตรและปริมาณกรัมของ "ครั้งที่ทำ" (FlavorProductionRun) ครั้งนั้น
   */
  runId: string;
  /**
   * จำนวนหม้อ/สัดส่วนของครั้งที่ทำนั้นที่นำมาใช้ในบูธนี้ (ค่าเริ่มต้น = 1)
   */
  batchesUsed: number;
}

export interface BoothEvent {
  id: string;
  name: string;
  location: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  status: 'planned' | 'active' | 'completed';
  /**
   * เมื่อ isLocked === true หรือมี recipeSnapshots เก็บไว้:
   * การไปแก้ไขสูตรหรือเปลี่ยนล็อตวัตถุดิบในหน้าสูตรภายหลัง จะไม่กระทบยอดต้นทุนของบูธนี้ย้อนหลัง
   */
  isLocked?: boolean;
  recipeSnapshots?: FlavorRecipe[];
  expenses: EventExpense[];
  posSales: PosSaleRow[];
  /**
   * ระบุเจาะจงในแต่ละ Event ว่าวัตถุดิบแต่ละตัว (ingredientId) ดึงมาจากการซื้อครั้งไหน (lotId | 'fifo' | 'latest')
   */
  ingredientLotOverrides?: Record<string, string>;
  /**
   * ระบุว่าในบูธนี้ วัตถุดิบแต่ละตัว (key = ingredient.id) ใช้จากล็อต/Vendor ไหนบ้าง และใช้ไปกี่กรัม
   * รองรับทั้งการระบุกรัมที่ใช้จริงในบูธโดยตรง และการแบ่งใช้จากหลาย Vendor ในบูธเดียว
   */
  ingredientLotAllocations?: Record<string, EventIngredientLotAllocation[]>;
  /**
   * จำนวนแพ็กเกจจิ้งที่ใช้เพิ่มเติมนอกเหนือจากที่ผูกกับจำนวนถ้วย POS ในแต่ละบูธ
   * เช่น ช้อนชิม, ลูกค้าขอช้อนเพิ่ม, แก้วเสีย (key = packagingItem.id, value = จำนวนชิ้นที่ใช้เพิ่ม)
   */
  extraPackagingUsage?: Record<string, number>;
  /**
   * ระบุว่าแพ็กเกจจิ้งแต่ละชนิด (key = packagingItem.id) ในบูธนี้ เลือกนำมาจากการสั่งซื้อครั้งไหนบ้าง และใช้เจ้าละกี่ชิ้น
   * รองรับการเลือกมากกว่า 1 ล็อต/Vendor ในบูธเดียว (เช่น ล็อตแรกหมดระหว่างทางแล้วซื้อเพิ่มหน้างาน)
   */
  packagingLotAllocations?: Record<string, EventPackagingLotAllocation[]>;
  /**
   * โหมดการคิดต้นทุนเนื้อไอติมในบูธนี้:
   * - 'pos_cups' (ค่าเริ่มต้น): คิดเฉพาะรสชาติและจำนวนถ้วยที่ขายได้จริงใน POS (รสที่ไม่ได้เอาไปขายจะไม่ถูกคิด)
   * - 'produced_batches': เลือกระบุเองว่าบูธนี้ทำรสอะไรไปบ้าง และดึงมาจาก "ครั้งที่ทำ" (Production Run / เติม Stock) ครั้งไหนบ้าง
   */
  ingredientCostMode?: 'pos_cups' | 'produced_batches';
  /**
   * จำนวนหม้อปั่น (Batch) ของแต่ละรสชาติที่ผลิตไปสำหรับบูธนี้ (key = recipe.id, value = จำนวนหม้อ เช่น 1, 2)
   */
  producedBatches?: Record<string, number>;
  /**
   * รายการระบุว่าในบูธนี้ทำรสอะไรไปบ้าง และนำมาจาก "ครั้งที่ทำ / เติม Stock" (runId) ครั้งไหนบ้าง
   * รองรับการเพิ่มมากกว่า 1 ครั้งที่ทำในรสเดียวกัน (เช่น ครั้งที่ 1 ปั่นเปิดบูธ + ครั้งที่ 2 ปั่นเติม Stock ที่ใช้ปริมาณกรัมไม่เท่ากัน)
   */
  flavorProductionUsages?: EventFlavorProductionUsage[];
  lastSyncedAt?: string;
  notes?: string;
}

export interface FifoLotUsageSlice {
  lotId: string;
  purchaseDate: string;
  vendor: string;
  quantityUsed: number;
  unitCost: number;
  totalCost: number;
}

export interface PackagingEventUsage {
  itemId: string;
  itemName: string;
  unit: string;
  posQuantityNeeded: number;
  extraQuantityNeeded: number;
  totalQuantityNeeded: number;
  slices: FifoLotUsageSlice[];
  unfulfilledQuantity: number;
  fallbackUnitCost: number;
  totalCost: number;
}

export interface IngredientEventUsage {
  ingredientId: string;
  ingredientName: string;
  selectedLotMode: string; // 'fifo' | 'latest' | lotId
  recipeGramsNeeded: number;
  totalGramsNeeded: number;
  slices: FifoLotUsageSlice[];
  unfulfilledGrams: number;
  fallbackCostPerGram: number;
  totalCost: number;
}

export interface FlavorEventSummary {
  flavorName: string;
  category: FlavorCategory | string;
  fullScoopCount: number;
  halfScoopCount: number;
  affogatoCount: number;
  equivalentFullCups: number;
  revenueAttributed: number;
  ingredientCost: number;
}

export interface EventPnLResult {
  eventId: string;
  totalOrders: number;
  totalCupsSold: number;
  totalDiscount: number;
  grossRevenue: number;
  netRevenue: number;
  cashRevenue: number;
  qrRevenue: number;
  packagingUsages: PackagingEventUsage[];
  totalPackagingCost: number;
  ingredientUsages: IngredientEventUsage[];
  totalIngredientCost: number;
  flavorSummaries: FlavorEventSummary[];
  expensesByCategory: Record<ExpenseCategory, number>;
  totalFixedExpenses: number;
  totalAllCosts: number;
  netProfit: number;
  profitMarginPct: number;
}

export interface PosConnectionSettings {
  sheetId: string;
  appsScriptUrl: string;
  shopName: string;
  branchName: string;
}

export interface AppDatabaseState {
  settings: PosConnectionSettings;
  packagingItems: PackagingItem[];
  packagingLots: PackagingLot[];
  ingredients: Ingredient[];
  ingredientLots: IngredientLot[];
  recipes: FlavorRecipe[];
  events: BoothEvent[];
}
