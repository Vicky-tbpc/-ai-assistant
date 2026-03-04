// api/gemini.js 11
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

    // --- 1. 從 Supabase 抓取資料 (預設抓取，供分析使用) ---
    let healthContext = "目前無數據";
    const queryUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&record_date=eq.${record_date}&select=record_date,raw_json`;
    
    const sbRes = await fetch(queryUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const dataList = await sbRes.json();

    if (dataList && dataList.length > 0) {
      const raw = dataList[0].raw_json || {};
      const tst = raw.TST_min || 0;
      healthContext = `日期：${dataList[0].record_date}
- 睡眠時長：${Math.floor(tst / 60)}小時${tst % 60}分鐘
- N3深睡：${raw.N3_pct || 0}%
- 效率：${raw.sleep_efficiency_pct || 0}%
- 淺睡：${raw.N1N2_pct || 0}%
- REM：${raw.REM_pct || 0}%`;
    }

    // --- 2. 構建 Gemini 請求 ---
    // 將歷史紀錄轉換為 Gemini 的 contents 格式
    // history 格式應為: [{role: "user", parts:[{text: "..."}]}, {role: "model", parts:[{text: "..."}]}]
    const contents = [...history, { role: "user", parts: [{ text: `[目前參考日期：${record_date}]\n[該日健康數據：\n${healthContext}]\n\n使用者問題：${prompt}` }] }];

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ 
            text: `你是一個具備專業醫學知識且親切的健康夥伴。你是使用者的平輩好朋友，絕對不要使用敬稱『您』，請用『你』。
                   請務必使用『繁體中文』回覆，適度加上合適的emoji。


                   【數據參考標準】：
                    - 睡眠時長：建議大於7小時。
                    - N3深睡：10%-20% 為標準。
                    - 效率：≥ 85% 為良好，≤ 75% 為不佳。
                    - 淺睡：50%-65% 為標準。
                    - REM：10%-25% 為標準。


                   【任務邏輯優先順序】：
                   1. 如果使用者詢問的是「名詞解釋」（例如：什麼是REM？N3代表什麼？），請直接專業地解釋該名詞，**不要**輸出數據分析或使用者的個人資料。
                   2. 如果使用者詢問的是「如何改善/提升/調整/優化」（例如：怎麼增加深睡？如何改善效率？），請針對問題提供具體的健康建議，**不要**輸出數據分析。
                   3. 如果使用者詢問的是「睡眠狀況」、「我這天的睡眠」或關於數據的分析，請利用提供的 [健康數據] 進行 3 到 5 句的重點分析。
                   4. 請根據歷史對談內容（History）保持對話流暢度。如果使用者沒提到日期，請預設參考最近一次對話的日期。

                   【限制】：絕對不要在回覆中出現 TST_min, N3_pct 等程式代碼。回覆請簡短有力。`
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
    res.status(500).json({ text: "伺服器忙碌中，請稍後再試。 😅" });
  }
}
