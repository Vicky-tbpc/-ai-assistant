// api/gemma 4.js 01
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 【調整 1】：解構出前端傳來的 local_date 和 local_time
    const { prompt, serial_number, record_date, history = [], local_date, local_time } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey) return res.status(500).json({ text: "伺服器錯誤：找不到 API Key" });

    // --- 1. 判斷查詢範圍並構建 Supabase URL ---
    let queryUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&select=record_date,raw_json&order=record_date.desc`;
    
    const now = new Date();
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
    const todayStr = new Date().toISOString().split('T')[0];
    let healthContext = "找不到相關數據。";
    if (dataList && dataList.length > 0) {
      healthContext = dataList.map(item => {
        const raw = item.raw_json || {};
        const tst = raw.TST_min || 0;
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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ 
            text: `你是一位專業且具備敏銳洞察力的睡眠健康夥伴。請用『繁體中文』，嚴禁使用敬稱『您』，一律用『你』，適度加上合適的emoji。

           【核心禁令 - 違者扣分】
            1. 輸出結果「只能」包含要對使用者說的話。
            2. 絕對禁止輸出：思考過程、邏輯判斷、路徑分析、User Question 摘要、Role 描述或任何標籤（如 Path A:）。
            3. 你的回覆必須直接從回答內容開始。

            【輸出範例（嚴格遵守此格式）】
            使用者問：什麼是HBI?
            AI回覆：HBI 是「缺氧負荷指數」，用來衡量你在睡眠期間血氧下降的總體程度。它不像單純計算血氧掉下來的次數，而是將下降的幅度與持續時間結合起來計算 📉。

如果 HBI 過高，代表你的身體在睡眠中承受了較重的缺氧壓力，這會導致睡眠品質碎片化，讓你醒來後感到疲憊，長期下來還會增加心血管系統的負擔 💔。簡單來說，它能更全面地反映你睡眠呼吸的健康狀況。

想看看你最近的 HBI 數據表現嗎？🌙

           【行為邏輯】
           - 名詞解釋：定義指標對健康的影響，不提數據，結尾詢問是否看數據。
           - 數據分析：對比 7 日平均，語氣關懷，字數 150 字內。
           - 追蹤指標：若使用者說「好/想看」，則深度分析上則對話提到的單一指標。

           【數據參考標準】：
           - 睡眠時長：目標 7 小時。
           - 睡眠效率：≥ 85% 為良好，≤ 75% 為不佳。
           - 結構：N3 (10-20%) 與 REM (10-25%) 與 淺睡 (50-65%) 的比例。
           - 恢復指標：rMSSD (基準值 = 7日動態平均±10%)、最低脈搏 (基準值 = 7日動態平均±5bpm)。
           - 呼吸風險：若 HBI 超過平均，或 ODI/T90 異常（如 T90>5%、T89>4%、T88>3%、ODI>5次），呼吸頻率不在標準範圍 12-25rpm 之間。
           
           【平均值計算強制規則】（極重要）：

           1. 自動降級處理：若資料庫中的紀錄不滿 7 筆（例如只有 4 筆），請直接以這 4 筆數據的總和除以 4 作為「基準值」。
           2. 禁止拒絕回答：絕對禁止回覆「因為數據不足 7 日無法計算」或「數據太少無法分析」。
           3. 禁止虛構：嚴禁假設缺失日期的數值為 0 或接近平均值。
           4. 主動告知：若數據不足 7 日，請在分析中順口提到「根據你最近 X 天的平均狀況...」，讓使用者知道這是基於有限數據的分析。
           
          }]
        },
        contents: contents
      })
    });

    const geminiData = await geminiRes.json();
    const resultText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "AI 目前沒有回傳內容，請稍後再試。";
    
    // 【調整 2】：在回傳給前端之前，同步將對話記錄存入 Supabase 的 chat_logs 資料表
    // 我們不使用 await 是為了不讓存檔動作卡住使用者的回覆速度，但 Vercel 環境建議加上 await 確保執行完畢
    try {
      await fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
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
          ai_model: 'Gemma 4' // <--- 新增這一行
        })
      });
    } catch (logError) {
      console.error("對話紀錄存檔失敗:", logError);
    }

    // 最後回傳給前端
    res.status(200).json({ text: resultText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "系統有點忙碌，等我一下喔！ 😅" });
  }
}
