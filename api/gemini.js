// api/gemini.js 23
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY; 
    const anythingLlmUrl = process.env.ANYTHING_LLM_URL;
    const anythingLlmKey = process.env.ANYTHING_LLM_KEY;
    const anythingLlmSlug = process.env.ANYTHING_LLM_SLUG;
    
    const { prompt, serial_number, history = [], local_date, local_time, action, metric_data } = req.body;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

    // ==========================================
    // 🚀 全動態超連結字典撈取 (消滅程式碼肥大，免重新部署)
    // ==========================================
    let linkRules = [];
    try {
      const linksRes = await fetch(`${supabaseUrl}/rest/v1/reference_links?select=tag,markdown_content,keywords`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      if (linksRes.ok) {
        linkRules = await linksRes.json();
      }
    } catch (e) {
      console.error("[錯誤] ❌ 撈取動態超連結字典失敗:", e);
    }

    // ==========================================
    // 🛡️ 絕對防錯區塊：即時撈取使用者專屬名稱
    // 嚴格綁定本次請求的 serial_number，避免任何全域變數污染
    // ==========================================
    let nickname = "使用者";
    let ai_name = "健康夥伴";
    
    console.log(`[檢查] 準備撈取名稱，收到的 serial_number: ${serial_number}`);

    if (!serial_number) {
      console.log("[警告] ⚠️ 前端沒有傳送 serial_number！請檢查前端 fetch 的 body。");
    } else {
      try {
        const userRes = await fetch(`${supabaseUrl}/rest/v1/user_credentials?select=nickname,ai_name&serial_number=eq.${serial_number}`, {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        });
        
        if (userRes.ok) {
          const userData = await userRes.json();
          console.log("[檢查] Supabase 回傳結果:", userData);
          
          if (userData && userData.length > 0) {
            nickname = userData[0].nickname || nickname;
            ai_name = userData[0].ai_name || ai_name;
            console.log(`[成功] 替換名稱為 nickname: ${nickname}, ai_name: ${ai_name}`);
          } else {
            console.log(`[警告] ⚠️ Supabase 找不到 serial_number 為 ${serial_number} 的資料！請確認資料表裡有這筆序號。`);
          }
        } else {
          const errText = await userRes.text();
          console.log(`[錯誤] ❌ Supabase 查詢失敗: ${userRes.status} ${errText}`);
        }
      } catch (e) {
        console.error("[錯誤] ❌ 撈取使用者名稱時發生 Exception:", e);
      }
    }

    // ==========================================
    // 客製化 AI 開場白攔截區塊
    // ==========================================
    if (action === 'generate_greeting') {
      const greetingPrompt = `【身份鎖定】
你永遠是 Soosyn Health Companion 的 AI 健康夥伴。
絕對禁止自稱：Google AI、Gemini、大型語言模型、第三方AI。
若被問到模型來源，請回答：「我是 Soosyn Health Companion 的 AI 健康夥伴，專門協助你解讀健康數據與提供健康管理建議。」
你的名字：${ai_name}
使用者暱稱：${nickname}

請根據以下提示，生成一句專屬的開場白。
【規則】
1. 第一句請自然地打招呼，表達歡迎回來的心情。你可以稱呼對方的暱稱「${nickname}」，也可以帶入你自己的名字「${ai_name}」。例如：「歡迎回來 ${nickname}！我是 ${ai_name} 👋」。
2. 接著請根據以下指標狀態給予一句${metric_data.type}：
   - 指標：${metric_data.metric}
   - 狀態：${metric_data.status}
3. 說明完後，最後加上一句引導詢問。
4. 語氣要像平輩朋友一樣自然。
5. 【絕對禁止】：嚴格禁止使用敬稱，請全部使用「你」。

請直接輸出對話文字，不要包含額外的解釋或 JSON 格式。`;

      let greetingRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: greetingPrompt }] }] })
      });
      
      let greetingResult = await greetingRes.json();
      const cleanGreeting = greetingResult.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || `歡迎回來 ${nickname}！今天想了解哪些健康數據呢？`;
      return res.status(200).json({ text: cleanGreeting });
    }

    // ==========================================
    // 第一階段：超級大腦 Gemini 進行意圖判斷 (Router)
    // ==========================================
    const parseDate = (dateStr) => {
      const [y, m, d] = dateStr.split('-');
      return new Date(y, m - 1, d);
    };

    const todayObj = parseDate(local_date);
    const dayOfWeek = todayObj.toLocaleDateString('zh-TW', { weekday: 'long' });

    const getOffsetDate = (offset) => {
      const d = new Date(todayObj);
      d.setDate(d.getDate() + offset);
      const yy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    };

    const yesterdayStr = getOffsetDate(-1);
    const lastWeekStartStr = getOffsetDate(-7);

    // 🌟 調整 1：精準定義 knowledge_query 的提取方式，強制抓出具體的名詞
    const routerPrompt = `今天是 ${local_date} (${dayOfWeek})。
請判斷使用者的問題：「${prompt}」的意圖。

【判斷規則】
1. 【圖表嚴格限制】：只有當使用者「明確提到視覺化圖表的關鍵字」時，才將 need_trend_chart 設為 true。並判斷 trend_type 為："all", "battery", "rhr", "n3", "rmssd", "hrmin", "hbi", 或 "unknown"。
2. 【數據查詢】：如果問到健康狀況、各項數值變化，need_data 設為 true，並指定 start 與 end 日期。若提到具體指標名稱，強制設 start 為 ${lastWeekStartStr}，end 為 ${local_date}。
3. 【知識庫查詢】(優化)：若使用者詢問健康指標（如：N3深睡期、血氧、AHI）的定義與「標準參考範圍」，或是詢問「如何使用 Soosyn APP、ST-50 裝置操作、說明書、教學網址」，請將 need_knowledge 設為 true，並在 knowledge_query 中提取「最核心的專有名詞」（例如：「N3 淺睡期 標準參考範圍」、「Soosyn APP ST-50 教學 說明書」），這將用於向量資料庫精準檢索。
4. 【外部即時資訊】：若問天氣、氣溫、中暑風險等，將 need_external 設為 true，並產生 external_query。

【日期對照表】
1. 今天：${local_date}
2. 昨天：${yesterdayStr}
3. 上週/最近一週：${lastWeekStartStr} 到 ${yesterdayStr}

請根據上述規則，輸出完全符合以下格式的 JSON：
{"need_data": boolean, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "need_trend_chart": boolean, "trend_type": "string", "need_external": boolean, "external_query": "string", "need_knowledge": boolean, "knowledge_query": "string"}`;

    let intentRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: routerPrompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    let intentData = await intentRes.json();
    let intent = { need_data: false, need_external: false, need_knowledge: false };
    try {
      const intentText = intentData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      intent = JSON.parse(intentText);
    } catch (e) { 
      console.log("意圖解析失敗", e); 
    }

    console.log("👉【Gemini Router 意圖解析結果】:", JSON.stringify(intent));

    if (intent.need_trend_chart) {
      const trendNames = { "all": "📊 完整圖表", "battery": "📈 恢復指數", "rhr": "❤️‍ 靜息心率", "n3": "🌙 深睡期 (N3)", "rmssd": "🌿 rMSSD", "hrmin": "💓 睡眠最低脈搏", "hbi": "🫁 HBI 低氧負擔指數" };
      if (intent.trend_type && trendNames[intent.trend_type]) {
        return res.status(200).json({ action: 'show_specific_trend', trend_type: intent.trend_type, text: `沒問題！為你送上最近的 ${trendNames[intent.trend_type]} 趨勢圖表 👇` });
      } else {
        return res.status(200).json({ action: 'show_trend_options', text: "🔍 想查看哪一種趨勢圖表呢？" });
      }
    }

    // ==========================================
    // 第二階段 (三管齊下並行準備)：知識庫 / 外部資訊 / 個人數據
    // ==========================================
    
    // 2-1. 呼叫地端 AnythingLLM (圖書館管理員) 獲取 RAG 知識
    let ragContext = "無特別的衛教與標準知識。";
    if (intent.need_knowledge && intent.knowledge_query) {
      try {
        // 🌟 調整 2：大幅簡化 Prompt，把關鍵字放最前面提升檢索命中率，並命令模型當個無情的搬運工
        const ragPrompt = `查詢目標：「${intent.knowledge_query}」與「${prompt}」

請在知識庫中檢索上述目標，並嚴格遵守以下輸出規則：
1. 你的唯一任務是「精準搬運」：只要找到相關的 Markdown 表格數據（如睡眠標準範圍）或超連結網址（如說明書連結 [連結名稱](網址)），請「原封不動、完整照抄」提取出來。
2. 絕對不要自己進行摘要、縮減、改寫或解釋。
3. 不要加入任何問候語或自我介紹。`;
        
        const ragRes = await fetch(`${anythingLlmUrl}/api/v1/workspace/${anythingLlmSlug}/chat`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${anythingLlmKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: ragPrompt, mode: "query" })
        });
        
        if (ragRes.ok) {
          let ragData = await ragRes.json();
          ragContext = ragData.textResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          console.log("📚【地端 AnythingLLM 知識庫檢索】:", ragContext);
        }
      } catch (e) { console.error("💥 地端 RAG 呼叫失敗:", e); }
    }

    // ==========================================
    // 🛡️ 雙重保險：用 Supabase 資料表動態補刀，防止 RAG 漏抓
    // ==========================================
    const userPromptLow = prompt.toLowerCase();
    let forceLinkInstruction = "";

    linkRules.forEach(rule => {
      if (rule.keywords) {
        // 將資料庫的關鍵字欄位依逗號拆開成陣列
        const kwArray = rule.keywords.split(',');
        // 只要使用者輸入包含其中一個關鍵字，就強灌規則給 AI
        const hasKeyword = kwArray.some(kw => userPromptLow.includes(kw.trim().toLowerCase()));
        
        if (hasKeyword) {
          forceLinkInstruction += `\n【系統強制規則】：請在回覆中適當位置原封不動附上這行標籤：${rule.tag}，絕對禁止自己寫出任何 http 或 https 網址！`;
        }
      }
    });

    ragContext = ragContext + forceLinkInstruction;

    // 2-2. 呼叫 Gemini API 獲取外部即時資訊
    let externalContext = "目前無外部即時資訊。";
    if (intent.need_external && intent.external_query) {
      try {
        const extPrompt = `今天是 ${local_date} (${dayOfWeek})。請針對查詢主題：「${intent.external_query}」，提供精簡關鍵的即時環境或天氣分析。字數150字內，不包含 JSON。`;
        const extRes = await fetch(geminiUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: extPrompt }] }], tools: [{ googleSearch: {} }] })
        });
        if (extRes.ok) {
          const extData = await extRes.json();
          externalContext = extData.candidates?.[0]?.content?.parts?.[0]?.text || "暫時無法取得外部詳細資訊。";
          console.log("☁️【Gemini 聯網搜尋結果】:", externalContext);
        }
      } catch (e) { console.error("💥 外部資訊呼叫失敗:", e); }
    }

    // 2-3. 抓取並格式化個人健康數據
    let healthContext = "目前沒有相關數據。";
    let uploadStatusContext = ""; // 🌟 新增：用來存放上傳狀態的比對結果
    if (intent.need_data && intent.start && intent.end) {
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      
      // 日期偏移小工具
      const getCustomOffsetDate = (baseDateStr, offset) => {
        const [y, m, d] = baseDateStr.split('-');
        const dateObj = new Date(y, m - 1, d);
        dateObj.setDate(dateObj.getDate() + offset);
        return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
      };

      // 為了完整涵蓋邊界，API 結束日期自動延後 1 天
      const apiStart = intent.start;
      const apiEnd = getCustomOffsetDate(intent.end, 1);
      
      const healthApiUrl = `${protocol}://${req.headers['host']}/api/health?serial=${serial_number}&start=${apiStart}&end=${apiEnd}`;
      
      const dataRes = await fetch(healthApiUrl);
      if (dataRes.ok) {
        const finalContextData = await dataRes.json();
        
        // ========================================================
        // 🌟 優化：只提供比對結果狀態，讓 AI 自由發揮語氣
        // ========================================================
        const checkUploadStatus = () => {
          const targetDates = {
            "今天": local_date,
            "昨天": getCustomOffsetDate(local_date, -1),
            "前天": getCustomOffsetDate(local_date, -2)
          };

          let statusLines = ["【使用者資料上傳實時狀態】"];
          
          for (const [label, dateStr] of Object.entries(targetDates)) {
            // 只比對 record_end 是否存在
            const hasData = finalContextData.some(d => d.raw_json?.record_end?.split(' ')[0] === dateStr);
            statusLines.push(`- ${label} (${dateStr}) 的 record_end 資料：${hasData ? "【有收到資料】" : "【尚未收到資料】"}`);
          }
          return statusLines.join('\n');
        };

        // 執行比對並存入變數
        uploadStatusContext = checkUploadStatus();
        // ========================================================

        if (finalContextData.length > 0) {
          // 1. 動態產生使用者詢問的精準日期陣列（Calendar Dates）
          const dateArray = [];
          let current = parseDate(intent.start);
          const endLimit = parseDate(intent.end);
          while (current <= endLimit) {
            const yy = current.getFullYear();
            const mm = String(current.getMonth() + 1).padStart(2, '0');
            const dd = String(current.getDate()).padStart(2, '0');
            dateArray.push(`${yy}-${mm}-${dd}`);
            current.setDate(current.getDate() + 1);
          }

          // 2. 依照「日曆日期」重組文字，消滅 AI 的日期混淆
          const contextBlocks = dateArray.map(targetDate => {
            const targetDateObj = parseDate(targetDate);
            const weekday = targetDateObj.toLocaleDateString('zh-TW', { weekday: 'short' });

            // 尋找這一天的「當天早晨醒來結算」（比對 record_end 的日期部分）
            const wakeRow = finalContextData.find(d => d.raw_json?.record_end?.split(' ')[0] === targetDate);
            // 尋找這一天的「當天晚上入睡生理數據」（比對 record_date）
            const sleepRow = finalContextData.find(d => d.record_date === targetDate);

            let blockText = `=== 日期：${targetDate} (週${weekday}) ===\n`;

            // 組合早晨數據
            if (wakeRow) {
              const rawWake = wakeRow.raw_json || {};
              const battery = rawWake.Personal_Battery_weighted_round;
              const light = rawWake.light_status;
              const rhr = rawWake.RHR_raw;
              const tag = rawWake.Daily_Tag;
              const batteryDisplay = (battery === null || battery === undefined) ? "資料不足" : `${battery}%`;
              const lightDisplay = (light === null || light === undefined || light === "無資料") ? "無資料" : light;
              const rhrDisplay = (rhr === null || rhr === undefined) ? "資料不足" : `${rhr}bpm`;
              const tagDisplay = (tag === null || tag === undefined || tag === "狀態平穩") ? "狀態平穩" : tag;
              blockText += `☀️ 【當天早晨醒來結算報告 (record_end: ${targetDate})】：\n`;
              blockText += `   - 恢復指數: ${batteryDisplay}\n`;
              blockText += `   - 發炎風險: ${lightDisplay}\n`;
              blockText += `   - 靜息心率: ${rhrDisplay}\n`;
              blockText += `   - 恢復狀態: ${tagDisplay}\n`;
            } else {
              blockText += `☀️ 【當天早晨醒來結算報告 (record_end: ${targetDate})】：無數據\n`;
            }

            // 組合夜晚數據
            if (sleepRow) {
              const rawSleep = sleepRow.raw_json || {};
              const tst = rawSleep.TST_min || 0;
              const trt = rawSleep.TRT_min || 0;
              const n3Min = rawSleep.N3_min || 0;
              const n1n2Min = rawSleep.N1N2_min || 0;
              const remMin = rawSleep.REM_min || 0;
              const n3Time = `${Math.floor(n3Min / 60)}時${n3Min % 60}分`;
              const n1n2Time = `${Math.floor(n1n2Min / 60)}時${n1n2Min % 60}分`;
              const remTime = `${Math.floor(remMin / 60)}時${remMin % 60}分`;

              blockText += `🛏️ 【當天晚上入睡生理數據 (record_date: ${targetDate})】：\n`;
              blockText += `   - 總睡眠時間: ${Math.floor(tst / 60)}時${tst % 60}分\n`;
              blockText += `   - 總紀錄時間: ${Math.floor(trt / 60)}時${trt % 60}分\n`;
              
              blockText += `   - 睡眠結構: 深睡期 (N3) ${rawSleep.N3_pct || 0}% (${n3Time}), 淺睡期 (N1、N2) ${rawSleep.N1N2_pct || 0}% (${n1n2Time}), 快速動眼期 (REM) ${rawSleep.REM_pct || 0}% (${remTime}), 醒來及清醒期 (Wake) ${rawSleep.wake_minutes || 0}分\n`;
              blockText += `   - 睡眠血氧飽和度: 平均 ${rawSleep.SpO2_mean || 0}% / 最高 ${rawSleep.SpO2_max || 0}% / 最低 ${rawSleep.SpO2_min || 0}%\n`;
              blockText += `   - 睡眠低血氧時間比例: T90 ${rawSleep.T90_pct || 0}%, T89 ${rawSleep.T89_pct || 0}%, T88 ${rawSleep.T88_pct || 0}%\n`;
              blockText += `   - 低氧負擔指數: HBI低氧負擔指數 ${rawSleep.HBI || 0}%min/h\n`;
              blockText += `   - 睡眠血氧下降指數: ODI 3% ${rawSleep.ODI3_per_hour || 0}次/h, ODI 4% ${rawSleep.ODI4_per_hour || 0}次/h\n`;
              blockText += `   - 睡眠呼吸頻率: 平均 ${rawSleep.RR_mean || 0} / 最高 ${rawSleep.RR_max || 0} / 最低 ${rawSleep.RR_min || 0} rpm\n`;
              blockText += `   - 睡眠脈搏: 平均 ${rawSleep.HR_mean || 0} / 最高 ${rawSleep.HR_max || 0} / 最低 ${rawSleep.HR_min || 0} bpm\n`;
              blockText += `   - 心率變異度: SDNN ${rawSleep.SDNN || 0}ms, rMSSD ${rawSleep.rMSSD || 0}ms, LF ${rawSleep.LF_ms2 || 0}ms2, HF ${rawSleep.HF_ms2 || 0}ms2, LF/HF ${rawSleep.LF_HF || 0}, pNN50 ${rawSleep.pNN50_pct || 0}%\n`;
            } else {
              blockText += `🛏️ 【當天晚上入睡生理數據 (record_date: ${targetDate})】：無數據\n`;
            }

            return blockText;
          });

          healthContext = contextBlocks.join('\n---\n');
          
          // 多日統計摘要平均值（精準計算使用者指定的這幾天）
          if (dateArray.length >= 7) {
            const fieldsToAvg = [
              { key: 'Personal_Battery_weighted_round', label: '平均恢復指數', unit: '%', isSleep: false },
              { key: 'RHR_raw', label: '平均靜息心率', unit: 'bpm', isSleep: false },
              { key: 'TST_min', label: '平均總睡眠時間', unit: ' min', isSleep: true },
              
              { key: 'N3_pct', label: '平均深睡比例 (N3)', unit: '%', isSleep: true },
              { key: 'N1N2_pct', label: '平均淺睡比例 (N1、N2)', unit: '%', isSleep: true },
              { key: 'REM_pct', label: '平均快速動眼期比例 (REM)', unit: '%', isSleep: true },
              { key: 'SpO2_mean', label: '平均血氧飽和度', unit: '%', isSleep: true },
              { key: 'T90_pct', label: '平均T90比例', unit: '%', isSleep: true },
              { key: 'T89_pct', label: '平均T89比例', unit: '%', isSleep: true },
              { key: 'T88_pct', label: '平均T88比例', unit: '%', isSleep: true },
              { key: 'HBI', label: '平均低氧負擔指數', unit: '%min/h', isSleep: true },
              { key: 'ODI3_per_hour', label: '平均 ODI 3%', unit: '次/h', isSleep: true },
              { key: 'ODI4_per_hour', label: '平均 ODI 4%', unit: '次/h', isSleep: true },
              { key: 'HR_mean', label: '平均脈搏', unit: 'bpm', isSleep: true },
              { key: 'RR_mean', label: '平均呼吸頻率', unit: 'rpm', isSleep: true },
              { key: 'SDNN', label: '平均SDNN', unit: 'ms', isSleep: true },
              { key: 'rMSSD', label: '平均rMSSD', unit: 'ms', isSleep: true },
              { key: 'LF_ms2', label: '平均LF', unit: 'ms2', isSleep: true },
              { key: 'HF_ms2', label: '平均HF', unit: 'ms2', isSleep: true },
              { key: 'LF_HF', label: '平均LF/HF', unit: '', isSleep: true },
              { key: 'pNN50_pct', label: '平均pNN50', unit: '%', isSleep: true }
            ];

            const summaryLines = fieldsToAvg.map(field => {
              let sum = 0;
              let count = 0;
              dateArray.forEach(targetDate => {
                const row = field.isSleep 
                  ? finalContextData.find(d => d.record_date === targetDate)
                  : finalContextData.find(d => d.raw_json?.record_end?.split(' ')[0] === targetDate);
                
                if (row && row.raw_json?.[field.key] !== undefined && row.raw_json?.[field.key] !== null) {
                  sum += Number(row.raw_json[field.key]) || 0;
                  count++;
                }
              });
              const avg = count > 0 ? (sum / count).toFixed(1) : "0.0";
              return `- ${field.label}：${avg}${field.unit || ''}`;
            });

            healthContext = `【多日統計摘要 (共 ${dateArray.length} 天)】\n${summaryLines.join('\n')}\n` + healthContext;
          }
        } else {
          // 🌟 這裡就是你問的整合點：當資料庫完全沒資料時，強制告訴 AI 這三天都是「尚未收到資料」
          const yesterdayStr = getCustomOffsetDate(local_date, -1);
          const beforeYesterdayStr = getCustomOffsetDate(local_date, -2);
          uploadStatusContext = `【使用者資料上傳實時狀態】\n- 今天 (${local_date}) 的 record_end 資料：【尚未收到資料】\n- 昨天 (${yesterdayStr}) 的 record_end 資料：【尚未收到資料】\n- 前天 (${beforeYesterdayStr}) 的 record_end 資料：【尚未收到資料】`;
        }
      }
    }

    // ==========================================
    // 第三階段：Gemini 2.5 Flash 超級大腦最終整合
    // ==========================================
    
    // 🌟 調整 3：注入【身份鎖定】並強制控制語氣
    const systemPrompt = `【身份鎖定】
你永遠是 Soosyn Health Companion 的 AI 健康夥伴。
絕對禁止自稱：Google AI、Gemini、大型語言模型、第三方AI。
若被問到模型來源，請回答：「我是 Soosyn Health Companion 的 AI 健康夥伴，專門協助你解讀健康數據與提供健康管理建議。」
你的名字：${ai_name}
使用者暱稱：${nickname}

今天是 ${local_date}。

【重要數據與參考資訊】
1. 🧑‍⚕️ 使用者個人健康數據：
   ${healthContext}
2. 📚 專業醫療標準與地端知識庫 (請100%絕對遵照此區塊資訊)：
   ${ragContext}
3. ☁️ 外部即時環境資訊：
   ${externalContext}
4. 🔄 資料上傳狀態：
   ${uploadStatusContext}

【對話與邏輯規則】
1. 嚴禁使用敬稱，請一律用「你」稱呼對方（${nickname}）。語氣要像平輩朋友一樣自然，可加上適合的 emoji。
2. 絕對不可以輸出 JSON、程式碼標籤或 Markdown code block。
3. 【因果邏輯分析】：當天早晨的「恢復指數」與「發炎風險」(隸屬 record_end) 是由「前一天晚上」的入睡生理數據 (隸屬 record_date，即 record_end 減去一天) 計算而來的。
   👉 舉例：若使用者問 record_end 2026-06-21 的恢復狀況，你必須提取並分析 record_date 2026-06-20 的「晚上入睡生理數據」來幫他找原因。
4. 【絕對忠於知識庫與超連結限制】：
   - 內容忠誠：當涉及裝置操作(APP、ST-50)、指標定義或標準範圍(如 N3、血氧)時，請「完全依照」上述【📚 專業醫療標準與地端知識庫】的內容回答。你的自有知識與外部資訊僅用於「補充」地端知識庫未涵蓋的生活建議，絕不可推翻知識庫原有內容。
   - 網址輸出限制：當需要引導使用者查看說明書、APP下載或健康指標的深入文章時，請務必根據系統在知識庫中強制附加的特殊標籤（例如 %%開頭與結尾的代碼%%）「原封不動」地輸出在對話中。
   👉 【鐵律】：嚴禁自行拼湊、臆測或發明任何帶有 http 或 https 的網址連結！你絕對只能輸出系統給予的 %% 格式標籤代碼。
5. 將天氣/外部環境資訊跟他的睡眠/心率狀態進行關聯提醒。
6. 針對問題直接回答，不要再說「歡迎回來」等開場白。
7. 【字數控制】：你自行生成的說明文字請盡量控制在 200 到 250 字左右（但不包含你要輸出的知識庫超連結與表格內容），保持精簡扼要。`;

    let geminiHistory = history.map(h => {
      const textContent = h.content || (h.parts && h.parts[0] && h.parts[0].text) || '';
      return { role: h.role === 'user' ? 'user' : 'model', parts: [{ text: textContent }] };
    });
    
    geminiHistory.push({ role: 'user', parts: [{ text: prompt }] });

    let finalRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: geminiHistory
      })
    });
    
    let finalResult = await finalRes.json();
    let finalText = finalResult.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "哎呀，我剛剛腦袋稍微打結了 😅。請再問我一次好嗎？";

    // ==========================================
    // 🚀 全動態標籤真實網址還原區塊 (不論未來新增多少連結，行數永遠固定)
    // ==========================================
    linkRules.forEach(rule => {
      // 建立動態正則表達式，全域替換該標籤
      const regex = new RegExp(rule.tag, 'g');
      finalText = finalText.replace(regex, rule.markdown_content);
    });

    const logTask = fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
      method: 'POST',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        serial_number: serial_number, user_query: prompt, ai_response: finalText,
        record_date: local_date, record_time: local_time, ai_model: 'Gemini-2.5-Flash-HybridRAG'
      })
    }).catch(e => console.error("背景存檔錯誤:", e));

    waitUntil(logTask);

    return res.status(200).json({ text: finalText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "大腦卡住了，再試試？ 😅" });
  }
}
