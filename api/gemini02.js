// api/gemini.js 13
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, serial_number, record_date, history = [] } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey) return res.status(500).json({ text: "伺服器錯誤：找不到 API Key" });

   // --- 1. 判斷查詢範圍並構建 Supabase URL ---
    let queryUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&select=record_date,raw_json&order=record_date.desc`;
    
    const now = new Date();
    // 基準日期：優先使用傳入的 record_date，若無則用今天
    const baseDate = record_date ? new Date(record_date) : new Date();

    if (prompt.includes("去年")) {
      const lastYear = now.getFullYear() - 1;
      queryUrl += `&record_date=gte.${lastYear}-01-01&record_date=lte.${lastYear}-12-31`;
    } else if (prompt.includes("上個月")) {
      const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
      const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${firstDayLastMonth}&record_date=lte.${lastDayLastMonth}`;
    } else if (prompt.includes("月")) {
      const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${thirtyDaysAgo}`;
    } else {
      // 【核心改動】：預設抓取目標日期往前推 7 天的資料，Gemini 才能算 7 日平均
      const sevenDaysAgo = new Date(baseDate);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const startDateStr = sevenDaysAgo.toISOString().split('T')[0];
      const endDateStr = baseDate.toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${startDateStr}&record_date=lte.${endDateStr}`;
    }
    // --- 2. 執行資料庫讀取 ---
    const sbRes = await fetch(queryUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const dataList = await sbRes.json();

    // --- 3. 格式化數據 Context ---
    let healthContext = "找不到相關數據。";
    if (dataList && dataList.length > 0) {
      healthContext = dataList.map(item => {
        const raw = item.raw_json || {};
        const tst = raw.TST_min || 0;
        return `日期:${item.record_date}, 
                睡眠時長:${Math.floor(tst/60)}時${tst%60}分, 
                N3深睡:${raw.N3_pct||0}%, 
                效率:${raw.sleep_efficiency_pct||0}%, 
                淺睡:${raw.N1N2_pct||0}%, 
                REM:${raw.REM_pct||0}%,

rMSSD放鬆恢復:${raw.rMSSD||0}ms,
HBI缺氧負荷:${raw.HBI||0}%min/h,
睡眠平均脈搏:${raw.HR_mean||0}bpm,
睡眠最低脈搏:${raw.HR_min||0}bpm




`;
      }).join('\n');
    }

    // --- 4. 呼叫 Gemini API ---
    const contents = [...history, { 
      role: "user", 
      parts: [{ text: `[系統提供數據庫內容]:\n${healthContext}\n\n[使用者當前問題]: ${prompt}` }] 
    }];

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ 
            text: `你是一位具備專業醫學知識且親切的睡眠健康夥伴，請用『你』稱呼對方，嚴禁使用『您』。
                   使用『繁體中文』回覆，適度加上合適的emoji。
            
            
                    【數據參考標準】：
                    - 睡眠時長：建議大於7小時。
                    - N3深睡：10%-20% 為標準。
                    - 效率：≥ 85% 為良好，≤ 75% 為不佳。
                    - 淺睡：50%-65% 為標準。
                    - REM：10%-25% 為標準。
- rMSSD放鬆恢復：個人7日移動平均正負百分之10 為標準。
- HBI缺氧負荷：個人7日移動平均 為標準。
- 睡眠最低脈搏：個人7日移動平均正負5 為標準。
- 睡眠平均脈搏：60-100bpm 為標準。
**動態基準計算**：當 [系統提供數據庫內容] 包含多日數據時，請針對 rMSSD、HBI、睡眠最低脈搏，先行計算過去 7 筆數據的平均值，並將此平均值作為該使用者的「個人標準」來進行比對分析。


           【運作邏輯】：
            1. **計算與對比**：分析最近一筆數據時，請對比你算出的「個人 7 日平均值」。例如：『你今天的 rMSSD 為 45ms，比起你過去一週的平均值稍微低了一點喔。』
            2. **名詞解釋優先**：若問名詞解釋（如：什麼是N3？），直接說明，不需分析數據。
            3. **建議優先**：若問如何改善（如：怎麼睡更好？），提供具體建議，不需分析數據。
            4. **數據分析**：若詢問睡眠狀況/最近表現，請利用 [系統提供數據庫內容] 進行摘要。
               - 若數據有多筆，請觀察趨勢（例如：這週你的深睡比例有下降趨勢喔）。
               - 節錄重點，約 3-5 句話。
            5. **無數據處理**：若數據內容為空，請親切回答：『這段時間沒看到數據喔~ 😅 可能是沒上傳或還沒同步。☁️』
            6. **禁止輸出代碼**：絕對不要在回覆中顯示 TST_min, raw_json, N3_pct 等代碼名稱。`
          }]
        },
        contents: contents
      })
    });

    const geminiData = await geminiRes.json();
    const resultText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "AI 目前沒有回傳內容。";
    
    res.status(200).json({ text: resultText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "系統有點忙碌，等我一下喔！ 😅" });
  }
}
