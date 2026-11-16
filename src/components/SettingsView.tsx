import React, { useRef, useState } from 'react';
import { AppDatabaseState } from '../types';
import { fetchAllPosSalesFromCloud } from '../services/posSync';
import { clearDemoTransactionsOnly, resetToDemoState } from '../services/storage';
import {
  Link2,
  Download,
  Upload,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Building2,
  Sparkles,
  CloudUpload,
  CloudDownload,
  HardDrive,
} from 'lucide-react';

interface Props {
  state: AppDatabaseState;
  onUpdateState: (updater: (prev: AppDatabaseState) => AppDatabaseState) => void;
  onPushCloud?: () => Promise<void>;
  onPullCloud?: () => Promise<void>;
  cloudBusy?: boolean;
}

export const SettingsView: React.FC<Props> = ({
  state,
  onUpdateState,
  onPushCloud,
  onPullCloud,
  cloudBusy,
}) => {
  const [sheetId, setSheetId] = useState(state.settings.sheetId);
  const [appsScriptUrl, setAppsScriptUrl] = useState(state.settings.appsScriptUrl);
  const [shopName, setShopName] = useState(state.settings.shopName);
  const [branchName, setBranchName] = useState(state.settings.branchName);
  const [testStatus, setTestStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const importRef = useRef<HTMLInputElement | null>(null);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    let cleanedSheetId = sheetId.trim();
    const match = cleanedSheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match && match[1]) {
      cleanedSheetId = match[1];
      setSheetId(cleanedSheetId);
    }

    onUpdateState((prev) => ({
      ...prev,
      settings: {
        sheetId: cleanedSheetId,
        appsScriptUrl: appsScriptUrl.trim(),
        shopName: shopName.trim() || 'REFV Gelato',
        branchName: branchName.trim() || 'Main',
      },
    }));

    setTestStatus({
      type: 'ok',
      msg: 'บันทึกการตั้งค่าลงไฟล์ data/database.json และซิงค์เรียบร้อยแล้ว',
    });
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const res = await fetchAllPosSalesFromCloud({
        sheetId: sheetId.trim(),
        appsScriptUrl: appsScriptUrl.trim(),
        shopName,
        branchName,
      });
      setTestStatus({
        type: 'ok',
        msg: `เชื่อมต่อ REFV POS สำเร็จ (${res.source}) — พบข้อมูลการขายทั้งหมด ${res.sales.length} ถ้วย`,
      });
    } catch (err) {
      setTestStatus({
        type: 'err',
        msg: `ไม่สามารถเชื่อมต่อได้: ${String(err)}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `refv-cost-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as AppDatabaseState;
        if (parsed && Array.isArray(parsed.packagingItems) && Array.isArray(parsed.recipes)) {
          onUpdateState(() => parsed);
          setTestStatus({ type: 'ok', msg: 'นำเข้าข้อมูลสำรองสำเร็จแล้ว!' });
        } else {
          alert('รูปแบบไฟล์สำรองข้อมูลไม่ถูกต้อง');
        }
      } catch {
        alert('ไม่สามารถอ่านไฟล์ JSON ได้');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* กล่องแสดงสถานะการจัดเก็บข้อมูล 2 ชั้น (ไฟล์ในเครื่อง + Google Sheets) */}
      <div className="bg-emerald-50/80 rounded-2xl p-5 border border-emerald-200 space-y-3">
        <div className="flex items-center gap-2 text-emerald-900 font-extrabold text-base">
          <HardDrive className="w-5 h-5 text-emerald-700" />
          <span>ระบบจัดเก็บข้อมูลอัตโนมัติ 2 ชั้น (ไม่หายแม้เปลี่ยนเบราว์เซอร์หรือเปิดเครื่องอื่น)</span>
        </div>
        <ul className="text-xs text-emerald-900 space-y-1.5 list-disc pl-5 font-medium">
          <li>
            <b>ชั้นที่ 1 (ไฟล์จริงในเครื่องนี้):</b> ทุกครั้งที่คุณแก้สูตรหรือเพิ่มรายการซื้อของ ระบบจะเซฟลงไฟล์{' '}
            <code className="bg-white px-1.5 py-0.5 rounded border border-emerald-200 font-bold">
              data/database.json
            </code>{' '}
            ในโฟลเดอร์โปรเจกต์ทันที (เปิดเบราว์เซอร์ไหนในเครื่องนี้ก็เห็นข้อมูลเดียวกันทั้งหมด)
          </li>
          <li>
            <b>ชั้นที่ 2 (ซิงค์ขึ้น Google Sheets):</b> ระบบจะส่งข้อมูลทั้งหมดขึ้นไปเก็บใน Google Sheet ของร้าน (เพียงนำโค้ดในไฟล์{' '}
            <code className="bg-white px-1.5 py-0.5 rounded border border-emerald-200 font-bold">
              google-apps-script.gs
            </code>{' '}
            ไปวางใน Extensions &gt; Apps Script ของชีทคุณ) เวลาไปเปิดที่คอมเครื่องอื่นก็กดดึงข้อมูลกลับมาได้ครบ 100%
          </li>
        </ul>
        <div className="flex flex-wrap gap-2.5 pt-1">
          {onPushCloud && (
            <button
              type="button"
              onClick={onPushCloud}
              disabled={cloudBusy}
              className="inline-flex items-center gap-2 bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold px-4 py-2 rounded-xl text-xs transition cursor-pointer"
            >
              <CloudUpload className="w-4 h-4" />
              ส่งข้อมูลทั้งหมดขึ้น Google Sheets เดี๋ยวนี้
            </button>
          )}
          {onPullCloud && (
            <button
              type="button"
              onClick={onPullCloud}
              disabled={cloudBusy}
              className="inline-flex items-center gap-2 bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold px-4 py-2 rounded-xl text-xs transition cursor-pointer"
            >
              <CloudDownload className="w-4 h-4 text-[#118cd1]" />
              ดึงข้อมูลล่าสุดจาก Google Sheets ลงเครื่องนี้
            </button>
          )}
        </div>
      </div>

      {/* การเชื่อมต่อกับ REFV POS */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-[#eae3cf] space-y-4">
        <div className="flex items-center gap-2.5">
          <Link2 className="w-5 h-5 text-[#118cd1]" />
          <div>
            <h2 className="text-lg font-extrabold text-[#0d3a57]">
              การเชื่อมต่อกับระบบ REFV POS (Google Sheets & Apps Script)
            </h2>
            <p className="text-xs text-[#6b8799]">
              เชื่อมต่อกับชีท POS ของร้านเพื่อดึงยอดขาย จำนวนถ้วย และเก็บสำรองข้อมูลสูตร/สต็อกขึ้นชีท
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#6b8799] mb-1">
                ชื่อร้าน / แบรนด์ (รองรับหลายร้านในอนาคต)
              </label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full border-2 border-[#eae3cf] rounded-xl px-3.5 py-2 text-sm font-bold text-[#0d3a57]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#6b8799] mb-1">สาขา / ทีมงาน</label>
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="w-full border-2 border-[#eae3cf] rounded-xl px-3.5 py-2 text-sm font-bold text-[#0d3a57]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#6b8799] mb-1">
              Google Sheet ID (หรือวางลิงก์ Google Sheet ของ REFV POS ได้เลย)
            </label>
            <input
              type="text"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="1VsOG-E4S9A4tUvPaw467d9KO4VRSn79k2HmJIhfZUkw"
              className="w-full border-2 border-[#eae3cf] rounded-xl px-3.5 py-2 text-sm font-mono font-semibold text-[#0d3a57]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#6b8799] mb-1">
              Google Apps Script Web App URL (จาก REFV POS config.json)
            </label>
            <input
              type="url"
              value={appsScriptUrl}
              onChange={(e) => setAppsScriptUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full border-2 border-[#eae3cf] rounded-xl px-3.5 py-2 text-sm font-mono font-semibold text-[#0d3a57]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              className="bg-[#118cd1] hover:bg-[#0e78b5] text-white font-bold px-5 py-2.5 rounded-xl text-sm transition cursor-pointer"
            >
              บันทึกการตั้งค่า
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className="bg-[#90d4ec]/30 hover:bg-[#90d4ec]/50 text-[#0d3a57] font-bold px-4 py-2.5 rounded-xl text-sm transition cursor-pointer"
            >
              {testing ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อกับ REFV POS'}
            </button>
          </div>
        </form>

        {testStatus && (
          <div
            className={`p-3.5 rounded-xl text-xs font-bold flex items-center gap-2 ${
              testStatus.type === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {testStatus.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{testStatus.msg}</span>
          </div>
        )}
      </div>

      {/* จัดการฐานข้อมูล สำรองข้อมูล และรีเซ็ตข้อมูลตัวอย่าง */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-[#eae3cf] space-y-4">
        <div className="flex items-center gap-2.5">
          <Building2 className="w-5 h-5 text-[#118cd1]" />
          <div>
            <h2 className="text-lg font-extrabold text-[#0d3a57]">
              ส่งออกไฟล์สำรองข้อมูล & จัดการข้อมูลตั้งต้น
            </h2>
            <p className="text-xs text-[#6b8799]">
              ส่งออกไฟล์ .json หรือล้างรายการตัวอย่างเพื่อเริ่มจดงานจริง
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <button
            onClick={handleExportJson}
            className="flex items-center justify-center gap-2 bg-[#fef9ec] hover:bg-[#90d4ec]/25 border border-[#eae3cf] text-[#0d3a57] font-bold py-3 px-4 rounded-xl text-sm transition cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#118cd1]" />
            ดาวน์โหลดไฟล์สำรองข้อมูล (.json)
          </button>

          <button
            onClick={() => importRef.current?.click()}
            className="flex items-center justify-center gap-2 bg-[#fef9ec] hover:bg-[#90d4ec]/25 border border-[#eae3cf] text-[#0d3a57] font-bold py-3 px-4 rounded-xl text-sm transition cursor-pointer"
          >
            <Upload className="w-4 h-4 text-[#118cd1]" />
            นำเข้าไฟล์สำรองข้อมูล (.json)
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json"
            onChange={handleImportJson}
            className="hidden"
          />
        </div>

        <div className="pt-4 border-t border-[#eae3cf] flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => {
              if (
                window.confirm(
                  'ต้องการล้างเฉพาะล็อตการซื้อแพ็กเกจจิ้งและงานออกบูธตัวอย่าง เพื่อเริ่มจดข้อมูลจริงใช่หรือไม่? (สูตรไอติมและราคาวัตถุดิบตั้งต้นจะยังคงอยู่)'
                )
              ) {
                onUpdateState((prev) => clearDemoTransactionsOnly(prev));
              }
            }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 px-3.5 py-2 rounded-xl border border-rose-200 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            ล้างรายการบูธตัวอย่างเพื่อเริ่มจดงานจริง (เก็บสูตรไว้)
          </button>

          <button
            onClick={() => {
              if (
                window.confirm(
                  'ต้องการโหลดข้อมูลตัวอย่าง Scenario (ซื้อแก้ว 100 ชิ้น ใช้ 80 ชิ้น ซื้อเจ้าใหม่ 100 ชิ้น ใช้ 60 ชิ้น) กลับมาใหม่หรือไม่?'
                )
              ) {
                onUpdateState(() => resetToDemoState());
              }
            }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#6b8799] hover:text-[#0d3a57] px-3 py-2 rounded-xl cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            รีเซ็ตกลับเป็นข้อมูลตัวอย่าง (Demo Scenario)
          </button>
        </div>
      </div>
    </div>
  );
};
