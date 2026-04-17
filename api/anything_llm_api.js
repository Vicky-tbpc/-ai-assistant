// anything_llm_api_01
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

    // === 【日期處理】 ===
    const todayStr = local_date || new Date().toISOString().split('T')[0];
    const todayObj = new Date(todayStr);
    const yesterdayObj = new Date(todayObj);
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterdayStr = yesterdayObj.toISOString().split('T')[0];

    // --- 1. 構建 Supabase 查詢 (維持原邏輯) ---
    const baseDate = record_date ? new Date(record_date) : new Date(todayStr);
    let queryUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&select=record_date,raw_json&order=record_date.desc`;

    if (prompt.includes("去年")) {
      const lastYear = baseDate.getFullYear() - 1;
      queryUrl += `&record_date=gte.${lastYear}-01-01&record_date=lte.${lastYear}-12-31`;
    } else if (prompt.includes("上個月")) {
      const firstDayLastMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() - 1, 1).toISOString().split('T')[0];
      const lastDayLastMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 0).toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${firstDayLastMonth}&record_date=lte.${lastDayLastMonth}`;
    } else if (prompt.includes("月")) {
      const thirtyDaysAgo = new Date(new Date(baseDate).setDate(baseDate.getDate() - 30)).toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${thirtyDaysAgo}`;
    } else {
      const sevenDaysAgo = new Date(baseDate);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      queryUrl += `&record_date=gte.${sevenDaysAgo.toISOString().split('T')[0]}&record_date=lte.${baseDate.toISOString().split('T')[0]}`;
    }

    // --- 2. 執行資料庫讀取 ---
    const sbRes = await fetch(queryUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const dataList = await sbRes.json();

    // === 【資料狀態檢查邏輯修正】 ===
    const latestRecordDate = dataList.length > 0 ? dataList[0].record_date : null;
    const hasYesterdayData = dataList.some(item => item.record_date === yesterdayStr);
    const isAskingForRecent = prompt.includes("昨天") || prompt.includes("昨晚") || prompt.includes("最新");

    let dataStatusNotice = "";
    if (isAskingForRecent && !hasYesterdayData) {
        dataStatusNotice = `⚠️【重要提醒】：使用者正在詢問昨天 (${yesterdayStr}) 的紀錄，但資料庫中找不到該日數據。目前最新的紀錄日期是 ${latestRecordDate || '未知'}。請務必誠實告知，不要編造數據。`;
    }

    // --- 3. 格式化數據 Context ---
    let healthContext = "目前資料庫中找不到你的相關健康數據。";
    if (dataList && dataList.length > 0) {
      healthContext = dataList.map(item => {
        const raw = item.raw_json || {};
        const tst = raw.TST_min || 0;
        return `[日期:${item.record_date}] 睡眠:${Math.floor(tst / 60)}時${tst % 60}分, 深睡:${raw.N3_pct || 0}%, 效率:${raw.sleep_efficiency_pct || 0}%, rMSSD:${Math.round(raw.rMSSD || 0)}ms, HBI:${Math.round(raw.HBI || 0)}%min/h, 平均脈搏:${Math.round(raw.HR_mean || 0)}bpm, 血氧:${Math.round(raw.SpO2_mean || 0)}%, ODI3:${Math.round(raw.ODI3_total || 0)}次/h`;
      }).join('\n');
    }

    // --- 4. 準備對話歷史 ---
    const formattedHistory = history.map(h => `${h.role === "model" ? "助手" : "使用者"}: ${h.parts[0].text}`).join('\n');

    // === 【重點：針對 Qwen-2.5 優化的組合訊息】 ===
    // 這裡將 System Prompt 與 Data 融合，確保 AnythingLLM 的地端模型能完整吸收
    const combinedMessage = `
# 角色與任務
你是一位專業且溫暖的睡眠健康夥伴。請根據提供的數據，用「平輩好友」的語氣分析使用者的睡眠。

# 核心規範
1. 嚴禁敬稱：一律用「你」，禁止說「您」。
2. Emoji 要求：每則回覆必須包含 3-5 個 Emoji。
3. 日期準確性：${dataStatusNotice}
4. 直接輸出答案：不要顯示思考過程，不要標題，字數 150-250 字。
5. 數據分析：若數據不足 7 天，請以現有數據計算平均並告知使用者。

# 基礎資訊
- 今天日期：${todayStr}
- 昨天日期：${yesterdayStr}
- 使用者當前時間：${local_time}

# 資料庫真實數據
${healthContext}

# 對話歷史紀錄
${formattedHistory}

# 使用者最新的問題
${prompt}
`.trim();

    // --- 5. 呼叫 AnythingLLM API ---
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
