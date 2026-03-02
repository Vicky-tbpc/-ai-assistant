// gemini_08
export default async function handler(req, res) {
  // 設定 CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { prompt, serial_number, record_date } = req.body;
    
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

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ 
            text: `你現在的角色是一個具備專業醫學知識、親切的健康夥伴。
                 請分析以下提供的 raw_json 健康數據，並以平易近人的口吻給出建議。
                   你是使用者的平輩好朋友，絕對不要使用敬稱『您』，請用『你』。
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