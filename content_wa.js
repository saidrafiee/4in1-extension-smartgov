// content_wa.js
(function () {
  // =========================================================================
  // MASUKKAN 2 NOMOR PENGIRIM RESMI DI SINI (Format angka murni berawalan 62)
  // Contoh: "6287750614282"
  // =========================================================================
  const AKUN_PENGIRIM_DIIZINKAN = [
    "6289526183439", // Nomor Pengirim Resmi 1
    "6281234567890"  // Nomor Pengirim Resmi 2
  ];

  const urlParams = new URLSearchParams(window.location.search);
  const isAutoSend = urlParams.get('autoSend') === 'true';

  if (!isAutoSend) return;

  function getLoggedUserNumber() {
    try {
      const lastWid = localStorage.getItem('last-wid-md') || 
                      localStorage.getItem('last-wid') || 
                      localStorage.getItem('whatsapp-consumer-id') || '';
      
      if (!lastWid) return null;
      const match = lastWid.match(/(\d+)/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  // Beri jeda 1 detik agar localStorage WhatsApp Web siap dibaca
  setTimeout(() => {
    const loggedNumber = getLoggedUserNumber();

    // 1. JIKA DEVICE BELUM LOGIN WA WEB
    if (!loggedNumber) {
      chrome.runtime.sendMessage({
        action: "SHOW_ALERT_ACTIVE_TAB",
        message: "AKSES DITOLAK!\n\nDevice/Browser ini BELUM LOGIN ke WhatsApp Web.\nSilakan scan QR Code WhatsApp Web terlebih dahulu dengan nomor resmi."
      });
      return;
    }

    // 2. JIKA NOMOR WA PENGIRIM TIDAK DIIZINKAN
    const isAuthorized = AKUN_PENGIRIM_DIIZINKAN.some(allowedNum => 
      loggedNumber.includes(allowedNum) || allowedNum.includes(loggedNumber)
    );

    if (!isAuthorized) {
      chrome.runtime.sendMessage({
        action: "SHOW_ALERT_ACTIVE_TAB",
        message: `AKSES DITOLAK!\n\nAkun WhatsApp Web yang login di device ini (+${loggedNumber}) TIDAK DIIZINKAN untuk mengirim pesan dari ekstensi ini!`
      });
      return;
    }

    // 3. JIKA LULUS OTENTIKASI, JALANKAN OTOMASI KIRIM
    console.log(`[SmartGov WA AutoSend] Otentikasi Berhasil (+${loggedNumber})`);

    let percobaan = 0;
    const maxPercobaan = 60;

    const intervalKirim = setInterval(() => {
      percobaan++;

      const btnKirim = document.querySelector('button span[data-icon="send"]')?.closest('button') ||
                       document.querySelector('button[aria-label="Kirim"]') ||
                       document.querySelector('button[aria-label="Send"]');

      if (btnKirim) {
        btnKirim.click();
        clearInterval(intervalKirim);

        setTimeout(() => {
          chrome.runtime.sendMessage({
            action: "SHOW_ALERT_ACTIVE_TAB",
            message: "BERHASIL!\n\nPesan pemberitahuan PBB telah sukses terkirim di latar belakang."
          });
        }, 2500);
      }

      if (percobaan >= maxPercobaan) {
        clearInterval(intervalKirim);
        chrome.runtime.sendMessage({
          action: "SHOW_ALERT_ACTIVE_TAB",
          message: "GAGAL KIRIM!\n\nTombol kirim tidak ditemukan atau koneksi lambat."
        });
      }
    }, 1000);

  }, 1000);
})();