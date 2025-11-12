function skipTrack(direction) {
    const isNext = direction === 'next';
    let success = false;
    
    // 1. First try to find and click next/previous buttons in the page
    const buttonSelectors = [
        isNext ? 
            ['button[title*="next" i]', 'button[aria-label*="next" i]', '.next', '.next-button', '.skip-button', '.skip-forward'] :
            ['button[title*="previous" i]', 'button[aria-label*="previous" i]', '.prev', '.previous', '.previous-button', '.skip-back'],
        
        // Common video player controls
        isNext ? 
            ['.ytp-next-button', '.ytp-next-arrow', '.video-next-button'] :
            ['.ytp-prev-button', '.ytp-prev-arrow', '.video-prev-button'],
        
        // Spotify and music players
        isNext ? 
            ['.spoticon-skip-forward', '.skip-control__next', '.player-controls__next'] :
            ['.spoticon-skip-back', '.skip-control__previous', '.player-controls__previous'],
        
        // Generic media controls
        isNext ? 
            ['[data-testid="control-button-skip-forward"]', '[data-testid="next"]'] :
            ['[data-testid="control-button-skip-back"]', '[data-testid="previous"]']
    ].flat();
    
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
    
    // 4. As a last resort, try to simulate keyboard events
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
