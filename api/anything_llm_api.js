// anything_llm_api_04
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, serial_number, record_date, history = [], local_date, local_time } = req.body;

    const anythingLlmUrl = process.env.ANYTHING_LLM_URL;
    const apiKey = process.env.ANYTHING_LLM_KEY;
    const workspaceSlug = process.env.ANYTHING_LLM_WORKSPACE || "tbpc_medical_ref_database";
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!anythingLlmUrl) return res.status(500).json({ text: "伺服器錯誤：找不到 AnythingLLM 網址" });

    // === 【1. 日期與區間偵測】 ===
    const todayStr = local_date || new Date().toISOString().split('T')[0];
    const todayObj = new Date(todayStr);
    
    const dateRegex = /(\d{4}[\/\-\.])?(\d{1,2})[\/\-\.月](\d{1,2})[日]?/g;
    const matches = [...prompt.matchAll(dateRegex)];
    let dateFilters = [];
    let targetDateStr = null;

    if (matches.length > 0) {
      const firstMatch = matches[0];
      const year = firstMatch[1] ? firstMatch[1].replace(/[\/\-\.]/g, '') : todayObj.getFullYear();
      const month = firstMatch[2].padStart(2, '0');
      const day = firstMatch[3].padStart(2, '0');
      targetDateStr = `${year}-${month}-${day}`;
      
      matches.forEach(m => {
        const y = m[1] ? m[1].replace(/[\/\-\.]/g, '') : todayObj.getFullYear();
        const mon = m[2].padStart(2, '0');
        const d = m[3].padStart(2, '0');
        const tStr = `${y}-${mon}-${d}`;
        const tObj = new Date(tStr);
        const sObj = new Date(tObj);
        sObj.setDate(tObj.getDate() - 7);
        dateFilters.push(`and(record_date.gte.${sObj.toISOString().split('T')[0]},record_date.lte.${tStr})`);
      });
    }

    if (prompt.includes("去年")) {
      const lastYear = todayObj.getFullYear() - 1;
      dateFilters.push(`and(record_date.gte.${lastYear}-01-01,record_date.lte.${lastYear}-12-31)`);
    }
    if (prompt.includes("上個月")) {
      const firstDay = new Date(todayObj.getFullYear(), todayObj.getMonth() - 1, 1).toISOString().split('T')[0];
      const lastDay = new Date(todayObj.getFullYear(), todayObj.getMonth(), 0).toISOString().split('T')[0];
      dateFilters.push(`and(record_date.gte.${firstDay},record_date.lte.${lastDay})`);
    }

    if (dateFilters.length === 0 || prompt.includes("最近") || prompt.includes("本月")) {
      const thirtyDaysAgo = new Date(new Date(todayObj).setDate(todayObj.getDate() - 30)).toISOString().split('T')[0];
      dateFilters.push(`and(record_date.gte.${thirtyDaysAgo},record_date.lte.${todayStr})`);
    }

    // --- 2. 執行 Supabase OR 查詢 ---
    const filterQuery = `or(${dateFilters.join(',')})`;
    // 加入 encodeURIComponent 確保特殊符號在網址中安全傳遞
    const queryUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&select=record_date,raw_json&record_date=${encodeURIComponent(filterQuery)}&order=record_date.desc`;

    const sbRes = await fetch(queryUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const dataList = await sbRes.json();

    // --- 3. 數據校對與狀態 ---
    const hasTargetData = targetDateStr ? dataList.some(item => item.record_date === targetDateStr) : true;
    const latestDateInDb = (dataList && dataList.length > 0) ? dataList[0].record_date : "無數據";
    
    let dataStatusNotice = "";
    if (targetDateStr && !hasTargetData) {
      dataStatusNotice = `⚠️【數據警報】：你正在詢問 ${targetDateStr}，但資料庫中沒有這天的紀錄。請老實告知，並提到目前最新數據日期為 ${latestDateInDb}。`;
    }    

    // --- 4. 格式化 Context ---
    let healthContext = "找不到相關健康數據。";
    if (dataList && dataList.length > 0) {
      healthContext = dataList.map(item => {
        const raw = item.raw_json || {};
        const tst = Number(raw.TST_min) || 0; // 確保是數字
        
        return `
[數據日期: ${item.record_date}]
- 睡眠時長: ${Math.floor(tst / 60)}時${tst % 60}分
- 睡眠階段: N3深睡 ${raw.N3_pct || 0}%, 淺睡 ${raw.N1N2_pct || 0}%, REM ${raw.REM_pct || 0}%
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

    const formattedHistory = history.map(h => `${h.role === "model" ? "助手" : "使用者"}: ${h.parts[0].text}`).join('\n');

    const combinedMessage = `
# 核心規範
1. 你是專業睡眠助手，語氣親切，不用「您」。
2. 日期校對：${dataStatusNotice}
3. **計算規則**：若使用者詢問特定日期（如 ${targetDateStr || '今天'}），請使用該日之前的 7 筆數據計算平均值作為基準，並與詢問日當天的數據進行對比。 📈
4. **跨時段對比任務**：若數據中包含多個時段（如去年 vs 今年），請計算各時段的平均表現，並分析使用者的健康趨勢（進步或退步）。
5. 每則回覆 3-5 個 Emoji。

# 基礎資訊
- 今天日期：${todayStr}
- 詢問目標日期：${targetDateStr || todayStr}

# 資料庫真實數據
${healthContext}

# 對話歷史
${formattedHistory}

# 使用者問題
${prompt}
`.trim();

    // --- 7. API 呼叫 ---
    const response = await fetch(`${anythingLlmUrl}/api/v1/workspace/${workspaceSlug}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ message: combinedMessage, mode: "chat" })
    });

    const data = await response.json();
    const resultText = data.textResponse || "AI 沒有回覆內容。";

    // --- 8. 存檔 (加上 await 確保存檔完成) ---
    try {
      await fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
        method: 'POST',
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serial_number, user_query: prompt, ai_response: resultText,
          record_date: local_date, record_time: local_time, ai_model: 'AnythingLLM-Qwen-2.5'
        })
      });
    } catch (logError) {
      console.error("Log 存檔失敗:", logError);
    }

    res.status(200).json({ text: resultText });

  } catch (error) {
    console.error("主要錯誤:", error);
    res.status(500).json({ text: "我的大腦接線生好像休假了，再試一次？ 😅" });
  }
}
