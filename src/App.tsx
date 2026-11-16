import React, { useEffect, useMemo, useState } from 'react';
import { AppDatabaseState } from './types';
import {
  formatBaht,
  formatSignedBaht,
  loadAppState,
  loadStateFromDiskOrCloud,
  pullDatabaseFromGoogleSheets,
  pushDatabaseToGoogleSheets,
  saveAppState,
  saveToDiskFile,
  SyncStatusInfo,
} from './services/storage';
import { runFifoSimulation } from './services/fifoEngine';
import { EventPnLView } from './components/EventPnLView';
import { FifoInventoryView } from './components/FifoInventoryView';
import { RecipeCostView } from './components/RecipeCostView';
import { SettingsView } from './components/SettingsView';
import {
  BarChart3,
  Package,
  IceCream,
  Settings,
  TrendingUp,
  HardDrive,
  CloudUpload,
  CloudDownload,
  CheckCircle2,
} from 'lucide-react';

type ActiveTab = 'events' | 'inventory' | 'recipes' | 'settings';

const DB_REVISION_STAMP = 'grapest-536g-v6';

export const App: React.FC = () => {
  const [state, setState] = useState<AppDatabaseState>(() => loadAppState());
  const [activeTab, setActiveTab] = useState<ActiveTab>('events');
  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>({
    diskSaved: true,
    cloudSynced: false,
    lastSavedAt: new Date().toLocaleTimeString('th-TH'),
    message: 'เชื่อมกับไฟล์ data/database.json ในเครื่องแล้ว',
  });
  const [cloudBusy, setCloudBusy] = useState(false);

  // โหลดข้อมูลจากไฟล์จริงในเครื่อง (data/database.json) หรือดึงจาก Google Sheets ตอนเปิดแอป
  useEffect(() => {
    let mounted = true;
    loadStateFromDiskOrCloud(state).then(({ state: loadedState, source }) => {
      if (!mounted) return;
      setState(loadedState);
      const t = new Date().toLocaleTimeString('th-TH');
      if (source === 'disk') {
        setSyncStatus({
          diskSaved: true,
          cloudSynced: false,
          lastSavedAt: t,
          message: `โหลดข้อมูลจากไฟล์ data/database.json สำเร็จ (${t})`,
        });
      } else if (source === 'cloud') {
        setSyncStatus({
          diskSaved: true,
          cloudSynced: true,
          lastSavedAt: t,
          message: `ดึงข้อมูลล่าสุดจาก Google Sheets ลงเครื่องสำเร็จ (${t})`,
        });
      }
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DB_REVISION_STAMP]);

  const handleUpdateState = (updater: (prev: AppDatabaseState) => AppDatabaseState) => {
    setState((prev) => {
      const next = updater(prev);
      saveAppState(next, (status) => setSyncStatus(status));
      return next;
    });
  };

  const handleManualCloudPush = async () => {
    setCloudBusy(true);
    try {
      await saveToDiskFile(state);
      const ok = await pushDatabaseToGoogleSheets(state);
      const t = new Date().toLocaleTimeString('th-TH');
      setSyncStatus({
        diskSaved: true,
        cloudSynced: ok,
        lastSavedAt: t,
        message: ok
          ? `ส่งข้อมูลทั้งหมดขึ้น Google Sheets สำเร็จ (${t})`
          : `เซฟลงไฟล์ data/database.json แล้ว (หากต้องการเก็บขึ้นชีท กรุณาอัปเดต google-apps-script.gs ในชีท)`,
      });
    } finally {
      setCloudBusy(false);
    }
  };

  const handleManualCloudPull = async () => {
    setCloudBusy(true);
    try {
      const cloudState = await pullDatabaseFromGoogleSheets(state.settings);
      const t = new Date().toLocaleTimeString('th-TH');
      if (cloudState) {
        setState(cloudState);
        await saveToDiskFile(cloudState);
        setSyncStatus({
          diskSaved: true,
          cloudSynced: true,
          lastSavedAt: t,
          message: `ดึงข้อมูลล่าสุดจาก Google Sheets ลงเครื่องสำเร็จ (${t})`,
        });
      } else {
        setSyncStatus({
          diskSaved: true,
          cloudSynced: false,
          lastSavedAt: t,
          message: `ยังไม่มีข้อมูล Tax_DB_State บน Google Sheets (กดปุ่ม "ส่งขึ้นชีท" ครั้งแรกเพื่อสร้างแท็บได้เลย)`,
        });
      }
    } finally {
      setCloudBusy(false);
    }
  };

  // คำนวณจำลองการตัดสต็อกแบบ FIFO และผลประกอบการทุกครั้งที่ข้อมูลเปลี่ยน
  const sim = useMemo(() => runFifoSimulation(state), [state]);

  // สรุปภาพรวมทุกงานออกบูธรวมกัน
  const overallSummary = useMemo(() => {
    const results = Object.values(sim.eventResults);
    const totalRevenue = results.reduce((s, r) => s + r.netRevenue, 0);
    const totalCosts = results.reduce((s, r) => s + r.totalAllCosts, 0);
    const totalProfit = results.reduce((s, r) => s + r.netProfit, 0);
    const totalCups = results.reduce((s, r) => s + r.totalCupsSold, 0);
    return { totalRevenue, totalCosts, totalProfit, totalCups, eventCount: results.length };
  }, [sim]);

  return (
    <div className="min-h-screen flex flex-col bg-[#fef9ec] text-[#0d3a57]">
      {/* แถบเมนูด้านบน (Top Navigation Bar) สไตล์เดียวกับ REFV POS */}
      <header className="sticky top-0 z-30 bg-[#fef9ec]/95 backdrop-blur-md border-b border-[#eae3cf] px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/images/logo.png"
              alt="REFV Gelato"
              className="h-11 w-auto object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-[#0d3a57]">
                  {state.settings.shopName} — Cost & Event P&L
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#90d4ec]/40 text-[#0d3a57]">
                  Disk File + Google Sheets Sync
                </span>
              </div>
              <p className="text-xs text-[#6b8799] font-medium flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-[#1a9a5b]" />
                <span>{syncStatus.message}</span>
              </p>
            </div>
          </div>

          {/* ปุ่มสลับหน้าจอหลัก */}
          <nav className="flex flex-wrap gap-1.5 bg-white p-1.5 rounded-2xl shadow-xs border border-[#eae3cf]">
            <button
              onClick={() => setActiveTab('events')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition cursor-pointer ${
                activeTab === 'events'
                  ? 'bg-[#118cd1] text-white shadow-xs'
                  : 'text-[#6b8799] hover:text-[#0d3a57]'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              ออกบูธ & สรุปกำไร (-/+)
            </button>

            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition cursor-pointer ${
                activeTab === 'inventory'
                  ? 'bg-[#118cd1] text-white shadow-xs'
                  : 'text-[#6b8799] hover:text-[#0d3a57]'
              }`}
            >
              <Package className="w-4 h-4" />
              ซื้อของเข้า & สต็อก FIFO
            </button>

            <button
              onClick={() => setActiveTab('recipes')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition cursor-pointer ${
                activeTab === 'recipes'
                  ? 'bg-[#118cd1] text-white shadow-xs'
                  : 'text-[#6b8799] hover:text-[#0d3a57]'
              }`}
            >
              <IceCream className="w-4 h-4" />
              สูตรไอติม & ต้นทุน/ถ้วย
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition cursor-pointer ${
                activeTab === 'settings'
                  ? 'bg-[#118cd1] text-white shadow-xs'
                  : 'text-[#6b8799] hover:text-[#0d3a57]'
              }`}
            >
              <Settings className="w-4 h-4" />
              ตั้งค่า & ซิงค์ชีท
            </button>
          </nav>
        </div>
      </header>

      {/* แถบสรุปภาพรวมสะสมทุกงานออกบูธ + ปุ่มด่วน Cloud Sync */}
      <div className="bg-white/70 border-b border-[#eae3cf] px-4 lg:px-8 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1.5 font-bold text-[#0d3a57]">
              <TrendingUp className="w-4 h-4 text-[#118cd1]" />
              สะสม {overallSummary.eventCount} บูธ ({overallSummary.totalCups.toLocaleString()} ถ้วย):
            </span>
            <span>
              ยอดขาย POS: <b className="text-[#0d3a57]">{formatBaht(overallSummary.totalRevenue)}</b>
            </span>
            <span>
              ต้นทุนรวม: <b className="text-rose-700">{formatBaht(overallSummary.totalCosts)}</b>
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-extrabold">
              กำไรสุทธิสะสม: {formatSignedBaht(overallSummary.totalProfit)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" />
              ไฟล์ในเครื่อง: data/database.json
            </span>
            <button
              onClick={handleManualCloudPush}
              disabled={cloudBusy}
              className="inline-flex items-center gap-1 bg-[#118cd1]/10 hover:bg-[#118cd1]/20 text-[#118cd1] font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
              title="ส่งสูตร สต็อก และงานออกบูธทั้งหมดไปเก็บบน Google Sheets"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              ส่งขึ้นชีท
            </button>
            <button
              onClick={handleManualCloudPull}
              disabled={cloudBusy}
              className="inline-flex items-center gap-1 bg-[#90d4ec]/30 hover:bg-[#90d4ec]/50 text-[#0d3a57] font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
              title="ดึงสูตร สต็อก และงานออกบูธล่าสุดจาก Google Sheets ลงเครื่องนี้"
            >
              <CloudDownload className="w-3.5 h-3.5" />
              ดึงจากชีท
            </button>
          </div>
        </div>
      </div>

      {/* เนื้อหาหลัก */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6">
        {activeTab === 'events' && (
          <EventPnLView state={state} sim={sim} onUpdateState={handleUpdateState} />
        )}
        {activeTab === 'inventory' && (
          <FifoInventoryView state={state} sim={sim} onUpdateState={handleUpdateState} />
        )}
        {activeTab === 'recipes' && (
          <RecipeCostView state={state} sim={sim} onUpdateState={handleUpdateState} />
        )}
        {activeTab === 'settings' && (
          <SettingsView
            state={state}
            onUpdateState={handleUpdateState}
            onPushCloud={handleManualCloudPush}
            onPullCloud={handleManualCloudPull}
            cloudBusy={cloudBusy}
          />
        )}
      </main>
    </div>
  );
};

export default App;
