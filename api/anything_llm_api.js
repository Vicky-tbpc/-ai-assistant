// anything_llm_api_22
import { waitUntil } from '@vercel/functions'; // 【新增】引入 Vercel 的背景執行工具

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, serial_number, record_date, history = [], local_date, local_time } = req.body;

    // === 【設定區】 ===
    const anythingLlmUrl = process.env.ANYTHING_LLM_URL;
    const apiKey = process.env.ANYTHING_LLM_KEY;
    const workspaceSlug = process.env.ANYTHING_LLM_WORKSPACE || "tbpc_medical_ref_database";
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!anythingLlmUrl) return res.status(500).json({ text: "伺服器錯誤：找不到 AnythingLLM 網址" });
    
    // --- 【新增】 檢查日期模糊性邏輯 ---
    // 1. 檢查是否有 4 位數年份 (如 2025, 2026)
    const hasYear = /\d{4}/.test(prompt); 
    // 2. 檢查是否有月份 (如 3月, 12月)
    const hasMonth = /\d{1,2}月/.test(prompt);
    // 3. 檢查是否有短日期格式 (如 4/6, 04-06)
    const hasShortDate = /\b\d{1,2}[\/-]\d{1,2}\b/.test(prompt);
    // 4. 判斷是否為「只有年份」或「去年」
    const isYearOnly = (hasYear && !hasMonth && !hasShortDate) || prompt.includes("去年");
    // 5. 判斷是否為「只有月份/日期但沒年份」
    const isMissingYear = !hasYear && (hasMonth || hasShortDate || prompt.includes("上個月"));

    // 如果符合以上模糊條件，則觸發反問機制
    if (isYearOnly || isMissingYear) {
      return res.status(200).json({ 
        text: `嘿！可以告訴我完整日期嗎？ 📅 比如「2026年3月」或「2026/4/6」，我才能準確幫你分析，不會拿錯資料喔～📊✨` 
      });
    }

    // --- 輔助函數：本地日期格式化 (YYYY-MM-DD) ---
    const fmt = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

     // --- 【新增】精準解析「週幾」函數 ---
    const getSpecificDate = (p, baseDate) => {
      const weekMap = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
      const match = p.match(/(這|上)(週|星期|禮拜)([一二三四五六日天])/);
      if (match) {
        const relative = match[1]; // "這" 或 "上"
        const targetDay = weekMap[match[3]];
        const currentDay = baseDate.getDay() === 0 ? 7 : baseDate.getDay(); // Mon=1...Sun=7
        
        // 先回推到「本週一」
        const thisMonday = new Date(baseDate);
        thisMonday.setDate(baseDate.getDate() - (currentDay - 1));

        const resultDate = new Date(thisMonday);
        if (relative === "上") {
          // 上週：先減 7 天，再加上目標星期的偏移量
          resultDate.setDate(thisMonday.getDate() - 7 + (targetDay === 0 ? 6 : targetDay - 1));
        } else {
          // 這週：直接加目標星期的偏移量
          resultDate.setDate(thisMonday.getDate() + (targetDay === 0 ? 6 : targetDay - 1));
        }
        return fmt(resultDate);
      }
      return null;
    };

    // --- 1. 日期解析與標準化 (整合版) ---
const today = new Date(local_date);
let targetDate = null;
let queryStartDate = "";
let queryEndDate = fmt(today);
let analysisMode = "range";

// 保留你原有的各種匹配邏輯
const weekdayDate = getSpecificDate(prompt, today);
const absMatch = prompt.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
const monthMatch = prompt.match(/(?:(\d{4})年)?(\d{1,2})月/);

if (weekdayDate) {
  targetDate = weekdayDate;
  analysisMode = "single";
} else if (absMatch) {
  targetDate = `${absMatch[1]}-${absMatch[2].padStart(2, '0')}-${absMatch[3].padStart(2, '0')}`;
  analysisMode = "single";
} else if (monthMatch) {
  analysisMode = "compare";
  const year = monthMatch[1] ? parseInt(monthMatch[1]) : today.getFullYear();
  const month = parseInt(monthMatch[2]);
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);      
  queryStartDate = fmt(firstDay);
  queryEndDate = fmt(lastDay);
} else if (prompt.includes("大前天")) {
  // 【新增】大前天的邏輯
  const ddby = new Date(today);
  ddby.setDate(today.getDate() - 3);
  targetDate = fmt(ddby);
  analysisMode = "single";
} else if (prompt.includes("前天")) {
  // 【新增】前天的邏輯
  const dby = new Date(today);
  dby.setDate(today.getDate() - 2);
  targetDate = fmt(dby);
  analysisMode = "single";
} else if (prompt.includes("昨天") || prompt.includes("昨晚")) {
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  targetDate = fmt(yesterday);
  analysisMode = "single";
} else if (prompt.includes("今天") || prompt.includes("最新")) {
  targetDate = fmt(today);
  analysisMode = "single";
} else if (prompt.includes("本週") || prompt.includes("上週")) {
  analysisMode = "compare";
  const currentDay = today.getDay() === 0 ? 7 : today.getDay();
  const thisMon = new Date(today);
  thisMon.setDate(today.getDate() - (currentDay - 1));
  if (prompt.includes("上週")) {
    const lastMon = new Date(thisMon);
    lastMon.setDate(lastMon.getDate() - 7);
    const lastSun = new Date(thisMon);
    lastSun.setDate(thisMon.getDate() - 1);
    queryStartDate = fmt(lastMon);
    queryEndDate = fmt(lastSun);
  } else {
    queryStartDate = fmt(thisMon);
    queryEndDate = fmt(today); // 補上結束日期為今天
  }
} else if (prompt.includes("上個月") || prompt.includes("這個月")) {
  analysisMode = "compare";
  if (prompt.includes("上個月")) {
    const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    queryStartDate = fmt(firstDayLastMonth);
    queryEndDate = fmt(lastDayLastMonth);
  } else {
    const firstDayThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    queryStartDate = fmt(firstDayThisMonth);
    queryEndDate = fmt(today); // 補上結束日期為今天
  }
} else {
  const defaultStart = new Date(today);
  defaultStart.setDate(today.getDate() - 14);
  queryStartDate = fmt(defaultStart);
  queryEndDate = fmt(today);
}

// --- 重要修正：針對單日查詢擴充 API 搜尋範圍 ---
// 這樣做是為了確保能撈到 record_date (入睡) 與 record_end (起床) 跨天的資料
if (analysisMode === "single" && targetDate) {
    const d = new Date(targetDate);
    const start = new Date(d); 
    start.setDate(d.getDate() - 2); // 往前多抓兩天
    const end = new Date(d); 
    end.setDate(d.getDate() + 1);   // 往後多抓一天
    queryStartDate = fmt(start);
    queryEndDate = fmt(end);
}
// --- 2. 執行地端資料讀取 【修改：帶入參數以節省 ngrok 流量】 ---
const protocol = req.headers['x-forwarded-proto'] || 'http';
const host = req.headers['host'];

// 將篩選條件串接在 URL 後面
const queryParams = new URLSearchParams({
    serial: serial_number,
    start: queryStartDate,
    end: queryEndDate
}).toString();

const healthApiUrl = `${protocol}://${host}/api/health?${queryParams}`;

let dataList = [];
try {
    const response = await fetch(healthApiUrl);
    if (!response.ok) throw new Error("地端連線失敗");
    
    // 現在拿到的直接就是該使用者、該區間的資料了，不需要再 filter 一次
    dataList = await response.json();

    // 雖然地端可能排過序，但為了保險，雲端這邊可以再排一次
    dataList.sort((a, b) => new Date(b.record_date) - new Date(a.record_date));
} catch (err) {
    console.error("讀取失敗:", err);
}

    // --- 2.5 判斷查詢類型 (加入智慧歷史意圖推斷) ---
    // 1. 先定義各類別的專屬關鍵字
    const recoveryKeywords = ["恢復", "發炎", "指數", "燈"];
    const overallKeywords = ["整體", "綜合", "狀況"];

// 建議將你列出的所有細節詞彙都加入
    const sleepKeywords = [
        "睡眠", "深睡", "N3", "淺睡", "快速動眼", "REM", 
        "血氧", "SpO2", "T90", "T89", "T88", "低血氧",
        "HBI", "負擔指數", "ODI", "下降指數",
        "呼吸", "脈搏", "心率", "SDNN", "rMSSD", "LF", "HF", "pNN50", "變異度"
    ];

    // 2. 檢查「當前這句話 (prompt)」是否包含這些關鍵字
    const promptHasRecovery = recoveryKeywords.some(kw => prompt.includes(kw));
    const promptHasOverall = overallKeywords.some(kw => prompt.includes(kw));
    const promptHasSleep = sleepKeywords.some(kw => prompt.includes(kw));

    let isRecoveryQuery = false;
    let isOverallQuery = false;

    // 3. 核心判斷邏輯
    if (promptHasRecovery || promptHasOverall || promptHasSleep) {
        // 情境 A：當前問題有明確指定要問什麼（例如：「昨天的睡眠分析」）
        // 那就直接以當前問題的意圖為主，完全不看歷史紀錄，避免交叉汙染！
        isRecoveryQuery = promptHasRecovery;
        isOverallQuery = promptHasOverall;
    } else {
        // 情境 B：當前問題沒有明確指標（例如：「昨天呢？」、「那5/3號的？」）
        // 這時候才去抓歷史紀錄，繼承上一輪的查詢意圖
        const lastUserHistory = history.filter(h => h.role === "user").pop();
        const lastUserText = lastUserHistory && lastUserHistory.parts ? lastUserHistory.parts[0].text : "";

        isRecoveryQuery = recoveryKeywords.some(kw => lastUserText.includes(kw));
        isOverallQuery = overallKeywords.some(kw => lastUserText.includes(kw));
    }

    // --- 3. 單日查詢補償與精準匹配邏輯 ---
    let finalContextData = dataList;
    let dataStatusNotice = "";

    if (analysisMode === "single" && targetDate) {
      let match = null;
      if (isRecoveryQuery || isOverallQuery) {
          match = dataList.find(d => d.raw_json?.record_end?.startsWith(targetDate));
      } else {
          match = dataList.find(d => d.record_date === targetDate);
      }

      if (match) {
          finalContextData = [match];
      } else if (dataList.length > 0) {
          // 修改排序邏輯：如果問恢復，就用 record_end 找最近；如果問睡眠，用 record_date 找最近
          if (isRecoveryQuery || isOverallQuery) {
              dataList.sort((a, b) => Math.abs(new Date(a.raw_json?.record_end || a.record_date) - new Date(targetDate)) - Math.abs(new Date(b.raw_json?.record_end || b.record_date) - new Date(targetDate)));
          } else {
              dataList.sort((a, b) => Math.abs(new Date(a.record_date) - new Date(targetDate)) - Math.abs(new Date(b.record_date) - new Date(targetDate)));
          }
          
const nearest = dataList[0];
          finalContextData = [nearest];
          
          // 根據查詢類型，取得原始帶時間的日期
          const rawShowDate = (isRecoveryQuery || isOverallQuery) 
                           ? (nearest.raw_json?.record_end || nearest.record_date) 
                           : nearest.record_date;
                           
          // 【整合在這裡】切除時分秒，只保留 YYYY-MM-DD
          const cleanShowDate = rawShowDate ? rawShowDate.split(' ')[0] : "";
                           
          dataStatusNotice = `⚠️ 你查詢的 ${targetDate} 沒有數據，我為你找到最接近的紀錄是 ${cleanShowDate}。`;
      } else {
          finalContextData = [];
          dataStatusNotice = `⚠️ 資料庫中完全找不到 ${targetDate} 附近的數據。`;
      }
    }

    // --- 4. 格式化 Context ---
    let healthContext = "目前沒有相關數據。";
    if (finalContextData.length > 0) {
      healthContext = finalContextData.map(item => {
        const raw = item.raw_json || {};
        const tst = raw.TST_min || 0;
        const trt = raw.TRT_min || 0;

        // 【新增/修改】抓取分鐘數據並換算時分格式
        const n3Min = raw.N3_min || 0;
        const n1n2Min = raw.N1N2_min || 0;
        const remMin = raw.REM_min || 0;
        
        const n3Time = `${Math.floor(n3Min / 60)}時${n3Min % 60}分`;
        const n1n2Time = `${Math.floor(n1n2Min / 60)}時${n1n2Min % 60}分`;
        const remTime = `${Math.floor(remMin / 60)}時${remMin % 60}分`;

        // 【修改這裡】精準判斷恢復指數與發炎風險是否缺乏
        const battery = raw.Personal_Battery_weighted_round;
        const light = raw.light_status;
        const batteryDisplay = (battery === null || battery === undefined) ? "資料不足" : `${battery}%`;
        const lightDisplay = (light === null || light === undefined || light === "無資料") ? "資料不足" : light;

        return `
[數據紀錄 - 唯一參考標準]
- 【起床當日結果】：${raw.record_end || "無"} 的恢復與發炎
- 恢復指數: ${batteryDisplay}
- 發炎風險: ${lightDisplay}
- 【前一晚睡眠成因】：${item.record_date} 晚上的睡眠細節
- 總睡眠時間: ${Math.floor(tst / 60)}時${tst % 60}分
- 總紀錄時間: ${Math.floor(trt / 60)}時${trt % 60}分
- 睡眠效率: ${raw.sleep_efficiency_pct || 0}%
- 睡眠結構: 深睡期 (N3) ${raw.N3_pct || 0}% (${n3Time}), 淺睡期 (N1、N2) ${raw.N1N2_pct || 0}% (${n1n2Time}), 快速動眼期 (REM) ${raw.REM_pct || 0}% (${remTime}), 醒來及清醒期 (Wake) ${raw.wake_minutes || 0}分
- 睡眠血氧飽和度: 平均 ${raw.SpO2_mean || 0}% / 最高 ${raw.SpO2_max || 0}% / 最低 ${raw.SpO2_min || 0}%
- 睡眠低血氧時間比例: T90 ${raw.T90_pct || 0}%, T89 ${raw.T89_pct || 0}%, T88 ${raw.T88_pct || 0}%
- 低氧負擔指數: HBI低氧負擔指數 ${raw.HBI || 0}%min/h
- 睡眠血氧下降指數: ODI 3% ${raw.ODI3_total || 0}次/h, ODI 4% ${raw.ODI4_total || 0}次/h
- 睡眠呼吸頻率: 平均 ${raw.RR_mean || 0} / 最高 ${raw.RR_max || 0} / 最低 ${raw.RR_min || 0} rpm
- 睡眠脈搏: 平均 ${raw.HR_mean || 0} / 最高 ${raw.HR_max || 0} / 最低 ${raw.HR_min || 0} bpm
- 心率變異度: SDNN ${raw.SDNN || 0}ms, rMSSD ${raw.rMSSD || 0}ms, LF ${raw.LF_ms2 || 0}ms2, HF ${raw.HF_ms2 || 0}ms2, LF/HF ${raw.LF_HF || 0}, pNN50 ${raw.pNN50_pct || 0}%`;
      }).join('\n');
    }

    const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
    const weekDaysInfo = [];
    for (let i = 0; i < 10; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        weekDaysInfo.push(`${fmt(d)} (星期${dayNames[d.getDay()]})`);
    }

// 1. 確保最新數據是篩選後的首筆
const latestData = finalContextData.length > 0 ? (finalContextData[0].raw_json || {}) : {};
const latestRecordDate = finalContextData.length > 0 ? finalContextData[0].record_date : "";
const latestRecordEnd = (latestData.record_end || "").split(' ')[0] || "";

// 2. 判斷壓力狀態：紅/黃燈，或恢復指數 < 60
const batteryValue = latestData.Personal_Battery_weighted_round;
const isStressed = (
  latestData.light_status === "紅燈" || 
  latestData.light_status === "黃燈" || 
  (batteryValue !== null && batteryValue !== undefined && batteryValue < 60)
);

// 3. 額外判斷：只有在詢問「今天」或「最新」時，才觸發現在的生理自覺問句
const isAskingNow = prompt.includes("今天") || prompt.includes("最新") || !targetDate;

const sensoryTask = (isStressed && isAskingNow) 
  ? `\n【生理自覺任務】\n目前數據顯示壓力較大 ⚠️。請在回覆最後關心他：『你現在會覺得頭痛、心跳很快，或是有其他不舒服嗎？』並強調這對優化你的健康模型精準度很重要喔！🌟` 
  : "";

    // 【新增】強制注入警告提示的指令
const noticeInstruction = dataStatusNotice 
  ? `\n【系統強制要求】
1. 由於目前回覆的是無數據時的補償紀錄，分析本文中【絕對嚴禁】使用「昨晚」、「昨天」、「今天」、「今晚」、「前一晚」等詞彙！
2. 提到睡眠時請使用「${latestRecordDate} 的睡眠」。
3. 提到恢復或發炎時，必須強調是睡眠後的隔天，請使用「隔天 ${latestRecordEnd} 的起床恢復」，讓日期資訊完全精確。` 
  : "";

// --- 【新增】對話紀錄清洗邏輯，防止上下文汙染 ---
const cleanedHistory = history.map(h => {
    let text = h.parts ? h.parts[0].text : "";
    // 除了過濾 ⚠️ 警告，也稍微清理掉歷史中的日期標籤，強迫模型看這一輪的數據
    text = text.replace(/⚠️ 你查詢的.*?[。！]\n*/g, "");
    return `${h.role === "model" ? "助手" : "我"}: ${text.trim()}`;
}).slice(-3).join('\n');

// --- 【新增】將警告直接綁定在最後的 prompt，防止模型幻覺 ---
const finalPrompt = dataStatusNotice 
  ? `${prompt}\n\n(🤖 系統強制指令：因為找不到 ${targetDate} 的資料，你【必須】遵守以下規則：
1. 開頭先說明「找不到 ${targetDate} 的資料，改為分析最近一筆 ${latestRecordDate} 的數據」。
2. 全文【絕對嚴禁】使用昨晚、昨天、今天、前一晚等相對時間詞。
3. 提到睡眠時一律稱呼「${latestRecordDate} 的睡眠」。
4. 提到恢復、發炎或起床狀態時，一律稱呼「隔天 ${latestRecordEnd} 的起床恢復」。)`
  : prompt;

    // --- 5. 組合最終 Prompt ---
    const combinedMessage = `
你是一個線上AI健康夥伴，請只輸出最終回覆內容，不要每次都輸出重複的報告格式。

【數據處理與因果邏輯規範】(AI 必須嚴格遵守)

1. 數據歸屬對應：
   - 【睡眠成因】：【總睡眠時間、總紀錄時間、睡眠效率、睡眠結構 (深睡/淺睡/快速動眼/醒來及清醒期)、睡眠血氧飽和度 (SpO2)、睡眠低血氧時間比例 (T90/T89/T88)、低氧負擔指數 (HBI)、睡眠血氧下降指數 (ODI 3%/ODI 4%)、睡眠呼吸頻率、睡眠脈搏、以及心率變異度 (SDNN/rMSSD/LF/HF/pNN50)】，請看入睡日(record_date)對應的數據[cite: 2]。(例如：問 4/26 睡眠，請找入睡日為 4/26 的紀錄)。
   - 【恢復結果】：包括恢復指數、發炎風險。這些數據請對應起床日(record_end)的數據[cite: 1, 2]。

2. 時間敘述準則 (防止邏輯錯誤)：
   - 提到的日期必須精準：恢復/發炎 -> ${latestRecordEnd}；睡眠細節 -> ${latestRecordDate}。
   - 嚴禁說「隔天的睡眠影響了恢復」。
   - 正確邏輯範本：「你 ${latestRecordDate} 晚上的睡眠狀況，影響了隔天 ${latestRecordEnd} 的恢復結果」。

3. 查詢整體健康時：
   - 請先解讀起床日 (${latestRecordEnd}) 的恢復與發炎狀態。
   - 再利用同一筆紀錄中的入睡日 (${latestRecordDate}) 睡眠細節來說明原因。

4. 特殊情況處理：
   - 若「恢復指數」或「發炎風險」顯示為「資料不足」，請直接回答：「恢復指數與發炎風險需要 7 天的睡眠紀錄才能計算出來喔！請繼續保持佩戴～」嚴禁解讀為 0% 或無資料。

5. 引用規範：
   - 引用數據時，請自然地融入對話，不要使用條列式。

【健康數據分析指南（內部對照）】

1. 核心狀態指標（優先參考）：
   ● 恢復指數：
     - 0%–59%：注意（恢復不足，建議放慢節奏，多休息）
     - 60%–79%：標準（狀態穩定，建議維持正常生活作息）
     - 80%–94%：良好（恢復良好，能量充沛）
     - ≥95%：優秀（狀態極佳，適合挑戰重要任務）

   ● 發炎風險：
     - 綠燈：低風險（穩定）
     - 黃燈：中等風險（輕微發炎或壓力累積，需注意飲食與作息）
     - 紅燈：高風險（發炎或壓力過高，建議就醫或徹底休息）

2. 詳細生理數值標準（細節解讀）：
   - 總睡眠時間：目標 7 小時。
   - 睡眠效率：良好 ≥ 85%, 不佳 ≤ 75%。
   - 睡眠結構：深睡 (N3) 10-20%, 淺睡 (N1、N2) 50-65%, 快速動眼 (REM) 10-25%。
   - 睡眠血氧 (SpO2)：正常應 > 95%。
   - 低血氧比例：T90 ≤ 5%, T89 ≤ 4%, T88 ≤ 3%。
   - 低氧負擔指數 (HBI)：>10 輕度, >30 中度（建議側睡）, >60 重度（建議就醫檢測）。
   - 血氧下降指數 (ODI 3%/4%)：每小時應 < 5 次。
   - 睡眠呼吸頻率：12-25 rpm 為正常範圍。
   - 睡眠脈搏：60-100 bpm 為正常範圍。
   - 心率變異度 (HRV)：SDNN 32-93 ms, rMSSD 19-75 ms, LF 193-1009 ms2, HF 83-3630 ms2, LF/HF 1.1-11.6, pNN50 6-50 %。

【分析原則（動態回覆邏輯）】
1. **模式切換**：
   - **特定提問**：若問題針對特定指標（如：血氧、HBI），直接以自然對話回覆，禁止使用固定標題或報告範本。
   - **區間查詢**：若提問包含月份、上週或長區間，則自動啟用【月份分析規則】。
2. **標準對照**：所有數據描述必須對照【健康數據分析指南】，給予具體評價（如：良好、輕度異常）與 1～2 個對應建議。
3. **時效解讀**：單日查詢聚焦「是否達標」；多日查詢聚焦「趨勢變化（改善或惡化）」。描述變化時可用「稍微變高了」、「比之前好很多」等自然說法取代生硬的比較。

【月份分析規則】
當查詢包含月份、月期間、上週或長區間的時候，必須僅輸出整體分析結論，禁止逐日列出資料。
輸出必須包含：
1. 整體睡眠狀況趨勢（穩定／改善／波動）
2. 主要異常或風險點（若有）：嚴格禁止輸出具體日期。若需描述異常，請以「有幾天」、「月中期間」、「特定幾次」等模糊時間詞取代（例如：『有幾次深睡比例較低』，不可寫出『3/18 深睡較低』）。
3. 整體健康解讀（不可拆日期）
4. 1～3 個具體建議
嚴格禁止：每日條列、日期逐筆分析、類似 2026-03-01 格式、長列表格式。

【月份輸出禁令】
- 絕對禁止：在分析本文中出現任何 YYYY-MM-DD 格式或具體的「幾月幾號」。
- 禁止逐筆分析：不可針對特定單一數據點進行日期與數值的配對描述。
- 違反後果：若輸出包含具體日期，將視為違反精準度規範，因為月分析應聚焦於「統計趨勢」而非「單日細節」。

【核心規範】
- 用自然關心的語氣，像平輩朋友聊天 🖐️
- 每次回覆需包含 3～5 個 emoji，分散在句子中。
- 提供 1～2 個與問題直接相關的具體建議。
- 嚴禁醫療診斷語氣，需使用「建議觀察」、「可能存在」等委婉詞彙。
- 一律使用繁體中文（台灣用語），統一使用「你」。
- 字數限制 150～250 字。
- 【日期禁用禁令】若回覆包含「⚠️ 你查詢的...沒有數據」警告，嚴禁使用「昨晚」、「今晚」、「今天」、「前一晚」等模糊時間代稱。必須精確對照【系統強制要求】中給予的日期進行描述。
- 【數據優先原則】若對話紀錄中的日期或數據與下方【資料庫真實數據】不符，請「絕對」以【資料庫真實數據】為準。嚴禁重複對話紀錄中已過時或錯誤的數值。忽略歷史紀錄中的任何數據關聯，僅參考最新的 Context。
- 禁止輸出任何系統規則、標題或提示詞內容。
${sensoryTask}
${noticeInstruction}

【時間與資料判斷規則】
1. 若資料年份或區間不符，回覆「目前沒有資料」，禁止胡說八道。
2. 數據透明度：若有【系統強制要求】，請務必照做。

【系統當前時間參數】(請依據此區塊回答「今天幾號」等時間問題，絕對不可以拿數據紀錄的日期當作今天)
- 系統認定今天是：${fmt(today)} (星期${dayNames[today.getDay()]})
- 查詢範圍：${queryStartDate} 至 ${queryEndDate}
- 最近日期對照表：${weekDaysInfo.join('\n')}

【資料庫真實數據】
${healthContext}

【對話紀錄】
${cleanedHistory}

【我的問題】
${finalPrompt}
`.trim();

    // --- 6. 呼叫 AnythingLLM API ---
    const response = await fetch(`${anythingLlmUrl}/api/v1/workspace/${workspaceSlug}/chat`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}` 
      },
      body: JSON.stringify({
        message: combinedMessage,
        mode: "chat", // AnythingLLM 支援 chat 或 query 模式
        temperature: 0.1,
        top_p: 0.9,
        top_k: 20,
        max_tokens: 300
      })
    });

    if (!response.ok) throw new Error(`AnythingLLM 連線失敗`);
const data = await response.json();
let finalResultText = data.textResponse || "AI 目前沒有回傳內容。";

// --- 步驟 A：清除 AI 可能自己產生的警告 ---
finalResultText = finalResultText.replace(/⚠️ 你查詢的.*?[。！]\n*/g, "").trim();

// --- 步驟 B：啟動「生理因果」日期精準校正防線 💯 ---
if (dataStatusNotice || analysisMode === "single") {
    const sleepDate = latestRecordDate; // 5/10 (入睡)
    const wakeDate = latestRecordEnd;   // 5/11 (起床/恢復)

    // 1. 先處理 AI 容易搞混的「隔天/之後」
    // 如果「隔天」後面接的是睡眠，那一定是錯的，強制改成「昨晚」或入睡日
    finalResultText = finalResultText.replace(/隔天(的)?(睡眠|數據|總睡眠|TST)/g, `${sleepDate} 的$2`);

    // 2. 強化版正則表達式，增加「隔天」攔截
    const smartTimeRegex = /(昨晚|昨天晚上|前天晚上|昨夜|今天早上|今早|今天起床|前天起床|前天|昨天|今天|隔天)(晚上|的數據|數據|的睡眠|睡眠|恢復|起床)?(\s*[\(（].*?[\)）])?/g;

    finalResultText = finalResultText.replace(smartTimeRegex, (match, p1, p2, p3) => {
        const suffix = p2 || "";
        
        // A. 恢復/發炎/起床 相關 -> 一律對應到【起床日】
        if (/(恢復|發炎|起床|今早|早上)/.test(match)) {
            return `${wakeDate} ${suffix}`;
        }
        
        // B. 睡眠/數據/晚上/隔天(被誤用時) -> 一律對應到【入睡日】
        if (/(睡眠|數據|晚上|昨晚|昨夜|隔天)/.test(match)) {
            return `${sleepDate} ${suffix}`;
        }

        // C. 模糊詞根據模式判斷
        return (isRecoveryQuery || isOverallQuery) ? wakeDate : sleepDate;
    });
}

    // 最後補上補償警告
    if (dataStatusNotice) {
        finalResultText = `${dataStatusNotice}\n\n${finalResultText}`;
    }
}

// 備註：接下來如果你的程式碼下方有用到 resultText 的地方（例如 logTask 存檔 或 res.json），
// 請記得把變數名稱改為 finalResultText

    // ==========================================
    // 【重點修改區】：背景執行存檔 (方案一)
    // ==========================================
    
    // 1. 定義存檔的 Promise，但不使用 await
    const logTask = fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        serial_number: serial_number,
        user_query: prompt,
        ai_response: finalResultText,
        record_date: local_date,
        record_time: local_time,
        ai_model: 'AnythingLLM-Qwen-2.5'
      })
    }).catch(e => console.error("背景存檔錯誤:", e));

    // 2. 關鍵：告訴 Vercel 必須等這個任務跑完才能關掉伺服器環境
    waitUntil(logTask);

    // 3. 立即回傳結果給使用者，這時候 logTask 還在背景跑，使用者不需要等它
    return res.status(200).json({ text: finalResultText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "我的地端大腦稍微斷線了，再試一次看看？ 😅" });
  }
}
