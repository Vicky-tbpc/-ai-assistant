const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function (req, res) {
  // 強制取得台北時間日期
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  try {
    // 1. 取得有 LINE ID 的使用者
    const { data: users, error: userError } = await supabase
      .from('user_credentials')
      .select('serial_number, line_user_id')
      .not('line_user_id', 'is', null);

    if (userError) throw userError;

    // 2. 取得今天與昨天的健康資料
    const { data: healthData, error: healthError } = await supabase
      .from('health_data')
      .select('serial_number, record_date, raw_json')
      .in('record_date', [today, yesterday]);

    if (healthError) throw healthError;

    const results = [];

    for (const user of users) {
      const userToday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === today);
      const userYesterday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === yesterday);

      if (!userToday || !userToday.raw_json) continue;

      const metrics = ['Battery_TST_min_A', 'Battery_N3_pct_A', 'Battery_rMSSD_A', 'Battery_HBI_A', 'Battery_HR_min_A'];
      let targetMetric = '';

      if (userYesterday && userYesterday.raw_json) {
        // 邏輯 A：計算降幅最大的指標 (今天 - 昨天，找最小值)
        let minDiff = Infinity;
        metrics.forEach(m => {
          const diff = (userToday.raw_json[m] || 0) - (userYesterday.raw_json[m] || 0);
          if (diff < minDiff) {
            minDiff = diff;
            targetMetric = m;
          }
        });
      } else {
        // 邏輯 B：沒有昨天資料，找今天數值最低的
        let minValue = Infinity;
        metrics.forEach(m => {
          const val = userToday.raw_json[m] || 0;
          if (val < minValue) {
            minValue = val;
            targetMetric = m;
          }
        });
      }

      // 3. 決定 Logic Key
      const logicKeyBase = getLogicKeyBase(targetMetric, userToday.raw_json.TST_min);
      
      // 4. 從 Library 隨機挑選訊息並發送
      const message = await getRandomPhrase(logicKeyBase);
      if (message) {
        const status = await sendLineMessage(user.line_user_id, message);
        results.push({ user: user.serial_number, metric: targetMetric, status });
      }
    }

    res.status(200).json({ date: today, results });

  } catch (error) {
    console.error('API Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// 根據指標與睡眠時間判定 Logic Key 前綴
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

// 根據前綴隨機抓取訊息
async function getRandomPhrase(base) {
  let keys = [];
  if (base === '總睡眠睡前提醒123') keys = ['總睡眠睡前提醒1', '總睡眠睡前提醒2', '總睡眠睡前提醒3'];
  else if (base === '總睡眠睡前提醒456') keys = ['總睡眠睡前提醒4', '總睡眠睡前提醒5', '總睡眠睡前提醒6'];
  else keys = [`${base}1`, `${base}2`, `${base}3`];

  const { data } = await supabase
    .from('phrase_library')
    .select('content') // 假設欄位名稱是 content，請根據實際調整
    .in('logic_key', keys);

  if (!data || data.length === 0) return null;
  return data[Math.floor(Math.random() * data.length)].content;
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