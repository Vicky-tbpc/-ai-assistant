// anything_llm_api_03
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

    // --- 1. 日期解析與標準化 (Rule 1 & 4) ---
    const today = new Date(local_date);
    let targetDate = null;
    let queryStartDate = "";
    let queryEndDate = fmt(today);
    let analysisMode = "range";

    // A. 優先檢查是否為「上週三/這週日」這種格式
    const weekdayDate = getSpecificDate(prompt, today);
    
    // B. 絕對日期匹配 (例如 2026/02/20)
    const absMatch = prompt.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);

    if (weekdayDate) {
      targetDate = weekdayDate;
      queryStartDate = targetDate;
      queryEndDate = targetDate;
      analysisMode = "single";
    } else if (absMatch) {
      targetDate = `${absMatch[1]}-${absMatch[2].padStart(2, '0')}-${absMatch[3].padStart(2, '0')}`;
      queryStartDate = targetDate;
      queryEndDate = targetDate;
      analysisMode = "single";
    } else if (prompt.includes("昨天") || prompt.includes("昨晚")) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      targetDate = fmt(yesterday);
      queryStartDate = targetDate;
      queryEndDate = targetDate;
      analysisMode = "single";
    } else if (prompt.includes("今天") || prompt.includes("最新")) {
      targetDate = fmt(today);
      queryStartDate = targetDate;
      queryEndDate = targetDate;
      analysisMode = "single";
    } else if (prompt.includes("本週") || prompt.includes("上週")) {
      analysisMode = "compare";
      const currentDay = today.getDay() === 0 ? 7 : today.getDay();
      const thisMon = new Date(today);
      thisMon.setDate(today.getDate() - (currentDay - 1));
      const lastMon = new Date(thisMon);
      lastMon.setDate(lastMon.getDate() - 7);
      queryStartDate = fmt(lastMon); 
    } else if (prompt.includes("上個月") || prompt.includes("這個月")) {
      analysisMode = "compare";
      const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      queryStartDate = fmt(firstDayLastMonth);
    } else {
      const defaultStart = new Date(today);
      defaultStart.setDate(today.getDate() - 14);
      queryStartDate = fmt(defaultStart);
    }

    // --- 2. 執行資料庫讀取 ---
    let queryUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&record_date=gte.${queryStartDate}&record_date=lte.${queryEndDate}&select=record_date,raw_json&order=record_date.desc`;
    const sbRes = await fetch(queryUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const dataList = await sbRes.json();

    // --- 3. 單日查詢補償邏輯 (Rule 2) ---
    let finalContextData = dataList;
    let dataStatusNotice = "";

    if (analysisMode === "single" && targetDate) {
      const exactMatch = dataList.find(d => d.record_date === targetDate);
      if (!exactMatch && dataList.length > 0) {
        // 尋找時間差最小的日期
        const sortedByDist = [...dataList].sort((a, b) => {
          const distA = Math.abs(new Date(a.record_date) - new Date(targetDate));
          const distB = Math.abs(new Date(b.record_date) - new Date(targetDate));
          if (distA === distB) return new Date(b.record_date) - new Date(a.record_date); // 優先選較新的
          return distA - distB;
        });
        const nearest = sortedByDist[0];
        dataStatusNotice = `⚠️ 你查詢的 ${targetDate} 沒有數據，我為你找到最接近的日期是 ${nearest.record_date}。`;
        finalContextData = [nearest];
      } else if (!exactMatch && dataList.length === 0) {
        dataStatusNotice = `⚠️ 資料庫中完全找不到 ${targetDate} 附近的數據。`;
        finalContextData = [];
      } else {
        finalContextData = [exactMatch];
      }
    }

    // --- 4. 格式化數據 Context ---
    let healthContext = "找不到相關健康數據。";
    if (dataList && dataList.length > 0) {
      healthContext = dataList.map(item => {
        const raw = item.raw_json || {};
        const tst = raw.TST_min || 0;
        
        // 建議將每個日期的數據包裝得更嚴密
        return `
[數據日期: ${item.record_date}]
- 睡眠時長: ${Math.floor(tst / 60)}時${tst % 60}分
- 睡眠階段: N3深睡 ${raw.N3_pct || 0}%, 淺睡 ${raw.N1N2_pct || 0}%, REM快速動眼 ${raw.REM_pct || 0}%
- 睡眠效率: ${raw.sleep_efficiency_pct || 0}%
- 自律神經: rMSSD放鬆恢復 ${Math.round(raw.rMSSD || 0)}ms
- 呼吸負荷: HBI缺氧負荷 ${Math.round(raw.HBI || 0)}%min/h
- 脈搏數據: 平均 ${Math.round(raw.HR_mean || 0)} / 最高 ${Math.round(raw.HR_max || 0)} / 最低 ${Math.round(raw.HR_min || 0)} bpm
- 血氧數據: 平均 ${Math.round(raw.SpO2_mean || 0)}% / 最高 ${Math.round(raw.SpO2_max || 0)}% / 最低 ${Math.round(raw.SpO2_min || 0)}%
- 呼吸頻率: 平均 ${Math.round(raw.RR_mean || 0)} / 最高 ${Math.round(raw.RR_max || 0)} / 最低 ${Math.round(raw.RR_min || 0)} rpm
- 血氧下降指數: ODI 3% ${Math.round(raw.ODI3_total || 0)}次/h, ODI 4% ${Math.round(raw.ODI4_total || 0)}次/h
- 低血氧時間比例: T90 ${Math.round(raw.T90_pct || 0)}%, T89 ${Math.round(raw.T89_pct || 0)}%, T88 ${Math.round(raw.T88_pct || 0)}%`;
      }).join('\n');
    }

    // --- 【新增】建立日期參考表，防止 AI 算錯星期 ---
    const weekDaysInfo = [];
    const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
    for (let i = 0; i < 10; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        weekDaysInfo.push(`${fmt(d)} (星期${dayNames[d.getDay()]})`);
    }
      
    // --- 5. 組合最終 Prompt ---
    const combinedMessage = `
# 核心規範
1. 語氣：你是平輩好友，用「你」，禁「您」。
2. Emoji：3-5 個。
3. 透明度：${dataStatusNotice} 必須誠實告知。
4. 比較原則：若是跨區間比較，請計算平均值。
5. 字數：150-250 字。

# 精準日期參考 (以這些對照為準)
- 今天是：${fmt(today)} (星期${dayNames[today.getDay()]})
- 查詢範圍：${queryStartDate} 至 ${queryEndDate}
- 最近日期對照表：${weekDaysInfo.join('\n')}

# 資料庫真實數據
${healthContext}

# 對話紀錄
${history.map(h => `${h.role === "model" ? "助手" : "我"}: ${h.parts[0].text}`).slice(-3).join('\n')}

# 我的問題
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
        mode: "chat" // AnythingLLM 支援 chat 或 query 模式
      })
    });

    if (!response.ok) {
      const errorDetail = await response.text();
      throw new Error(`AnythingLLM 連線失敗: ${response.status} - ${errorDetail}`);
    }

    const data = await response.json();
    const resultText = data.textResponse || "AI 目前沒有回傳內容。";

    // --- 6. 同步對話記錄至 Supabase (異步執行) ---
    fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
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
    }).catch(e => console.error("Log 存檔失敗", e));

    res.status(200).json({ text: resultText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "我的地端大腦（Qwen）稍微斷線了，再試一次看看？ 😅" });
  }
}
