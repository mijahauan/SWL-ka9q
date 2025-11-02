/**
 * Broadcast Station Monitor - Frontend Application
 * Handles station display, filtering, and WebSocket audio streaming
 */

let allStations = [];
let frequencyData = [];
let activeAudioSessions = new Map();
let currentBandFilter = null;
let currentView = 'time'; // 'time' or 'frequency'

/**
 * Audio Session Manager
 * Handles WebSocket connections for RTP audio streaming
 */
class AudioSession {
    constructor(frequency, ssrc, websocketUrl) {
        this.frequency = frequency;
        this.ssrc = ssrc;
        this.websocketUrl = websocketUrl;
        this.ws = null;
        this.audioContext = null;
        this.sourceNode = null;
        this.isPlaying = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.intentionallyStopped = false;
        this.nextPlayTime = 0; // Track scheduled audio time
    }

    async start() {
        console.log(`🎵 Starting audio session for ${this.frequency / 1000} kHz (SSRC: ${this.ssrc})`);
        
        // Reset the intentionally stopped flag when starting
        this.intentionallyStopped = false;
        
        try {
            // Create Web Audio API context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 12000
            });
            
            // Connect to WebSocket
            this.ws = new WebSocket(this.websocketUrl);
            this.ws.binaryType = 'arraybuffer';
            
            let packetCount = 0;
            
            this.ws.onopen = () => {
                console.log(`✅ WebSocket connected for ${this.frequency / 1000} kHz`);
                // Send start command
                this.ws.send('A:START');
                this.isPlaying = true;
                this.nextPlayTime = this.audioContext.currentTime; // Initialize play time
            };
            
            this.ws.onmessage = (event) => {
                if (event.data instanceof ArrayBuffer) {
                    packetCount++;
                    if (packetCount === 1 || packetCount % 100 === 0) {
                        console.log(`📦 Received ${packetCount} PCM packets for ${this.frequency / 1000} kHz`);
                    }
                    this.handlePcmPacket(event.data);
                } else {
                    console.warn(`⚠️ Received non-ArrayBuffer data:`, typeof event.data, event.data);
                }
            };
            
            this.ws.onerror = (error) => {
                console.error(`❌ WebSocket error for ${this.frequency / 1000} kHz:`, error);
            };
            
            this.ws.onclose = () => {
                console.log(`👋 WebSocket closed for ${this.frequency / 1000} kHz`);
                this.isPlaying = false;
                
                // Only attempt reconnection if not intentionally stopped
                if (!this.intentionallyStopped && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    setTimeout(() => {
                        console.log(`🔄 Reconnecting (attempt ${this.reconnectAttempts})...`);
                        this.start();
                    }, 2000 * this.reconnectAttempts);
                }
            };
            
            return true;
        } catch (error) {
            console.error(`❌ Failed to start audio session:`, error);
            return false;
        }
    }

    handlePcmPacket(data) {
        try {
            // Server sends decoded PCM as 16-bit signed integers
            const pcmData = new Int16Array(data);
            
            if (pcmData.length === 0) return;
            
            // Convert to Float32 for Web Audio API
            const audioBuffer = this.audioContext.createBuffer(
                1, // mono
                pcmData.length,
                this.audioContext.sampleRate
            );
            
            const channelData = audioBuffer.getChannelData(0);
            for (let i = 0; i < pcmData.length; i++) {
                channelData[i] = pcmData[i] / 32768.0; // Convert to -1.0 to 1.0
            }
            
            // Schedule audio buffer to play without gaps
            if (this.isPlaying) {
                const source = this.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.audioContext.destination);
                
                // Schedule to play at nextPlayTime, or immediately if we're behind
                const now = this.audioContext.currentTime;
                const playTime = Math.max(now, this.nextPlayTime);
                source.start(playTime);
                
                // Update next play time
                this.nextPlayTime = playTime + audioBuffer.duration;
            }
        } catch (error) {
            console.error('Error processing PCM packet:', error);
        }
    }

    stop() {
        console.log(`🛑 Stopping audio session for ${this.frequency / 1000} kHz`);
        
        this.isPlaying = false;
        this.intentionallyStopped = true;
        
        if (this.ws) {
            this.ws.send('A:STOP');
            this.ws.close();
            this.ws = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

/**
 * Initialize the application
 */
async function init() {
    console.log('🚀 Initializing Broadcast Station Monitor...');
    
    // Update UTC time
    updateUtcTime();
    setInterval(updateUtcTime, 1000);
    
    // Load stations
    await loadStations();
    
    // Setup event listeners
    document.getElementById('search').addEventListener('input', renderStations);
    
    // Auto-refresh every 60 seconds
    setInterval(loadStations, 60000);
}

/**
 * Update UTC time display
 */
function updateUtcTime() {
    const now = new Date();
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    document.getElementById('utc-time').textContent = `${hours}:${minutes}:${seconds}`;
}

/**
 * Load stations from API
 */
async function loadStations() {
    try {
        // Load time-based view
        const timeResponse = await fetch('/api/stations');
        if (!timeResponse.ok) throw new Error('Failed to load stations');
        allStations = await timeResponse.json();
        
        // Load frequency-based view
        const freqResponse = await fetch('/api/stations/by-frequency');
        if (!freqResponse.ok) throw new Error('Failed to load frequency data');
        frequencyData = await freqResponse.json();
        
        console.log(`✅ Loaded ${allStations.length} station schedules`);
        console.log(`✅ Loaded ${frequencyData.length} unique frequencies`);
        
        renderStations();
        updateStats();
    } catch (error) {
        console.error('Error loading stations:', error);
        showError('Failed to load station data. Please check your connection.');
    }
}

/**
 * Switch between time and frequency views
 */
function switchTab(view) {
    currentView = view;
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update info text
    const infoText = view === 'time' 
        ? '📅 Organized by broadcast schedule • Green = On-air now'
        : '📡 Organized by frequency • Shows all time slots per frequency';
    document.getElementById('view-info').textContent = infoText;
    
    renderStations();
}

/**
 * Render station cards
 */
function renderStations() {
    if (currentView === 'time') {
        renderTimeView();
    } else {
        renderFrequencyView();
    }
}

/**
 * Render time-based view (original view)
 */
function renderTimeView() {
    const container = document.getElementById('stations-container');
    const searchTerm = document.getElementById('search').value.toLowerCase();
    
    // Filter stations (show all, but filter by band and search only)
    let filteredStations = allStations.filter(station => {
        // Band filter
        if (currentBandFilter) {
            const [minFreq, maxFreq] = currentBandFilter;
            // Band filter values are in MHz, frequencies are in Hz
            if (station.frequency < minFreq * 1e6 || station.frequency > maxFreq * 1e6) {
                return false;
            }
        }
        
        // Search filter
        if (searchTerm) {
            const searchableText = [
                station.station,
                station.frequency.toString(),
                station.language,
                station.target,
                station.location || ''
            ].join(' ').toLowerCase();
            
            if (!searchableText.includes(searchTerm)) return false;
        }
        
        return true;
    });
    
    // Sort by frequency
    filteredStations.sort((a, b) => a.frequency - b.frequency);
    
    if (filteredStations.length === 0) {
        container.innerHTML = '<div class="loading">No stations found matching your criteria.</div>';
        return;
    }
    
    // Render cards
    container.innerHTML = filteredStations.map(station => createStationCard(station)).join('');
    
    updateStats();
}

/**
 * Render frequency-based view (grouped by frequency)
 */
function renderFrequencyView() {
    const container = document.getElementById('stations-container');
    const searchTerm = document.getElementById('search').value.toLowerCase();
    
    // Filter frequencies
    let filteredFreqs = frequencyData.filter(freq => {
        // Band filter
        if (currentBandFilter) {
            const [minFreq, maxFreq] = currentBandFilter;
            // Band filter values are in MHz, frequencies are in Hz
            if (freq.frequency < minFreq * 1e6 || freq.frequency > maxFreq * 1e6) {
                return false;
            }
        }
        
        // Search filter
        if (searchTerm) {
            const searchableText = [
                freq.station || '',
                freq.frequency.toString(),
                freq.location || '',
                freq.target || '',
                ...freq.schedules.map(s => `${s.language} ${s.target}`)
            ].join(' ').toLowerCase();
            
            if (!searchableText.includes(searchTerm)) return false;
        }
        
        return true;
    });
    
    // Sort by frequency
    filteredFreqs.sort((a, b) => a.frequency - b.frequency);
    
    if (filteredFreqs.length === 0) {
        container.innerHTML = '<div class="loading">No frequencies found matching your criteria.</div>';
        return;
    }
    
    // Render cards
    container.innerHTML = filteredFreqs.map(freq => createFrequencyCard(freq)).join('');
    
    updateStats();
}

/**
 * Create a frequency card HTML (shows all time slots for one frequency)
 */
function createFrequencyCard(freq) {
    const isListening = activeAudioSessions.has(freq.frequency);
    const cardClass = `station-card ${freq.onAir ? 'on-air' : ''} ${isListening ? 'listening' : ''}`;
    
    return `
        <div class="${cardClass}" data-frequency="${freq.frequency}">
            <div class="station-header">
                <div class="station-title">
                    <div class="station-name">${freq.station || 'Unknown Station'}</div>
                    <div class="station-frequency">
                        ${(freq.frequency / 1000).toFixed(0)} <span class="unit">kHz</span>
                    </div>
                </div>
                <span class="status-badge ${freq.onAir ? 'on-air' : 'off-air'}">
                    ${freq.onAir ? '🔴 ON AIR' : '⚫ OFF AIR'}
                </span>
            </div>
            
            ${freq.location || freq.power ? `
            <div class="station-details">
                ${freq.location ? `
                <div class="detail-item">
                    <span class="detail-label">Location</span>
                    <span class="detail-value">${freq.location}</span>
                </div>
                ` : ''}
                ${freq.power ? `
                <div class="detail-item">
                    <span class="detail-label">Power</span>
                    <span class="detail-value">${freq.power} kW</span>
                </div>
                ` : ''}
            </div>
            ` : ''}
            
            <div class="schedule-list">
                <div class="detail-label" style="margin-bottom: 8px;">📅 Broadcast Schedule (${freq.broadcastCount} slot${freq.broadcastCount > 1 ? 's' : ''}):</div>
                ${freq.schedules.map(schedule => `
                    <div class="schedule-item ${schedule.onAir ? 'active-schedule' : ''}">
                        ${schedule.onAir ? '🔴' : '⚫'} ${schedule.time} UTC ${schedule.days !== 'N/A' ? `(${schedule.days})` : ''} - ${schedule.language} → ${schedule.target}
                    </div>
                `).join('')}
            </div>
            
            <div class="audio-controls">
                <button 
                    class="btn-listen ${isListening ? 'stop' : 'play'}" 
                    onclick="toggleAudio(${freq.frequency})"
                    ${!freq.onAir && !isListening ? 'disabled' : ''}
                >
                    ${isListening ? '⏹️ Stop Listening' : '▶️ Listen Live'}
                </button>
            </div>
        </div>
    `;
}

/**
 * Create a station card HTML
 */
function createStationCard(station) {
    const isListening = activeAudioSessions.has(station.frequency);
    const cardClass = `station-card ${station.onAir ? 'on-air' : ''} ${isListening ? 'listening' : ''}`;
    
    return `
        <div class="${cardClass}" data-frequency="${station.frequency}">
            <div class="station-header">
                <div class="station-title">
                    <div class="station-name">${station.station}</div>
                    <div class="station-frequency">
                        ${(station.frequency / 1000).toFixed(0)} <span class="unit">kHz</span>
                    </div>
                </div>
                <span class="status-badge ${station.onAir ? 'on-air' : 'off-air'}">
                    ${station.onAir ? '🔴 ON AIR' : '⚫ OFF AIR'}
                </span>
            </div>
            
            <div class="station-details">
                <div class="detail-item">
                    <span class="detail-label">Language</span>
                    <span class="detail-value">${station.language || 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Target</span>
                    <span class="detail-value">${station.target || 'N/A'}</span>
                </div>
                ${station.location ? `
                <div class="detail-item">
                    <span class="detail-label">Location</span>
                    <span class="detail-value">${station.location}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Power</span>
                    <span class="detail-value">${station.power} kW</span>
                </div>
                ` : ''}
            </div>
            
            <div class="station-time">
                📅 Broadcast Time: ${station.time} UTC (${station.days})
            </div>
            
            ${station.notes ? `
            <div class="station-technical">
                📝 ${station.notes}
            </div>
            ` : ''}
            
            <div class="audio-controls">
                <button 
                    class="btn-listen ${isListening ? 'stop' : 'play'}" 
                    onclick="toggleAudio(${station.frequency})"
                    ${!station.onAir && !isListening ? 'disabled' : ''}
                >
                    ${isListening ? '⏹️ Stop Listening' : '▶️ Listen Live'}
                </button>
            </div>
        </div>
    `;
}

/**
 * Toggle audio playback for a station
 */
async function toggleAudio(frequency) {
    console.log(`🎛️ Toggle audio for ${frequency / 1000} kHz`);
    
    if (activeAudioSessions.has(frequency)) {
        // Stop audio
        const session = activeAudioSessions.get(frequency);
        console.log(`⏹️ Stopping session ${session.ssrc}`);
        session.stop();
        activeAudioSessions.delete(frequency);
        
        // Stop stream on server
        try {
            await fetch(`/api/audio/stream/${session.ssrc}`, { method: 'DELETE' });
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    } else {
        // Start audio
        try {
            console.log(`▶️ Starting audio for ${frequency / 1000} kHz (${frequency} Hz)`);
            const response = await fetch(`/api/audio/stream/${frequency}`);
            if (!response.ok) throw new Error('Failed to start audio stream');
            
            const data = await response.json();
            console.log(`📡 Server response:`, data);
            
            if (!data.success) {
                throw new Error(data.details || 'Failed to start audio stream');
            }
            
            console.log(`🎧 Creating audio session: SSRC=${data.ssrc}, WS=${data.websocket}`);
            const session = new AudioSession(frequency, data.ssrc, data.websocket);
            const started = await session.start();
            
            if (started) {
                activeAudioSessions.set(frequency, session);
                console.log(`✅ Audio session started for ${frequency / 1000} kHz`);
            } else {
                throw new Error('Failed to initialize audio session');
            }
        } catch (error) {
            console.error('Error starting audio:', error);
            alert(`Failed to start audio: ${error.message}\n\nMake sure ka9q-radio is running and accessible.`);
        }
    }
    
    renderStations();
    updateAudioStatus();
}

/**
 * Stop all audio sessions
 */
function stopAllAudio() {
    for (const [frequency, session] of activeAudioSessions) {
        session.stop();
    }
    activeAudioSessions.clear();
    
    renderStations();
    updateAudioStatus();
}

/**
 * Update statistics
 */
function updateStats() {
    if (currentView === 'time') {
        const activeCount = allStations.filter(s => s.onAir).length;
        document.getElementById('total-count').textContent = allStations.length;
        document.getElementById('active-count').textContent = activeCount;
    } else {
        const activeCount = frequencyData.filter(f => f.onAir).length;
        document.getElementById('total-count').textContent = frequencyData.length;
        document.getElementById('active-count').textContent = activeCount;
    }
    document.getElementById('listening-count').textContent = activeAudioSessions.size;
}

/**
 * Update audio status bar
 */
function updateAudioStatus() {
    const statusBar = document.getElementById('audio-status');
    const statusText = document.getElementById('audio-status-text');
    const stopButton = document.getElementById('stop-all-audio');
    
    if (activeAudioSessions.size > 0) {
        statusBar.classList.add('active');
        statusText.textContent = `🎵 Listening to ${activeAudioSessions.size} station(s)`;
        stopButton.style.display = 'block';
    } else {
        statusBar.classList.remove('active');
        statusText.textContent = 'No audio playing';
        stopButton.style.display = 'none';
    }
}

/**
 * Filter by frequency band
 */
function filterByBand(minFreq, maxFreq) {
    // Remove active class from all buttons
    document.querySelectorAll('.band-btn').forEach(btn => btn.classList.remove('active'));
    
    // Set current filter
    currentBandFilter = minFreq ? [minFreq, maxFreq] : null;
    
    // Add active class to clicked button
    event.target.classList.add('active');
    
    renderStations();
}

/**
 * Reload schedules from server
 */
async function reloadSchedules() {
    try {
        const response = await fetch('/api/reload', { method: 'POST' });
        if (!response.ok) throw new Error('Failed to reload schedules');
        
        await loadStations();
        alert('✅ Schedules reloaded successfully!');
    } catch (error) {
        console.error('Error reloading schedules:', error);
        alert('❌ Failed to reload schedules. Please try again.');
    }
}

/**
 * Show error message
 */
function showError(message) {
    const container = document.getElementById('stations-container');
    container.innerHTML = `
        <div class="error-message">
            <strong>⚠️ Error:</strong> ${message}
        </div>
    `;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopAllAudio();
});
