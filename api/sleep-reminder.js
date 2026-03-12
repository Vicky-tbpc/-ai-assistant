const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function (req, res) {
  // 強制取得台北時間日期 (YYYY-MM-DD)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  const debugLog = []; // 用來存放除錯資訊

  try {
    // 1. 取得所有有 LINE ID 的使用者
    const { data: users, error: userError } = await supabase
      .from('user_credentials')
      .select('serial_number, line_user_id')
      .not('line_user_id', 'is', null);

    if (userError) throw userError;
    
    debugLog.push({ step: "1. Fetch Users", count: users?.length || 0, users });

    // 2. 取得今天與昨天的健康資料
    const { data: healthData, error: healthError } = await supabase
      .from('health_data')
      .select('serial_number, record_date, raw_json')
      .in('record_date', [today, yesterday]);

    if (healthError) throw healthError;
    
    debugLog.push({ step: "2. Fetch Health Data", count: healthData?.length || 0 });

    const results = [];
    const metrics = ['Battery_TST_min_A', 'Battery_N3_pct_A', 'Battery_rMSSD_A', 'Battery_HBI_A', 'Battery_HR_min_A'];

    for (const user of users) {
      const userToday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === today);
      const userYesterday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === yesterday);

      // 檢查今天是否有資料
      if (!userToday || !userToday.raw_json) {
        debugLog.push({ serial: user.serial_number, status: "Skipped", reason: `今天 (${today}) 沒資料` });
        continue;
      }

      let targetMetric = '';
      let calculationType = '';

      // 邏輯判斷：比較今天與昨天
      if (userYesterday && userYesterday.raw_json) {
        calculationType = "Compare with yesterday";
        let minDiff = Infinity;
        metrics.forEach(m => {
          const diff = (userToday.raw_json[m] || 0) - (userYesterday.raw_json[m] || 0);
          if (diff < minDiff) {
            minDiff = diff;
            targetMetric = m;
          }
        });
      } else {
        calculationType = "No yesterday data, find lowest today";
        let minValue = Infinity;
        metrics.forEach(m => {
          const val = userToday.raw_json[m] || 0;
          if (val < minValue) {
            minValue = val;
            targetMetric = m;
          }
        });
      }

      // 取得 TST_min 並判定 Logic Key
      const tstMin = userToday.raw_json.TST_min;
      
      // 除錯：檢查是否缺少關鍵欄位
      if (targetMetric === 'Battery_TST_min_A' && tstMin === undefined) {
        debugLog.push({ serial: user.serial_number, status: "Error", reason: "raw_json 缺少 TST_min 欄位" });
        continue;
      }

      const logicKeyBase = getLogicKeyBase(targetMetric, tstMin);
      
      // 取得隨機訊息
      const message = await getRandomPhrase(logicKeyBase);
      
      if (!message) {
        debugLog.push({ 
          serial: user.serial_number, 
          status: "Error", 
          reason: `在 phrase_library 找不到對應的 LogicKey: ${logicKeyBase}` 
        });
        continue;
      }

      // 發送 LINE 通知
      const sendStatus = await sendLineMessage(user.line_user_id, message);
      
      results.push({
        serial: user.serial_number,
        metric: targetMetric,
        logicKeyBase,
        calc: calculationType,
        send: sendStatus
      });
    }

    res.status(200).json({
      date: today,
      debug: debugLog,
      results: results
    });

  } catch (error) {
    res.status(500).json({ error: error.message, debug: debugLog });
  }
};

// 輔助函式：判斷 Logic Key 基底
function getLogicKeyBase(metric, tstMin) {
  switch (metric) {
    case 'Battery_TST_min_A':
      return tstMin < 420 ? '總睡眠睡前提醒123' : '總睡眠睡前提醒456';
    case 'Battery_N3_pct_A': return 'N3睡前提醒';
    case 'Battery_rMSSD_A': return 'rMSSD睡前提醒';
    case 'Battery_HBI_A': return 'HBI睡前提醒';
    case 'Battery_HR_min_A': return '最低脈搏睡前提醒';
    default: return '';
  }
}

// 輔助函式：從 Library 隨機抓取文字
async function getRandomPhrase(base) {
  let keys = [];
  if (base === '總睡眠睡前提醒123') keys = ['總睡眠睡前提醒1', '總睡眠睡前提醒2', '總睡眠睡前提醒3'];
  else if (base === '總睡眠睡前提醒456') keys = ['總睡眠睡前提醒4', '總睡眠睡前提醒5', '總睡眠睡前提醒6'];
  else keys = [`${base}1`, `${base}2`, `${base}3`];

  const { data } = await supabase
    .from('phrase_library')
    .select('logic_key') // 請確認你資料表存文字的欄位名稱
    .in('logic_key', keys);

  if (!data || data.length === 0) return null;
  return data[Math.floor(Math.random() * data.length)].content;
}

// 輔助函式：發送 LINE 訊息
async function sendLineMessage(lineUserId, text) {
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  try {
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
    return response.ok ? 'success' : `failed: ${response.status}`;
  } catch (e) {
    return `error: ${e.message}`;
  }
}
