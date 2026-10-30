'use strict';
const params = new URLSearchParams(location.search);
const pdfUrl = params.get('pdf');
const nop = params.get('nop') || '';
const status = document.getElementById('status');
const frame = document.getElementById('pdfFrame');
let printed = false;
if (!pdfUrl) {
  status.textContent = 'Gagal: URL PDF tidak tersedia.';
  chrome.runtime.sendMessage({ action: 'PRINT_DIALOG_ERROR', message: 'URL PDF tidak tersedia.' }, () => void chrome.runtime.lastError);
} else {
  status.textContent = `NOP ${nop}: PDF siap. Jika Chrome tidak dijalankan dengan --kiosk-printing, dialog cetak akan muncul.`;
  frame.onload = () => {
    if (printed) return;
    printed = true;
    setTimeout(() => {
      try {
        // Chrome --kiosk-printing dapat mencetak tanpa dialog; Chrome biasa biasanya menampilkan dialog.
        window.focus();
        window.print();
        // window.print() kembali setelah dialog cetak ditutup atau proses cetak kiosk selesai.
        chrome.runtime.sendMessage({ action: 'PRINT_DIALOG_CLOSED', nop }, () => void chrome.runtime.lastError);
      } catch (error) {
        status.textContent = `Gagal memulai cetak NOP ${nop}: ${error.message}`;
        chrome.runtime.sendMessage({ action: 'PRINT_DIALOG_ERROR', message: status.textContent, nop }, () => void chrome.runtime.lastError);
      }
    }, 900);
  };
  frame.src = pdfUrl;
}
window.addEventListener('beforeunload', () => {
  if (pdfUrl) chrome.runtime.sendMessage({ action: 'REVOKE_PRINT_BLOB', url: pdfUrl }, () => void chrome.runtime.lastError);
});
