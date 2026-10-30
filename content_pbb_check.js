(function () {
  if (window.pbbAutoCheckerInjected) {
    return;
  }
  window.pbbAutoCheckerInjected = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_CHECK') {
      processAllNop(request.data).then((results) => {
        downloadCSV(results);
        sendResponse({ status: 'DONE', count: results.length });
      });
      return true;
    }
  });

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function waitForTableUpdate(timeoutMs = 5000) {
    return new Promise((resolve) => {
      const targetNode = document.querySelector('#main_datatable tbody');
      
      if (!targetNode) {
        setTimeout(resolve, 2000);
        return;
      }

      let timer;

      const observer = new MutationObserver((mutationsList, obs) => {
        obs.disconnect();
        clearTimeout(timer);
        setTimeout(resolve, 300);
      });

      observer.observe(targetNode, { childList: true, subtree: true, characterData: true });

      timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, timeoutMs);
    });
  }

  async function typeLikeHuman(char) {
    let activeEl = document.activeElement;
    if (!activeEl) return;

    document.execCommand('insertText', false, char);

    activeEl.dispatchEvent(new Event('input', { bubbles: true }));
    activeEl.dispatchEvent(new Event('change', { bubbles: true }));
    activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

    await delay(50);
  }

  async function clearAllFields() {
    const selectors = [
      '#main_datatable_filter_kode_kecamatan_field',
      '#main_datatable_filter_kode_kelurahan_field',
      '#main_datatable_filter_kode_blok_field',
      '#main_datatable_filter_no_urut_field',
      '#main_datatable_filter_kode_jenis_op_field'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    await delay(100);
  }

  async function handlePopUpIfPresent() {
    const modal = document.querySelector('.modal.in, .modal.show, .sweet-alert, .swal-overlay--show, div[role="dialog"]');
    
    if (modal && modal.offsetWidth > 0 && modal.offsetHeight > 0) {
      const closeBtn = modal.querySelector('button.btn-primary, button.confirm, .modal-footer button, button.close');
      if (closeBtn) {
        closeBtn.click();
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      }
      await delay(500);
      return true;
    }
    return false;
  }

  async function processAllNop(dataList) {
    const results = [];

    for (let i = 0; i < dataList.length; i++) {
      const item = dataList[i];
      const rawNop = item.NOP || "";

      let cleanNop = rawNop.replace(/\./g, '');
      if (cleanNop.startsWith("1471")) {
        cleanNop = cleanNop.substring(4);
      }

      await clearAllFields();

      const firstInput = document.querySelector('#main_datatable_filter_kode_kecamatan_field');
      if (firstInput) {
        firstInput.focus();
        firstInput.select();
      }

      let isNopChanged = false;

      for (let char of cleanNop) {
        await typeLikeHuman(char);

        const popUpAppeared = await handlePopUpIfPresent();
        if (popUpAppeared) {
          isNopChanged = true;
          break;
        }
      }

      if (isNopChanged) {
        results.push({
          No: item.No,
          NOP: rawNop,
          "Nama WP": item["Nama WP"],
          "2026": "NOP Berubah",
          "2025": "NOP Berubah",
          "2024": "NOP Berubah",
          "2023": "NOP Berubah",
          "2022": "NOP Berubah"
        });
        await delay(500);
        continue;
      }

      const tablePromise = waitForTableUpdate(6000);

      const filterBtn = document.querySelector('#filter_button');
      if (filterBtn) {
        filterBtn.click();
      } else {
        const activeEl = document.activeElement || document.querySelector('#main_datatable_filter_kode_jenis_op_field');
        if (activeEl) {
          activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        }
      }

      await tablePromise;

      if (await handlePopUpIfPresent()) {
        results.push({
          No: item.No,
          NOP: rawNop,
          "Nama WP": item["Nama WP"],
          "2026": "NOP Berubah",
          "2025": "NOP Berubah",
          "2024": "NOP Berubah",
          "2023": "NOP Berubah",
          "2022": "NOP Berubah"
        });
        continue;
      }

      const getText = (rowIdx) => {
        const cell = document.querySelector(`#main_datatable > tbody > tr:nth-child(${rowIdx}) > td:nth-child(6)`);
        return cell ? cell.innerText.trim() : 'Tidak Ada Data';
      };

      results.push({
        No: item.No,
        NOP: rawNop,
        "Nama WP": item["Nama WP"],
        "2026": getText(1),
        "2025": getText(2),
        "2024": getText(3),
        "2023": getText(4),
        "2022": getText(5)
      });
    }

    return results;
  }

  // PERBAIKAN: Export ke Excel dengan pemisah titik koma (;) & instruksi sep=;
  function downloadCSV(data) {
    if (!data || data.length === 0) return;

    const headers = ["No", "NOP", "Nama WP", "2026", "2025", "2024", "2023", "2022"];
    
    // Baris pertama memaksa Excel membaca pemisah berupa titik koma (;)
    const csvRows = ['sep=;', headers.join(';')];

    data.forEach((row) => {
      const values = headers.map((header) => {
        let val = row[header] || '';
        // Ubah NOP menjadi teks eksplisit agar angka nol di depan tidak hilang di Excel
        if (header === 'NOP') {
          return `="${val}"`;
        }
        return `"${val.toString().replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(';'));
    });

    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Hasil_Cek_PBB_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
})();