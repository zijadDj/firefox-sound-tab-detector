// Store media tabs globally for direct access
let globalMediaTabs = [];
let lastScanTime = 0;
const SCAN_COOLDOWN = 10000; // Only scan once every 10 seconds max

// Function to get all tabs with media elements (playing or paused)
async function getAllMediaTabs() {
    console.log("getAllMediaTabs called.");
    
    // Return cached data if recently scanned
    const now = Date.now();
    if (globalMediaTabs.length > 0 && (now - lastScanTime) < SCAN_COOLDOWN) {
        console.log("Returning cached media tabs:", globalMediaTabs.length);
        return globalMediaTabs;
    }
    
    try {
        let allTabs = await browser.tabs.query({});
        console.log(`Found ${allTabs.length} total tabs to check.`);
        
        let mediaTabs = [];
        
        // Filter tabs to only check regular web pages (http/https)
        const webTabs = allTabs.filter(tab => {
            if (!tab.url) return false;
            return tab.url.startsWith('http://') || tab.url.startsWith('https://');
        });
        
        console.log(`Filtered to ${webTabs.length} web tabs out of ${allTabs.length} total tabs`);
        
        // Check only web tabs for media elements in parallel batches
        const batchSize = 5;
        for (let i = 0; i < webTabs.length; i += batchSize) {
            const batch = webTabs.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i/batchSize) + 1}: tabs ${i + 1}-${Math.min(i + batchSize, webTabs.length)}`);
            
            const batchPromises = batch.map(async (tab) => {
                try {
                    console.log(`Checking tab ${tab.id}: ${tab.title}`);
                    
                    // Fast fallback: if Firefox already says the tab is audible, include it immediately
                    if (tab.audible === true) {
                        console.log(`Tab ${tab.id} is marked audible by the browser; using audible fallback.`);
                        return {
                            ...tab,
                            mediaInfo: {
                                hasMedia: true,
                                isPlaying: true,
                                isPaused: false,
                                mediaCount: 1
                            }
                        };
                    }

                    const tabPromise = browser.tabs.executeScript(tab.id, {
                        code: `
                            (function() {
                                try {
                                    var mediaElements = document.querySelectorAll('audio, video');
                                    var hasMedia = mediaElements.length > 0;
                                    var isPlaying = false;
                                    var isPaused = false;
                                    
                                    mediaElements.forEach(function(media) {
                                        if (!media.paused) {
                                            isPlaying = true;
                                        } else if (media.currentTime > 0) {
                                            isPaused = true;
                                        }
                                    });
                                    
                                    return {
                                        hasMedia: hasMedia,
                                        isPlaying: isPlaying,
                                        isPaused: isPaused,
                                        mediaCount: mediaElements.length
                                    };
                                } catch (e) {
                                    return { hasMedia: false, error: e.message };
                                }
                            })();
                        `
                    });
                    
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Tab timeout')), 5000);
                    });
                    
                    const results = await Promise.race([tabPromise, timeoutPromise]);
                    
                    if (results && results.length > 0 && results[0].hasMedia) {
                        console.log(`Tab ${tab.id} has media:`, results[0]);
                        return {
                            ...tab,
                            mediaInfo: results[0]
                        };
                    } else {
                        console.log(`Tab ${tab.id} has no media`);
                        return null;
                    }
                } catch (error) {
                    console.log(`Skipping tab ${tab.id} due to error:`, error.message);
                    // As a last resort, if the tab is audible, still include it
                    if (tab.audible === true) {
                        console.log(`Including tab ${tab.id} via audible fallback after error.`);
                        return {
                            ...tab,
                            mediaInfo: {
                                hasMedia: true,
                                isPlaying: true,
                                isPaused: false,
                                mediaCount: 1
                            }
                        };
                    }
                    return null;
                }
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            const validResults = batchResults
                .filter(result => result.status === 'fulfilled' && result.value !== null)
                .map(result => result.value);
            
            mediaTabs.push(...validResults);
            console.log(`Batch completed. Found ${validResults.length} media tabs in this batch.`);
        }
        
        console.log(`Found ${mediaTabs.length} tabs with media out of ${allTabs.length} total tabs.`);
        
        // Update global cache
        globalMediaTabs = mediaTabs;
        lastScanTime = Date.now();
        console.log("Updated global media tabs cache");
        
        return mediaTabs;
    } catch (error) {
        console.error("Error in getAllMediaTabs:", error);
        return [];
    }
}

// Function to update the extension icon and title based on media tabs count
async function updateIconForMediaTabs() {
    console.log("updateIconForMediaTabs called.");

    let mediaTabs = await getAllMediaTabs();
    let playingTabs = mediaTabs.filter(tab => tab.mediaInfo.isPlaying);
    
    // Use specific icon paths
    const iconOnPath = "icons/icon-sound-on-48.png";
    const iconOffPath = "icons/icon-sound-off-48.png";

    if (playingTabs.length > 0) {
        console.log(`${playingTabs.length} tabs are playing media. Setting icon to ON.`);
        browser.browserAction.setIcon({ path: iconOnPath });
        browser.browserAction.setTitle({ title: `${playingTabs.length} tab(s) playing sound` });
    } else if (mediaTabs.length > 0) {
        console.log(`${mediaTabs.length} tabs have media but none are playing. Setting icon to OFF.`);
        browser.browserAction.setIcon({ path: iconOffPath });
        browser.browserAction.setTitle({ title: `${mediaTabs.length} tab(s) with media (paused)` });
    } else {
        console.log("No tabs with media found. Setting icon to OFF.");
        browser.browserAction.setIcon({ path: iconOffPath });
        browser.browserAction.setTitle({ title: "No tabs with media" });
    }
}

// --- Event Listeners ---

// 1. Initial update when the extension loads
browser.runtime.onStartup.addListener(updateIconForMediaTabs);
browser.windows.onCreated.addListener(updateIconForMediaTabs); // Handle new windows

// 2. Listen for tab activation (when you switch tabs)
browser.tabs.onActivated.addListener((activeInfo) => {
    console.log(`Tab activated: ${activeInfo.tabId}.`);
    updateIconForMediaTabs(); 
});

// 3. Listen for tab updates (e.g., audible status changes, title changes, etc.)
//    We care about changes to the 'audible' property for any tab.
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Update whenever audible status changes for any tab
    if (changeInfo.audible !== undefined) {
        console.log(`Tab ${tabId} updated. Audible status changed to: ${changeInfo.audible}.`);
        // Just update icon, don't invalidate cache
        updateIconForMediaTabs();
    }
}, { properties: ["audible"] }); // Only listen for audible property changes for efficiency

// 4. Handle when a tab is removed
browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    console.log(`Tab ${tabId} removed. Re-evaluating media tabs.`);
    updateIconForMediaTabs();
});


// Message listener for the popup
browser.runtime.onMessage.addListener((message, sender) => {
    if (message.command === "get_media_tabs") {
        console.log("Background: Received 'get_media_tabs' command from popup.");
        // Return current cache immediately and refresh in background to keep popup snappy
        const tabsData = globalMediaTabs.map(tab => ({
            id: tab.id,
            title: tab.title || tab.url,
            url: tab.url,
            audible: tab.audible,
            muted: tab.mutedInfo && tab.mutedInfo.muted,
            isPlaying: tab.mediaInfo.isPlaying,
            isPaused: tab.mediaInfo.isPaused,
            mediaCount: tab.mediaInfo.mediaCount
        }));
        console.log(`Background: Returning ${tabsData.length} cached media tabs to popup (immediate).`);
        // Kick off a fresh scan asynchronously
        lastScanTime = 0;
        getAllMediaTabs().then(() => {
            console.log("Background: Async refresh of media tabs complete.");
            updateIconForMediaTabs();
        }).catch(err => console.error("Background: Async refresh failed:", err));
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
        }).catch(error => {
            console.error(`Background: Error in toggle_mute for tab ${message.tabId}:`, error);
            return { success: false, error: error.message };
        });
    }
});

// Immediately call on script load to set the initial icon state
updateIconForMediaTabs();