const MASTER_TEMPLATE = `Pemberitahuan Pelayanan PBB
Yth. Bapak/Ibu Wajib Pajak,
Berkas permohonan pelayanan PBB Anda telah selesai diproses.

Detail Layanan:
No. Pelayanan: {{no_pelayanan}}
Jenis Pelayanan: {{jenis_pelayanan}}
NOP: {{nop}}
Nama WP: {{nama_wp_sensor}}

Dokumen/SK dapat diambil di loket pelayanan pada jam kerja dengan membawa Resi Pendaftaran asli dan KTP.

Pesan ini dikirim otomatis oleh sistem, mohon tidak membalas pesan ini.`;

let dataPajakAktif = {};
let printPollTimer = null;

function $(id) { return document.getElementById(id); }

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = $(viewId);
  if (view) view.classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.menu-card').forEach(card => {
    card.addEventListener('click', () => showView(card.dataset.view));
  });

  document.querySelectorAll('.back').forEach(btn => {
    btn.addEventListener('click', () => showView('dashboardView'));
  });

  setupPrintView();
  setupKonfirmasi();
  setupCekPbb();
  setupBotPetugasSettings();
});

function setupPrintView() {
  const input = $('jsonInput');
  const modeSelect = $('modeSelect');
  const btnStart = $('btnStart');

  input?.addEventListener('input', updateNopCount);
  input?.addEventListener('change', updateNopCount);
  modeSelect?.addEventListener('change', updatePrintModeUI);
  $('batchModeSelect')?.addEventListener('change', updateBatchModeUI);
  btnStart?.addEventListener('click', startPrintBatch);

  updateNopCount();
  updatePrintModeUI();
  updateBatchModeUI();
}

function updatePrintModeUI() {
  // Mode SPPT/STTS dan Catatan menggunakan engine yang sama seperti extension printing asli.
  // Tidak mengubah fungsi background/content script.
}


function updateBatchModeUI() {
  const selected = $('batchModeSelect')?.value || 'MERGE';
  const hint = $('batchModeHint');
  if (hint) {
    hint.textContent = selected === 'AUTO_PRINT'
      ? 'Auto Print memerlukan Chrome yang dijalankan dengan --kiosk-printing dan printer yang sudah siap. Tanpa dukungan itu, Chrome dapat menampilkan dialog cetak.'
      : 'Batch Merge mengunduh PDF per NOP lalu menggabungkannya menjadi satu PDF untuk dicetak manual.';
  }
}

function updateNopCount() {
  const input = $('jsonInput');
  const countEl = $('nopCount');
  if (!input || !countEl) return;
  const items = konversiInputKeNopArray(input.value || '');
  countEl.textContent = `NOP valid terbaca: ${items.length}`;
}

async function startPrintBatch() {
  const rawText = $('jsonInput')?.value.trim() || '';
  const selectedMode = $('modeSelect')?.value || 'SPPT';
  const processingMode = $('batchModeSelect')?.value || 'MERGE';
  const status = $('printStatus');
  const button = $('btnStart');

  if (!rawText) {
    return setStatus(status, 'Tempel daftar NOP terlebih dahulu!', 'error');
  }

  const items = konversiInputKeNopArray(rawText);
  updateNopCount();

  if (!items.length) {
    return setStatus(status, 'Tidak ada NOP valid yang ditemukan!', 'error');
  }

  if (items.length > 500) {
    return setStatus(status, 'Maksimal 500 NOP dalam satu batch.', 'error');
  }

  const modeLabel = selectedMode === 'CATATAN_PEMBAYARAN' ? 'Catatan Pembayaran' : selectedMode === 'STTS' ? 'STTS' : 'SPPT / STTS Terseleksi';
  const methodLabel = processingMode === 'AUTO_PRINT' ? 'Auto Print per NOP' : 'Batch Merge';
  const confirmed = confirm(`Metode: ${methodLabel}\nDokumen: ${modeLabel}\nJumlah NOP: ${items.length}\n\n${processingMode === 'AUTO_PRINT' ? 'Pastikan Chrome mendukung --kiosk-printing dan printer siap.' : 'PDF akan digabung menjadi satu file.'}\n\nLanjutkan?`);
  if (!confirmed) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return setStatus(status, 'Tab SmartGov tidak ditemukan!', 'error');
  }

  button.disabled = true;

  const label = selectedMode === 'CATATAN_PEMBAYARAN'
    ? 'Catatan Pembayaran'
    : 'SPPT / STTS Terseleksi';

  setStatus(status, `Membaca ${items.length} NOP. Memproses ${label}...`, 'info');

  chrome.runtime.sendMessage({
    action: 'START_BATCH',
    items,
    tabId: tab.id,
    mode: selectedMode,
    processingMode
  }, response => {
    if (chrome.runtime.lastError) {
      button.disabled = false;
      return setStatus(status, 'Error: ' + chrome.runtime.lastError.message, 'error');
    }

    if (response?.status === 'STARTED') {
      setStatus(status, `Batch ${processingMode === 'AUTO_PRINT' ? 'Auto Print' : 'Merge'} berjalan [${label}] untuk ${items.length} NOP!`, 'info');
      mulaiPantauBatch(status, null, button, items.length);
    } else if (response?.status === 'BUSY') {
      button.disabled = false;
      setStatus(status, response.message, 'error');
    } else {
      button.disabled = false;
      setStatus(status, response?.message || 'Batch tidak dapat dimulai.', 'error');
    }
  });
}

function mulaiPantauBatch(status, progressBar, button, total) {
  clearInterval(printPollTimer);
  printPollTimer = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'GET_BATCH_STATE' }, state => {
      if (chrome.runtime.lastError || !state) return;
      const done = Number(state.completed) || 0;
      const successes = Number(state.successes) || 0;
      setStatus(status, state.status || `Memproses ${done}/${state.total || total}...`, state.running ? 'info' : 'success');
      if (!state.running) {
        clearInterval(printPollTimer);
        button.disabled = false;
        const failed = Number(state.failures) || 0;
        const finalMsg = state.mergeStatus || state.status || `Selesai. Berhasil ${successes}, gagal ${failed}.`;
        setStatus(status, finalMsg, failed > 0 || /^Gagal/i.test(finalMsg) ? 'error' : 'success');
      }
    });
  }, 500);
}

function setStatus(el, msg, type) {
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'error'
    ? '#c62828'
    : type === 'success'
      ? '#138a45'
      : '#155eef';
}

function konversiInputKeNopArray(inputText) {
  const listHasil = [];
  const setNop = new Set();

  const tambahJikaValid = (str) => {
    if (!str || typeof str !== 'string') return;
    const fields = str.split(/[\t,;]+/);
    for (const field of fields) {
      const clean = field.replace(/["']/g, '').trim();
      const lower = clean.toLowerCase();
      if (!clean || lower === 'nop' || lower === 'tahun' || lower === 'no') continue;

      const digitCount = clean.replace(/\D/g, '').length;
      if (digitCount === 18 && !setNop.has(clean)) {
        const normalizedNop = clean.replace(/\D/g, '');
        if (!setNop.has(normalizedNop)) {
          setNop.add(normalizedNop);
          listHasil.push({ nop: normalizedNop });
        }
      }
    }
  };

  // Ambil NOP berpemisah titik/tanda hubung di mana pun letaknya pada baris Excel/CSV.
  const formattedNopPattern = /\b\d{2}\.\d{2}\.\d{3}\.\d{3}\.\d{3}-\d{4}\.\d\b/g;
  const formattedMatches = inputText.match(formattedNopPattern) || [];
  formattedMatches.forEach(tambahJikaValid);

  try {
    const parsed = JSON.parse(inputText);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    rows.forEach((item) => {
      if (typeof item === 'string' || typeof item === 'number') tambahJikaValid(String(item));
      else if (item && typeof item === 'object') {
        const nopValue = item.nop ?? item.NOP ?? item.Nop;
        if (nopValue != null) tambahJikaValid(String(nopValue));
        else Object.values(item).forEach(value => {
          if (typeof value === 'string' || typeof value === 'number') tambahJikaValid(String(value));
        });
      }
    });
    if (listHasil.length > 0) return listHasil;
  } catch (e) {}

  const baris = inputText.split(/[\r\n]+/);
  baris.forEach(line => tambahJikaValid(line));

  return listHasil;
}

function sensorNama(nama) {
  if (!nama) return '';
  return nama.trim().split(/\s+/).map(kata => {
    if (kata.length <= 1) return kata;
    if (kata.length === 2) return kata[0] + '*';
    return kata.substring(0, 2) + '*'.repeat(kata.length - 2);
  }).join(' ');
}

function setupKonfirmasi() {
  const btnAmbil = $('btnAmbil');
  const btnKirimWA = $('btnKirimWA');
  const fields = [$('noPelayanan'), $('namaWp'), $('noTelepon'), $('jenisPelayanan')];

  fields.forEach(el => el?.addEventListener('input', updatePreview));
  fields.forEach(el => el?.addEventListener('change', updatePreview));
  btnAmbil?.addEventListener('click', ambilDataPajak);
  btnKirimWA?.addEventListener('click', kirimWA);
  updatePreview();
}

function ambilDataPajak() {
  const status = $('waStatus');
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs?.[0];
    if (!tab?.id) return setStatus(status, 'Tab aktif tidak ditemukan.', 'error');
    chrome.tabs.sendMessage(tab.id, { action: 'AMBIL_DATA_PAJAK' }, response => {
      if (chrome.runtime.lastError) return setStatus(status, 'Gagal membaca halaman SmartGov. Pastikan sedang berada di halaman pelayanan.', 'error');
      if (!response) return setStatus(status, 'Data SmartGov tidak berhasil dibaca.', 'error');
      dataPajakAktif = response;
      $('noPelayanan').value = response.no_pelayanan || '';
      $('namaWp').value = response.nama_wp || '';
      $('noTelepon').value = response.telepon || '';
      updatePreview();
      setStatus(status, 'Data berhasil diambil dari halaman SmartGov.', 'success');
    });
  });
}

function updatePreview() {
  const noPelayanan = $('noPelayanan')?.value.trim() || '';
  const jenis = $('jenisPelayanan')?.value || '';
  const nama = $('namaWp')?.value.trim() || dataPajakAktif.nama_wp || '';
  const preview = $('preview');
  if (!preview) return;

  preview.value = MASTER_TEMPLATE
    .replace(/\{\{no_pelayanan\}\}/g, noPelayanan || '[Nomor Pelayanan]')
    .replace(/\{\{nomor_pelayanan\}\}/g, noPelayanan || '[Nomor Pelayanan]')
    .replace(/\{\{jenis_pelayanan\}\}/g, jenis || '[Jenis Pelayanan]')
    .replace(/\{\{nop\}\}/g, dataPajakAktif.nop || '[NOP]')
    .replace(/\{\{nama_wp_sensor\}\}/g, sensorNama(nama) || '[Nama WP]')
    .replace(/\{\{nama_wp\}\}/g, sensorNama(nama) || '[Nama WP]');
}

function kirimWA() {
  const status = $('waStatus');
  const raw = $('noTelepon')?.value.trim() || '';
  let noHP = raw.replace(/\D/g, '');
  if (noHP.startsWith('0')) noHP = '62' + noHP.slice(1);
  if (noHP.length < 10) return setStatus(status, 'Nomor telepon tidak valid. Minimal 10 digit.', 'error');

  const text = $('preview')?.value || '';
  const url = `https://web.whatsapp.com/send?phone=${noHP}&text=${encodeURIComponent(text)}&autoSend=true`;
  chrome.tabs.create({ url, active: false });
  setStatus(status, 'WhatsApp Web dibuka di tab latar belakang. Sistem akan memeriksa akun pengirim dan mengirim otomatis.', 'info');
}


// === Fitur Cek PBB (diambil dari extension asli) ===
function setupCekPbb() {
  const button = $('btnCekPbb');
  button?.addEventListener('click', async () => {
    const raw = $('cekJsonInput')?.value.trim() || '';
    const status = $('cekPbbStatus');
    if (!raw) { status.textContent = 'Status: Tempelkan data JSON terlebih dahulu!'; return; }
    let data;
    try {
      data = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error('JSON harus berupa array.');
    } catch (e) {
      status.textContent = 'Status: Format JSON tidak valid (harus array)!';
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { status.textContent = 'Status: Tab tidak ditemukan!'; return; }
    button.disabled = true;
    status.textContent = 'Status: Memproses... Harap tunggu.';
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content_pbb_check.js'] });
    } catch (e) {
      // Content script biasanya sudah otomatis terpasang; lanjutkan pengiriman pesan.
    }
    chrome.tabs.sendMessage(tab.id, { action: 'START_CHECK', data }, response => {
      button.disabled = false;
      if (chrome.runtime.lastError) status.textContent = 'Error: Gagal terhubung ke halaman web.';
      else if (response?.status === 'DONE') status.textContent = `Selesai! ${response.count} data diexport ke CSV.`;
      else status.textContent = 'Error: Tidak menerima konfirmasi dari script Cek PBB.';
    });
  });
}

// === Pengaturan Bot Ganti Petugas (pengaturan asli disimpan dengan storage.local) ===
function setupBotPetugasSettings() {
  const ids = ['nama_petugas', 's_row', 's_ubah', 's_select', 's_save'];
  chrome.storage.local.get(['namaPetugas', 'sRow', 'sUbah', 'sSelect', 'sSave'], data => {
    if ($('nama_petugas')) $('nama_petugas').value = data.namaPetugas || 'Id..';
    if ($('s_row')) $('s_row').value = data.sRow || '#d-rows > tr';
    if ($('s_ubah')) $('s_ubah').value = data.sUbah || 'td:nth-child(2) > button';
    if ($('s_select')) $('s_select').value = data.sSelect || 'select';
    if ($('s_save')) $('s_save').value = data.sSave || 'td:nth-child(5) > button.btn-save-row';
  });
  $('btn_simpan')?.addEventListener('click', () => {
    const data = {
      namaPetugas: $('nama_petugas')?.value || '',
      sRow: $('s_row')?.value || '',
      sUbah: $('s_ubah')?.value || '',
      sSelect: $('s_select')?.value || '',
      sSave: $('s_save')?.value || ''
    };
    chrome.storage.local.set(data, () => {
      const status = $('status_txt');
      if (status) {
        status.textContent = 'Pengaturan disimpan!';
        status.style.color = '#138a45';
      }
    });
  });
}
