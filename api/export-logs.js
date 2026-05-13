// export-logs_02
import * as XLSX from 'xlsx';

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // 1. 取得前端傳來的日期參數
  const { date } = req.query;

  if (!date) {
    return res.status(400).send("缺少日期參數");
  }

  try {
    // 2. 從 Supabase 抓取特定日期的對話紀錄 (增加 eq 過濾)
    const apiUrl = `${supabaseUrl}/rest/v1/chat_logs?record_date=eq.${date}&select=*&order=created_at.asc`;
    
    const sbRes = await fetch(apiUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const allLogs = await sbRes.json();

    if (!allLogs || allLogs.length === 0) {
      // 如果沒資料，回傳一段簡單的 Script 讓前端彈出警告並回上一頁
      return res.status(404).send(`<script>alert("${date} 沒有任何對話紀錄"); window.history.back();</script>`);
    }

    // 3. 建立 Excel 工作簿 (保持原邏輯)
    const wb = XLSX.utils.book_new();

    const groupedData = allLogs.reduce((acc, log) => {
      const sn = log.serial_number || '未知序號';
      if (!acc[sn]) acc[sn] = [];
      acc[sn].push({
        '日期': log.record_date,
        '時間': log.record_time,
        '使用者問題': log.user_query,
        'AI回答': log.ai_response,
        'AI模型': log.ai_model,
        '系統存檔時間': log.created_at
      });
      return acc;
    }, {});

    Object.keys(groupedData).forEach(sn => {
      const ws = XLSX.utils.json_to_sheet(groupedData[sn]);
      ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 40 }, { wch: 60 }, { wch: 12 }, { wch: 20 }];
      const safeSheetName = sn.toString().substring(0, 31).replace(/[\\/?*\[\]]/g, "_");
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    });

    // 4. 將 Excel 轉換為 Buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 5. 設定檔案名稱為 Chat_Logs_yyyy-mm-dd.xlsx
    const fileName = `Chat_Logs_${date}.xlsx`;
    
    // 處理檔名編碼防止中文或特殊字元錯誤
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    
    return res.status(200).send(buf);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "匯出失敗" });
  }
}
