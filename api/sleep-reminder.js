const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function (req, res) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  const debugLog = [];

  try {
    const { data: users, error: userError } = await supabase
      .from('user_credentials')
      .select('serial_number, line_user_id')
      .not('line_user_id', 'is', null);

    if (userError) throw userError;

    const { data: healthData, error: healthError } = await supabase
      .from('health_data')
      .select('serial_number, record_date, raw_json')
      .in('record_date', [today, yesterday]);

    if (healthError) throw healthError;

    const results = [];
    const metrics = ['Battery_TST_min_A', 'Battery_N3_pct_A', 'Battery_rMSSD_A', 'Battery_HBI_A', 'Battery_HR_min_A'];

    for (const user of users) {
      const userToday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === today);
      const userYesterday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === yesterday);

      if (!userToday || !userToday.raw_json) {
        debugLog.push({ serial: user.serial_number, status: "Skipped", reason: `今天 (${today}) 沒資料` });
        continue;
      }

      let targetMetric = '';
      if (userYesterday && userYesterday.raw_json) {
        let minDiff = Infinity;
        metrics.forEach(m => {
          const diff = (userToday.raw_json[m] || 0) - (userYesterday.raw_json[m] || 0);
          if (diff < minDiff) {
            minDiff = diff;
            targetMetric = m;
          }
        });
      } else {
        let minValue = Infinity;
        metrics.forEach(m => {
          const val = userToday.raw_json[m] || 0;
          if (val < minValue) {
            minValue = val;
            targetMetric = m;
          }
        });
      }

      const tstMin = userToday.raw_json.TST_min || 0;
      const logicKeys = getLogicKeys(targetMetric, tstMin);
      
      // 從 phrase_library 抓取資料，欄位改為 detailed_content
      const { data: phrases } = await supabase
        .from('phrase_library')
        .select('detailed_content')
        .in('logic_key', logicKeys);

      if (!phrases || phrases.length === 0) {
        debugLog.push({ 
          serial: user.serial_number, 
          status: "Error", 
          reason: `找不到對應的 LogicKeys: ${logicKeys.join(', ')}` 
        });
        continue;
      }

      // 隨機選一個內容
      const message = phrases[Math.floor(Math.random() * phrases.length)].detailed_content;
      const sendStatus = await sendLineMessage(user.line_user_id, message);
      
      results.push({
        serial: user.serial_number,
        metric: targetMetric,
        send: sendStatus
      });
    }

    res.status(200).json({ date: today, debug: debugLog, results });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 根據指標與睡眠分鐘數，回傳對應的 3 個 logic_key 陣列
function getLogicKeys(metric, tstMin) {
  let base = '';
  switch (metric) {
    case 'Battery_TST_min_A':
      base = tstMin < 420 ? '總睡眠睡前提醒' : '總睡眠睡前提醒';
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
