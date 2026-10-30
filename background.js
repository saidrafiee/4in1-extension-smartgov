importScripts('pdf-lib.min.js', 'printing_background.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CLOSE_THIS_TAB' && sender.tab?.id) {
    chrome.tabs.remove(sender.tab.id).catch(() => {});
    return false;
  }
  if (request.action === 'SHOW_ALERT_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs?.[0];
      if (tab?.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: msg => alert(msg),
          args: [request.message]
        }).catch(() => {});
      }
    });
    if (sender.tab?.id) chrome.tabs.remove(sender.tab.id).catch(() => {});
    return false;
  }
});
