// Open the side panel when the icon is clicked. No browsing permissions:
// the fly lives in its panel until the user chooses to let it out.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  const { semilla } = await chrome.storage.local.get('semilla');
  if (!semilla) {
    // every install gets ITS OWN fly: a different mutation
    const s = [...crypto.getRandomValues(new Uint8Array(8))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({
      semilla: s, nacida: Date.now(), ultima_comida: Date.now(), comidas: 0
    });
  }
});

// If permission was already granted in an earlier session, re-register the
// rule: registerContentScripts persists, but can be lost on update.
const RULE = {
  id: 'fly-isOut', matches: ['*://*/*'],
  js: ['js/overlay.bundle.js'], runAt: 'document_idle',
};
async function syncRule(){
  const tiene = await chrome.permissions.contains({ origins: ['*://*/*'] });
  const ya = await chrome.scripting.getRegisteredContentScripts({ ids: [RULE.id] }).catch(() => []);
  if (tiene && !ya.length) await chrome.scripting.registerContentScripts([RULE]).catch(() => {});
  if (!tiene && ya.length) await chrome.scripting.unregisterContentScripts({ ids: [RULE.id] }).catch(() => {});
}
chrome.runtime.onStartup.addListener(syncRule);
chrome.runtime.onInstalled.addListener(syncRule);
chrome.permissions.onAdded.addListener(syncRule);
chrome.permissions.onRemoved.addListener(syncRule);
