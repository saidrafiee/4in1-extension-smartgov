const LOG_PREFIX = '%c[Content Script]';
const LOG_STYLE = 'color: #27ae60; font-weight: bold;';

let isContentProcessing = false;
let cancelContentProcess = false;
let nopModalProblem = false;
let lastHandledNopChangeNotice = '';
let progressWidget = null;
let latestBatchState = null;

console.log(LOG_PREFIX, LOG_STYLE, 'Content Script terpasang pada halaman SmartGov.');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'AMBIL_DATA_PAJAK') {
    try {
      sendResponse(ambilDataPajak());
    } catch (e) {
      console.error(LOG_PREFIX, 'Gagal mengambil data:', e);
      sendResponse(null);
    }
    return true;
  }
  if (request.action === "BATCH_PROGRESS") {
    renderBatchProgress(request.state);
    return false;
  }
  if (request.action === "CANCEL_PROCESS") {
    cancelContentProcess = true;
    sendResponse({ status: "CANCELING" });
    return false;
  }
  if (request.action === "PROCESS_NOP") {
    createProgressWidget();
    if (latestBatchState) renderBatchProgress(latestBatchState);
    if (isContentProcessing) {
      console.warn(LOG_PREFIX, LOG_STYLE, `Abaikan duplikat perintah untuk NOP ${request.nop}.`);
      sendResponse({ status: "BUSY" });
      return false;
    }

    console.log(LOG_PREFIX, LOG_STYLE, `Menerima perintah pengisian NOP: ${request.nop} [Mode: ${request.mode}]`);

    if (!request.nop || String(request.nop).trim() === "") {
      sendResponse({ status: "ERROR", message: "NOP Kosong" });
      return false;
    }

    isContentProcessing = true;
    cancelContentProcess = false;
    nopModalProblem = false;

    eksekusiProses(request.nop, request.tahun, request.mode || "SPPT")
      .then(() => {
        console.log(LOG_PREFIX, LOG_STYLE, `Pengisian NOP ${request.nop} SELESAI.`);
        sendResponse({ status: "OK" });
      })
      .catch((err) => {
        console.warn(LOG_PREFIX, LOG_STYLE, `Pemberitahuan NOP ${request.nop}:`, err.message);
        sendResponse({ status: "ERROR", message: err.message });
      })
      .finally(() => {
        isContentProcessing = false;
      });

    return true;
  }
});

chrome.runtime.sendMessage({ action: 'GET_BATCH_STATE' }, (state) => {
  if (!chrome.runtime.lastError && state?.running && state.total) renderBatchProgress(state);
});

function createProgressWidget() {
  if (progressWidget || !document.documentElement) return;
  const host = document.createElement('div');
  host.id = 'smartgov-extension-progress';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; font-family: Arial, sans-serif; }
      .card { box-sizing: border-box; width: 270px; padding: 13px; color: #263238; background: #fff; border: 1px solid #cfd8dc; border-radius: 9px; box-shadow: 0 4px 18px #0003; }
      .title { font-size: 13px; font-weight: 700; }
      .status { margin-top: 6px; color: #56616a; font-size: 11px; overflow-wrap: anywhere; }
      progress { width: 100%; height: 12px; margin-top: 8px; }
      button { width: 100%; margin-top: 9px; padding: 8px; border: 0; border-radius: 5px; background: #c0392b; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
      button:hover { background: #a93226; }
    </style>
    <section class="card" aria-live="polite">
      <div class="title">PDF terunduh: <span class="count">0/0</span></div>
      <progress value="0" max="1"></progress>
      <div class="status">Menunggu proses...</div>
      <button type="button">Batalkan Proses</button>
    </section>`;
  shadow.querySelector('button').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'CANCEL_BATCH' }, (response) => {
      if (chrome.runtime.lastError) return;
      shadow.querySelector('.status').textContent = response?.status === 'CANCELING'
        ? 'Pembatalan diminta...' : 'Tidak ada proses yang berjalan.';
    });
  });
  (document.body || document.documentElement).appendChild(host);
  progressWidget = { host, shadow };
}

function renderBatchProgress(state) {
  if (!state || !state.total) return;
  latestBatchState = state;
  createProgressWidget();
  if (!progressWidget) return;
  const { shadow } = progressWidget;
  const total = Number(state.total) || 0;
  const completed = Math.min(Number(state.completed) || 0, total);
  shadow.querySelector('.count').textContent = `${Number(state.successes) || 0}/${total}`;
  const bar = shadow.querySelector('progress');
  bar.max = total || 1;
  bar.value = completed;
  const status = shadow.querySelector('.status');
  if (state.running && completed > 0 && state.startedAt) {
    const remaining = Math.ceil(((Date.now() - state.startedAt) / completed) * (total - completed) / 60000);
    const eta = remaining < 1 ? 'kurang dari 1 menit' : remaining >= 60
      ? `${Math.floor(remaining / 60)} jam ${remaining % 60} menit` : `${remaining} menit`;
    status.textContent = `Estimasi waktu: ${eta} · ${state.status || 'Sedang berjalan'}`;
  } else {
    status.textContent = state.mergeStatus || state.status || 'Menunggu proses...';
  }
  shadow.querySelector('button').style.display = state.running ? 'block' : 'none';
}

async function eksekusiProses(nopRaw, tahunCustom, mode) {
  periksaPembatalan();
  await sleep(400);

  const inputs = await tungguKolomNop();
  if (inputs.length < 7) {
    throw new Error("Kolom NOP tidak siap atau tertutup modal.");
  }

  const cleanNop = String(nopRaw).replace(/\D/g, '');
  if (cleanNop.length !== 18) {
    throw new Error(`NOP harus 18 digit! Diterima: ${cleanNop.length} digit`);
  }

  const parts = [
    cleanNop.substring(0, 2),
    cleanNop.substring(2, 4),
    cleanNop.substring(4, 7),
    cleanNop.substring(7, 10),
    cleanNop.substring(10, 13),
    cleanNop.substring(13, 17),
    cleanNop.substring(17, 18)
  ];

  for (let i = 0; i < 7; i++) isiInput(inputs[i], "");
  await sleep(100);

  for (let i = 0; i < 7; i++) {
    periksaPembatalan();
    isiInput(inputs[i], parts[i]);
    await sleep(60);
  }

  // ALUR BERDASARKAN MODE HALAMAN
  if (mode === "CATATAN_PEMBAYARAN") {
    // 1. Klik tombol CARI
    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Mengeklik tombol CARI...');
    const btnCari = cariTombol('CARI');
    if (!btnCari) throw new Error("Tombol CARI tidak ditemukan!");
    btnCari.click();

    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Menunggu hasil pencarian (1.2 detik)...');
    await sleep(1200);

    // 2. Klik tombol CETAK di halaman utama
    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Mengeklik tombol CETAK utama...');
    const btnCetak = cariTombol('CETAK');
    if (!btnCetak) throw new Error("Tombol CETAK tidak ditemukan!");
    btnCetak.click();

    // 3. Tangani Modal "Tahun SPPT" (Centang Semua Tahun -> Klik CETAK Modal)
    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Menunggu modal Tahun SPPT...');
    await sleep(500);
    await menanganiModalTahunSppt();

  } else {
    // Flow SPPT / STTS Terseleksi: NOP -> TAHUN -> CETAK -> Konfirmasi Modal
    const inputTahun = cariKolomTahun();
    if (inputTahun) {
      const valTahun = (tahunCustom && String(tahunCustom).trim() !== "") ? String(tahunCustom).trim() : "2026";
      isiInput(inputTahun, valTahun);
    }

    await sleep(600);

    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: SPPT/STTS] Mengeklik tombol CETAK...');
    const btnCetak = cariTombol('CETAK');
    if (!btnCetak) throw new Error("Tombol CETAK tidak ditemukan!");
    btnCetak.click();

    await sleep(600);
    await tekanKonfirmasiModal();
  }

  await sleep(400);
  periksaPembatalan();
  return true;
}

/**
 * Menangani Modal "Tahun SPPT" pada Catatan Pembayaran
 */
async function menanganiModalTahunSppt() {
  for (let i = 0; i < 10; i++) {
    const modals = Array.from(document.querySelectorAll('.modal, .sweet-alert, .swal2-container, div[role="dialog"]'))
      .filter(isVisible);

    for (let modal of modals) {
      if (modal.textContent.includes('Tahun SPPT') || modal.textContent.includes('Semua tahun')) {
        // A. Centang Checkbox "Semua tahun"
        const checkbox = modal.querySelector('input[type="checkbox"]');
        if (checkbox) {
          if (!checkbox.checked) {
            checkbox.click();
            await sleep(150);
            if (!checkbox.checked) {
              checkbox.checked = true;
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }

        await sleep(300);

        // B. Klik Tombol CETAK di dalam Modal
        const btns = Array.from(modal.querySelectorAll('button, input[type="button"], a.btn, a'))
          .filter(isVisible);

        const btnCetakModal = btns.find(b => {
          const txt = (b.textContent || b.value || '').trim().toUpperCase();
          return txt === 'CETAK';
        });

        if (btnCetakModal) {
          btnCetakModal.click();
          console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Berhasil mencentang "Semua tahun" & mengeklik CETAK pada modal.');
          return true;
        }
      }
    }
    await sleep(300);
  }
  throw new Error("Modal 'Tahun SPPT' atau tombol CETAK pada modal tidak ditemukan!");
}

async function tungguKolomNop() {
  for (let i = 0; i < 8; i++) {
    periksaPembatalan();
    const inputs = cariKolomNop();
    if (inputs.length >= 7) return inputs;
    await sleep(300);
  }
  return [];
}

function cariKolomNop() {
  const nopWrapper = document.querySelector('.input-inline-7') || 
                     Array.from(document.querySelectorAll('.form-group, .row')).find(el => el.textContent.includes('NOP'));

  if (nopWrapper) {
    const inputs = Array.from(nopWrapper.querySelectorAll('input'))
      .filter(i => isVisible(i) && !isInputTahun(i));
    if (inputs.length >= 7) return inputs.slice(0, 7);
  }

  const allInputs = Array.from(document.querySelectorAll('input'))
    .filter(i => isVisible(i) && !isInputTahun(i));
  if (allInputs.length >= 7) return allInputs.slice(0, 7);

  return [];
}

function cariKolomTahun() {
  return document.querySelector('input[name*="tahun" i], input[id*="tahun" i], input[name*="thn" i], input[id*="thn" i]') ||
         Array.from(document.querySelectorAll('input')).find(i => {
           const label = i.closest('.form-group, .row')?.querySelector('label')?.textContent || '';
           return label.toLowerCase().includes('tahun') && isVisible(i);
         });
}

function isInputTahun(el) {
  const nameId = (el.name + ' ' + el.id).toLowerCase();
  return nameId.includes('tahun') || nameId.includes('thn');
}

function isiInput(el, val) {
  if (!el) return;
  
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(el, val);
  } else {
    el.value = val;
  }

  el.dispatchEvent(new Event('keydown', { bubbles: true }));
  el.dispatchEvent(new Event('keypress', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('keyup', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function cariTombol(teksDiberikan) {
  return Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a'))
    .filter(isVisible)
    .find(el => {
      const txt = (el.textContent || el.value || '').trim().toUpperCase();
      return txt === teksDiberikan.toUpperCase();
    });
}

async function tekanKonfirmasiModal() {
  for (let i = 0; i < 6; i++) {
    const btns = Array.from(document.querySelectorAll('.modal button, .sweet-alert button, .swal2-container button, div[role="dialog"] button'))
      .filter(isVisible);

    for (let b of btns) {
      const txt = (b.textContent || b.value || '').toUpperCase();
      if (txt === 'YA' || txt === 'YES' || txt === 'OK' || txt.includes('DOWNLOAD') || txt.includes('PROSES')) {
        b.click();
        return true;
      }
    }
    await sleep(300);
  }
  return false;
}

function bersihkanLayar() {
  // Jangan menghapus backdrop atau menutup modal milik halaman SmartGov.
}

function periksaPembatalan() {
  const dialogBermasalah = tanganiDialogLookupBermasalah();
  if (dialogBermasalah) {
    nopModalProblem = true;
    throw new Error(`NOP bermasalah: ${dialogBermasalah}; tombol BATAL ditekan otomatis.`);
  }

  const noticeNopBerubah = deteksiNotifikasiNopBerubah();
  if (noticeNopBerubah) {
    throw new Error(`NOP bermasalah: SmartGov memberi notifikasi NOP telah berubah. ${noticeNopBerubah}`);
  }

  if (cancelContentProcess) throw new Error('Proses dibatalkan pengguna.');
}

function deteksiNotifikasiNopBerubah() {
  const notice = document.getElementById('success_box');
  if (!notice || !isVisible(notice)) {
    lastHandledNopChangeNotice = '';
    return '';
  }

  const text = (notice.innerText || notice.textContent || '').replace(/\s+/g, ' ').trim();
  if (!/NOP.{0,120}(perubahan|berubah)|NOP\s+Baru/i.test(text)) return '';

  const signature = text.toLowerCase();
  if (signature === lastHandledNopChangeNotice) return '';
  lastHandledNopChangeNotice = signature;
  return text;
}

function tanganiDialogLookupBermasalah() {
  const dialogs = Array.from(document.querySelectorAll('[id^="main_data_keydown_"][id$="_dialog"]'))
    .filter(isVisible)
    .reverse();

  for (const dialog of dialogs) {
    const tombolBatal = dialog.querySelector('.modal-footer button.cancel-btn, button.cancel-btn[data-dismiss="modal"]') ||
      Array.from(dialog.querySelectorAll('.modal-footer button, .modal-footer input[type="button"]'))
        .find(button => (button.textContent || button.value || '').trim().toUpperCase() === 'BATAL');
    if (!tombolBatal || !isVisible(tombolBatal)) continue;

    const judul = dialog.querySelector('.modal-header')?.textContent?.trim().replace(/\s+/g, ' ') || 'dialog lookup';
    tombolBatal.click();
    console.warn(LOG_PREFIX, LOG_STYLE, `${judul} muncul; tombol BATAL ditekan otomatis.`);
    return judul;
  }

  return false;
}

function isVisible(el) {
  if (!el || el.type === 'hidden') return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
}

function sleep(ms) {
  return new Promise((resolve, reject) => setTimeout(() => {
    try { periksaPembatalan(); resolve(); } catch (error) { reject(error); }
  }, ms));
}


// Fungsi ekstraksi data pelayanan dari extension gabungan.
function ambilDataPajak() {
  const data = { nop: '', nama_wp: '', jalan_wp: '', telepon: '', no_pelayanan: '', jenis_pelayanan: '' };
  const allLabels = Array.from(document.querySelectorAll('label, td, th, span, div, strong, b'));

  const labelNop = allLabels.find(el => el.children.length === 0 && el.innerText.trim() === 'NOP');
  if (labelNop) {
    const container = labelNop.closest('.form-group, .row, tr, div');
    const inputs = container ? Array.from(container.querySelectorAll('input')) : [];
    if (inputs.length) data.nop = inputs.map(i => i.value.trim()).filter(Boolean).join('');
  }
  if (!data.nop) {
    const smallInputs = Array.from(document.querySelectorAll('input'))
      .filter(i => i.value?.trim() && i.value.trim().length <= 4 && /^\d+$/.test(i.value.trim()));
    if (smallInputs.length >= 7) data.nop = smallInputs.slice(0, 7).map(i => i.value.trim()).join('');
  }

  const getInputValueByLabel = regex => {
    for (const lbl of allLabels) {
      if (lbl.children.length > 1) continue;
      const txt = (lbl.innerText || '').trim();
      if (!regex.test(txt)) continue;
      const parent = lbl.closest('.form-group, .row, tr, div');
      if (parent) {
        const input = Array.from(parent.querySelectorAll('input, textarea, select'))
          .find(el => el.value?.trim() && !regex.test(el.value));
        if (input) return input.value.trim();
      }
      let sib = lbl.nextElementSibling;
      while (sib) {
        if (['INPUT','TEXTAREA','SELECT'].includes(sib.tagName) && sib.value) return sib.value.trim();
        const child = sib.querySelector?.('input, textarea, select');
        if (child?.value) return child.value.trim();
        sib = sib.nextElementSibling;
      }
    }
    return '';
  };

  data.no_pelayanan = getInputValueByLabel(/Nomor Formulir|No\.?\s*Formulir|Nomor Pelayanan|No\.?\s*Pelayanan/i);
  data.nama_wp = getInputValueByLabel(/^Nama WP$/i) || getInputValueByLabel(/Nama WP|Nama Wajib Pajak|Nama Subjek Pajak|Nama Pemohon/i);
  data.jalan_wp = getInputValueByLabel(/^Jalan WP$/i) || getInputValueByLabel(/Jalan WP|Nama Jalan|Alamat/i);
  data.telepon = getInputValueByLabel(/^Telepon$/i) || getInputValueByLabel(/Telepon|Handphone|No\.?\s*HP|WhatsApp/i);
  return data;
}
