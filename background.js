// Lightweight, event-driven cache of audible tabs
const audibleTabsMap = new Map(); // tabId -> { id, title, url, audible, muted }

function getAudibleTabs() {
    return Array.from(audibleTabsMap.values());
}

function upsertFromTab(tab) {
    if (!tab || tab.id == null) return false;
    const was = audibleTabsMap.has(tab.id);
    if (tab.audible) {
        audibleTabsMap.set(tab.id, {
            id: tab.id,
            title: tab.title || tab.url || `Tab ${tab.id}`,
            url: tab.url || '',
            audible: true,
            muted: !!(tab.mutedInfo && tab.mutedInfo.muted),
        });
        return was ? 'updated' : 'added';
    } else {
        if (was) {
            audibleTabsMap.delete(tab.id);
            return 'removed';
        }
        return false;
    }
}

function pushUpdateToPopup() {
    const tabs = getAudibleTabs();
    try {
        browser.runtime.sendMessage({ command: 'audible_tabs_changed', tabs });
    } catch (_) {
        // Ignore if no listeners (e.g., popup closed)
    }
}

// Function to update the extension icon and title based on audible tabs count
async function updateIconForMediaTabs() {
    console.log("updateIconForMediaTabs called.");
    const count = getAudibleTabs().length;
    const iconOnPath = "icons/icon-sound-on-48.png";
    const iconOffPath = "icons/icon-sound-off-48.png";
    if (count > 0) {
        browser.browserAction.setIcon({ path: iconOnPath });
        browser.browserAction.setTitle({ title: `${count} tab(s) playing sound` });
    } else {
        browser.browserAction.setIcon({ path: iconOffPath });
        browser.browserAction.setTitle({ title: "No tabs with media" });
    }
}

// --- Event Listeners ---

// 1. Initialize cache on startup and update icon
browser.runtime.onStartup.addListener(async () => {
    const tabs = await browser.tabs.query({});
    tabs.forEach(t => upsertFromTab(t));
    updateIconForMediaTabs();
});
browser.windows.onCreated.addListener(updateIconForMediaTabs);

// 2. Listen for tab creation
browser.tabs.onCreated.addListener((tab) => {
    const changed = upsertFromTab(tab);
    if (changed) {
        updateIconForMediaTabs();
        pushUpdateToPopup();
    }
});

// 3. Listen for tab updates (audible, muted, title, url)
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    let changed = false;
    if (changeInfo.audible !== undefined) {
        console.log(`Tab ${tabId} audible: ${changeInfo.audible}`);
        changed = upsertFromTab(tab) !== false || changed;
    } else if (audibleTabsMap.has(tabId)) {
        // For audible tabs, reflect metadata changes
        const entry = audibleTabsMap.get(tabId);
        const before = JSON.stringify(entry);
        if (changeInfo.title !== undefined) entry.title = tab.title || entry.title;
        if (changeInfo.url !== undefined) entry.url = tab.url || entry.url;
        if (changeInfo.mutedInfo !== undefined) entry.muted = !!(tab.mutedInfo && tab.mutedInfo.muted);
        const after = JSON.stringify(entry);
        changed = (before !== after) || changed;
    }
    if (changed) {
        updateIconForMediaTabs();
        pushUpdateToPopup();
    }
}, { properties: ["audible", "mutedInfo", "title", "url"] });

// 4. Handle when a tab is removed
browser.tabs.onRemoved.addListener((tabId) => {
    if (audibleTabsMap.delete(tabId)) {
        updateIconForMediaTabs();
        pushUpdateToPopup();
    }
});


// Message listener for the popup
browser.runtime.onMessage.addListener((message, sender) => {
    if (message.command === "skip_track") {
        console.log(`Background: Received 'skip_track' command for tab ${message.tabId}, direction: ${message.direction}`);
        
        // First, try to inject and execute our content script
        return browser.tabs.executeScript(message.tabId, {
            file: '/content/skipTrack.js'
        }).then(() => {
            // Now execute the skipTrack function
            return browser.tabs.executeScript(message.tabId, {
                code: `skipTrack('${message.direction}');`
            });
        }).then(results => {
            if (results && results[0] && results[0].success) {
                console.log(`Successfully skipped ${message.direction} track using method:`, results[0].method);
                return { success: true, method: results[0].method };
            }
            const error = results && results[0] ? results[0].error : 'Unknown error';
            const methodsTried = results && results[0] ? results[0].methodsTried : [];
            console.error(`Failed to skip ${message.direction} track:`, error, 'Methods tried:', methodsTried);
            return { 
                success: false, 
                error: error,
                methodsTried: methodsTried
            };
        }).catch(error => {
            console.error(`Background: Error executing skip_track in tab ${message.tabId}:`, error);
            return { 
                success: false, 
                error: error.message,
                method: 'error'
            };
        });
    }

    if (message.command === "get_media_tabs") {
        console.log("Background: Received 'get_media_tabs' command from popup.");
        const tabsData = getAudibleTabs().map(tab => ({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            audible: true,
            muted: tab.muted,
            // Keep fields popup expects
            isPlaying: true,
            isPaused: false,
            mediaCount: 1,
        }));
        console.log(`Background: Returning ${tabsData.length} audible tabs from cache.`);
        return Promise.resolve(tabsData);
    }

    if (message.command === "toggle_play_pause") {
        console.log(`Background: Received 'toggle_play_pause' command for tab ${message.tabId}.`);
        // Execute script in the tab to toggle play/pause
        return browser.tabs.executeScript(message.tabId, {
            code: `
                (function() {
                    var mediaElements = document.querySelectorAll('audio, video');
                    var foundPlaying = false;
                    mediaElements.forEach(function(media) {
                        if (!media.paused) {
                            foundPlaying = true;
                            media.pause();
                        } else if (media.currentTime > 0) {
                            media.play();
                        }
                    });
                    return foundPlaying ? 'paused' : 'playing';
                })();
            `
        }).then(results => {
            if (results && results.length > 0) {
                const newState = results[0];
                console.log(`Background: Tab ${message.tabId} state changed to: ${newState}`);
                return { success: true, isPlaying: newState === 'playing' };
            } else {
                console.log(`Background: No media elements found in tab ${message.tabId}`);
                return { success: false, error: 'No media elements found' };
            }
        }).catch(error => {
            console.error(`Background: Error executing script in tab ${message.tabId}:`, error);
            return { success: false, error: error.message };
        });
    }

    if (message.command === "toggle_mute") {
        console.log(`Background: Received 'toggle_mute' command for tab ${message.tabId}.`);
        return browser.tabs.get(message.tabId).then(tab => {
            const isCurrentlyMuted = tab.mutedInfo && tab.mutedInfo.muted;
            const newMuteState = !isCurrentlyMuted;
            return browser.tabs.update(message.tabId, { muted: newMuteState }).then(() => {
                console.log(`Background: Tab ${message.tabId} mute state changed to: ${newMuteState}`);
                return { success: true, isMuted: newMuteState };
            });
        }).then(result => {
            // Reflect mute change in cache and push update
            const tabEntry = audibleTabsMap.get(message.tabId);
            if (tabEntry) {
                tabEntry.muted = result.isMuted;
                pushUpdateToPopup();
            }
            return result;
        }).catch(error => {
            console.error(`Background: Error in toggle_mute for tab ${message.tabId}:`, error);
            return { success: false, error: error.message };
        });
    }
});

// Immediately initialize cache and set initial icon state
(async function init() {
    const tabs = await browser.tabs.query({});
    tabs.forEach(t => upsertFromTab(t));
    updateIconForMediaTabs();
})();