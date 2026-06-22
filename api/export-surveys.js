// export-surveys.js
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: '只允許 GET 請求' });
    }

    // 初始化 Supabase
    // 請確認 Vercel 環境變數有設定 SUPABASE_URL 和 SUPABASE_KEY
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // 1. 抓取問卷資料，優先依照 record_date 排序，確保日期越早的在越上面
        const { data, error } = await supabase
            .from('user_daily_surveys')
            .select('serial_number, record_date, subjective_score, physical_abnormality, created_at')
            .order('record_date', { ascending: true })
            .order('created_at', { ascending: true }); 

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).send('找不到任何問卷資料');
        }

        // 2. 依照 serial_number 將資料分組，順便把欄位改成中文表頭
        const groupedData = {};
        data.forEach(row => {
            const sn = row.serial_number || '未分類';
            if (!groupedData[sn]) {
                groupedData[sn] = [];
            }
            
            // 整理匯出的欄位格式與中文標題
            groupedData[sn].push({
                "使用者序號": row.serial_number,
                "紀錄日期": row.record_date,
                "主觀電量評分": row.subjective_score !== null ? row.subjective_score : "",
                "身體異常狀況": row.physical_abnormality || "",
                "系統寫入時間": new Date(row.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
            });
        });

        // 3. 建立 Excel Workbook
        const wb = XLSX.utils.book_new();

        // 4. 將每一組序號轉成一個獨立的 Sheet (分頁)
        for (const [sn, rows] of Object.entries(groupedData)) {
            // Excel 分頁名稱限制最多 31 個字元
            const sheetName = sn.substring(0, 31); 
            const ws = XLSX.utils.json_to_sheet(rows);
            
            // 稍微調整一下欄位寬度讓 Excel 打開比較好看 (選擇性)
            ws['!cols'] = [
                { wch: 12 }, // 使用者序號
                { wch: 12 }, // 紀錄日期
                { wch: 15 }, // 主觀電量評分
                { wch: 30 }, // 身體異常狀況
                { wch: 22 }  // 系統寫入時間
            ];

            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }

        // 5. 將 Excel 寫出成 Buffer
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // 6. 設定固定的下載檔名
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Daily_Surveys.xlsx"');

        // 7. 回傳檔案
        res.status(200).send(buffer);

    } catch (err) {
        console.error('匯出問卷錯誤:', err);
        res.status(500).json({ error: '內部伺服器錯誤', details: err.message });
    }
}
