document.addEventListener('DOMContentLoaded', async () => {
    const tabsContainer = document.getElementById('tabs-container');
    
    try {
        console.log("Popup: Sending message to background script for media tabs.");
        
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                console.log("Popup: Timeout reached, showing timeout message");
                reject(new Error('Timeout'));
            }, 10000); // 10 second timeout
        });
        
        const mediaTabsPromise = browser.runtime.sendMessage({ command: "get_media_tabs" });
        console.log("Popup: Message sent, waiting for response...");
        
        const mediaTabs = await Promise.race([mediaTabsPromise, timeoutPromise]);
        console.log("Popup: Received response from background script (mediaTabs):", mediaTabs);
        console.log("Popup: Type of mediaTabs:", typeof mediaTabs);
        console.log("Popup: Is array:", Array.isArray(mediaTabs));
        console.log("Popup: Length:", mediaTabs ? mediaTabs.length : 'undefined');
        
        if (mediaTabs && mediaTabs.length > 0) {
            console.log(`Popup: Displaying ${mediaTabs.length} tabs with media.`);
            
            // Clear loading message
            tabsContainer.innerHTML = '';
            
            // Create tab items
            mediaTabs.forEach(tab => {
                const tabItem = document.createElement('div');
                tabItem.className = 'tab-item';
                tabItem.innerHTML = `
                    <div class="tab-content">
                        <div class="tab-title">${escapeHtml(tab.title)}</div>
                        <div class="tab-url">${escapeHtml(tab.url)}</div>
                    </div>
                    <div class="tab-controls">
                        <div class="tab-info"></div>
                        <button class="control-button pause-btn" data-tab-id="${tab.id}">⏸️ Pause</button>
                        <button class="control-button mute-btn" data-tab-id="${tab.id}">🔇 Mute</button>
                    </div>
                `;
                
                // Add click handler to switch to the tab (only on tab content, not controls)
                const tabContent = tabItem.querySelector('.tab-content');
                tabContent.addEventListener('click', () => {
                    browser.tabs.update(tab.id, { active: true });
                    window.close(); // Close the popup after switching
                });
                
                // Add click handlers for control buttons
                const pauseBtn = tabItem.querySelector('.pause-btn');
                const muteBtn = tabItem.querySelector('.mute-btn');
                
                // Initialize button states based on actual media state
                if (tab.isPlaying) {
                    pauseBtn.textContent = '⏸️ Pause';
                } else if (tab.isPaused) {
                    pauseBtn.textContent = '▶️ Play';
                } else {
                    pauseBtn.textContent = '▶️ Play';
                }
                
                if (tab.muted) {
                    muteBtn.textContent = '🔊 Unmute';
                } else {
                    muteBtn.textContent = '🔇 Mute';
                }
                
                pauseBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await toggleTabPlayPause(tab.id, pauseBtn);
                });
                
                muteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await toggleTabMute(tab.id, muteBtn);
                });
                
                tabsContainer.appendChild(tabItem);
            });
        } else {
            console.log("Popup: No tabs with media found.");
            tabsContainer.innerHTML = '<div class="no-tabs">🔇 No tabs with media found</div>';
        }
    } catch (error) {
        console.error("Popup: Error sending or receiving message:", error);
        if (error.message === 'Timeout') {
            tabsContainer.innerHTML = '<div class="no-tabs">⏰ Loading timeout - try refreshing</div>';
        } else {
            tabsContainer.innerHTML = '<div class="no-tabs">❌ Error loading tabs</div>';
        }
    }
});

// Helper function to escape HTML characters
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Function to toggle play/pause for a tab
async function toggleTabPlayPause(tabId, button) {
    try {
        console.log(`Popup: Toggling play/pause for tab ${tabId}`);
        
        // Disable button temporarily to prevent multiple clicks
        button.disabled = true;
        button.textContent = '⏳ Loading...';
        
        const result = await browser.runtime.sendMessage({ 
            command: "toggle_play_pause", 
            tabId: tabId 
        });
        
        if (result.success) {
            // Update button text based on new state
            button.textContent = result.isPlaying ? '⏸️ Pause' : '▶️ Play';
            console.log(`Popup: Tab ${tabId} is now ${result.isPlaying ? 'playing' : 'paused'}`);
        } else {
            console.error(`Popup: Failed to toggle play/pause for tab ${tabId}:`, result.error);
            button.textContent = '❌ Error';
        }
    } catch (error) {
        console.error(`Popup: Error toggling play/pause for tab ${tabId}:`, error);
        button.textContent = '❌ Error';
    } finally {
        // Re-enable button after a short delay
        setTimeout(() => {
            button.disabled = false;
        }, 1000);
    }
}

// Function to toggle mute for a tab
async function toggleTabMute(tabId, button) {
    try {
        console.log(`Popup: Toggling mute for tab ${tabId}`);
        
        // Disable button temporarily to prevent multiple clicks
        button.disabled = true;
        button.textContent = '⏳ Loading...';
        
        const result = await browser.runtime.sendMessage({ 
            command: "toggle_mute", 
            tabId: tabId 
        });
        
        if (result.success) {
            // Update button text based on new state
            button.textContent = result.isMuted ? '🔊 Unmute' : '🔇 Mute';
            console.log(`Popup: Tab ${tabId} is now ${result.isMuted ? 'muted' : 'unmuted'}`);
        } else {
            console.error(`Popup: Failed to toggle mute for tab ${tabId}:`, result.error);
            button.textContent = '❌ Error';
        }
    } catch (error) {
        console.error(`Popup: Error toggling mute for tab ${tabId}:`, error);
        button.textContent = '❌ Error';
    } finally {
        // Re-enable button after a short delay
        setTimeout(() => {
            button.disabled = false;
        }, 1000);
    }
}