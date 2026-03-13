// daily-reminder_03
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function (req, res) {
  // --- 身分驗證與防誤觸邏輯 ---
  const authHeader = req.headers['x-vercel-cron'];
  const isManual = req.query && req.query.manual === 'true';

  if (!authHeader && !isManual) {
    return res.status(401).json({ 
      status: "Unauthorized",
      message: "此 API 僅限排程執行。如需手動測試，請在網址後方加上 ?manual=true" 
    });
  }
  // ---------------------------

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  try {
    const { data: users, error: userError } = await supabase
      .from('user_credentials')
      .select('serial_number, line_user_id')
      .not('line_user_id', 'is', null);

    if (userError) throw userError;

    const { data: surveys, error: surveyError } = await supabase
      .from('user_daily_surveys')
      .select('serial_number')
      .eq('record_date', today);

    if (surveyError) throw surveyError;

    const finishedSerials = new Set(surveys.map(s => s.serial_number));
    const pendingUsers = users.filter(u => !finishedSerials.has(u.serial_number));

    const results = await Promise.all(pendingUsers.map(async (user) => {
      try {
        const result = await sendLineReminder(user.line_user_id);
        return { user: user.serial_number, status: result };
      } catch (e) {
        return { user: user.serial_number, status: 'error', message: e.message };
      }
    }));

    res.status(200).json({ 
      date: today,
      total_pending: pendingUsers.length,
      results: results 
    });
  } catch (error) {
    console.error('API Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

async function sendLineReminder(lineUserId) {
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${lineToken}`
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{
        type: 'text',
        text: `早安！提醒你：今天還沒紀錄健康狀況喔 😊\n\n請登入填寫：\nhttps://ai-assistant-eight-puce.vercel.app/`
      }]
    })
  });
  
  return response.ok ? 'success' : 'failed';
}
