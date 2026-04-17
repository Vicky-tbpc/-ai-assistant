// anything_llm_api_02
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

    // === 【1. 精準日期解析器】 ===
    const todayStr = local_date || new Date().toISOString().split('T')[0];
    const todayObj = new Date(todayStr);
    
    // 嘗試從提問中抓取日期 (支援 4/6, 4月6日, 2026/4/6 等格式)
    const dateRegex = /(\d{4}[\/\-\.])?(\d{1,2})[\/\-\.月](\d{1,2})[日]?/;
    const match = prompt.match(dateRegex);
    let targetDateStr = null;

    if (match) {
      const year = match[1] ? match[1].replace(/[\/\-\.]/g, '') : todayObj.getFullYear();
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      targetDateStr = `${year}-${month}-${day}`;
    }

    // --- 2. 構建動態 Supabase 查詢 ---
    let queryUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&select=record_date,raw_json&order=record_date.desc`;

    if (targetDateStr) {
      // === 修改處：精準抓取詢問日 + 前 7 天 ===
      const tObj = new Date(targetDateStr);
      const startObj = new Date(tObj);
      startObj.setDate(tObj.getDate() - 7); // 往前推 7 天
      
      const startDate = startObj.toISOString().split('T')[0];
      const endDate = targetDateStr; // 結束日就是使用者問的那天
      
      // 確保 queryUrl 包含這 8 天的範圍
      queryUrl += `&record_date=gte.${startDate}&record_date=lte.${endDate}`;
      
    } else if (prompt.includes("去年")) {
    
      const lastYear = todayObj.getFullYear() - 1;
      queryUrl += `&record_date=gte.${lastYear}-01-01&record_date=lte.${lastYear}-12-31`;
    } else if (prompt.includes("上個月")) {
      const firstDay = new Date(todayObj.getFullYear(), todayObj.getMonth() - 1, 1).toISOString().split('T')[0];
      const lastDay = new Date(todayObj.getFullYear(), todayObj.getMonth(), 0).toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${firstDay}&record_date=lte.${lastDay}`;
    } else if (prompt.includes("月")) {
      const thirtyDaysAgo = new Date(new Date(todayObj).setDate(todayObj.getDate() - 30)).toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${thirtyDaysAgo}`;
    } else {
      // 預設擴大到 14 天，避免「昨天」或「前幾天」的資料漏掉
      const fourteenDaysAgo = new Date(new Date(todayObj).setDate(todayObj.getDate() - 14)).toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${fourteenDaysAgo}&record_date=lte.${todayStr}`;
    }

    // --- 3. 執行資料庫讀取 ---
    const sbRes = await fetch(queryUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const dataList = await sbRes.json();

    // --- 4. 數據檢查與狀態通知 ---
    const latestRecordDate = dataList.length > 0 ? dataList[0].record_date : null;
    
    // 如果有目標日期，檢查它是否存在
    const hasTargetData = targetDateStr ? dataList.some(item => item.record_date === targetDateStr) : true;
    
    let dataStatusNotice = "";
    if (targetDateStr && !hasTargetData) {
      dataStatusNotice = `⚠️【緊急通知】：使用者詢問的是 ${targetDateStr}，但資料庫中「完全沒有」這一天的數據。請直接告訴他你找不到這一天的紀錄，目前最新的是 ${latestRecordDate || '無數據'}。絕對不能用其他日期的數據來代替！`;
    }

    // --- 5. 格式化 Context ---
    let healthContext = "找不到相關健康數據。";
    if (dataList && dataList.length > 0) {
      healthContext = dataList.map(item => {
        const raw = item.raw_json || {};
        const tst = raw.TST_min || 0;
        return `[日期:${item.record_date}] 睡眠:${Math.floor(tst / 60)}時${tst % 60}分, 深睡:${raw.N3_pct || 0}%, 效率:${raw.sleep_efficiency_pct || 0}%, rMSSD:${Math.round(raw.rMSSD || 0)}ms, HBI:${Math.round(raw.HBI || 0)}%min/h, 平均脈搏:${Math.round(raw.HR_mean || 0)}bpm, 血氧:${Math.round(raw.SpO2_mean || 0)}%, ODI3:${Math.round(raw.ODI3_total || 0)}次/h`;
      }).join('\n');
    }

    // --- 6. 組合訊息給 AnythingLLM ---
    const formattedHistory = history.map(h => `${h.role === "model" ? "助手" : "使用者"}: ${h.parts[0].text}`).join('\n');

    const combinedMessage = `
# 核心規範
1. 你是專業睡眠助手，語氣親切，不用「您」。
2. 日期校對：${dataStatusNotice}
3. **計算規則**：若使用者詢問特定日期（如 ${targetDateStr || '今天'}），請使用該日之前的 7 筆數據計算平均值作為基準，並與詢問日當天的數據進行對比。 📈
4. 每則回覆 3-5 個 Emoji。 😴✨

# 基礎資訊
- 今天日期：${todayStr}
- 詢問目標日期：${targetDateStr || todayStr}

# 資料庫真實數據（已包含目標日與前 7 天數據）
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

    // --- 8. 存檔 ---
    fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
      method: 'POST',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serial_number, user_query: prompt, ai_response: resultText,
        record_date: local_date, record_time: local_time, ai_model: 'AnythingLLM-Qwen-2.5'
      })
    }).catch(e => console.error(e));

    res.status(200).json({ text: resultText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "我的大腦接線生好像休假了，再試一次？ 😅" });
  }
}
