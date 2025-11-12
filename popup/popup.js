document.addEventListener('DOMContentLoaded', async () => {
    const tabsContainer = document.getElementById('tabs-container');

    function renderTabs(mediaTabs) {
        if (mediaTabs && mediaTabs.length > 0) {
            tabsContainer.innerHTML = '';
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
                        <button class="control-button prev-btn" data-tab-id="${tab.id}" title="Previous Track">⏮️</button>
                        <button class="control-button pause-btn" data-tab-id="${tab.id}">⏸️ Pause</button>
                        <button class="control-button next-btn" data-tab-id="${tab.id}" title="Next Track">⏭️</button>
                        <button class="control-button mute-btn" data-tab-id="${tab.id}">🔇 Mute</button>
                    </div>
                `;

                const tabContent = tabItem.querySelector('.tab-content');
                tabContent.addEventListener('click', () => {
                    browser.tabs.update(tab.id, { active: true });
                    window.close();
                });

                const prevBtn = tabItem.querySelector('.prev-btn');
                const pauseBtn = tabItem.querySelector('.pause-btn');
                const nextBtn = tabItem.querySelector('.next-btn');
                const muteBtn = tabItem.querySelector('.mute-btn');

                pauseBtn.textContent = tab.isPlaying ? '⏸️ Pause' : '▶️ Play';
                muteBtn.textContent = tab.muted ? '🔊 Unmute' : '🔇 Mute';

                prevBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await skipTrack(tab.id, 'prev', prevBtn);
                });
                pauseBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await toggleTabPlayPause(tab.id, pauseBtn);
                });
                nextBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await skipTrack(tab.id, 'next', nextBtn);
                });
                muteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await toggleTabMute(tab.id, muteBtn);
                });

                tabsContainer.appendChild(tabItem);
            });
        } else {
            tabsContainer.innerHTML = '<div class="no-tabs">🔇 No tabs with media found</div>';
        }
    }

    try {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 5000);
        });
        const mediaTabs = await Promise.race([
            browser.runtime.sendMessage({ command: 'get_media_tabs' }),
            timeoutPromise,
        ]);
        renderTabs(mediaTabs);
    } catch (error) {
        console.error('Popup: initial load error', error);
        if (error.message === 'Timeout') {
            tabsContainer.innerHTML = '<div class="no-tabs">⏰ Loading timeout - try refreshing</div>';
        } else {
            tabsContainer.innerHTML = '<div class="no-tabs">❌ Error loading tabs</div>';
        }
    }

    // Listen for push updates from background
    browser.runtime.onMessage.addListener((message) => {
        if (message && message.command === 'audible_tabs_changed') {
            // Adapt pushed schema to popup schema
            const tabs = (message.tabs || []).map(t => ({
                id: t.id,
                title: t.title,
                url: t.url,
                muted: !!t.muted,
                isPlaying: true,
                isPaused: false,
                mediaCount: 1,
            }));
            renderTabs(tabs);
        }
    });
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

// Function to skip to previous/next track in a tab
async function skipTrack(tabId, direction, button) {
    try {
        console.log(`Popup: Skipping ${direction} track for tab ${tabId}`);
        
        // Disable button temporarily to prevent multiple clicks
        button.disabled = true;
        button.textContent = '⏳';
        
        const result = await browser.runtime.sendMessage({ 
            command: "skip_track", 
            tabId: tabId,
            direction: direction
        });
        
        if (result.success) {
            console.log(`Popup: Successfully skipped ${direction} track in tab ${tabId}`);
            // Visual feedback
            button.textContent = direction === 'prev' ? '⏮️' : '⏭️';
        } else {
            console.error(`Popup: Failed to skip ${direction} track in tab ${tabId}:`, result.error);
            button.textContent = '❌';
        }
    } catch (error) {
        console.error(`Popup: Error skipping ${direction} track in tab ${tabId}:`, error);
        button.textContent = '❌';
    } finally {
        // Re-enable button after a short delay
        setTimeout(() => {
            button.disabled = false;
            button.textContent = direction === 'prev' ? '⏮️' : '⏭️';
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