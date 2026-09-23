// api/layout.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
    const { method } = req;

    if (method === 'GET') {
        const { serial_number } = req.query;
        const { data, error } = await supabase
            .from('user_preferences')
            .select('card_layout')
            .eq('serial_number', serial_number)
            .single();

        if (error || !data) {
            // 如果沒有資料，回傳預設的區塊順序
            return res.status(200).json({ 
                layout: ['block4', 'block5', 'block6', 'block7', 'block8', 'block9', 'block10', 'block11', 'block12'] 
            });
        }
        return res.status(200).json({ layout: data.card_layout });
    } 
    
    if (method === 'POST') {
        const { serial_number, layout } = req.body;
        // 使用 upsert 來新增或更新資料
        const { error } = await supabase
            .from('user_preferences')
            .upsert({ serial_number, card_layout: layout }, { onConflict: 'serial_number' });

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${method} Not Allowed`);
}