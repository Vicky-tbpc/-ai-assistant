// api/gemini.js 15
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

// --- 3. 格式化數據 Context (加上整數處理) ---
const todayStr = new Date().toISOString().split('T')[0]; // 取得今天的日期字串
let healthContext = "找不到相關數據。";
if (dataList && dataList.length > 0) {
  healthContext = dataList.map(item => {
    const raw = item.raw_json || {};
    const tst = raw.TST_min || 0;

// 確保所有數值都從 raw 裡面拿，避免 undefined
    const hrMean = Math.round(raw.HR_mean || 0);
    const hrMin = Math.round(raw.HR_min || 0);
    const rMssd = Math.round(raw.rMSSD || 0);
    const hbi = Math.round(raw.HBI || 0);
    const spo2 = Math.round(raw.SpO2_mean || 0);
    const rr = Math.round(raw.RR_mean || 0);
    const odi3 = Math.round(raw.ODI3_total || 0);
    const odi4 = Math.round(raw.ODI4_total || 0);

    return `日期:${item.record_date}, 
            睡眠時長:${Math.floor(tst / 60)}時${tst % 60}分, 
            N3深睡:${raw.N3_pct || 0}%, 
            效率:${raw.sleep_efficiency_pct || 0}%, 
            淺睡:${raw.N1N2_pct || 0}%, 
            REM:${raw.REM_pct || 0}%,
            rMSSD放鬆恢復:${rMssd}ms,
            HBI缺氧負荷:${hbi}%min/h,
            睡眠平均脈搏:${hrMean}bpm,
            睡眠最低脈搏:${hrMin}bpm,
            睡眠平均血氧飽和度:${spo2}%,
            睡眠平均呼吸頻率:${rr}rpm,
            ODI 3%:${odi3}次/小時,
            ODI 4%:${odi4}次/小時,
            T90:${raw.T90_pct || 0}%,
            T89:${raw.T89_pct || 0}%,
            T88:${raw.T88_pct || 0}%`;
  }).join('\n');
}

    // --- 4. 呼叫 Gemini API ---
    const contents = [...history, { 
      role: "user", 
parts: [{ text: `[系統時間]: 今天是 ${todayStr}\n[系統提供數據庫內容]:\n${healthContext}\n\n[使用者當前問題]: ${prompt}` }] 
}];

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ 
            text: `你是一位具備專業醫學知識且親切的生活健康夥伴。你的回覆應該像是在 LINE 上傳訊息給好朋友，專業但完全不說廢話。
           使用『繁體中文』，嚴禁使用敬稱『您』，一律用『你』。

           【核心溝通風格】：
           1. **自然對話**：不要使用「📊 重點摘要」或「⚠️ 特別注意」等生硬標題。請用自然段落或 Emoji 開頭來引導視覺。
           2. **數據揉合**：將數據分析隱藏在句子中。不要說「你的數據是...」，要說「我看你昨晚...」。
           3. **重點分明**：透過「換行」來區分不同層次的資訊（昨晚表現 / 近期趨勢 / 暖心建議）。
           4. **日期格式**：統一使用「月/日」（例如：3/12）。

           【數據基準與分析邏輯】：
           - **睡眠時長**：以 7 小時為目標。
           - **恢復指標 (rMSSD & 脈搏)**：必須對比「個人7日移動平均（不含當日）」。
             - 若 rMSSD 低於平均 10% 以上，提示身體疲勞。
             - 若最低脈搏偏離平均 5 bpm 以上，提示身體狀態有異。
           - **呼吸風險**：若 HBI 超過平均，或 ODI/T90 異常（如 T90 > 5%），請用關心的口吻提醒呼吸順暢度。
           - **結構指標**：注意 N3 (10-20%) 與 REM (10-25%) 的比例。

           【輸出範本風格範例】：
           嗨！看到你 3/18 還沒更新數據，我們先看看 3/12 那晚的狀況？昨晚睡得還好嗎？

           那一晚你睡了約 5 小時，雖然 N3 深睡比例不錯，但 REM 只有 3%，這會讓你白天比較容易覺得精神沒恢復喔。😴

           你的 rMSSD 是 59ms，比你這週平均的 68.9ms 稍微低一點，看來身體還在努力放鬆。另外三月目前整體的睡眠都偏短，特別要留意 3/6 那天缺氧負荷較高，呼吸順暢度要多觀察一下。

           今晚試著早點放下手機，把睡眠時間拉長一點，身體會感謝你的。加油！✨`
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
