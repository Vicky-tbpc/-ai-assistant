import { createClient } from '@supabase/supabase-js';

// 初始化 Supabase (建議使用 Service Role Key 以跳過 RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // 安全檢查：確保只有 Vercel Cron 可以觸發
  // if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
  //   return res.status(401).end('Unauthorized');
  // }

  const today = new Date().toISOString().split('T')[0]; // 格式: 2024-05-20

  try {
    // 1. 取得所有有 LINE ID 的使用者
    const { data: users, error: userError } = await supabase
      .from('user_credentials')
      .select('serial_number, line_user_id')
      .not('line_user_id', 'is', null);

    if (userError) throw userError;

    // 2. 取得今天已經填寫過資料的序號清單
    const { data: surveys, error: surveyError } = await supabase
      .from('user_daily_surveys')
      .select('serial_number')
      .eq('record_date', today);

    if (surveyError) throw surveyError;

    const finishedSerials = new Set(surveys.map(s => s.serial_number));

    // 3. 篩選出今天還沒填寫的使用者
    const pendingUsers = users.filter(u => !finishedSerials.has(u.serial_number));

    // 4. 批次發送 LINE 通知
    for (const user of pendingUsers) {
      await sendLineReminder(user.line_user_id);
    }

    return res.status(200).json({ 
      message: `通知發送完成，共發送 ${pendingUsers.length} 位。` 
    });

  } catch (error) {
    console.error('Cron Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function sendLineReminder(lineUserId) {
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  
  const message = {
    to: lineUserId,
    messages: [{
      type: 'text',
      text: `早安！灰盾提醒你：今天還沒紀錄健康狀況喔 😊\n\n請點擊連結登入填寫：\nhttps://ai-assistant-eight-puce.vercel.app/test2.html`
    }]
  };

  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${lineToken}`
    },
    body: JSON.stringify(message)
  });
}