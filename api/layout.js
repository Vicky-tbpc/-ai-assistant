// api/layout.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
// 這裡確認 Vercel 的環境變數名稱是否一致
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

// 如果連環境變數都沒抓到，及早報錯避免後續 500
if (!supabaseUrl || !supabaseKey) {
    console.error('缺少 Supabase 環境變數設定');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
    const { method } = req;

    if (method === 'GET') {
        try {
            const { serial_number } = req.query;

            if (!serial_number) {
                return res.status(400).json({ error: '缺少 serial_number 參數' });
            }

            const { data, error } = await supabase
                .from('user_preferences')
                .select('card_layout')
                .eq('serial_number', serial_number)
                .single();

            // PGRST116 是 Supabase「找不到單筆資料」的標準錯誤代碼，這是正常的（代表新用戶）
            if (error && error.code !== 'PGRST116') {
                console.error('Supabase 讀取錯誤:', error);
                throw error;
            }

            // 如果沒有資料，回傳預設的區塊順序
            if (!data) {
                return res.status(200).json({ 
                    layout: ['block4', 'block5', 'block6', 'block7', 'block8', 'block9', 'block10', 'block11', 'block12'] 
                });
            }

            return res.status(200).json({ layout: data.card_layout });

        } catch (err) {
            console.error('GET 請求發生例外錯誤:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    } 
    
    if (method === 'POST') {
        try {
            // 確保 Vercel 有正確解析 JSON (有時 Content-Type 沒設對會變成字串)
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { serial_number, layout } = body;

            // 防呆：確保前端有傳入必要的資料
            if (!serial_number || !layout || !Array.isArray(layout)) {
                console.error('POST 資料格式錯誤:', body);
                return res.status(400).json({ error: '缺少 serial_number 或 layout 格式錯誤' });
            }

            // 使用 upsert 來新增或更新資料，順便更新 updated_at
            const { data, error } = await supabase
                .from('user_preferences')
                .upsert({ 
                    serial_number: serial_number, 
                    card_layout: layout,
                    updated_at: new Date().toISOString() // 確保每次寫入都有新的時間戳記
                }, { 
                    onConflict: 'serial_number' 
                });

            if (error) {
                console.error('Supabase 寫入錯誤:', error);
                return res.status(500).json({ error: error.message });
            }

            return res.status(200).json({ success: true, data });

        } catch (err) {
            console.error('POST 請求發生例外錯誤:', err);
            return res.status(500).json({ error: 'Internal Server Error', details: err.message });
        }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${method} Not Allowed`);
}
