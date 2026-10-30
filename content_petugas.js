const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let botSedangBerjalan = false;

async function mulaiAutomasiTabel() {
  if (botSedangBerjalan) return;

  console.log('Mengambil data pengaturan dari UI Extension...');
  
  const dataEkstensi = await new Promise((resolve) => {
    chrome.storage.local.get(['namaPetugas'], (result) => {
      resolve(result);
    });
  });

  const ROW_SELECTOR = '#d-rows > tr';
  const BTN_UBAH_SELECTOR = 'td:nth-child(2) > button'; 
  const BTN_SAVE_SELECTOR = 'td:nth-child(5) > button.btn-save-row'; 
  const INPUT_PETUGAS_USER = dataEkstensi.namaPetugas || "";

  const rows = document.querySelectorAll(ROW_SELECTOR);
  
  if (rows.length === 0) {
    alert(`Maaf, tidak menemukan baris tabel dengan selector "${ROW_SELECTOR}".`);
    return;
  }

  const konfirmasi = confirm(`[INFO BOT] Berhasil membaca tabel!\n\nJumlah Baris Terdeteksi: ${rows.length} baris\nValue yang akan dikirim: "${INPUT_PETUGAS_USER}"\n\nApakah Anda ingin memulai otomatisasi sekarang?`);
  if (!konfirmasi) return;

  botSedangBerjalan = true;
  tampilkanTombolStop(true);
  console.log(`Memulai otomatisasi massal untuk ${rows.length} data...`);

  for (let i = 0; i < rows.length; i++) {
    if (!botSedangBerjalan) {
      console.log('🛑 PROSES DIHENTIKAN OLEH PENGGUNA DI TENGAH JALAN!');
      console.log(`Berhenti pada baris ke-${i} dari total ${rows.length} baris.`);
      break; 
    }

    const row = rows[i];
    console.log(`==================================================`);
    console.log(`MEMPROSES BARIS KE-${i + 1} DARI ${rows.length}`);
    console.log(`==================================================`);

    const btnUbah = row.querySelector(BTN_UBAH_SELECTOR); 

    if (!btnUbah || btnUbah.disabled || btnUbah.classList.contains('disabled')) {
      console.log(`[Baris ${i + 1}] Dilewati: Tombol 'Ubah' tidak aktif.`);
      continue; 
    }

    btnUbah.click();
    btnUbah.dispatchEvent(new Event('click', { bubbles: true }));
    console.log(`[Baris ${i + 1}] Sukses mengklik tombol Ubah.`);
    
    await delay(1000); 

    const selectAsli = row.querySelector('td:nth-child(5) select');

    if (selectAsli) {
      console.log(`[Baris ${i + 1}] Tag <select> ditemukan. Menyuntikkan value input langsung...`);

      try {
        const newOption = document.createElement('option');
        newOption.value = INPUT_PETUGAS_USER; 
        newOption.text = INPUT_PETUGAS_USER;   
        newOption.selected = true;
        
        selectAsli.innerHTML = '';
        selectAsli.appendChild(newOption);
        selectAsli.value = INPUT_PETUGAS_USER;
        
        selectAsli.dispatchEvent(new Event('change', { bubbles: true }));
        selectAsli.dispatchEvent(new Event('input', { bubbles: true }));
        
        console.log(`[Baris ${i + 1}] Sukses injeksi data murni: "${INPUT_PETUGAS_USER}"`);
        
      } catch (err) {
        console.log(`[Baris ${i + 1}] Kendala manipulasi elemen:`, err);
      }

      await delay(1000); 

      const btnSave = row.querySelector(BTN_SAVE_SELECTOR);
      if (btnSave) {
        btnSave.click();
        btnSave.dispatchEvent(new Event('click', { bubbles: true }));
        console.log(`[Baris ${i + 1}] Sukses mengklik tombol Save.`);
        
        await delay(1000); 
      } else {
        console.log(`[Baris ${i + 1}] Peringatan: Tombol Save tidak ditemukan.`);
        await delay(1000);
      }

    } else {
      console.log(`[Baris ${i + 1}] Gagal: Tag <select> asli tidak ditemukan.`);
      await delay(1000);
    }
  }

  botSedangBerjalan = false;
  tampilkanTombolStop(false); 
  console.log(`==================================================`);
  alert('Proses Bot Selesai / Telah Dihentikan!');
}

// =========================================================================
// FUNGSI BARU: MENGINTIP & MENYALIN ID PETUGAS YANG SEDANG DIPILIH MANUAL
// =========================================================================
function ambilIdPetugasAktif() {
  // Mencari elemen <select> di kolom ke-5 yang sedang aktif/terbuka di tabel
  const semuaSelect = document.querySelectorAll('#d-rows > tr td:nth-child(5) select');
  let selectDitemukan = null;

  // Cari select mana yang terlihat atau nilainya tidak kosong (sedang dimodifikasi)
  for (let select of semuaSelect) {
    if (select && select.value !== "" && select.offsetHeight > 0) {
      selectDitemukan = select;
      break;
    }
  }

  // Jika di dalam tr tidak ketemu (mungkin karena ditutup Select2 visual), cari secara global
  if (!selectDitemukan) {
    selectDitemukan = document.querySelector('select.inline-editor');
  }

  if (selectDitemukan && selectDitemukan.value) {
    const idPetugas = selectDitemukan.value;
    
    // Mendapatkan teks nama yang sedang dipilih sebagai informasi tambahan
    const namaPetugas = selectDitemukan.options[selectDitemukan.selectedIndex] ? 
                        selectDitemukan.options[selectDitemukan.selectedIndex].textContent : "Tidak diketahui";

    // Menggunakan prompt agar teks ID bisa langsung di-blok dan di-copy oleh user
    prompt(`[BERHASIL MENDETEKSI ID]\n\nPetugas: ${namaPetugas}\n\nSilakan salin (Ctrl+C) kode ID di bawah ini:`, idPetugas);
  } else {
    alert('Gagal Mendeteksi: Pastikan Anda sudah mengklik tombol "Ubah" pada salah satu baris tabel dan memilih nama petugas terlebih dahulu sebelum menekan tombol ini.');
  }
}

function buatTombolTrigger() {
  if (document.getElementById('btn-bot-otomatis')) return;

  // 1. Tombol Jalankan Bot
  const btnStart = document.createElement('button');
  btnStart.id = 'btn-bot-otomatis';
  btnStart.innerText = '⚡ Jalankan Bot Tabel';
  btnStart.style.position = 'fixed'; btnStart.style.top = '20px'; btnStart.style.right = '20px'; btnStart.style.zIndex = '99999';
  btnStart.style.padding = '12px 20px'; btnStart.style.backgroundColor = '#2563eb'; btnStart.style.color = '#ffffff';
  btnStart.style.border = 'none'; btnStart.style.borderRadius = '8px'; btnStart.style.cursor = 'pointer'; btnStart.style.fontWeight = 'bold';
  btnStart.style.fontSize = '14px'; btnStart.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.2)';
  btnStart.addEventListener('click', mulaiAutomasiTabel);
  document.body.appendChild(btnStart);

  // 2. Tombol Ambil ID Aktif (BARU)
  const btnGetId = document.createElement('button');
  btnGetId.id = 'btn-bot-getid';
  btnGetId.innerText = '🔑 Ambil ID Aktif';
  btnGetId.style.position = 'fixed'; btnGetId.style.top = '75px'; btnGetId.style.right = '20px'; btnGetId.style.zIndex = '99999';
  btnGetId.style.padding = '10px 18px'; btnGetId.style.backgroundColor = '#10b981'; btnGetId.style.color = '#ffffff';
  btnGetId.style.border = 'none'; btnGetId.style.borderRadius = '8px'; btnGetId.style.cursor = 'pointer'; btnGetId.style.fontWeight = 'bold';
  btnGetId.style.fontSize = '13px'; btnGetId.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.2)';
  btnGetId.addEventListener('click', ambilIdPetugasAktif);
  document.body.appendChild(btnGetId);

  // 3. Tombol Stop Bot
  const btnStop = document.createElement('button');
  btnStop.id = 'btn-bot-stop';
  btnStop.innerText = '🛑 Stop Bot';
  btnStop.style.position = 'fixed'; btnStop.style.top = '20px'; btnStop.style.right = '200px'; btnStop.style.zIndex = '99999';
  btnStop.style.padding = '12px 20px'; btnStop.style.backgroundColor = '#dc2626'; btnStop.style.color = '#ffffff';
  btnStop.style.border = 'none'; btnStop.style.borderRadius = '8px'; btnStop.style.cursor = 'pointer'; btnStop.style.fontWeight = 'bold';
  btnStop.style.fontSize = '14px'; btnStop.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.2)';
  btnStop.style.display = 'none'; 
  
  btnStop.addEventListener('click', () => {
    botSedangBerjalan = false;
    console.log('Mengirim perintah stop ke sistem bot...');
  });
  document.body.appendChild(btnStop);
}

function tampilkanTombolStop(show) {
  const btnStop = document.getElementById('btn-bot-stop');
  if (btnStop) {
    btnStop.style.display = show ? 'block' : 'none';
  }
}

if (document.readyState === 'complete') { buatTombolTrigger(); } else { window.addEventListener('load', buatTombolTrigger); }