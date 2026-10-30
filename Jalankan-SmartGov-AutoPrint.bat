@echo off
setlocal
 title SmartGov Auto Print - Chrome Kiosk Printing
 echo ============================================================
 echo SmartGov Auto Print - cetak senyap ke printer yang dikonfigurasi di PC ini
 echo ============================================================
 echo.
 echo PENTING: Simpan pekerjaan dan tutup SEMUA jendela Google Chrome dahulu.
 echo Pastikan printer default / printer terakhir Chrome sudah benar di PC ini.
 echo.
 pause
 set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
 if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
 if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
 if not exist "%CHROME%" (
   echo Google Chrome tidak ditemukan pada lokasi standar.
   echo Buka Chrome dengan shortcut yang ditambahkan opsi --kiosk-printing.
   pause
   exit /b 1
 )
 start "" "%CHROME%" --kiosk-printing
endlocal
