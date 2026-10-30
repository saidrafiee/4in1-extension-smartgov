const activeBlobUrls = new Map();
const pendingBlobs = new Map();
const pendingPrintBlobs = new Map();
const printBlobUrls = new Set();
let batchKeepaliveTimer = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_BATCH_KEEPALIVE') {
    if (!batchKeepaliveTimer) {
      batchKeepaliveTimer = setInterval(() => {
        chrome.runtime.sendMessage({ action: 'BATCH_KEEPALIVE' }, () => void chrome.runtime.lastError);
      }, 20000);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'STOP_BATCH_KEEPALIVE') {
    if (batchKeepaliveTimer) clearInterval(batchKeepaliveTimer);
    batchKeepaliveTimer = null;
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'CREATE_PRINT_BLOB') {
    pendingPrintBlobs.set(request.token, { chunks: [], size: 0, expectedSize: Number(request.expectedSize) || 0 });
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'APPEND_PRINT_CHUNK') {
    const pending = pendingPrintBlobs.get(request.token);
    if (!pending || typeof request.chunkBase64 !== 'string') {
      sendResponse({ error: 'Sesi PDF untuk cetak tidak ditemukan atau chunk tidak valid.' });
      return false;
    }
    const binary = atob(request.chunkBase64);
    const chunk = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) chunk[i] = binary.charCodeAt(i);
    pending.chunks.push(chunk);
    pending.size += chunk.byteLength;
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'FINALIZE_PRINT_BLOB') {
    const pending = pendingPrintBlobs.get(request.token);
    if (!pending) {
      sendResponse({ error: 'Sesi PDF cetak tidak ditemukan.' });
      return false;
    }
    pendingPrintBlobs.delete(request.token);
    if (pending.size !== pending.expectedSize) {
      sendResponse({ error: `Ukuran PDF tidak cocok (${pending.size}/${pending.expectedSize} byte).` });
      return false;
    }
    const blob = new Blob(pending.chunks, { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    printBlobUrls.add(url);
    sendResponse({ url });
    return false;
  }

  if (request.action === 'REVOKE_PRINT_BLOB') {
    if (printBlobUrls.has(request.url)) URL.revokeObjectURL(request.url);
    printBlobUrls.delete(request.url);
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'CREATE_BLOB_DOWNLOAD') {
    pendingBlobs.set(request.token, {
      chunks: [],
      size: 0,
      expectedSize: Number(request.expectedSize) || 0,
      mimeType: request.mimeType || 'application/octet-stream'
    });
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'APPEND_BLOB_CHUNK') {
    const pending = pendingBlobs.get(request.token);
    if (!pending) {
      sendResponse({ error: 'Sesi file sementara tidak ditemukan.' });
      return false;
    }
    if (typeof request.chunkBase64 !== 'string') {
      sendResponse({ error: 'Format chunk file tidak valid.' });
      return false;
    }
    const binary = atob(request.chunkBase64);
    const chunk = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) chunk[index] = binary.charCodeAt(index);
    pending.chunks.push(chunk);
    pending.size += chunk.byteLength;
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'FINALIZE_BLOB_DOWNLOAD') {
    const pending = pendingBlobs.get(request.token);
    if (!pending) {
      sendResponse({ error: 'Sesi file sementara tidak ditemukan.' });
      return false;
    }
    pendingBlobs.delete(request.token);
    if (pending.size !== pending.expectedSize) {
      sendResponse({ error: `Ukuran data tidak cocok (${pending.size}/${pending.expectedSize} byte).` });
      return false;
    }
    const blob = new Blob(pending.chunks, { type: request.mimeType || pending.mimeType });
    pending.chunks = [];
    const url = URL.createObjectURL(blob);
    activeBlobUrls.set(request.token, url);

    chrome.runtime.sendMessage({
      action: 'OFFSCREEN_BLOB_READY',
      token: request.token,
      url,
      filename: request.filename
    }, (response) => {
      if (chrome.runtime.lastError || response?.error || !response?.downloadId) {
        URL.revokeObjectURL(url);
        activeBlobUrls.delete(request.token);
        sendResponse({ error: response?.error || chrome.runtime.lastError?.message || 'Unduhan gagal dimulai.' });
        return;
      }
      sendResponse({ downloadId: response.downloadId });
    });
    return true;
  }

  if (request.action === 'REVOKE_BLOB_URL') {
    const url = activeBlobUrls.get(request.token);
    if (url) URL.revokeObjectURL(url);
    activeBlobUrls.delete(request.token);
    sendResponse({ ok: true });
    return false;
  }

  if (request.action === 'ABORT_BLOB_DOWNLOAD') {
    pendingBlobs.delete(request.token);
    const url = activeBlobUrls.get(request.token);
    if (url) URL.revokeObjectURL(url);
    activeBlobUrls.delete(request.token);
    sendResponse({ ok: true });
  }
});
