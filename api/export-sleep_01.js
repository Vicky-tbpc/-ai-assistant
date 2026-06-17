// export-sleep_01
import * as XLSX from 'xlsx';

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // 從 Supabase 抓取所有睡眠紀錄，並依據日期遞增排序 (由舊到新往下排)
    const apiUrl = `${supabaseUrl}/rest/v1/user_sleep_records?select=*&order=record_date.asc`;
    
    const sbRes = await fetch(apiUrl, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const allRecords = await sbRes.json();

    if (!allRecords || allRecords.length === 0) {
      return res.status(404).send(`<script>alert("目前沒有任何睡眠紀錄可以匯出"); window.history.back();</script>`);
    }

    // 建立 Excel 工作簿
    const wb = XLSX.utils.book_new();

    // 依照 serial_number 將資料分組
    const groupedData = allRecords.reduce((acc, row) => {
      const sn = row.serial_number || '未知序號';
      if (!acc[sn]) acc[sn] = [];
      
      acc[sn].push({
        '紀錄日期': row.record_date,
        '入睡時間': row.sleep_time,
        '醒來時間': row.wake_time,
        '系統建立時間': row.created_at
      });
      return acc;
    }, {});

    // 為每個序號建立一個 Sheet
    Object.keys(groupedData).forEach(sn => {
      const ws = XLSX.utils.json_to_sheet(groupedData[sn]);
      // 設定欄位寬度讓畫面好看一點
      ws['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 25 }];
      
      const safeSheetName = sn.toString().substring(0, 31).replace(/[\\/?*[\]]/g, "_");
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    });

    // 將 Excel 轉換為 Buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 設定檔案名稱為 Sleep_Records_加上今天日期
    const today = new Date().toISOString().split('T')[0];
    const fileName = `Sleep_Records_${today}.xlsx`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    
    return res.status(200).send(buf);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "匯出睡眠紀錄失敗" });
  }
}