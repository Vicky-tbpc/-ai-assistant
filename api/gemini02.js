// api/gemini.js 10
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, serial_number, record_date } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // 請確保 Vercel 環境變數名稱正確

    if (!apiKey) return res.status(500).json({ text: "伺服器錯誤：找不到 API Key" });

    // --- 1. 根據 prompt 判斷日期範圍並讀取 Supabase ---
    let healthContext = "";
    let isRangeQuery = prompt.includes("週") || prompt.includes("月") || prompt.includes("最近");
    let queryUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&select=record_date,raw_json`;

    if (isRangeQuery) {
      const days = prompt.includes("月") ? 30 : (prompt.includes("週") ? 7 : 5);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const startDateStr = startDate.toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${startDateStr}&order=record_date.desc`;
    } else {
      queryUrl += `&record_date=eq.${record_date}`;
    }

    const sbRes = await fetch(queryUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const dataList = await sbRes.json();

    // --- 2. 處理無數據情況 ---
    if (!dataList || dataList.length === 0) {
      return res.status(200).json({ text: "這天沒數據喔~ 😅 可能是沒有上傳，或資料尚未同步完成。☁️" });
    }

    // --- 3. 格式化數據給 Gemini (包含 TST 轉換) ---
    healthContext = dataList.map(item => {
      const raw = item.raw_json || {};
      const tst = raw.TST_min || 0;
      const hours = Math.floor(tst / 60);
      const minutes = tst % 60;
      return `日期：${item.record_date}
- 總睡眠時間：${hours}小時${minutes}分鐘
- 深層睡眠比例 (N3)：${raw.N3_pct || 0}%
- 睡眠效率：${raw.sleep_efficiency_pct || 0}%
- 淺睡期 (N1N2)：${raw.N1N2_pct || 0}%
- 快速動眼期 (REM)：${raw.REM_pct || 0}%`;
    }).join('\n\n');

    // --- 4. 呼叫 Gemini ---
    // 修正：模型名稱建議使用 'gemini-1.5-flash' 或 'gemini-2.0-flash'
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ 
            text: `你是一個具備專業醫學知識且親切的健康夥伴。
你是使用者的平輩好朋友，絕對不要使用敬稱『您』，請用『你』。
請務必使用『繁體中文』回覆，適度加上合適的emoji。

【數據參考標準】：
- N3深層睡眠：10%-20% 為標準。
- 睡眠效率：≥ 85% 為良好，≤ 75% 為不佳。
- N1N2淺睡：50%-65% 為標準。
- REM快速動眼：10%-25% 為標準。

【回覆規則】：
1. 根據提供的健康數據進行分析。
2. 節錄重點，長度約 3 到 5 句話。
3. 絕對不要在回覆中輸出 TST_min, N3_pct 等程式代碼。
4. 不要輸出任何內心思考或筆記。
5. 若有多天數據，請總結趨勢。`
          }]
        },
        contents: [{ 
          parts: [{ text: `這是使用者的健康數據：\n${healthContext}\n\n使用者問題：${prompt}` }] 
        }],
        tools: [{ google_search: {} }]
      })
    });

    const geminiData = await geminiRes.json();
    const resultText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "AI 目前沒有回傳內容。";
    res.status(200).json({ text: resultText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "伺服器內部錯誤，請檢查 Vercel Logs。" });
  }
}
