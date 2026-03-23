import * as XLSX from 'xlsx';

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // 1. 從 Supabase 抓取所有對話紀錄
    const sbRes = await fetch(`${supabaseUrl}/rest/v1/chat_logs?select=*&order=created_at.asc`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const allLogs = await sbRes.json();

    if (!allLogs || allLogs.length === 0) {
      return res.status(404).send("沒有找到任何對話紀錄");
    }

    // 2. 建立一個新的 Excel 工作簿
    const wb = XLSX.utils.book_new();

    // 3. 依照 serial_number 將資料分類
    const groupedData = allLogs.reduce((acc, log) => {
      const sn = log.serial_number || '未知序號';
      if (!acc[sn]) acc[sn] = [];
      acc[sn].push({
        '日期': log.record_date,
        '時間': log.record_time,
        '使用者問題': log.user_query,
        'AI回答': log.ai_response,
        '系統存檔時間': log.created_at
      });
      return acc;
    }, {});

    // 4. 將每個序號的資料寫入不同的 Sheet
    Object.keys(groupedData).forEach(sn => {
      const ws = XLSX.utils.json_to_sheet(groupedData[sn]);
      
      // 設定欄位寬度 (讓繁體中文顯示更漂亮)
      ws['!cols'] = [
        { wch: 12 }, // 日期
        { wch: 10 }, // 時間
        { wch: 40 }, // 使用者問題
        { wch: 60 }, // AI回答
        { wch: 20 }  // 系統存檔時間
      ];

      // Sheet 名稱限制 31 字元，移除特殊符號
      const safeSheetName = sn.toString().substring(0, 31).replace(/[\\/?*\[\]]/g, "_");
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    });

    // 5. 將 Excel 轉換為 Buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 6. 設定 Response Header，讓瀏覽器觸發下載
    const fileName = `Chat_Logs_${new Date().toLocaleDateString('en-CA')}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    
    return res.status(200).send(buf);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "匯出失敗" });
  }
}
