// sleep-reminder_03
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // 取得台北時間的今天、昨天、前天
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  const dayBeforeYesterdayDate = new Date();
  dayBeforeYesterdayDate.setDate(dayBeforeYesterdayDate.getDate() - 2);
  const dayBeforeYesterday = dayBeforeYesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  try {
    // 1. 取得所有有 LINE ID 的使用者
    const { data: users, error: userError } = await supabase
      .from('user_credentials')
      .select('serial_number, line_user_id')
      .not('line_user_id', 'is', null);

    if (userError) throw userError;

    // 2. 取得「昨天」與「前天」的健康數據 (因為昨天的資料才是最新的睡眠結果)
    const { data: healthData, error: healthError } = await supabase
      .from('health_data')
      .select('serial_number, record_date, raw_json')
      .in('record_date', [yesterday, dayBeforeYesterday]);

    if (healthError) throw healthError;

    const metrics = ['Battery_TST_min_A', 'Battery_N3_pct_A', 'Battery_rMSSD_A', 'Battery_HBI_A', 'Battery_HR_min_A'];

    // 3. 使用 Promise.all 平行處理所有使用者的任務
    const results = await Promise.all(users.map(async (user) => {
      try {
        // 修改對應關係：userYesterday 變為本次分析的主體
        const userYesterday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === yesterday);
        const userBeforeYesterday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === dayBeforeYesterday);

        if (!userYesterday || !userYesterday.raw_json) {
          return { serial: user.serial_number, status: "Skipped", reason: "昨天(最新)沒資料" };
        }

        // --- 計算邏輯：比較「昨天」與「前天」 ---
        let targetMetric = '';
        if (userBeforeYesterday && userBeforeYesterday.raw_json) {
          let minDiff = Infinity;
          metrics.forEach(m => {
            // 計算退步最多的指標 (昨天 vs 前天)
            const diff = (userYesterday.raw_json[m] || 0) - (userBeforeYesterday.raw_json[m] || 0);
            if (diff < minDiff) {
              minDiff = diff;
              targetMetric = m;
            }
          });
        } else {
          // 若無前天資料，則找昨天數值最低的
          let minValue = Infinity;
          metrics.forEach(m => {
            const val = userYesterday.raw_json[m] || 0;
            if (val < minValue) {
              minValue = val;
              targetMetric = m;
            }
          });
        }

        // 根據昨天的總睡眠時間與最差指標決定詞句
        const tstMin = userYesterday.raw_json.TST_min || 0;
        const logicKeys = getLogicKeys(targetMetric, tstMin);
        
        // 抓取詞句
        const { data: phrases } = await supabase
          .from('phrase_library')
          .select('detailed_content')
          .in('logic_key', logicKeys);

        if (!phrases || phrases.length === 0) {
          return { serial: user.serial_number, status: "Error", reason: "找不到對應詞句" };
        }

        const message = phrases[Math.floor(Math.random() * phrases.length)].detailed_content;
        const sendStatus = await sendLineMessage(user.line_user_id, message);
        
        return {
          serial: user.serial_number,
          target_date: yesterday,
          metric: targetMetric,
          status: sendStatus
        };

        // --- 計算邏輯結束 ---

      } catch (err) {
        // 捕捉單一使用者處理過程中的錯誤，確保不影響其他人
        return { serial: user.serial_number, status: "Error", message: err.message };
      }
    }));

    res.status(200).json({ execution_date: todayStr, results });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// 根據指標與睡眠分鐘數，回傳對應的 logic_key 陣列
function getLogicKeys(metric, tstMin) {
  let base = '';
  switch (metric) {
    case 'Battery_TST_min_A':
      return tstMin < 420 ? ['總睡眠睡前提醒1', '總睡眠睡前提醒2', '總睡眠睡前提醒3'] 
                          : ['總睡眠睡前提醒4', '總睡眠睡前提醒5', '總睡眠睡前提醒6'];
    case 'Battery_N3_pct_A': base = 'N3睡前提醒'; break;
    case 'Battery_rMSSD_A': base = 'rMSSD睡前提醒'; break;
    case 'Battery_HBI_A': base = 'HBI睡前提醒'; break;
    case 'Battery_HR_min_A': base = '最低脈搏睡前提醒'; break;
  }
  return [`${base}1`, `${base}2`, `${base}3`];
}

async function sendLineMessage(lineUserId, text) {
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${lineToken}`
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text }]
    })
  });
  return response.ok ? 'success' : 'failed';
}
