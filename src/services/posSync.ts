import { FlavorCategory, PosConnectionSettings, PosSaleRow } from '../types';

export const DEFAULT_REFV_POS_SETTINGS: PosConnectionSettings = {
  sheetId: '1VsOG-E4S9A4tUvPaw467d9KO4VRSn79k2HmJIhfZUkw',
  appsScriptUrl:
    'https://script.google.com/macros/s/AKfycbyC8sOIL0oSuJFi7A8rDgMoY83FuGfGqqzx8t28AH-ULPR0f3BxVAaO55x_A2U8DIlU/exec',
  shopName: 'REFV Gelato',
  branchName: 'Event & Booth Operations',
};

/**
 * แปลงบรรทัด CSV เป็น Array ของ string โดยรองรับเครื่องหมายคำพูด ("...")
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function normalizeDateString(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';

  // รูปแบบ YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }

  // รูปแบบ DD/MM/YYYY หรือ M/D/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    const yyyy = slashMatch[3];
    // ถ้าตัวแรก > 12 แปลว่าเป็น DD/MM/YYYY
    if (p1 > 12) {
      return `${yyyy}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
    }
    return `${yyyy}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return s;
}

export function normalizeTimeString(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '12:00:00';
  const match = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const hh = String(match[1]).padStart(2, '0');
    const mm = match[2];
    const ss = match[3] || '00';
    return `${hh}:${mm}:${ss}`;
  }
  return '12:00:00';
}

/**
 * แปลงตารางแถวข้อมูลจากชีท Sales ของ REFV POS (13 คอลัมน์ หรือ 11 คอลัมน์รุ่นเก่า)
 * HEAD = ["Order ID","Date","Time","Type","Flavors per cup","Flavor 1","Flavor 2","Category 1","Category 2","Payment","Promotion","Discount Amount","Amount (THB)"]
 */
export function parseRefvPosRows(rows: string[][]): PosSaleRow[] {
  const sales: PosSaleRow[] = [];

  for (const r of rows) {
    if (!r || r.length < 6) continue;
    const orderId = String(r[0] || '').trim();
    if (!orderId || orderId.toLowerCase() === 'order id') continue;

    const date = normalizeDateString(r[1]);
    const time = normalizeTimeString(r[2]);
    const type = String(r[3] || 'gelato').trim().toLowerCase();
    const flavorsPerCup = Number(r[4]) || 1;
    const flavor1 = String(r[5] || '').trim();
    const flavor2 = String(r[6] || '').trim();
    const category1 = String(r[7] || 'Original').trim();
    const category2 = String(r[8] || '').trim();
    const payment = String(r[9] || 'QR').trim();

    const is13Cols = r.length >= 13;
    const promotion = is13Cols ? String(r[10] || '').trim() : '';
    const discountAmount = is13Cols ? Number(r[11]) || 0 : 0;
    const amount = is13Cols ? Number(r[12]) || 0 : Number(r[10]) || 0;

    sales.push({
      orderId,
      date,
      time,
      type,
      flavorsPerCup,
      flavor1,
      flavor2,
      category1,
      category2,
      payment,
      promotion,
      discountAmount,
      amount,
    });
  }

  return sales;
}

export function parseRefvPosCsvText(csvText: string): PosSaleRow[] {
  const clean = csvText.replace(/^\uFEFF/, '').trim();
  if (!clean) return [];
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows = lines.map(parseCsvLine);
  return parseRefvPosRows(rows);
}

/**
 * ดึงข้อมูลจาก Google Sheets ผ่าน GViz JSONP (เหมือนใน REFV POS index.html เพื่อเลี่ยงปัญหา CORS)
 */
export function fetchSheetGvizRows(sheetId: string, tabName: string): Promise<string[][] | null> {
  return new Promise((resolve) => {
    const cbName =
      '__refvTaxGviz_' +
      tabName.replace(/\W/g, '') +
      '_' +
      Date.now() +
      '_' +
      Math.floor(Math.random() * 1e4);
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 7000);

    function cleanup() {
      clearTimeout(timer);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (window as any)[cbName];
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any)[cbName] = undefined;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[cbName] = function (resp: any) {
      cleanup();
      if (!resp || resp.status !== 'ok' || !resp.table || !Array.isArray(resp.table.rows)) {
        resolve(null);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: string[][] = resp.table.rows.map((r: any) =>
        r && Array.isArray(r.c)
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            r.c.map((cell: any) =>
              cell && cell.f !== undefined && cell.f !== null
                ? String(cell.f)
                : cell && cell.v !== null && cell.v !== undefined
                  ? String(cell.v)
                  : ''
            )
          : []
      );
      resolve(rows);
    };

    script.onerror = () => {
      cleanup();
      resolve(null);
    };
    script.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?sheet=${encodeURIComponent(
      tabName
    )}&tqx=responseHandler:${cbName}&ts=${Date.now()}`;
    document.head.appendChild(script);
  });
}

/**
 * ดึงรายการขายทั้งหมดจาก REFV POS Google Sheet หรือ Apps Script URL
 */
export async function fetchAllPosSalesFromCloud(
  settings: PosConnectionSettings
): Promise<{ sales: PosSaleRow[]; source: string }> {
  // 1. ลองดึงผ่าน GViz / CSV ของแท็บ Sales ใน Google Sheet ก่อน
  if (settings.sheetId) {
    try {
      const gvizRows = await fetchSheetGvizRows(settings.sheetId, 'Sales');
      if (gvizRows && gvizRows.length > 0) {
        const parsed = parseRefvPosRows(gvizRows);
        if (parsed.length > 0) {
          return { sales: parsed, source: 'Google Sheets (Sales Tab)' };
        }
      }
    } catch {
      // fallback ต่อ
    }

    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${settings.sheetId}/gviz/tq?tqx=out:csv&sheet=Sales&ts=${Date.now()}`;
      const res = await fetch(csvUrl, { cache: 'no-store', credentials: 'omit' });
      if (res.ok) {
        const text = await res.text();
        const parsed = parseRefvPosCsvText(text);
        if (parsed.length > 0) {
          return { sales: parsed, source: 'Google Sheets CSV (Sales Tab)' };
        }
      }
    } catch {
      // fallback ต่อ
    }
  }

  // 2. ลองดึงผ่าน Apps Script Web App (?mode=report) เหมือนฟังก์ชัน loadCentralReport() ใน REFV POS
  if (settings.appsScriptUrl && settings.appsScriptUrl.includes('script.google.com')) {
    try {
      const sep = settings.appsScriptUrl.includes('?') ? '&' : '?';
      const url = `${settings.appsScriptUrl}${sep}mode=report&ts=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.sales)) {
          const rows: PosSaleRow[] = [];
          for (const order of data.sales) {
            const d = new Date(Number(order.ts) || Date.now());
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
              d.getDate()
            ).padStart(2, '0')}`;
            const timeStr = d.toTimeString().slice(0, 8);
            const items = Array.isArray(order.items) ? order.items : [];
            items.forEach((item: any) => {
              const parts = Array.isArray(item.parts) ? item.parts : [];
              rows.push({
                orderId: String(order.id || ''),
                date: dateStr,
                time: timeStr,
                type: String(item.type || 'gelato'),
                flavorsPerCup: Number(item.cups) || parts.length || 1,
                flavor1: String(parts[0]?.name || ''),
                flavor2: String(parts[1]?.name || ''),
                category1: String(parts[0]?.cat || 'Original'),
                category2: String(parts[1]?.cat || ''),
                payment: String(order.pay || '').toUpperCase() === 'QR' ? 'QR' : 'Cash',
                promotion: String(item.promo || order.promo || ''),
                discountAmount: Number(item.discount) || 0,
                amount: Number(item.price) || 0,
              });
            });
          }
          return { sales: rows, source: 'REFV POS Apps Script (?mode=report)' };
        }
      }
    } catch {
      // ignore
    }
  }

  return { sales: [], source: 'ไม่พบรายการขายในชีท หรือไม่สามารถเชื่อมต่อได้' };
}

/**
 * กรองรายการขายจาก POS เฉพาะที่อยู่ในช่วงวันและเวลาของ Event
 */
export function filterSalesForEventWindow(
  allSales: PosSaleRow[],
  startDate: string,
  endDate: string,
  startTime = '00:00',
  endTime = '23:59'
): PosSaleRow[] {
  const startD = startDate.trim();
  const endD = (endDate || startDate).trim();
  const startT = normalizeTimeString(startTime || '00:00').slice(0, 5);
  const endT = normalizeTimeString(endTime || '23:59').slice(0, 5);

  return allSales.filter((row) => {
    const d = row.date;
    if (!d) return false;
    if (d < startD || d > endD) return false;

    const t = normalizeTimeString(row.time || '12:00:00').slice(0, 5);
    if (d === startD && t < startT) return false;
    if (d === endD && t > endT) return false;
    return true;
  });
}

/**
 * ดึงรายชื่อรสชาติไอติมจากชีท Flavor ของ REFV POS
 */
export async function fetchPosFlavorsFromCloud(
  settings: PosConnectionSettings
): Promise<{ name: string; category: FlavorCategory }[]> {
  if (!settings.sheetId) return [];

  for (const tab of ['Flavor', 'Flavors']) {
    try {
      const rows = await fetchSheetGvizRows(settings.sheetId, tab);
      if (rows && rows.length > 0) {
        const list: { name: string; category: FlavorCategory }[] = [];
        for (const r of rows) {
          const name = String(r[0] || '').trim();
          const catRaw = String(r[1] || 'Original').trim();
          const status = String(r[2] || 'Active')
            .trim()
            .toLowerCase();
          if (!name || name.toLowerCase().includes('flavor name')) continue;
          if (status === 'inactive' || status === 'disabled' || status === 'hidden') continue;
          const category: FlavorCategory =
            catRaw === 'Premium' || catRaw === 'Signature' ? catRaw : 'Original';
          list.push({ name, category });
        }
        if (list.length > 0) return list;
      }
    } catch {
      // try next
    }
  }
  return [];
}

