// Cache DOM elements for better performance
const cache = {
    mediaElements: null,
    lastUpdate: 0,
    CACHE_DURATION: 1000 // 1 second cache
};

function getMediaElements() {
    const now = Date.now();
    if (!cache.mediaElements || (now - cache.lastUpdate) > cache.CACHE_DURATION) {
        cache.mediaElements = Array.from(document.querySelectorAll('audio, video'));
        cache.lastUpdate = now;
    }
    return cache.mediaElements;
}

function skipTrack(direction) {
    const isNext = direction === 'next';
    let success = false;
    
    // Get media elements with track support
    const mediaElements = getMediaElements();
    const mediaWithTracks = [];
    
    // Only check for track support if we haven't found a better method yet
    for (const media of mediaElements) {
        if ((direction === 'next' && media.nextTrack) || 
            (direction === 'prev' && media.previousTrack) ||
            (media.audioTracks && media.audioTracks.length > 1)) {
            mediaWithTracks.push(media);
        }
    }
    
    // 1. First try to find and click next/previous buttons in the page
    const commonButtonSelectors = {
        next: [
            // YouTube
            '.ytp-next-button', '.ytp-next-arrow',
            // Spotify
            '.spoticon-skip-forward',
            // Generic
            '[data-testid="control-button-skip-forward"]',
            '[data-testid="next"]',
            'button[title*="next" i]',
            'button[aria-label*="next" i]',
            '.next', '.next-button', '.skip-forward'
        ],
        prev: [
            // YouTube
            '.ytp-prev-button', '.ytp-prev-arrow',
            // Spotify
            '.spoticon-skip-back',
            // Generic
            '[data-testid="control-button-skip-back"]',
            '[data-testid="previous"]',
            'button[title*="previous" i]',
            'button[aria-label*="previous" i]',
            '.prev', '.previous', '.previous-button', '.skip-back'
        ]
    };
    
    const buttonSelectors = commonButtonSelectors[direction] || [];
    
    // Try to find and click the most likely button
    for (const selector of buttonSelectors) {
        const buttons = Array.from(document.querySelectorAll(selector));
        const visibleButton = buttons.find(btn => {
            const style = window.getComputedStyle(btn);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0' &&
                   btn.offsetWidth > 0 && 
                   btn.offsetHeight > 0;
        });
        
        if (visibleButton) {
            console.log('Found skip button with selector:', selector);
            visibleButton.click();
            return { success: true, method: 'button-click' };
        }
    }
    
    // 2. Try to use media session API if available
    if ('mediaSession' in navigator) {
        try {
            if (isNext && navigator.mediaSession.setActionHandler) {
                navigator.mediaSession.setActionHandler('nexttrack', () => {});
                const event = new Event('nexttrack');
                navigator.mediaSession.dispatchEvent(event);
                return { success: true, method: 'media-session' };
            } else if (!isNext && navigator.mediaSession.setActionHandler) {
                navigator.mediaSession.setActionHandler('previoustrack', () => {});
                const event = new Event('previoustrack');
                navigator.mediaSession.dispatchEvent(event);
                return { success: true, method: 'media-session' };
            }
        } catch (e) {
            console.log('Media session API not fully supported:', e);
        }
    }
    
    // 3. Try to find and use video.js or other common players
    try {
        const players = [];
        
        // Check for video.js players
        if (window.videojs && window.videojs.getPlayers) {
            const videoJsPlayers = Object.values(window.videojs.getPlayers() || {});
            players.push(...videoJsPlayers);
        }
        
        // Check for other common player instances
        const commonPlayers = [
            'player', 'videoPlayer', 'audioPlayer', 'mediaPlayer',
            'ytplayer', 'ytPlayer', 'netflix', 'spotifyPlayer'
        ];
        
        commonPlayers.forEach(name => {
            if (window[name] && typeof window[name].nextTrack === 'function') {
                players.push(window[name]);
            }
        });
        
        // Try to skip track on found players
        for (const player of players) {
            try {
                if (isNext && typeof player.nextTrack === 'function') {
                    player.nextTrack();
                    return { success: true, method: 'player-api-next' };
                } else if (!isNext && typeof player.previousTrack === 'function') {
                    player.previousTrack();
                    return { success: true, method: 'player-api-prev' };
                }
            } catch (e) {
                console.log('Error using player API:', e);
            }
        }
    } catch (e) {
        console.log('Error accessing player APIs:', e);
    }
    
    // 4. Try to find and click buttons in the page
    for (const selector of buttonSelectors) {
        const button = document.querySelector(selector);
        if (button) {
            const style = window.getComputedStyle(button);
            if (style.display !== 'none' && 
                style.visibility !== 'hidden' && 
                style.opacity !== '0' &&
                button.offsetWidth > 0 && 
                button.offsetHeight > 0) {
                try {
                    button.click();
                    return { success: true, method: 'button-click' };
                } catch (e) {
                    console.log('Error clicking button:', e);
                }
            }
        }
    }

    // 5. As a last resort, try to simulate keyboard events
    try {
        const keyCode = isNext ? 176 : 177; // Next track: 176, Previous track: 177
        const event = new KeyboardEvent('keydown', {
            key: isNext ? 'MediaTrackNext' : 'MediaTrackPrevious',
            keyCode: keyCode,
            code: isNext ? 'MediaTrackNext' : 'MediaTrackPrevious',
            which: keyCode,
            bubbles: true,
            cancelable: true,
            composed: true
        });
        
        // Try dispatching to document, window, and active element
        const targets = [document, window, document.activeElement];
        for (const target of targets) {
            try {
                target.dispatchEvent(event);
                console.log('Dispatched', isNext ? 'next' : 'previous', 'track event to', target);
                // Don't return immediately, try all targets
                success = true;
            } catch (e) {
                console.log('Failed to dispatch event to', target, ':', e);
            }
        }
        
        if (success) {
            return { success: true, method: 'keyboard-events' };
        }
    } catch (e) {
        console.log('Error dispatching keyboard events:', e);
    }
    
    return { 
        success: false, 
        error: 'No supported track skipping method found on this page',
        methodsTried: ['button-click', 'media-session', 'player-api', 'keyboard-events']
    };
}

// Add message listener to handle skip track commands from the background script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === 'execute_skip_track') {
        try {
            const result = skipTrack(message.direction);
            sendResponse(result);
        } catch (error) {
            console.error('Error in skipTrack:', error);
            sendResponse({
                success: false,
                error: error.message,
                method: 'error'
            });
        }
        return true; // Keep the message channel open for async response
    }
    return false;
});
