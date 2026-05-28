// qwen_function_18.js
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
    const { prompt, serial_number, history = [], local_date, local_time, action, metric_data } = req.body;

    // ==========================================
    // 客製化 AI 開場白攔截區塊
    // ==========================================
    if (action === 'generate_greeting') {
      const greetingPrompt = `你是一個友好熱情的 AI 健康夥伴。
請根據以下提示，生成一句專屬的開場白。

【規則】
1. 第一句請自由發揮，表達歡迎回來的心情，例如：「歡迎回來！我是你的健康夥伴 👋」。
2. 【絕對禁止】：嚴格禁止在對話中出現使用者的名字或 AI 的名字，請用「你」來稱呼對方即可。
3. 接著請根據以下指標狀態給予一句${metric_data.type}：
   - 指標：${metric_data.metric}
   - 狀態：${metric_data.status}
4. 說明完後，最後加上一句引導詢問，例如：「接下來想看看哪個健康指標呢？」或「現在想從哪個部分開始了解呢？」
5. 語氣要像平輩朋友一樣自然。
6. 【絕對禁止】：嚴格禁止使用敬稱「您」，請全部使用「你」。

請直接輸出對話文字，不要包含額外的解釋或 JSON 格式。`;

      let greetingRes = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: greetingPrompt, mode: "chat" })
      });
      
      let greetingResult = await greetingRes.json();
      
      // ✨ 貼在這裡！過濾開場白的內心戲
      const cleanGreeting = greetingResult.textResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return res.status(200).json({ text: cleanGreeting });
    }

    // ==========================================
    // 第一階段：主控地端 AI 意圖判斷 (Router)
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

    // 🌟 修正點：強化第3點的意圖判斷，強制綁定個人生理數據
    const routerPrompt = `今天是 ${local_date} (${dayOfWeek})。
請判斷使用者的問題：「${prompt}」的意圖。

【判斷規則】
1. 【圖表嚴格限制】：只有當使用者「明確提到視覺化圖表的關鍵字」（例如：「趨勢圖」、「圖表」、「折線圖」、「畫圖」、「看圖」）時，才將 need_trend_chart 設為 true。
   - 若 need_trend_chart 為 true，請判斷他想看哪一種，將 trend_type 設為以下之一："all"(完整/全部)、"battery"(恢復指數)、"rhr"(靜息心率)、"n3"(深睡期)、"rmssd"、"hrmin"(最低脈搏)、"hbi"(低氧負擔)、"unknown"(未指定)。
2. 【數據與指標查詢】：
   - 若使用者只是提到「7天」、「最近」、「變化」、「趨勢」或單純詢問各項指標數據，但「沒有明確提到畫圖或圖表」，請務必將 need_trend_chart 設為 false，並將 need_data 設為 true，輸出對應的 start 和 end 日期。
   - 🚨【指標科普防呆】：只要使用者的問題中包含了具體的健康指標名稱（例如：「靜息心率」、「深睡」、「血氧」、「HBI」等），不論他是問定義、問科普還是問好壞（例如：「靜息心率愈低愈好嗎」），請「一律強制」將 need_data 設為 true，並將 start 設為上週 (${lastWeekStartStr})，end 設為今天 (${local_date})。因為我們需要撈取他最近的數據，讓回答能結合他的個人現況！
3. 【外部資訊與綜合風險評估】：(極度重要)
   - 判斷使用者的問題是否需要外部環境資訊（例如：天氣、氣溫、中暑風險、流行疾病等）。若是，將 need_external 設為 true，並在 external_query 寫下搜尋關鍵字（例如：「評估今日高溫與中暑風險」）。
   - 🚨【強制綁定數據】：只要使用者詢問「我今天會不會中暑」、「我適合運動嗎」這類需要結合個人身體狀況來判斷的環境風險問題，請「務必同時」將 need_data 設為 true，並將 start 設為昨天 (${yesterdayStr})，end 設為今天 (${local_date})，這樣才能撈取他的生理數據做交叉比對！
4. 若回答模糊（例如：「都可以」、「看看」）或只是打招呼，請「一律視為需要數據」，並將日期設為昨天到今天：${yesterdayStr} 到 ${local_date}。
5. 只有在明確閒聊且完全無關健康時，才將 need_data 與 need_external 設為 false。

【日期對照表】(請直接使用以下計算好的日期，絕對不要自己推算)
1. 「今天」：${local_date}
2. 「昨天」：${yesterdayStr}
3. 「上週 / 本週 / 最近一週 / 過去七天」：${lastWeekStartStr} 到 ${yesterdayStr}

請「務必只」輸出 JSON：{"need_data": true/false, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "need_trend_chart": true/false, "trend_type": "...", "need_external": true/false, "external_query": "..."}`;

    let intentRes = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: routerPrompt, mode: "chat" })
    });

    let intentData = await intentRes.json();
    let intent = { need_data: false, need_external: false };
    try {
      const jsonMatch = intentData.textResponse.match(/\{.*\}/s);
      if (jsonMatch) intent = JSON.parse(jsonMatch[0]);
    } catch (e) { console.log("意圖解析失敗"); }

    console.log("👉【地端 Router 意圖解析結果】:", JSON.stringify(intent));

    if (intent.need_trend_chart) {
      const trendNames = {
        "all": "📊 完整圖表",
        "battery": "📈 恢復指數",
        "rhr": "❤️‍ 靜息心率",
        "n3": "🌙 深睡期 (N3)",
        "rmssd": "🌿 rMSSD",
        "hrmin": "💓 睡眠最低脈搏",
        "hbi": "🫁 HBI 低氧負擔指數"
      };

      if (intent.trend_type && trendNames[intent.trend_type]) {
        return res.status(200).json({ 
          action: 'show_specific_trend', 
          trend_type: intent.trend_type,
          text: `沒問題！為你送上最近的 ${trendNames[intent.trend_type]} 趨勢圖表 👇` 
        });
      } else {
        return res.status(200).json({ 
          action: 'show_trend_options', 
          text: "🔍 想查看哪一種趨勢圖表呢？" 
        });
      }
    }

    // ==========================================
    // 新增階段：呼叫 Gemini API 獲取外部即時資訊
    // ==========================================
    let externalContext = "目前無外部即時資訊。";
    if (intent.need_external && intent.external_query) {
      try {
        const geminiApiKey = process.env.GEMINI_API_KEY;
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
        
        const geminiPrompt = `今天是 ${local_date} (${dayOfWeek})。
請針對使用者的外部查詢主題：「${intent.external_query}」，提供精簡且關鍵的外部即時環境資訊、天氣分析、或生活健康指引。
【規則】
1. 請直接給出分析結論或關鍵數據（例如：今日體感溫度高達 38 度、紫外線偏強、或是某流感正處於高峰期等）。
2. 字數請精簡控制在 150 字以內，不要有廢話，方便後續與使用者的個人生理數據進行整合。
3. 請直接輸出內容，不要包含額外的解釋或 JSON 格式。`;

        const geminiRes = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: geminiPrompt }] }],
            tools: [{ googleSearch: {} }] 
          })
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          externalContext = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "暫時無法取得外部詳細資訊。";
          console.log("✅【Gemini 聯網搜尋結果】:", externalContext);
        } else {
          const errText = await geminiRes.text();
          console.error(`❌ Gemini API 回傳錯誤狀態碼: ${geminiRes.status}, 詳情:`, errText);
          
          const fallbackUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
          const fallbackRes = await fetch(fallbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt + " (請根據你已知的知識回答即可)" }] }] })
          });
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            externalContext = fallbackData.candidates?.[0]?.content?.parts?.[0]?.text || "暫時無法取得外部詳細資訊。";
            console.log("⚠️【Gemini 降級無聯網回應】:", externalContext);
          }
        }
      } catch (e) {
        console.error("💥 呼叫 Gemini 失敗:", e);
        externalContext = "外部即時資訊連線逾時或取得失敗。";
      }
    }

    // ==========================================
    // 第二階段：抓取並「格式化」數據（完全對齊日曆日期）
    // ==========================================
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
              blockText += `☀️ 【當天早晨醒來結算報告】：\n`;
              blockText += `   - 恢復指數: ${batteryDisplay}\n`;
              blockText += `   - 發炎風險: ${lightDisplay}\n`;
              blockText += `   - 靜息心率: ${rhrDisplay}\n`;
              blockText += `   - 恢復狀態: ${tagDisplay}\n`;
            } else {
              blockText += `☀️ 【當天早晨醒來結算報告】：無數據\n`;
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

              blockText += `🛏️ 【當天晚上入睡生理數據】：\n`;
              blockText += `   - 總睡眠時間: ${Math.floor(tst / 60)}時${tst % 60}分\n`;
              blockText += `   - 總紀錄時間: ${Math.floor(trt / 60)}時${trt % 60}分\n`;
              blockText += `   - 睡眠效率: ${rawSleep.sleep_efficiency_pct || 0}%\n`;
              blockText += `   - 睡眠結構: 深睡期 (N3) ${rawSleep.N3_pct || 0}% (${n3Time}), 淺睡期 (N1、N2) ${rawSleep.N1N2_pct || 0}% (${n1n2Time}), 快速動眼期 (REM) ${rawSleep.REM_pct || 0}% (${remTime}), 醒來及清醒期 (Wake) ${rawSleep.wake_minutes || 0}分\n`;
              blockText += `   - 睡眠血氧飽和度: 平均 ${rawSleep.SpO2_mean || 0}% / 最高 ${rawSleep.SpO2_max || 0}% / 最低 ${rawSleep.SpO2_min || 0}%\n`;
              blockText += `   - 睡眠低血氧時間比例: T90 ${rawSleep.T90_pct || 0}%, T89 ${rawSleep.T89_pct || 0}%, T88 ${rawSleep.T88_pct || 0}%\n`;
              blockText += `   - 低氧負擔指數: HBI低氧負擔指數 ${rawSleep.HBI || 0}%min/h\n`;
              blockText += `   - 睡眠血氧下降指數: ODI 3% ${rawSleep.ODI3_per_hour || 0}次/h, ODI 4% ${rawSleep.ODI4_per_hour || 0}次/h\n`;
              blockText += `   - 睡眠呼吸頻率: 平均 ${rawSleep.RR_mean || 0} / 最高 ${rawSleep.RR_max || 0} / 最低 ${rawSleep.RR_min || 0} rpm\n`;
              blockText += `   - 睡眠脈搏: 平均 ${rawSleep.HR_mean || 0} / 最高 ${rawSleep.HR_max || 0} / 最低 ${rawSleep.HR_min || 0} bpm\n`;
              blockText += `   - 心率變異度: SDNN ${rawSleep.SDNN || 0}ms, rMSSD ${rawSleep.rMSSD || 0}ms, LF ${rawSleep.LF_ms2 || 0}ms2, HF ${rawSleep.HF_ms2 || 0}ms2, LF/HF ${rawSleep.LF_HF || 0}, pNN50 ${rawSleep.pNN50_pct || 0}%\n`;
            } else {
              blockText += `🛏️ 【當天晚上入睡生理數據】：無數據\n`;
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
              { key: 'sleep_efficiency_pct', label: '平均睡眠效率', unit: '%', isSleep: true },
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
    // 第三階段：最終地端 AI 整合回答
    // ==========================================
    const systemPrompt = `你是一個友好熱情的 AI 健康夥伴。今天是 ${local_date}。

【重要數據與即時環境資訊】
1. 以下是使用者從 ${intent.start || '今日'} 到 ${intent.end || '今日'} 的真實數據：
   ${healthContext}
2. 外部即時/環境資訊（由外部 API 擷取）：
3. 【資料上傳實時狀態】(這是後端精準比對 record_end 的結果)：
   ${uploadStatusContext}
   ${externalContext}

【生理數據解讀規則】
1. 【數據查閱指南】(極度重要)：
   - 數據文本已經以「=== 日期：YYYY-MM-DD ===」為區塊分好了。
   - 使用者詢問某一天的任何數據（例如：「5月12日的HBI」或「5月12日的恢復指數」），請直接至該日期的區塊內，尋找對應的「早晨醒來結算報告」或「晚上入睡生理數據」作答。
   - 後端已經幫你處理好所有的跨日、因果與日期對齊邏輯，請「百分之百相信並照抄」各日期區塊下的數據，你不需要（也絕對禁止）再自行增減日期或推算因果關係。
2. 【健康分析因果邏輯】(僅在分析原因時啟用)：
   - 若使用者進階詢問「為什麼某天早晨的恢復指數/恢復狀態/發炎風險不好？」，請理解這是由「前一天晚上入睡」的生理數據所決定的。
   - 你應主動查看「前一天日期區塊」的【當天晚上入睡生理數據】（如：血氧、HBI、心率等）來為使用者找出原因並進行關聯分析。
   - 範例：如果使用者問「為什麼我 5月12日 早上恢復指數這麼低？」，你應該去翻看「5月11日」區塊內的「晚上入睡生理數據」來幫他找出睡眠問題。
3. 【外部與健康數據整合邏輯】(極度重要)：
   - 你必須將「使用者生理數據」、「外部即時資訊」與你的「RAG知識庫」進行交叉關聯分析。
   - 範例情境：如果外部資訊顯示今天體感溫度高、中暑風險強，而生理數據顯示使用者「昨晚睡眠不足（總睡眠時間短或深睡 N3 不足）」或「發炎風險/心率偏高」，你必須在回答中主動點出這兩者的危險加乘效應（如：天氣熱 + 你昨晚沒睡飽 = 中暑機率大增！），並給予客製化的貼心提醒。
4. 【嚴禁自行推算星期】：數據文本中已經在日期後方標註了正確的星期幾（例如：2026-05-14 (週四)）。請直接「照抄」文本裡的星期，絕對不要自己推算或猜測！
5. 若數據中顯示「資料不足」或是「無資料」，請誠實告知使用者，不要猜測。
6. 【知識庫使用規範】：
   - 知識庫僅用於「醫學常識」與「各項指標的標準值/參考範圍」查詢。
   - 【嚴格禁止】：絕對不可將知識庫 PDF 裡的「範例個案數值」誤當作是使用者的數據。
7. 【禁止輸出 JSON】：你現在是面對使用者的最終客服，請用自然、親切的對話回答，絕對不可以輸出 JSON 格式或任何程式碼字串。
8. 【極度重要！對話延續規則】：你和使用者已經打過招呼了！後續的回覆請「直接針對問題回答」，嚴格禁止再說出「歡迎回來」、「我是你的健康夥伴」或任何類似的自我介紹開場白！
9. 【資料上傳狀態回覆邏輯】：
   - 當使用者關心「今天/昨天/前天有沒有成功上傳資料」或「有沒有收到數據」時，請務必先查看上方【資料上傳實時狀態】對應日期的結果。
   - 【回覆原則】：如果狀態為「有收到資料」，請用你溫暖、平輩朋友的口吻，高興地告訴對方有收到；如果狀態為「尚未收到資料」，則貼心地提醒對方目前還沒看到。
   - 【重要】：請保持對話的自然與彈性，你可以自己加上適合的 emoji (例如：🎉, 👀, 喔～)，不要回答得像系統罐頭訊息！

請用平輩口吻回答，多用 emoji！全部使用「你」，絕對禁止使用敬稱「您」。`;

    const historyText = history.map(h => {
      const textContent = h.content || (h.parts && h.parts[0] && h.parts[0].text) || '';
      return `${h.role === 'user' ? '使用者' : '助理'}: ${textContent}`;
    }).join('\n');
    const finalChatPrompt = `${systemPrompt}\n\n${historyText}\n使用者: ${prompt}`;

    let finalRes = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: finalChatPrompt, mode: "chat" })
    });
    
    let finalResult = await finalRes.json();
    
    // ✨ 貼在這裡！直接把過濾後的文字存進 aiText
    const aiText = finalResult.textResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // 背景存檔任務
    const logTask = fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
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
        ai_response: aiText,
        record_date: local_date,
        record_time: local_time,
        ai_model: 'LLM-Qwen-function'
      })
    }).catch(e => console.error("背景存檔錯誤:", e));

    waitUntil(logTask);

    return res.status(200).json({ text: aiText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "大腦卡住了，再試試？ 😅" });
  }
}
