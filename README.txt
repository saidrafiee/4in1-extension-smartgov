SmartGov PBB Automator v4.3.0 — Auto Print per NOP

FITUR
- Batch Merge tetap tersedia.
- Auto Print memproses NOP berurutan: tunggu PDF selesai diunduh, lalu buka halaman cetak, dan tunggu window.print() kembali sebelum memproses NOP berikutnya.
- Auto Print senyap membutuhkan Google Chrome dijalankan dengan --kiosk-printing.
- Extension tidak mengunci nama printer tertentu. Setiap komputer menggunakan konfigurasi printer Chrome/Windows pada komputer itu sendiri.
- Dashboard, fitur WhatsApp/Konfirmasi Selesai, Cek PBB, Bot Ganti Petugas, laporan TXT, progress, dan pembatalan tetap tersedia.

PENTING UNTUK 2 KOMPUTER DENGAN PRINTER FISIK BERBEDA
Lakukan konfigurasi ini secara TERPISAH di masing-masing komputer:
1. Pasang printer fisik yang sesuai dan pastikan bisa mencetak halaman uji dari Windows.
2. Windows Settings > Bluetooth & devices > Printers & scanners. Matikan "Let Windows manage my default printer" jika tersedia, lalu pilih printer komputer itu dan klik Set as default.
3. Buka Chrome biasa, buka halaman apa pun dan tekan Ctrl+P satu kali. Pastikan printer yang dipilih adalah printer komputer tersebut. Pilih printer yang benar, lalu tutup/cancel dialog. Chrome dapat mengingat printer terakhir yang digunakan, jadi jangan lewatkan pemeriksaan ini.
4. Tutup SEMUA jendela Chrome. Jalankan file Jalankan-SmartGov-AutoPrint.bat dari folder ini. File tersebut menjalankan Chrome dengan --kiosk-printing agar dialog cetak dilewati.
5. Buka SmartGov dan extension seperti biasa, lalu uji Auto Print dengan 1 NOP sebelum batch besar.

JANGAN jalankan BAT ketika Chrome masih terbuka. Jika Chrome sudah berjalan, Chrome bisa memakai proses yang sudah ada dan mengabaikan opsi startup baru. BAT tidak memaksa menutup Chrome agar tab dan pekerjaan Anda tidak hilang.

CARA MEMASANG EXTENSION
1. Ekstrak ZIP ini.
2. Buka chrome://extensions dan aktifkan Developer mode.
3. Klik Load unpacked, pilih folder "Extension Multifungsi Smartgov" yang berisi manifest.json.
4. Lakukan pemasangan pada kedua komputer; file extension yang sama bisa dipakai keduanya.

BATASAN / CATATAN
- --kiosk-printing adalah opsi startup Chrome, bukan pengaturan yang bisa diaktifkan extension dari dalam browser.
- Cetak senyap mengirim ke printer yang dipilih/dikenali Chrome; karena itu periksa printer pada masing-masing komputer sebelum digunakan.
- Extension dapat menunggu window.print() kembali, tetapi tidak dapat memastikan kertas benar-benar keluar atau memastikan printer fisik menyelesaikan pekerjaan.
- Jika dialog cetak tidak selesai dalam 10 menit, antrean dihentikan. Jika unduhan PDF gagal/timeout 60 detik, dialog cetak untuk NOP tersebut tidak dibuka.
- Uji 1 NOP dahulu pada setiap komputer untuk memastikan printer dan format hasil sesuai.
