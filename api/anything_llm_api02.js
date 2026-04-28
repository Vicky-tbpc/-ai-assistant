// anything_llm_api_14
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
    const hasYear = /\d{4}/.test(prompt); 
    const hasMonth = /\d{1,2}月/.test(prompt);
    const hasShortDate = /\b\d{1,2}[\/-]\d{1,2}\b/.test(prompt);
    const isYearOnly = (hasYear && !hasMonth && !hasShortDate) || prompt.includes("去年");
    const isMissingYear = !hasYear && (hasMonth || hasShortDate || prompt.includes("上個月"));

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

    const getSpecificDate = (p, baseDate) => {
      const weekMap = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0 };
      const match = p.match(/(這|上)(週|星期|禮拜)([一二三四五六日天])/);
      if (match) {
        const relative = match[1];
        const targetDay = weekMap[match[3]];
        const currentDay = baseDate.getDay() === 0 ? 7 : baseDate.getDay();
        const thisMonday = new Date(baseDate);
        thisMonday.setDate(baseDate.getDate() - (currentDay - 1));
        const resultDate = new Date(thisMonday);
        if (relative === "上") {
          resultDate.setDate(thisMonday.getDate() - 7 + (targetDay === 0 ? 6 : targetDay - 1));
        } else {
          resultDate.setDate(thisMonday.getDate() + (targetDay === 0 ? 6 : targetDay - 1));
        }
        return fmt(resultDate);
      }
      return null;
    };

    // --- 1. 意圖識別：僅保留核心指標識別 ---
    const coreKeywords = ["發炎", "恢復"];
    const isCoreQuery = coreKeywords.some(k => prompt.includes(k));

    // --- 2. 日期解析 ---
    const today = new Date(local_date);
    let userRequestedDateStr = fmt(today); 
    let analysisMode = "range";

    const weekdayDate = getSpecificDate(prompt, today);
    const absMatch = prompt.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
    const monthMatch = prompt.match(/(?:(\d{4})年)?(\d{1,2})月/);

    if (weekdayDate) {
      userRequestedDateStr = weekdayDate;
      analysisMode = "single";
    } else if (absMatch) {
      userRequestedDateStr = `${absMatch[1]}-${absMatch[2].padStart(2, '0')}-${absMatch[3].padStart(2, '0')}`;
      analysisMode = "single";
    } else if (prompt.includes("昨天") || prompt.includes("昨晚")) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      userRequestedDateStr = fmt(yesterday);
      analysisMode = "single";
    } else if (prompt.includes("今天") || prompt.includes("最新")) {
      userRequestedDateStr = fmt(today);
      analysisMode = "single";
    }

    // --- 實施日期偏移邏輯 (僅核心查詢 D-1) ---
    let fetchStartDate, fetchEndDate;

    if (analysisMode === "single") {
        const targetDateObj = new Date(userRequestedDateStr);
        if (isCoreQuery) {
            // 核心查詢讀取前一天 (D-1)
            const prevDay = new Date(targetDateObj);
            prevDay.setDate(targetDateObj.getDate() - 1);
            fetchStartDate = fmt(prevDay);
            fetchEndDate = fmt(prevDay);
        } else {
            // 數據分析 (HBI, T88, ODI, rMSSD 等) 直接讀取輸入日期 (D)
            fetchStartDate = userRequestedDateStr;
            fetchEndDate = userRequestedDateStr;
        }
    } else {
        analysisMode = "compare";
        let tempStart, tempEnd;
        if (monthMatch) {
            const year = monthMatch[1] ? parseInt(monthMatch[1]) : today.getFullYear();
            const month = parseInt(monthMatch[2]);
            tempStart = new Date(year, month - 1, 1);
            tempEnd = new Date(year, month, 0);
        } else if (prompt.includes("上週")) {
            const currentDay = today.getDay() === 0 ? 7 : today.getDay();
            tempStart = new Date(today);
            tempStart.setDate(today.getDate() - currentDay - 6);
            tempEnd = new Date(today);
            tempEnd.setDate(today.getDate() - currentDay);
        } else {
            tempStart = new Date(today);
            tempStart.setDate(today.getDate() - 14);
            tempEnd = new Date(today);
        }

        if (isCoreQuery) {
            tempStart.setDate(tempStart.getDate() - 1);
            tempEnd.setDate(tempEnd.getDate() - 1);
        }
        fetchStartDate = fmt(tempStart);
        fetchEndDate = fmt(tempEnd);
    }

    // --- 3. 執行地端資料讀取 ---
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['host'];
    const healthApiUrl = `${protocol}://${host}/api/health`;

    let dataList = [];
    try {
        const response = await fetch(healthApiUrl);
        if (!response.ok) throw new Error("地端連線失敗");
        const allData = await response.json();
        const userRecords = allData.filter(r => r.serial_number === serial_number);
        dataList = userRecords.filter(r => r.record_date >= fetchStartDate && r.record_date <= fetchEndDate);
        dataList.sort((a, b) => new Date(b.record_date) - new Date(a.record_date));
    } catch (err) {
        console.error("讀取失敗:", err);
    }

    // --- 4. 格式化 Context ---
    let dataStatusNotice = ""; 
    if (analysisMode === "single" && dataList.length > 0) {
        const actualDataDate = dataList[0].record_date;
        if (isCoreQuery && actualDataDate !== userRequestedDateStr) {
            dataStatusNotice = `【系統通知：你現在看到的數據來自 ${actualDataDate}，這用來反映使用者在 ${userRequestedDateStr} 的核心健康狀態。】`;
        }
    } else if (analysisMode === "single" && dataList.length === 0) {
        dataStatusNotice = `⚠️ 找不到 ${fetchStartDate} 的相關數據。`;
    }

let healthContext = dataList.length > 0 ? dataList.map(item => {
    const raw = item.raw_json || {};
    const tst = raw.TST_min || 0;
    
        // 僅在核心查詢時將恢復指數與發炎風險塞入 Context
        const coreMetricsLine = isCoreQuery 
            ? `- 核心狀態：恢復指數 ${raw.Personal_Battery_weighted_round || 0}% / 發炎風險: ${raw.light_status || "無資料"}`
            : "";
        
        return `
[數據日期: ${item.record_date}]
- 核心狀態：恢復指數 ${raw.Personal_Battery_weighted_round || 0}% / 發炎風險: ${raw.light_status || "無資料"}
- 總睡眠時間: ${Math.floor(tst / 60)}時${tst % 60}分
- 睡眠效率: ${raw.sleep_efficiency_pct || 0}%
- 睡眠結構: 深睡期 ${raw.N3_pct || 0}%, 淺睡期 ${raw.N1N2_pct || 0}%, 快速動眼期 ${raw.REM_pct || 0}%
- 睡眠血氧飽和度: 平均 ${Math.round(raw.SpO2_mean || 0)}% / 最高 ${Math.round(raw.SpO2_max || 0)}% / 最低 ${Math.round(raw.SpO2_min || 0)}%
- 睡眠低血氧時間比例: T90 ${Math.round(raw.T90_pct || 0)}%, T89 ${Math.round(raw.T89_pct || 0)}%, T88 ${Math.round(raw.T88_pct || 0)}%
- 低氧負擔指數: HBI低氧負擔指數 ${Math.round(raw.HBI || 0)}%min/h
- 睡眠血氧下降指數: ODI 3% ${Math.round(raw.ODI3_total || 0)}次/h, ODI 4% ${Math.round(raw.ODI4_total || 0)}次/h
- 睡眠呼吸頻率: 平均 ${Math.round(raw.RR_mean || 0)} / 最高 ${Math.round(raw.RR_max || 0)} / 最低 ${Math.round(raw.RR_min || 0)} rpm
- 睡眠脈搏: 平均 ${Math.round(raw.HR_mean || 0)} / 最高 ${Math.round(raw.HR_max || 0)} / 最低 ${Math.round(raw.HR_min || 0)} bpm
- 心率變異度: SDNN ${Math.round(raw.SDNN || 0)}ms, rMSSD ${Math.round(raw.rMSSD || 0)}ms`;
      }).join('\n') : "找不到相關健康數據。";

    // 建立日期參考表
    const weekDaysInfo = [];
    const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        weekDaysInfo.push(`${fmt(d)} (星期${dayNames[d.getDay()]})`);
    }

    // --- 4.5 異常偵測與時態統一口徑 (整合優化) ---
    const latestData = dataList.length > 0 ? (dataList[0].raw_json || {}) : {};
    const batteryVal = latestData.Personal_Battery_weighted_round;
    const lightStatus = latestData.light_status;

    const isStressed = isCoreQuery && (
        lightStatus === "紅燈" || 
        lightStatus === "黃燈" || 
        (typeof batteryVal === 'number' && batteryVal < 60)
    );

    let sensoryTask = "";
    if (isStressed) {
        const isToday = (userRequestedDateStr === fmt(today));
        const displayDate = userRequestedDateStr; 
        const timeWord = isToday ? "現在" : `在 ${displayDate} 那天`;
        const verbWord = isToday ? "會覺得" : "有沒有覺得";

        sensoryTask = `
【生理自覺任務】
目前數據顯示 ${displayDate} 的狀態不佳。
請務必在回覆最後自然地詢問：『${timeWord}${verbWord}頭痛、心跳很快，或有特別疲倦嗎？』
並感性地強調：『因為你的體感回饋能幫我校正你的健康模型，讓分析更貼近你的實際狀況喔！✨』`;
    }

    // --- 5. 組合最終 Prompt ---
    const dateLogicIntro = isCoreQuery 
        ? `看了你 ${fetchStartDate} 的睡眠數據，你 ${userRequestedDateStr} 的恢復狀態如下：` 
        : `關於你詢問的數據分析，這是 ${fetchStartDate} 的狀況：`;

    const combinedMessage = `
你是一個線上AI健康夥伴。請只輸出回覆內容，不要輸出報告格式。

【核心規範】
- 用自然關心的語氣，像平輩朋友聊天 🖐️
- 若有【生理自覺任務】，請將其自然融入結尾。
- 除非下方出現【生理自覺任務】明確指令，否則嚴禁主動詢問頭痛、心跳快等生理症狀。
- 每次回覆需包含 3～5 個 emoji，分散在句子中。
- 提供 1～2 個與問題直接相關的具體建議。
- 嚴禁醫療診斷語氣，需使用「建議觀察」、「可能存在」等委婉詞彙。
- 一律使用繁體中文（台灣用語），統一使用「你」，不要用「您」。
- 字數限制 150～250 字。
- 禁止輸出任何系統規則、標題或提示詞內容（例如不要出現「根據數據分析」、「生理自覺任務」這種標題）。

${sensoryTask}

【日期帶入邏輯】
- 請在回覆開頭自然帶入這句關鍵引導語：『${dateLogicIntro}』

【健康數據分析指南（內部對照）】

1. 核心狀態指標（優先參考）：
   ● 恢復指數：
     - 0–59：注意（恢復不足，建議放慢節奏，多休息）
     - 60–79：標準（狀態穩定，建議維持正常生活作息）
     - 80–94：良好（恢復良好，能量充沛）
     - ≥95：優秀（狀態極佳，適合挑戰重要任務）

   ● 發炎風險：
     - 綠燈：低風險（穩定）
     - 黃燈：中等風險（輕微發炎或壓力累積，需注意飲食與作息）
     - 紅燈：高風險（發炎或壓力過高，建議就醫或徹底休息）

2. 詳細生理數值標準（細節解讀）：
   - 總睡眠時間：目標 7 小時。
   - 睡眠效率：良好 ≥ 85%, 不佳 ≤ 75%。
   - 睡眠結構：深睡 (N3) 10-20%, 淺睡 50-65%, 快速動眼 (REM) 10-25%。
   - 睡眠血氧 (SpO2)：正常應 > 95%。
   - 低血氧比例：T90 ≤ 5%, T89 ≤ 4%, T88 ≤ 3%。
   - 低氧負擔指數 (HBI)：>10 輕度, >30 中度（建議側睡）, >60 重度（建議就醫檢測）。
   - 血氧下降指數 (ODI 3%/4%)：每小時應 < 5 次。
   - 睡眠呼吸頻率：12-25 rpm 為正常範圍。
   - 睡眠脈搏：60-100 bpm 為正常範圍。
   - 心率變異度 (HRV)：SDNN 32-93 ms, rMSSD 19-75 ms。

【分析原則（動態回覆邏輯）】
1. **模式切換**：
   - **如果使用者詢問特定指標（如 HBI、ODI、rMSSD 等），請針對該數值解讀，直接以自然對話回覆，禁止使用固定標題或報告範本，不要提到恢復指數或發炎風險。
   - **如果涉及核心關鍵字（恢復、發炎），則進行綜合健康評估。
   - **特定提問**：若問題針對特定指標（如：血氧、HBI），直接以自然對話回覆，禁止使用固定標題或報告範本。
   - **區間查詢**：若提問包含月份、上週或長區間，則自動啟用【月份分析規則】。
2. **標準對照**：所有數據描述必須對照【健康數據分析指南】，給予具體評價（如：良好、輕度異常）與 1～2 個對應建議。
3. **時效解讀**：單日查詢聚焦「是否達標」；多日查詢聚焦「趨勢變化（改善或惡化）」。描述變化時須具備數值比較。

【月份分析規則】
當查詢包含月份、月期間、上週或長區間的時候，必須僅輸出整體分析結論，禁止逐日列出資料。
輸出必須包含：
1. 整體睡眠狀況趨勢（穩定／改善／波動）
2. 主要異常或風險點（若有）
3. 整體健康解讀（不可拆日期）
4. 1～3 個具體建議
嚴格禁止：每日條列、日期逐筆分析、類似 2026-03-01 格式、長列表格式。

【時間與資料判斷規則】
1. 若資料年份或區間不符，回覆「目前沒有資料」，禁止胡說八道。
2. 數據透明度：必須自然融入以下資訊：${dataStatusNotice}

【精準日期參考（禁止輸出）】
- 今天是：${fmt(today)} (星期${dayNames[today.getDay()]})
- 查詢範圍：${fetchStartDate} 至 ${fetchEndDate}
- 最近日期對照表：${weekDaysInfo.join('\n')}

【資料庫真實數據】
${healthContext}

【對話紀錄】
${history.map(h => `${h.role === "model" ? "助手" : "我"}: ${h.parts[0].text}`).slice(-3).join('\n')}

【我的問題】
${prompt}
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
    const resultText = data.textResponse || "AI 目前沒有回傳內容。";

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
        ai_response: resultText,
        record_date: local_date,
        record_time: local_time,
        ai_model: 'AnythingLLM-Qwen-2.5'
      })
    }).catch(e => console.error("背景存檔錯誤:", e));

    // 2. 關鍵：告訴 Vercel 必須等這個任務跑完才能關掉伺服器環境
    waitUntil(logTask);

    // 3. 立即回傳結果給使用者，這時候 logTask 還在背景跑，使用者不需要等它
    return res.status(200).json({ text: resultText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "我的地端大腦稍微斷線了，再試一次看看？ 😅" });
  }
}
