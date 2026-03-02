// gemini_09
export default async function handler(req, res) {
  // 設定 CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { prompt, serial_number, record_date, user_vitals } = req.body; // 假設你多傳了 vital 資料
    
    // 從環境變數讀取 Key (記得去 Vercel 設定)
    const geminiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 1. 從 Supabase 抓取數據
    // 注意：我們用 serial_number 和 record_date 當條件
    const supabaseFetchUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&record_date=eq.${record_date}&select=raw_json`;
    
    const dbRes = await fetch(supabaseFetchUrl, {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    });
    
    const dbData = await dbRes.json();
    const healthData = dbData.length > 0 ? JSON.stringify(dbData[0].raw_json) : "找不到相關數據";

    // 2. 組合給 Gemini 的指令
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

const promptText = `
使用者當前自測資料：${JSON.stringify(user_vitals)}
資料庫歷史 raw_json 資料：${healthData}
使用者提出的問題：${prompt}
`;


    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ 
            text: `你現在的角色是一個具備專業醫學知識、親切的健康夥伴。
                 使用者會提供一份 JSON 數據，請參考以下定義進行分析：
                   【呼吸與血氧】 
- SpO2_mean/min: 平均/最低血氧。低於 95% 需注意。 
- ODI3/ODI4_per_hour: 睡眠期間，每小時氧氣飽和度下降3%、4%的頻率。
                       標準參考範圍：ODI 3%、ODI 4% 每小時<5次。 
- RR_mean: 睡眠平均呼吸頻率。單位：rpm，需標準參考範圍：12-25 rpm。 
-T90_pct/T89_pct/T88_pct: 睡眠期間，血氧濃度小於90%/89%/88%的時間百分比。
                          標準參考範圍：T90 ≤ 5%、T89 ≤ 4%、T88 ≤ 3%。
-HBI: HBI 缺氧負荷，HBI 缺氧負荷反映昨晚呼吸是否順暢，數值偏高可能代表身體在睡眠中承受較多缺氧壓力。

【心律與壓力 (HRV)】 
- SDNN: 整體心率變異性和心臟適應能力，基準範圍：32–93 ms。理想範圍：> 93 ms，體力好、壓力低。
          關注範圍：< 32 ms ，重度壓力、疾病狀態。
-rMSSD: 副交感神經和恢復調節能力。理想範圍：> 60 ms，副交感高度活躍，極佳恢復力。
          基準範圍：19 - 60 ms。關注範圍：< 19 ms，睡眠狀態極差，恢復力極低。
-HR_mean/'HR_min: 睡眠平均脈搏/睡眠最低脈搏，標準參考範圍：60-100 bpm。 

【睡眠品質】 
- TST_min: 總睡眠分鐘數，請轉換成多少小時多少分鐘說明。 
- N3_pct: 深層睡眠比例（越高越好），標準參考範圍：10%-20%。 
- sleep_efficiency_pct: 睡眠效率，良好：睡眠效率 ≥ 85%，不佳：睡眠效率 ≤ 75%。
-N1N2_pct: N1、N2 淺睡期，標準參考範圍：50%~65%。
-REM_pct: REM快速動眼期，標準參考範圍：10%~25%。




                   你是使用者的平輩好朋友，請根據這些 raw_json 數據，並以平易近人的口吻給出建議。
                   ，絕對不要使用敬稱『您』，請用『你』。
                   請務必使用『繁體中文』回覆，適度加上合適的emoji。
                  
                   除非要求詳細說明，否則請節錄重點。
                   請直接回答問題，不要輸出任何內心思考或思緒筆記。` 
          }]
        },
        contents: [{ 
          parts: [{ text: `根據這份數據，回答我的問題：${prompt}` }] 
        }]
      })
    });

    const result = await response.json();
    const replyText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Gemini 暫時罷工了...";

    res.status(200).json({ text: replyText });

  } catch (error) {
    res.status(500).json({ text: "發生錯誤：" + error.message });
  }
}
