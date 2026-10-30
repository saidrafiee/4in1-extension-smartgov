(function () {
'use strict';

const LOG_PREFIX = '%c[Background]';
const LOG_STYLE = 'color: #2980b9; font-weight: bold;';

let isProcessing = false;
let masterPdf = null;
let batchResults = [];
let batchState = { running: false, completed: 0, total: 0, successes: 0, startedAt: 0, status: 'idle' };
let cancelRequested = false;
let activeProcessingMode = 'MERGE';
let activePdfDownloadHandler = null;
let offscreenCreatePromise = null;
const blobDownloadIds = new Map();
let activePrintTabId = null;
const printDialogWaiters = new Map();

function settlePrintWaiter(tabId, result) {
  const waiter = printDialogWaiters.get(tabId);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  printDialogWaiters.delete(tabId);
  if (activePrintTabId === tabId) activePrintTabId = null;
  waiter.resolve(result);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (printDialogWaiters.has(tabId)) {
    settlePrintWaiter(tabId, { success: false, reason: 'Tab cetak ditutup sebelum dialog cetak selesai.' });
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  if (activePdfDownloadHandler) activePdfDownloadHandler(delta);
  if (delta.state && ['complete', 'interrupted'].includes(delta.state.current)) {
    const token = blobDownloadIds.get(delta.id);
    if (token) {
      blobDownloadIds.delete(delta.id);
      chrome.runtime.sendMessage({ action: 'REVOKE_BLOB_URL', token }, () => void chrome.runtime.lastError);
    }
  }
});

function publishProgress(extra = {}) {
  batchState = { ...batchState, ...extra };
  chrome.storage.local.set({ batchState });
  chrome.runtime.sendMessage({ action: 'BATCH_PROGRESS', state: batchState }).catch(() => {});
  if (batchState.tabId != null) {
    chrome.tabs.sendMessage(batchState.tabId, { action: 'BATCH_PROGRESS', state: batchState }, () => void chrome.runtime.lastError);
  }
}

console.log(LOG_PREFIX, LOG_STYLE, 'Service Worker Background Aktif.');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PRINT_DIALOG_CLOSED') {
    const tabId = sender.tab?.id;
    if (tabId != null && printDialogWaiters.has(tabId)) {
      settlePrintWaiter(tabId, { success: true, reason: 'Dialog cetak ditutup / proses cetak kembali.' });
      chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
    }
    sendResponse({ ok: true });
    return false;
  }
  if (request.action === 'PRINT_DIALOG_ERROR') {
    const tabId = sender.tab?.id;
    if (tabId != null && printDialogWaiters.has(tabId)) {
      settlePrintWaiter(tabId, { success: false, reason: request.message || 'Halaman cetak gagal.' });
      chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
    }
    sendResponse({ ok: true });
    return false;
  }
  if (request.action === 'BATCH_KEEPALIVE') {
    sendResponse({ ok: true });
    return false;
  }
  if (request.action === 'OFFSCREEN_BLOB_READY') {
    chrome.downloads.download({ url: request.url, filename: request.filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      blobDownloadIds.set(downloadId, request.token);
      sendResponse({ downloadId });
    });
    return true;
  }
  if (request.action === "GET_BATCH_STATE") {
    sendResponse(batchState);
    return true;
  }
  if (request.action === "CANCEL_BATCH") {
    if (isProcessing) {
      cancelRequested = true;
      publishProgress({ status: 'Membatalkan proses...' });
      chrome.tabs.sendMessage(batchState.tabId, { action: 'CANCEL_PROCESS' }, () => void chrome.runtime.lastError);
      if (activePrintTabId != null) {
        const tabId = activePrintTabId;
        settlePrintWaiter(tabId, { success: false, reason: 'Dibatalkan pengguna.' });
        chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
      }
      sendResponse({ status: 'CANCELING' });
    } else sendResponse({ status: 'IDLE' });
    return true;
  }
  if (request.action === "START_BATCH") {
    const requestItems = ekstrakSemuaNop(request.items || []);
    if (requestItems.length > 500) {
      sendResponse({ status: "TOO_MANY", message: `Maksimal 500 NOP per batch. Data ini berisi ${requestItems.length} NOP valid.` });
      return true;
    }

    if (isProcessing) {
      sendResponse({ status: "BUSY", message: "Proses cetak sedang berjalan di latar belakang!" });
      return true;
    }

    isProcessing = true;
    cancelRequested = false;
    masterPdf = null;
    activeProcessingMode = request.processingMode === 'AUTO_PRINT' ? 'AUTO_PRINT' : 'MERGE';
    batchResults = [];
    publishProgress({ running: true, completed: 0, total: requestItems.length, successes: 0, failures: 0, startedAt: Date.now(), status: 'Memulai...', tabId: request.tabId, processingMode: activeProcessingMode });
    sendResponse({ status: "STARTED" });

    ubahBatchKeepalive('START_BATCH_KEEPALIVE');
    jalankanBatch(requestItems, request.tabId, request.mode || "SPPT", activeProcessingMode);
    return true;
  }
});

async function jalankanBatch(itemsRaw, tabId, mode, processingMode = 'MERGE') {
  const items = ekstrakSemuaNop(itemsRaw);
  publishProgress({ total: items.length });
  console.log(LOG_PREFIX, LOG_STYLE, `Batch Dimulai [Mode: ${mode}]. Total NOP: ${items.length}`);

  try {
  if (processingMode === 'MERGE') masterPdf = await PDFLib.PDFDocument.create();
  for (let i = 0; i < items.length; i++) {
    if (cancelRequested) break;
    const item = items[i];
    publishProgress({ completed: i, total: items.length, status: `Memproses ${i + 1}/${items.length}` });
    console.group(`[Background] Progres (${i + 1}/${items.length}): NOP ${item.nop}`);

    const penungguDownload = tungguPdfSelesaiTerunduh(60000, item.nop);

    console.log(LOG_PREFIX, LOG_STYLE, `Mengirim instruksi ke Content Script (${mode})...`);
    const resContent = await kirimKeContent(tabId, {
      action: "PROCESS_NOP",
      nop: item.nop,
      tahun: item.tahun,
      mode: mode
    });

    if (cancelRequested) {
      penungguDownload.batal();
    } else if (resContent && (resContent.status === "OK" || resContent.status === "BUSY")) {
      console.log(LOG_PREFIX, LOG_STYLE, 'Aksi dipicu. Menunggu file PDF selesai diunduh...');
      
      const hasilDownload = await penungguDownload;

      if (hasilDownload.success) {
        let printResult = { success: true };
        if (processingMode === 'AUTO_PRINT') {
          printResult = await bukaPdfUntukAutoPrint(hasilDownload.bytes, item.nop);
          if (!printResult.success && /timeout|ditutup sebelum|dibatalkan/i.test(printResult.reason || '')) cancelRequested = true;
        }
        batchResults.push({ nop: item.nop, success: printResult.success, reason: printResult.success && processingMode === 'AUTO_PRINT' ? 'PDF dibuka pada tab cetak; status cetak fisik tidak dapat diverifikasi.' : (printResult.success ? '' : printResult.reason) });
        console.log(LOG_PREFIX, LOG_STYLE, `%c[${printResult.success ? 'SUKSES' : 'GAGAL'}] NOP ${item.nop}: ${processingMode === 'AUTO_PRINT' ? printResult.reason || 'PDF dikirim ke tab cetak; status fisik printer tidak dapat diverifikasi.' : 'PDF terunduh dan masuk master'}`, 'color: green; font-weight: bold;');
      } else {
        batchResults.push({ nop: item.nop, success: false, reason: hasilDownload.reason || 'Unduhan PDF gagal' });
        console.error(LOG_PREFIX, LOG_STYLE, `%c[GAGAL/TIMEOUT] NOP ${item.nop}: ${hasilDownload.reason}`, 'color: red; font-weight: bold;');
      }
    } else {
      penungguDownload.batal();
      batchResults.push({ nop: item.nop, success: false, reason: resContent?.message || resContent?.status || 'Gagal memproses NOP' });
      console.error(LOG_PREFIX, LOG_STYLE, `[ERROR FORM] Gagal memicu NOP ${item.nop}: ${resContent?.message || 'Timeout'}`);
    }

    console.groupEnd();
    publishProgress({ completed: i + 1, total: items.length, successes: batchResults.filter(result => result.success).length, failures: batchResults.filter(result => !result.success).length, status: cancelRequested ? 'Membatalkan proses...' : `Selesai ${i + 1}/${items.length}` });
    if (cancelRequested) break;
    await sleep(1000);
  }
  } catch (err) {
    console.error(LOG_PREFIX, LOG_STYLE, 'Batch berhenti karena error:', err);
    const currentItem = items[batchState.completed];
    if (currentItem && !batchResults.some(result => result.nop === currentItem.nop)) {
      batchResults.push({ nop: currentItem.nop, success: false, reason: `Batch error: ${err.message}` });
    }
  }

  console.log(LOG_PREFIX, LOG_STYLE, `Batch selesai. Total NOP: ${items.length}`);

  const recordedNops = new Set(batchResults.map(result => result.nop));
  items.forEach((item, index) => {
    if (!recordedNops.has(item.nop)) {
      batchResults.push({ nop: item.nop, success: false, reason: cancelRequested ? 'Batch dibatalkan sebelum diproses' : 'NOP tidak berhasil diproses' });
    }
  });

  let mergeResult = { status: 'Tidak digunakan (Auto Print per NOP)', failedNops: [] };
  if (processingMode === 'MERGE') {
    publishProgress({ status: 'Menyimpan master PDF...' });
    mergeResult = await gabungkanDanUnduhPdf(mode);
  }
  const mergeStatus = mergeResult.status;
  for (const nop of mergeResult.failedNops || []) {
    const result = batchResults.find(entry => entry.nop === nop);
    if (result) {
      result.success = false;
      result.reason = 'NOP bermasalah - PDF gagal dimasukkan ke master';
    }
  }

  publishProgress({ status: 'Membuat laporan...' });
  await unduhLaporanBatch(items.length, batchResults, mode, mergeStatus);

  masterPdf = null;
  isProcessing = false;
  publishProgress({ running: false, status: cancelRequested ? 'Dibatalkan' : 'Selesai', mergeStatus, completed: batchState.completed, successes: batchResults.filter(result => result.success).length, failures: batchResults.filter(result => !result.success).length, finishedAt: Date.now() });
  ubahBatchKeepalive('STOP_BATCH_KEEPALIVE');
}

async function ubahBatchKeepalive(action) {
  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({ action });
  } catch (error) {
    console.warn(LOG_PREFIX, LOG_STYLE, 'Keepalive offscreen tidak tersedia:', error.message);
  }
}

function tungguPdfSelesaiTerunduh(timeoutMs = 30000, nop = '') {
  let timer = null;
  let resolvePromise;
  let settled = false;

  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    const listener = async (downloadDelta) => {
      if (settled || activePdfDownloadHandler !== listener || downloadDelta.state?.current !== 'complete') return;
      try {
        const [item] = await chrome.downloads.search({ id: downloadDelta.id });
        if (!item || !(item.mime === 'application/pdf' || item.filename?.toLowerCase().endsWith('.pdf'))) return;
        const response = await fetch(item.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength) throw new Error('File PDF kosong.');

        if (activeProcessingMode === 'MERGE') {
          const sourcePdf = await PDFLib.PDFDocument.load(bytes);
          const pages = await masterPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
          if (!pages.length) throw new Error('PDF tidak memiliki halaman.');
          pages.forEach(page => masterPdf.addPage(page));
        }
        finish({ success: true, size: bytes.byteLength, bytes: new Uint8Array(bytes) });
      } catch (err) {
        finish({ success: false, reason: 'Gagal memasukkan PDF ke master: ' + err.message });
      }
    };

    activePdfDownloadHandler = listener;

    timer = setTimeout(() => {
      finish({ success: false, reason: `Timeout (${timeoutMs / 1000}s): Download tidak kunjung selesai.` });
    }, timeoutMs);

    function finish(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }

    function cleanup() {
      if (activePdfDownloadHandler === listener) activePdfDownloadHandler = null;
      if (timer) clearTimeout(timer);
    }
  });

  promise.batal = () => {
    if (settled) return;
    settled = true;
    if (activePdfDownloadHandler) activePdfDownloadHandler = null;
    if (timer) clearTimeout(timer);
    resolvePromise({ success: false, reason: 'Dibatalkan' });
  };
  return promise;
}

function ekstrakSemuaNop(items) {
  const daftarNop = [];
  const setNop = new Set();

  const tambahJikaValid = (str) => {
    if (!str || typeof str !== 'string') return;
    const clean = str.trim();
    if (clean.toLowerCase() === 'nop' || clean.toLowerCase() === 'tahun') return;
    const normalizedNop = clean.replace(/\D/g, '');
    if (normalizedNop.length === 18 && !setNop.has(normalizedNop)) {
      setNop.add(normalizedNop);
      daftarNop.push({ nop: normalizedNop });
    }
  };

  if (!Array.isArray(items)) return [];

  items.forEach(item => {
    if (typeof item === 'string') {
      tambahJikaValid(item);
    } else if (typeof item === 'object' && item !== null) {
      if (item.nop) {
        tambahJikaValid(item.nop);
      } else {
        Object.keys(item).forEach(key => tambahJikaValid(key));
        Object.values(item).forEach(val => tambahJikaValid(val));
      }
    }
  });

  return daftarNop;
}

async function gabungkanDanUnduhPdf(mode) {
  try {
    if (!masterPdf) masterPdf = await PDFLib.PDFDocument.create();
    if (masterPdf.getPageCount() === 0) {
      const page = masterPdf.addPage([595.28, 841.89]);
      page.drawText('Tidak ada PDF berhasil digabung.', { x: 50, y: 790, size: 14 });
    }

    const mergedPdfBytes = await masterPdf.save();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const prefixName = mode === "CATATAN_PEMBAYARAN" ? "CATATAN_PEMBAYARAN_GABUNGAN" : "PBB_SPPT_GABUNGAN";
    const fileName = `${prefixName}_${timestamp}.pdf`;

    const downloadId = await downloadBlob(mergedPdfBytes, fileName, 'application/pdf');

    console.log(LOG_PREFIX, LOG_STYLE, `%c[SUKSES] Master PDF Gabungan (${fileName}) Berhasil Diunduh!`, 'color: green; font-weight: bold;');
    return {
      status: `Berhasil disimpan (download ${downloadId}): ${fileName}`
    };
  } catch (err) {
    console.error(LOG_PREFIX, LOG_STYLE, 'Error fatal saat menggabungkan PDF:', err);
    return {
      status: `Gagal membuat master PDF: ${err.message}`,
      failedNops: batchResults.filter(result => result.success).map(result => result.nop)
    };
  }
}

async function bukaPdfUntukAutoPrint(bytes, nop) {
  try {
    const byteView = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const token = `print-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await ensureOffscreenDocument();
    let response = await chrome.runtime.sendMessage({
      action: 'CREATE_PRINT_BLOB', token, expectedSize: byteView.length
    });
    if (response?.error) throw new Error(response.error);
    const chunkSize = 1024 * 1024;
    for (let offset = 0; offset < byteView.length; offset += chunkSize) {
      response = await chrome.runtime.sendMessage({
        action: 'APPEND_PRINT_CHUNK', token,
        chunkBase64: encodeBase64Bytes(byteView.subarray(offset, Math.min(offset + chunkSize, byteView.length)))
      });
      if (response?.error) throw new Error(response.error);
    }
    response = await chrome.runtime.sendMessage({ action: 'FINALIZE_PRINT_BLOB', token });
    if (response?.error || !response?.url) throw new Error(response?.error || 'Gagal membuat URL PDF untuk cetak.');
    const printTab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`print.html?pdf=${encodeURIComponent(response.url)}&nop=${encodeURIComponent(nop)}`),
      active: true
    });
    if (!printTab?.id) throw new Error('Tab cetak tidak berhasil dibuka.');
    activePrintTabId = printTab.id;
    const printResult = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        settlePrintWaiter(printTab.id, { success: false, reason: 'Timeout 10 menit: dialog cetak belum ditutup. Batch dihentikan agar NOP berikutnya tidak mendahului proses cetak.' });
        chrome.tabs.remove(printTab.id, () => void chrome.runtime.lastError);
      }, 10 * 60 * 1000);
      printDialogWaiters.set(printTab.id, { resolve, timer, nop });
    });
    if (!printResult.success) {
      cancelRequested = true;
      return printResult;
    }
    // Dialog selesai/kembali sebelum batch mengerjakan NOP berikutnya. Status printer fisik tidak dapat diverifikasi.
    return { success: true, reason: 'Dialog cetak selesai; status fisik printer tidak dapat diverifikasi.' };
  } catch (error) {
    return { success: false, reason: `Auto Print gagal: ${error.message}` };
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (contexts.length) return;
  }
  if (!offscreenCreatePromise) {
    offscreenCreatePromise = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Membuat Blob URL agar master PDF besar dapat diunduh tanpa data URL base64.'
    }).catch(async (error) => {
      if (/already exists|single offscreen|only one offscreen/i.test(error.message)) return;
      throw error;
    }).finally(() => { offscreenCreatePromise = null; });
  }
  await offscreenCreatePromise;
}

async function downloadBlob(bytes, filename, mimeType) {
  await ensureOffscreenDocument();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const byteView = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (mimeType === 'application/pdf') {
      const signature = String.fromCharCode(...byteView.subarray(0, 5));
      if (signature !== '%PDF-') throw new Error('Data master tidak memiliki header PDF yang valid.');
    }
    if (!byteView.length) throw new Error('Tidak ada data untuk diunduh.');
    let response = await chrome.runtime.sendMessage({
      action: 'CREATE_BLOB_DOWNLOAD', token, filename, mimeType, expectedSize: byteView.length
    });
    if (response?.error) throw new Error(response.error);
    const chunkSize = 4 * 1024 * 1024;
    for (let offset = 0; offset < byteView.length; offset += chunkSize) {
      const chunk = byteView.subarray(offset, Math.min(offset + chunkSize, byteView.length));
      response = await chrome.runtime.sendMessage({
        action: 'APPEND_BLOB_CHUNK',
        token,
        chunkBase64: encodeBase64Bytes(chunk)
      });
      if (response?.error) throw new Error(response.error);
    }
    response = await chrome.runtime.sendMessage({ action: 'FINALIZE_BLOB_DOWNLOAD', token, filename, mimeType });
    if (!response || response.error || !response.downloadId) {
      throw new Error(response?.error || 'Chrome tidak mengembalikan ID unduhan.');
    }
    return response.downloadId;
  } catch (error) {
    chrome.runtime.sendMessage({ action: 'ABORT_BLOB_DOWNLOAD', token }, () => void chrome.runtime.lastError);
    throw error;
  }
}

function encodeBase64Bytes(bytes) {
  let binary = '';
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + stride, bytes.length)));
  }
  return btoa(binary);
}

async function unduhLaporanBatch(inputCount, results, mode, mergeStatus) {
  try {
    const failedResults = results.filter(result => !result.success);
    const successfulCount = results.length - failedResults.length;
    const lines = [
      'LAPORAN HASIL PROSES PDF SMARTGOV',
      `Mode: ${mode}`,
      `Tanggal: ${new Date().toLocaleString('id-ID')}`,
      `Jumlah PDF/NOP diinput: ${inputCount}`,
      `Berhasil masuk master: ${successfulCount}`,
      `Gagal / bermasalah: ${failedResults.length}`,
      `Status merge: ${mergeStatus}`,
      '',
      'DAFTAR NOP GAGAL / BERMASALAH'
    ];
    if (!failedResults.length) lines.push('Tidak ada NOP bermasalah.');
    failedResults.forEach((result, index) => {
      lines.push(`${index + 1}. NOP ${result.nop} - ${result.reason || 'NOP bermasalah'}`);
    });
    lines.push(
      '',
      'DAFTAR NOP GAGAL UNTUK EXCEL (FORMAT TEKS, SATU NOP PER BARIS)',
      ...(failedResults.length ? failedResults.map(result => "'" + String(result.nop).replace(/^'+/, '')) : ['']),
      '',
      'DAFTAR NOP GAGAL NORMAL (SATU NOP PER BARIS)',
      ...(failedResults.length ? failedResults.map(result => String(result.nop)) : ['']),
      '',
      'RINCIAN SEMUA NOP',
      ...(results.length ? results.map((result, index) => `${index + 1}. NOP ${result.nop} | ${result.success ? 'BERHASIL' : 'GAGAL'} | ${result.reason || ''}`) : ['Tidak ada hasil item yang tercatat.'])
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const prefixName = mode === 'CATATAN_PEMBAYARAN' ? 'CATATAN_PEMBAYARAN' : 'PBB_SPPT';
    const reportText = lines.join('\r\n');
    const fileName = `${prefixName}_LAPORAN_${timestamp}.txt`;
    try {
      await downloadBlob(new TextEncoder().encode(reportText), fileName, 'text/plain;charset=utf-8');
    } catch (downloadError) {
      console.warn(LOG_PREFIX, LOG_STYLE, 'Download Blob laporan gagal; mencoba data URL ringan:', downloadError);
      await chrome.downloads.download({
        url: `data:text/plain;charset=utf-8,${encodeURIComponent(reportText)}`,
        filename: fileName,
        saveAs: false
      });
    }
  } catch (err) {
    console.error(LOG_PREFIX, LOG_STYLE, 'Gagal membuat laporan batch:', err);
  }
}

function kirimKeContent(tabId, message) {
  return new Promise((resolve) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve({ status: "TIMEOUT" });
      }
    }, 15000);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve(response || { status: "OK" });
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

})();
