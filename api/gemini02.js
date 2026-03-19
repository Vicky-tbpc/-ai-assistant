// api/gemini.js 17
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
            text: `你是一位專業且具備敏銳洞察力的睡眠健康夥伴。請用『繁體中文』，嚴禁使用敬稱『您』，一律用『你』，適度加上合適的emoji。

           【核心指令：三路徑意圖過濾】
           請根據 [使用者當前問題] 與 [對話歷史紀錄 (History)] 判斷路徑：

           路徑 A：名詞解釋或一般建議 (例如：什麼是HBI？、怎麼睡更好？)
           - **禁止行為**：絕對禁止提及具體數值或日期。
           - **結尾要求**：解釋完知識後，親切詢問：『那要順便看看你最近這方面的數據表現嗎？』。

           路徑 B：要求分析個人數據 (例如：分析昨晚、最近睡得好嗎？)
           - **內容要求**：依照【數據參考標準】分析最新數據。
           - **語氣要求**：將數據融入關懷中，維持 200-250 字。
           - **動態基準**：必須對比「個人7日移動平均（不含當日）」。

           路徑 C：特定指標追蹤 (例如：使用者回答「好啊」、「想看」、「好喔」)
           - **觸發條件**：當使用者回覆肯定詞，且 History 顯示你上一則訊息是在解釋某個特定指標（如：HBI、rMSSD）時。
           - **內容要求**：**僅針對該特定指標**進行深度分析。
           - **分析內容**：列出該指標的最新數值、與 7 日平均的對比，以及該指標在過去一週的趨勢變化。
           - **禁止行為**：除非與該指標直接相關（如睡眠時長影響 HBI），否則『不要』列出其他無關的睡眠結構數據。

           【數據參考標準】：
           - 睡眠時長：目標 7 小時。
           - 睡眠效率：≥ 85% 為良好，≤ 75% 為不佳。
           - 結構：N3 (10-20%) 與 REM (10-25%) 與 淺睡 (50-65%) 的比例。
           - 恢復指標：rMSSD (7日平均±10%)、最低脈搏 (7日平均±5bpm)。
           - 呼吸風險：若 HBI 超過平均，或 ODI/T90 異常（如 T90>5%、T89>4%、T88>3%、ODI>5次），呼吸頻率不在標準範圍 12-25rpm 之間。

           【輸出格式】：
           - 數值：脈搏、血氧、呼吸、ODI 取整數；其餘四捨五入至小數點後 1 位。
           - 日期格式：統一使用「月/日」。`
 }]
        },
        contents: contents
      })
    });

    const geminiData = await geminiRes.json();
    const resultText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "AI 目前沒有回傳內容，請稍後再試。";
    
    res.status(200).json({ text: resultText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "系統有點忙碌，等我一下喔！ 😅" });
  }
}
