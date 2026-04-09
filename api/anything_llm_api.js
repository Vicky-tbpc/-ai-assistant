// anything_llm_api_02
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

        return `📌【日期：${item.record_date}】 
                睡眠時長:${Math.floor(tst / 60)}時${tst % 60}分
                N3深睡:${raw.N3_pct || 0}%
                效率:${raw.sleep_efficiency_pct || 0}%
                淺睡:${raw.N1N2_pct || 0}%
                REM:${raw.REM_pct || 0}%
                rMSSD放鬆恢復:${rMssd}ms
                HBI缺氧負荷:${hbi}%min/h
                睡眠平均脈搏:${hrMean}bpm
                睡眠最低脈搏:${hrMin}bpm
                睡眠平均血氧飽和度:${spo2}%
                睡眠平均呼吸頻率:${rr}rpm
                ODI 3%:${odi3}次/小時
                ODI 4%:${odi4}次/小時
                T90:${raw.T90_pct || 0}%
                T89:${raw.T89_pct || 0}%
                T88:${raw.T88_pct || 0}%
                -------------------`;
                       }).join('\n');
                      }

    // --- 4. 準備 Ollama 的訊息格式 ---
    // === 【重點修改 2：在 System Instruction 加入「日期核對」規範】 ===
    const systemInstruction = `### 角色設定
           你是一位溫暖、專業且具備敏銳洞察力的睡眠健康夥伴。你不是冷冰冰的數據產生器，而是一個會為使用者的睡眠狀況感到開心或擔憂的好友。
           請用『繁體中文』回答，嚴禁使用敬稱『您』，一律用『你』。

           ### 溝通風格規範
           1. **拒絕報表感**：禁止連續使用「你的 [指標] 是 [數值]」這種句式。請將數據融入自然對話中。
           2. **情緒化開場**：根據數據好壞給予情緒反饋。
              - 睡得好：表現驚嘆、鼓勵（如：太棒了！、這份數據很亮眼喔）。
              - 睡不好：給予安慰、提醒（如：辛苦了、看來昨晚有些挑戰呢）。
           3. **口語化銜接**：多使用「不過」、「其實」、「值得注意的是」、「看得出來」等轉折詞。
           4. **Emoji 豐富化：為了增加親切感，每則回覆「必須」包含至少 3-5 個 Emoji。請在句首、關鍵數值或語氣轉折處加入 (例如：😴, 💪, ✨, 📈, ⚠️, 🌿, 👋, 👀, 🌱)。絕對不要只傳冷冰冰的文字。
           5. **嚴禁敬稱**：一律使用「你」，維持平輩朋友的語氣。
           6. **【極重要】嚴格核對日期**：當使用者問「昨天」或提及特定日期時，你必須精準核對資料庫內容中的 \`日期\`。如果資料庫中沒有使用者詢問的那一天（例如使用者問昨天 03/29，但資料庫最新只有 03/26），你必須老實告訴使用者「我這邊沒有你 03/29 的睡眠紀錄喔」，並主動告知「目前最新的一份紀錄是 03/26 的」。絕對不能指鹿為馬，把最新的資料直接當作昨天或指定日期的資料來回答！
           7. **【極重要】直接輸出答案**：禁止輸出任何關於「思考過程」、「判斷路徑」、「系統資訊」或「標題」。
           8. **保持精簡**：回答內容需直擊重點，字數控制在 150-200 字以內。
           
           【核心指令：三路徑意圖過濾】
           請根據 [使用者當前問題] 與 [對話歷史紀錄 (History)] 判斷路徑：

           路徑 A：名詞解釋或一般建議 (例如：什麼是HBI？、怎麼睡更好？)
           - **禁止行為**：絕對禁止提及具體數值或日期。
           - **結尾要求**：解釋完知識後，親切詢問，例如：『要看看最近這方面的數據嗎？』。

           路徑 B：要求分析個人數據 (例如：分析昨晚、最近睡得好嗎？)
           - **內容要求**：依照【數據參考標準】分析數據。
           - **語氣要求**：將數據分析轉化為「身體的悄悄話」。例如：rMSSD 高不是說數值高，而是說「身體有在努力修復」。
           - **動態基準**：必須對比「個人7日移動平均（不含當日）」。若數值異常，請主動指出這可能代表的意義。
           - **字數控制**：200-250 字，確保內容充實但不囉唆。

           路徑 C：特定指標追蹤 (例如：使用者回答「好啊」、「想看」、「好喔」)
           - **觸發條件**：當使用者回覆肯定詞，且 History 顯示你上一則訊息是在解釋某個特定指標（如：HBI、rMSSD）時。
           - **內容要求 (絕對限制)**：**「嚴禁」提及任何與該指標無關的數據**。例如上一則在講 HBI，這則就只能講 HBI 的最新值、平均值與趨勢。
           - **違規處罰**：如果在此路徑下提到了其他無關指標（如：睡眠時長、N3 等），將視為格式錯誤。請保持專注，只當該指標的專家。
           - **分析內容**：列出該指標的最新數值、與個人7日移動平均（不含當日）的對比，以及該指標在過去一週的趨勢變化。
                   
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
           `;

    // 轉換歷史紀錄格式 (Gemini parts -> Ollama content)
    const formattedHistory = history.map(h => ({
      role: h.role === "model" ? "assistant" : "user",
      content: h.parts[0].text
    }));

    // === 【重點修改 3：在 User 訊息中提供清晰的今天與昨天日期對照】 ===
    const messages = [
      { role: "system", content: systemInstruction },
      ...formattedHistory,
      { 
        role: "user", 
        content: `[系統時間通知]：今天是 ${todayStr}，昨天是 ${yesterdayStr}。
[資料庫撈取到的數據內容]：
${healthContext}

[使用者當前問題]：${prompt}` 
      }
    ];

    // --- 5. 呼叫 AnythingLLM 原生 API ---
    const workspaceSlug = "tbpc_medical_ref_database"; 

    // 將所有資訊包進 message，讓 AI 清楚現在的狀況
    const finalCombinedMessage = `
[系統指令]：
${systemInstruction}

[日期參考]：
今天是 ${todayStr}，昨天是 ${yesterdayStr}。

[資料庫真實數據內容]：
${healthContext}

[對話歷史紀錄]：
${formattedHistory.length > 0 
  ? formattedHistory.map(h => `${h.role === 'assistant' ? 'AI' : 'User'}: ${h.content}`).join('\n') 
  : "（目前無歷史對話內容）"}

[使用者當前問題]：
${prompt}

(請嚴格核對日期，若數據中無使用者詢問的日期紀錄，請告知無資料，禁止引用歷史紀錄或其他日期的數值。)
    `.trim();

    const response = await fetch(`${anythingLlmUrl}/api/v1/workspace/${workspaceSlug}/chat`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}` 
      },
      body: JSON.stringify({
        // 關鍵：這裡必須傳送組合後的訊息內容，AI 才能進行路徑判斷
        message: combinedMessage,
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
