const audibleTabsMap = new Map();
const TAB_RETENTION_MS = 30 * 60 * 1000; // Keep tabs for 30 minutes after they stop playing

function getAudibleTabs() {
    // Clean up old tabs before returning the list
    cleanupOldTabs();
    return Array.from(audibleTabsMap.values())
        .filter(tab => tab.audible || (Date.now() - tab.lastActive) < TAB_RETENTION_MS);
}

function cleanupOldTabs() {
    const now = Date.now();
    for (const [id, tab] of audibleTabsMap.entries()) {
        if (!tab.audible && (now - tab.lastActive) >= TAB_RETENTION_MS) {
            audibleTabsMap.delete(id);
        }
    }
}

function upsertFromTab(tab) {
    if (!tab || tab.id == null) return false;
    
    const now = Date.now();
    const was = audibleTabsMap.has(tab.id);
    
    if (tab.audible) {
        // Update or add tab that's currently playing
        audibleTabsMap.set(tab.id, {
            id: tab.id,
            title: tab.title || tab.url || `Tab ${tab.id}`,
            url: tab.url || '',
            audible: true,
            muted: !!(tab.mutedInfo && tab.mutedInfo.muted),
            lastActive: now
        });
        return was ? 'updated' : 'added';
    } else if (was) {
        // Tab was playing before but isn't now - mark as inactive but keep it
        const existingTab = audibleTabsMap.get(tab.id);
        if (existingTab) {
            existingTab.audible = false;
            // Only update lastActive if it's not already set
            existingTab.lastActive = existingTab.lastActive || now;
        }
        return 'updated';
    }
    return false;
}


const popupPorts = new Set();


browser.runtime.onConnect.addListener(port => {
    if (port.name === 'popup') {
        popupPorts.add(port);
        
        
        const tabs = Array.from(audibleTabsMap.values());
        port.postMessage({
            command: 'update_media_tabs',
            tabs: tabs
        });
        
        port.onDisconnect.addListener(() => {
            popupPorts.delete(port);
        });
    }
});


function pushUpdateToPopup() {
    if (popupPorts.size === 0) {
        return; 
    }
    
    // Get the latest tab states
    const tabs = Array.from(audibleTabsMap.values()).map(tab => ({
        ...tab,
        // Ensure we have the latest play state
        isPlaying: tab.audible
    }));
    
    const message = {
        command: 'update_media_tabs',
        tabs: tabs
    };
    
    for (const port of popupPorts) {
        try {
            port.postMessage(message);
        } catch (error) {
            console.error('Error sending update to popup:', error);
            popupPorts.delete(port);
        }
    }
}


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


// Clean up old tabs every 5 minutes
setInterval(cleanupOldTabs, 5 * 60 * 1000);

browser.runtime.onStartup.addListener(async () => {
    const tabs = await browser.tabs.query({});
    tabs.forEach(t => upsertFromTab(t));
    updateIconForMediaTabs();
});

browser.windows.onCreated.addListener(updateIconForMediaTabs);


browser.tabs.onCreated.addListener((tab) => {
    const changed = upsertFromTab(tab);
    if (changed) {
        updateIconForMediaTabs();
        pushUpdateToPopup();
    }
});


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


browser.tabs.onRemoved.addListener((tabId) => {
    if (audibleTabsMap.delete(tabId)) {
        updateIconForMediaTabs();
        pushUpdateToPopup();
    }
});



browser.runtime.onMessage.addListener((message, sender) => {
    // Handle play/pause toggle
    if (message.command === "toggle_play_pause") {
        console.log(`Background: Received 'toggle_play_pause' command for tab ${message.tabId}.`);
        
        // Update our local state first
        const tab = audibleTabsMap.get(message.tabId);
        if (tab) {
            tab.lastActive = Date.now();
            // We'll update the audible state when we get the result from the content script
        }
        
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
                            foundPlaying = true;
                            media.play();
                        }
                    });
                    
                    if (!foundPlaying && mediaElements.length > 0) {
                        // If no media was playing, start the first one
                        mediaElements[0].play();
                        foundPlaying = true;
                    }
                    
                    return { success: true, isPlaying: !foundPlaying };
                })();
            `
        }).then(([result]) => {
            console.log(`Background: Successfully toggled play/pause for tab ${message.tabId}.`);
            
            // Update our local state with the actual result from the content script
            const tab = audibleTabsMap.get(message.tabId);
            if (tab) {
                tab.audible = result.isPlaying;
                tab.lastActive = Date.now();
                pushUpdateToPopup();
            }
            
            return result;
        }).catch(error => {
            console.error(`Background: Error toggling play/pause for tab ${message.tabId}:`, error);
            return { success: false, error: error.message };
        });
    }
    
    if (message.command === "skip_track") {
        console.log(`Background: Received 'skip_track' command for tab ${message.tabId}, direction: ${message.direction}`);
        
        
        return browser.tabs.sendMessage(message.tabId, {
            command: 'execute_skip_track',
            direction: message.direction
        }).catch(error => {
            console.log('Direct message failed, attempting to inject content script...', error);
            
            return browser.tabs.executeScript(message.tabId, {
                file: '/content/skipTrack.js'
            }).then(() => {
                console.log('Content script injected, sending message...');
                return browser.tabs.sendMessage(message.tabId, {
                    command: 'execute_skip_track',
                    direction: message.direction
                });
            }).catch(injectError => {
                console.error('Failed to inject content script:', injectError);
                throw new Error('Failed to inject content script: ' + injectError.message);
            });
        }).then(async (result) => {
            if (result && result.success) {
                console.log(`Successfully skipped ${message.direction} track using method:`, result.method);
                
                try {
                    
                    const tab = await browser.tabs.get(message.tabId);
                    if (tab) {
                        
                        const updateType = upsertFromTab(tab);
                        if (updateType) {
                            console.log(`Tab ${tab.id} ${updateType} in cache`);
                        }
                        
                        
                        const updatedTab = await browser.tabs.get(message.tabId);
                        if (updatedTab) {
                            
                            audibleTabsMap.set(updatedTab.id, {
                                ...audibleTabsMap.get(updatedTab.id) || {},
                                title: updatedTab.title,
                                url: updatedTab.url
                            });
                            
                            
                            pushUpdateToPopup();
                            
                            
                            try {
                                await browser.tabs.sendMessage(message.tabId, {
                                    command: 'update_title'
                                });
                            } catch (e) {
                                
                                console.log('Could not update title via content script:', e);
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error updating tab info after skip:', e);
                }
                
                return { success: true, method: result.method };
            }
            const error = result?.error || 'No supported track skipping method found';
            const methodsTried = result?.methodsTried || [];
            console.error(`Failed to skip ${message.direction} track:`, error, 'Methods tried:', methodsTried);
            return { success: false, error, methodsTried };
        }).catch(error => {
            console.error(`Background: Error in skip_track for tab ${message.tabId}:`, error);
            
            return browser.tabs.executeScript(message.tabId, {
                code: `
                    (function() {
                        try {
                            const direction = '${message.direction}';
                            const selectors = direction === 'next' ? 
                                ['.ytp-next-button', '.next', '.skip-next', '[data-testid="next"]'] :
                                ['.ytp-prev-button', '.previous', '.skip-previous', '[data-testid="previous"]'];
                            
                            for (const selector of selectors) {
                                const button = document.querySelector(selector);
                                if (button && button.offsetParent !== null) {
                                    button.click();
                                    return { success: true, method: 'direct-button-click' };
                                }
                            }
                            return { success: false, error: 'No skip buttons found' };
                        } catch (e) {
                            return { success: false, error: e.message };
                        }
                    })();
                `
            }).then(results => {
                const result = results && results[0];
                if (result && result.success) {
                    console.log(`Successfully skipped ${message.direction} track using fallback method:`, result.method);
                    return { success: true, method: result.method };
                }
                throw new Error(result?.error || 'All skip methods failed');
            });
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

            isPlaying: true,
            isPaused: false,
            mediaCount: 1,
        }));
        console.log(`Background: Returning ${tabsData.length} audible tabs from cache.`);
        return Promise.resolve(tabsData);
    }

    if (message.command === "toggle_play_pause") {
        console.log(`Background: Received 'toggle_play_pause' command for tab ${message.tabId}.`);
        
        // Update our local state first
        const tab = audibleTabsMap.get(message.tabId);
        if (tab) {
            tab.lastActive = Date.now();
            // We'll update the audible state when we get the result from the content script
        }
        
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


(async function init() {
    const tabs = await browser.tabs.query({});
    tabs.forEach(t => upsertFromTab(t));
    updateIconForMediaTabs();
})();