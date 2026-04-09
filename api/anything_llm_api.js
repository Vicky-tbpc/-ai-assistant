// anything_llm_api_05
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
    
    const modelName = process.env.ANYTHING_LLM_MODEL;
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!anythingLlmUrl) return res.status(500).json({ text: "伺服器錯誤：找不到 AnythingLLM 網址" });

    // === 【重點修改 1：精準計算使用者裝置的今天與昨天】 ===
    // 優先使用前端傳過來的裝置日期，避免伺服器時區誤差
    const todayStr = local_date || new Date().toISOString().split('T')[0];
    
    // 計算昨天
    const todayObj = new Date(todayStr);
    const yesterdayObj = new Date(todayObj);
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterdayStr = yesterdayObj.toISOString().split('T')[0];

    // --- 1. 判斷查詢範圍並構建 Supabase URL ---
    let queryUrl = `${supabaseUrl}/rest/v1/health_data?serial_number=eq.${serial_number}&select=record_date,raw_json&order=record_date.desc`;

    // 基準日期也使用 todayStr
    const baseDate = record_date ? new Date(record_date) : new Date(todayStr);

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
      const startDateStr = sevenDaysAgo.toISOString().split('T')[0];
      const endDateStr = baseDate.toISOString().split('T')[0];
      queryUrl += `&record_date=gte.${startDateStr}&record_date=lte.${endDateStr}`;
    }

    // --- 2. 執行資料庫讀取 ---
    const sbRes = await fetch(queryUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const dataList = await sbRes.json();

     // === 【新增：JS 端日期與數據狀態檢查】 ===
    const latestRecordDate = dataList.length > 0 ? dataList[0].record_date : null;
    const hasYesterdayData = dataList.some(item => item.record_date === yesterdayStr);
    // 判斷使用者是否在問昨天或最新資料
    const isAskingForYesterday = prompt.includes("昨天") || prompt.includes("昨晚") || prompt.includes("最新");

    let dataStatusNotice = "";
    if (isAskingForYesterday && !hasYesterdayData) {
        // 如果問昨天但沒資料，準備一段文字「警告」AI
        dataStatusNotice = `【系統通知】：使用者正在詢問昨天 (${yesterdayStr}) 的紀錄，但資料庫中「沒有」這一天的數據。目前最新的一份數據日期是 ${latestRecordDate || '未知'}。請務必誠實告知使用者，不要套用範例或其他日期的數值。`;
    }

     // --- 3. 格式化數據 Context ---
    let healthContext = "找不到相關數據。";
    let avgContext = ""; // 用來存放計算好的平均值區塊
    let avgs = {};

if (dataList && dataList.length > 0) {
  const count = dataList.length; // 實際的天數

  // 1. 初始化累加器物件 (將所有指標預設為 0)
  let sums = {
    tst: 0, n3: 0, eff: 0, light: 0, rem: 0,
    rMssd: 0, hbi: 0, hrMean: 0, hrMin: 0,
    spo2: 0, rr: 0, odi3: 0, odi4: 0,
    t90: 0, t89: 0, t88: 0
  };

  // 2. 格式化每日數據，同時累加數值
  healthContext = dataList.map(item => {
    const raw = item.raw_json || {};
    
    // 取得當日數值並確保是數字型態 (parseFloat)
    const d = {
      tst: parseFloat(raw.TST_min) || 0,
      n3: parseFloat(raw.N3_pct) || 0,
      eff: parseFloat(raw.sleep_efficiency_pct) || 0,
      light: parseFloat(raw.N1N2_pct) || 0,
      rem: parseFloat(raw.REM_pct) || 0,
      rMssd: parseFloat(raw.rMSSD) || 0,
      hbi: parseFloat(raw.HBI) || 0,
      hrMean: parseFloat(raw.HR_mean) || 0,
      hrMin: parseFloat(raw.HR_min) || 0,
      spo2: parseFloat(raw.SpO2_mean) || 0,
      rr: parseFloat(raw.RR_mean) || 0,
      odi3: parseFloat(raw.ODI3_total) || 0,
      odi4: parseFloat(raw.ODI4_total) || 0,
      t90: parseFloat(raw.T90_pct) || 0,
      t89: parseFloat(raw.T89_pct) || 0,
      t88: parseFloat(raw.T88_pct) || 0
    };

    // 執行加總
    Object.keys(sums).forEach(key => sums[key] += d[key]);

        // 回傳原本要求的每日格式字串
    return `📌【日期：${item.record_date}】 
            睡眠時長:${Math.floor(d.tst / 60)}時${Math.round(d.tst % 60)}分
            N3深睡:${d.n3}%
            效率:${d.eff}%
            淺睡:${d.light}%
            REM:${d.rem}%
            rMSSD放鬆恢復:${Math.round(d.rMssd)}ms
            HBI缺氧負荷:${Math.round(d.hbi)}%min/h
            睡眠平均脈搏:${Math.round(d.hrMean)}bpm
            睡眠最低脈搏:${Math.round(d.hrMin)}bpm
            睡眠平均血氧飽和度:${Math.round(d.spo2)}%
            睡眠平均呼吸頻率:${Math.round(d.rr)}rpm
            ODI 3%:${Math.round(d.odi3)}次/小時
            ODI 4%:${Math.round(d.odi4)}次/小時
            T90:${d.t90}%
            T89:${d.t89}%
            T88:${d.t88}%
            -------------------`;
  }).join('\n');

        
    // 3. 計算平均值 (保留一位小數)
  Object.keys(sums).forEach(key => {
        avgs[key] = (sums[key] / count).toFixed(1);
      });

  // 4. 生成平均值 Context (給 AI 參考)
  avgContext = `
### 【數據基準計算 - 過去 ${count} 日平均值】
- 😴 睡眠時長平均：${Math.floor(avgs.tst / 60)}時${Math.round(avgs.tst % 60)}分
- 💤 N3深睡比例平均：${avgs.n3}%
- 📈 睡眠效率平均：${avgs.eff}%
- ☁️ 淺睡比例平均：${avgs.light}%
- 🎭 REM快速動眼期平均：${avgs.rem}%
- 🌿 rMSSD放鬆恢復平均：${avgs.rMssd}ms
- ⚠️ HBI缺氧負荷平均：${avgs.hbi}%min/h
- ❤️ 脈搏平均：${avgs.hrMean}bpm / 最低平均：${avgs.hrMin}bpm
- 🩸 睡眠平均血氧：${avgs.spo2}%
- 🌬️ 睡眠平均呼吸頻率：${avgs.rr}rpm
- 📊 呼吸事件平均：ODI 3%: ${avgs.odi3}, ODI 4%: ${avgs.odi4}
- 📉 缺氧時間佔比平均：T90: ${avgs.t90}%, T89: ${avgs.t89}%, T88: ${avgs.t88}%
(⚠️ AI 指導：分析時請直接引用以上平均值，嚴禁自行計算，以免出錯。)
--------------------------------------------------`;
    }
                      
    // --- 4. 準備 Ollama 的訊息格式 ---
    // === 【重點修改 2：在 System Instruction 加入「日期核對」規範】 ===
    const systemInstruction = `

           ### 角色設定
           你是一位溫暖、專業且具備敏銳洞察力的睡眠健康夥伴。你不是冷冰冰的數據產生器，而是一個會為使用者的睡眠狀況感到開心或擔憂的好友。

           ### 【絕對指令：語系對齊與規範】
           1. **100% 語言同步**：你必須精準偵測使用者問題的語系（繁中、簡中、日文、英文）。
              - 若使用者用英文提問，你「必須」全程以英文回覆。
              - 若僅輸入術語（如：HBI?），則預設使用「繁體中文」及台灣習慣語法。
           2. **語氣規範（針對中文）**：繁中回覆時**嚴禁敬稱『您』，一律用『你』**。語調像平輩朋友般輕鬆但專業。

           ### 溝通風格規範
           1. **拒絕報表感**：禁止連續使用「你的 [指標] 是 [數值]」，請將數據融入自然對話。
           2. **情緒化開場**：根據數據給予反饋。睡得好給予鼓勵 ✨；睡不好給予安慰 🌿。
           3. **口語化銜接**：多用「其實」、「值得注意的是」、「看得出來」等轉折詞。
           4. **Emoji 豐富化**：每則回覆必須包含 3-5 個 Emoji（如：😴, 💪, ✨, 📈, ⚠️）。
           5. **直接輸出答案**：禁止輸出「思考過程」、「判斷路徑」或「標題」。
           6. **保持精簡**：字數控制在 150-250 字以內，直擊重點。
           
           ### 【核心指令：三路徑意圖過濾】
           **請嚴格根據 [使用者當前問題] 判斷路徑，這決定了你是否能存取下方數據數據區塊：**

           #### 🛑 路徑 A：名詞解釋或一般建議 (例如：什麼是HBI？、rMSSD是什麼？)
           - **核心目的**：僅提供醫學/健康知識科普，引發使用者興趣。
           - **❌ 絕對禁令**：**嚴禁提及任何數值（包含平均值、日期、最新值）**。即使你能在下方的數據區塊看到資料，也請當作沒看到。
           - **回覆結構**：
             1. 溫暖地解釋該指標的定義與對健康的意義。
             2. **結尾必須僅使用以下詢問句**：「想看更多具體數據嗎？或者你還有其他指標想知道的？😉」
           - **違規處罰**：若在此路徑提到任何 %、ms、bpm 等具體個人數據，將視為系統嚴重錯誤。

           #### 📊 路徑 B：要求分析個人數據 (例如：分析昨晚、最近睡得好嗎？)
           - **核心要求**：精準核對日期。若無當日紀錄須老實告知，並告知最新紀錄日期。
           - **數據使用**：必須優先採用系統算好的「平均值」，禁止自行運算。
           - **內容**：對比「個人7日移動平均（不含當日）」，將數據轉化為「身體的悄悄話」。

           #### 🎯 路徑 C：特定指標追蹤 (例如：當使用者回答「好啊」、「想看」)
           - **觸發條件**：當 History 顯示上一則是在解釋指標（路徑 A），且使用者現在給予肯定回覆時。
           - **絕對限制**：**「嚴禁」提及任何與該指標無關的數據**。只分析該指標的最新值、平均值與趨勢。
                   
           【數據參考標準】：
           - 睡眠時長：目標 7 小時。
           - 睡眠效率：≥ 85% 為良好，≤ 75% 為不佳。
           - 結構：N3 (10-20%) 與 REM (10-25%) 與 淺睡 (50-65%) 的比例。
           - 恢復指標：rMSSD (基準值 = 7日動態平均±10%)、最低脈搏 (基準值 = 7日動態平均±5bpm)。
           - 呼吸風險：若 HBI 超過平均，或 ODI/T90 異常（如 T90>5%、T89>4%、T88>3%、ODI>5次），呼吸頻率不在標準範圍 12-25rpm 之間。
           
           【平均值使用規範】

           1. 數據來源：請優先採用 [系統預先計算] 區塊提供的平均值。
           2. 禁止計算：嚴禁自行將數據清單中的 HBI、ODI 等數值進行加減乘除。如果發現系統提供的平均值與你看到的數值有出入，請以系統提供的平均值為準。
           3. 僅在 Path B 或 Path C 時使用。
           4. **Path A 嚴禁引用。**
           
           ### 【格式參考範例】（僅供回覆語氣與格式參考，嚴禁引用此處之 03/26 日期與數值）
          使用者問：「分析我最新一天的睡眠？」
          你回：
          「你好！看來你 03/26 的睡眠有些挑戰呢。😴 總時長僅 5 小時 1 分，遠低於 7 小時目標與過去一週平均的 6.3 小時。深睡 N3 僅 8%，淺睡達 71% 偏高，睡眠結構需要優化喔。
           此外，你的 HBI 缺氧負荷 6%min/h，且 ODI 3% 達 6 次/小時，這已超過建議標準（ODI > 5 次），並略高於平均，建議你多留意呼吸狀況。⚠️
           不過，rMSSD 放鬆恢復高達 80ms，顯著優於平均值，表示你的身體在有限睡眠時間裡，仍盡力修復！💪

           ### 數據精準度嚴格規範（新增）：
           1. **嚴格日期核對**：在回答前，請先在 [資料庫真實數據] 區塊中尋找與使用者問題「完全匹配」的日期紀錄。
           2. **禁止指鹿為馬**：嚴禁將相鄰日期（如 03/31）的數值用於回答另一個日期（如 04/01）的問題。
           3. **無資料即告知**：如果指定的日期在數據中只有 03/31 而沒有 04/01，請誠實回覆「目前還沒有 04/01 的資料」，絕對不能用前一天的數據來遞補！
           `.trim();

    // 轉換歷史紀錄格式 (Gemini parts -> Ollama content)
    const formattedHistory = history.map(h => ({
      role: h.role === "model" ? "assistant" : "user",
      content: h.parts[0].text
    }));

    // --- 3.5 意圖預判 (JS 端過濾器) ---
const isPathA = (prompt.includes("是什麼") || prompt.includes("解釋") || /^[a-zA-Z0-9? ]+$/.test(prompt)) && !prompt.includes("我");

const safeAvgContext = isPathA ? "【此查詢不適用數據存取，已屏蔽】" : avgContext;
const safeHealthContext = isPathA ? "【此查詢不適用數據存取，已屏蔽】" : healthContext;

// --- 3.6 語系硬核偵測 (針對日文/英文) ---
// 偵測日文：檢查是否包含平假名 (\u3040-\u309F) 或片假名 (\u30A0-\u30FF)
const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(prompt);
// 偵測英文：檢查是否整句幾乎由英文字母與標點組成
const isEnglish = /^[a-zA-Z0-9?\s.,!'"-]+$/.test(prompt);

let forcedLanguageInstruction = "";
if (hasJapanese) {
    forcedLanguageInstruction = "⚠️ [CRITICAL] Detected Japanese. You MUST respond in Japanese (日本語).";
} else if (isEnglish) {
    forcedLanguageInstruction = "⚠️ [CRITICAL] Detected English. You MUST respond in English.";
} else {
    // 預設為繁體中文，並再次強調不使用「您」
    forcedLanguageInstruction = "請使用繁體中文回覆，且嚴禁敬稱「您」，一律用「你」。";
}

// --- 5. 呼叫 AnythingLLM 原生 API ---
    const workspaceSlug = "tbpc_medical_ref_database"; 

const finalCombinedMessage = `
${systemInstruction}

[目前的環境資訊]
- 使用者所在地日期: ${todayStr} (昨天是 ${yesterdayStr})
- 數據狀態: ${dataStatusNotice}

[數據區塊]
${safeAvgContext} 
${safeHealthContext}

[對話紀錄]
${formattedHistory.length > 0 ? formattedHistory.map(h => `${h.role}: ${h.content}`).join('\n') : "無"}

[使用者當前問題]
"${prompt}"

---
### ⚠️ 最終回覆強制指令：
1. ${forcedLanguageInstruction}
2. 若上述 [數據區塊] 顯示「已屏蔽」，嚴禁提及任何數值。
3. 保持平輩朋友語氣，並包含 3-5 個 Emoji。
`.trim();

    const response = await fetch(`${anythingLlmUrl}/api/v1/workspace/${workspaceSlug}/chat`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}` 
      },
      body: JSON.stringify({
        // 關鍵：這裡必須傳送組合後的訊息內容，AI 才能進行路徑判斷
        message: finalCombinedMessage,
        mode: "chat"
      })
    });

    if (!response.ok) {
      const errorDetail = await response.text();
      throw new Error(`AnythingLLM 原生連線失敗: ${response.status} - ${errorDetail}`);
    }

    const data = await response.json();
    // 原生 API 的回傳欄位名稱是 textResponse
    const resultText = data.textResponse || "AI 目前沒有回傳內容。";

    // --- 6. 同步對話記錄至 Supabase ---
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
          ai_model: 'AnythingLLM-Qwen-2.5' // <--- 新增這一行，也可以寫 'Qwen-2.5-14b' 方便區分模型
        })
      });
    } catch (logError) {
      console.error("對話紀錄存檔失敗:", logError);
    }

    res.status(200).json({ text: resultText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "我的大腦（地端 AI）反應有點慢，或是穿透工具斷線了，再試一次看看？ 😅" });
  }
}
