/**
 * Broadcast Station Monitor - Frontend Application
 * Handles station display, filtering, and WebSocket audio streaming
 */

let allStations = [];
let frequencyData = [];
let activeAudioSessions = new Map();
let currentBandFilter = null;
let currentTargetFilter = null;
let currentLanguageFilter = null;
let currentView = 'time'; // 'time' or 'frequency'
let displayMode = 'table'; // 'table' or 'cards'

// Target region code mappings for tooltips
const TARGET_REGIONS = {
    'Af': 'Africa',
    'Am': 'Americas',
    'As': 'Asia',
    'Aus': 'Australia',
    'CAf': 'Central Africa',
    'CAm': 'Central America',
    'CAs': 'Central Asia',
    'EAf': 'East Africa',
    'EAs': 'East Asia',
    'ENA': 'Eastern North America',
    'Eu': 'Europe',
    'FE': 'Far East',
    'ME': 'Middle East',
    'NAf': 'North Africa',
    'NAm': 'North America',
    'Oc': 'Oceania',
    'SAf': 'South Africa',
    'SAm': 'South America',
    'SAs': 'South Asia',
    'SEA': 'Southeast Asia',
    'SEu': 'Southern Europe',
    'WAf': 'West Africa',
    'WNA': 'Western North America'
};

// Language code mappings for tooltips (EiBi standard codes)
const LANGUAGE_CODES = {
    'A': 'Arabic',
    'AL': 'Albanian',
    'AM': 'Amharic',
    'AR': 'Armenian',
    'AZ': 'Azeri',
    'B': 'Bulgarian',
    'BE': 'Belarusian',
    'BN': 'Bengali',
    'BR': 'Burmese',
    'C': 'Chinese (Mandarin)',
    'CA': 'Cantonese',
    'CC': 'Chinese (other)',
    'CZ': 'Czech',
    'D': 'Dutch',
    'DA': 'Danish',
    'DR': 'Dari',
    'DZ': 'Dzongkha',
    'E': 'English',
    'EO': 'Esperanto',
    'F': 'French',
    'FA': 'Farsi/Persian',
    'FI': 'Finnish',
    'FS': 'Pashto',
    'G': 'German',
    'GR': 'Greek',
    'H': 'Hebrew',
    'HA': 'Hausa',
    'HI': 'Hindi',
    'HR': 'Croatian',
    'HU': 'Hungarian',
    'HY': 'Armenian',
    'I': 'Italian',
    'IN': 'Indonesian',
    'J': 'Japanese',
    'K': 'Korean',
    'KA': 'Georgian',
    'KH': 'Khmer',
    'KU': 'Kurdish',
    'L': 'Latin',
    'LA': 'Lao',
    'LT': 'Lithuanian',
    'LV': 'Latvian',
    'M': 'Multilingual',
    'MK': 'Macedonian',
    'ML': 'Malay',
    'MN': 'Mongolian',
    'NE': 'Nepali',
    'NO': 'Norwegian',
    'P': 'Portuguese',
    'PL': 'Polish',
    'PS': 'Pashto',
    'R': 'Russian',
    'RO': 'Romanian',
    'S': 'Spanish',
    'SC': 'Serbian/Croatian',
    'SD': 'Sindhi',
    'SI': 'Sinhala',
    'SK': 'Slovak',
    'SL': 'Slovenian',
    'SO': 'Somali',
    'SQ': 'Albanian',
    'SR': 'Serbian',
    'SW': 'Swahili',
    'T': 'Turkish',
    'TA': 'Tamil',
    'TB': 'Tibetan',
    'TG': 'Tagalog',
    'TH': 'Thai',
    'TI': 'Tigrinya',
    'TJ': 'Tajik',
    'TL': 'Tagalog',
    'TM': 'Turkmen',
    'TP': 'Tetum',
    'TU': 'Turkish',
    'UK': 'Ukrainian',
    'UR': 'Urdu',
    'UZ': 'Uzbek',
    'V': 'Vietnamese',
    'VT': 'Vietnamese',
    'YI': 'Yiddish',
    'ZU': 'Zulu',
    // Special codes
    'DO': 'Various/Multiple',
    'MX': 'Music',
    'VN': 'Various',
    '-E': 'English',
    '-S': 'Spanish'
};

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
        this.audioStarted = false; // Track if we've started audio playback
        this.audioBuffer = []; // Buffer to smooth out packet arrival jitter
        this.minBufferSize = 20; // Wait for 20 packets (approx 400ms) for smoother playback
    }

    async start() {
        console.log(`🎵 Starting audio session for ${this.frequency / 1000} kHz (SSRC: ${this.ssrc})`);

        // Reset state when starting
        this.intentionallyStopped = false;
        this.audioStarted = false;
        this.audioBuffer = [];
        this.nextPlayTime = 0;

        try {
            // Create Web Audio API context
            // Use a slightly higher latency hint for stability
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000,
                latencyHint: 'playback'
            });
            console.log(`🔊 AudioContext created with state: ${this.audioContext.state}`);

            // Connect to WebSocket
            this.ws = new WebSocket(this.websocketUrl);
            this.ws.binaryType = 'arraybuffer';

            let packetCount = 0;

            this.ws.onopen = async () => {
                console.log(`✅ WebSocket connected for ${this.frequency / 1000} kHz`);

                // Resume AudioContext if suspended (required by browsers)
                if (this.audioContext.state === 'suspended') {
                    console.log('🔊 Resuming AudioContext...');
                    await this.audioContext.resume();
                    console.log(`🔊 AudioContext state: ${this.audioContext.state}`);
                }

                // Send start command
                this.ws.send('A:START');
                this.isPlaying = true;
                this.nextPlayTime = this.audioContext.currentTime + 0.5; // Start with safe delay
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
            // CRITICAL: Use 48000 Hz to match browser's native rate
            // radiod sends at this rate, browser plays directly
            const audioBuffer = this.audioContext.createBuffer(
                1, // mono
                pcmData.length,
                48000 // Match browser native rate
            );

            const channelData = audioBuffer.getChannelData(0);
            for (let i = 0; i < pcmData.length; i++) {
                channelData[i] = pcmData[i] / 32768.0; // Convert to -1.0 to 1.0
            }

            // Add to buffer for jitter smoothing
            this.audioBuffer.push(audioBuffer);

            // Start playback once we have enough buffered
            if (!this.audioStarted) {
                if (this.audioBuffer.length >= this.minBufferSize) {
                    this.audioStarted = true;
                    // Start scheduling from slightly in the future to ensure first chunk hits
                    this.nextPlayTime = this.audioContext.currentTime + 0.2;
                    console.log(`🎵 Starting audio playback with ${this.audioBuffer.length} buffered packets`);
                } else {
                    return; // Wait for more data
                }
            }

            // Schedule buffered audio for playback
            if (this.audioStarted && this.isPlaying) {
                while (this.audioBuffer.length > 0) {
                    const buffer = this.audioBuffer.shift();
                    const source = this.audioContext.createBufferSource();
                    source.buffer = buffer;
                    source.connect(this.audioContext.destination);

                    const now = this.audioContext.currentTime;
                    // If we've fallen behind, resync
                    if (this.nextPlayTime < now) {
                        const gap = now - this.nextPlayTime;
                        // Only resync if the gap is very significant (> 500ms)
                        // Small gaps (< 500ms) are normal network jitter - don't resync
                        if (gap > 0.5) {
                            if (!this.lastResyncLog || Date.now() - this.lastResyncLog > 5000) {
                                console.log(`⏩ Audio resync: fell behind by ${gap.toFixed(3)}s, skipping ahead`);
                                this.lastResyncLog = Date.now();
                            }
                            this.nextPlayTime = now + 0.1; // Reset to future
                        }
                    }

                    source.start(this.nextPlayTime);
                    this.nextPlayTime += buffer.duration;
                }
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

    // Discover available radiod instances
    await discoverRadiod();

    // Load stations
    await loadStations();

    // Setup event listeners
    document.getElementById('search').addEventListener('input', renderStations);

    // Auto-refresh every 60 seconds
    setInterval(loadStations, 60000);
}

/**
 * Discover available radiod instances on the network
 */
async function discoverRadiod() {
    const select = document.getElementById('radiod-select');
    select.innerHTML = '<option value="">Discovering...</option>';

    try {
        const response = await fetch('/api/radiod/discover');
        const data = await response.json();

        select.innerHTML = '';

        if (data.services && data.services.length > 0) {
            data.services.forEach(service => {
                const option = document.createElement('option');
                option.value = service.address;
                option.textContent = service.name;
                option.title = `Address: ${service.address}`;

                // Select current radiod
                if (service.address === data.current ||
                    service.name.includes(data.current)) {
                    option.selected = true;
                }

                select.appendChild(option);
            });

            // If no match found, add current as custom option
            if (!select.value && data.current) {
                const option = document.createElement('option');
                option.value = data.current;
                option.textContent = `📍 ${data.current}`;
                option.selected = true;
                select.insertBefore(option, select.firstChild);
            }
        } else {
            // No services discovered, show current
            const option = document.createElement('option');
            option.value = data.current || 'localhost';
            option.textContent = data.current || 'localhost';
            option.selected = true;
            select.appendChild(option);
        }

        console.log(`📻 Found ${data.services?.length || 0} radiod instances`);
    } catch (error) {
        console.error('Failed to discover radiod:', error);
        select.innerHTML = '<option value="">Discovery failed</option>';
    }
}

/**
 * Select a radiod instance
 */
async function selectRadiod(address) {
    if (!address) return;

    const select = document.getElementById('radiod-select');
    const originalValue = select.value;

    try {
        console.log(`🔄 Switching to radiod: ${address}`);

        const response = await fetch('/api/radiod/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address })
        });

        const data = await response.json();

        if (data.success) {
            console.log(`✅ ${data.message}`);

            // Stop any active audio sessions
            for (const [freq, session] of activeAudioSessions) {
                if (session.ws) session.ws.close();
            }
            activeAudioSessions.clear();
            updateStats();
            updateAudioStatus();

            // Reload stations (in case different radiod has different coverage)
            await loadStations();
        } else {
            console.error(`❌ Failed to switch radiod: ${data.error}`);
            alert(`Failed to switch radiod: ${data.error}`);
            select.value = originalValue;
        }
    } catch (error) {
        console.error('Failed to select radiod:', error);
        alert('Failed to switch radiod. Check console for details.');
        select.value = originalValue;
    }
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

        populateFilters();
        renderStations();
        updateStats();
    } catch (error) {
        console.error('Error loading stations:', error);
        showError('Failed to load station data. Please check your connection.');
    }
}

/**
 * Populate target and language filter buttons dynamically
 */
function populateFilters() {
    // Extract unique targets
    const targets = new Set();
    const languages = new Set();

    allStations.forEach(station => {
        if (station.target && station.target.trim()) {
            targets.add(station.target.trim());
        }
        if (station.language && station.language.trim()) {
            languages.add(station.language.trim());
        }
    });

    // Sort alphabetically
    const sortedTargets = Array.from(targets).sort();
    const sortedLanguages = Array.from(languages).sort();

    // Populate target filters with tooltips
    const targetContainer = document.getElementById('target-filters');
    const targetButtons = sortedTargets.map(target => {
        const tooltip = TARGET_REGIONS[target] || target;
        const displayText = target;
        return `<button class="filter-btn" onclick="filterByTarget('${target.replace(/'/g, "\\'")}')" title="${tooltip}">${displayText}</button>`;
    }).join('');
    targetContainer.innerHTML = `<button class="filter-btn active" onclick="filterByTarget(null)" title="Show all target regions">All Regions</button>${targetButtons}`;

    // Populate language filters with tooltips
    const languageContainer = document.getElementById('language-filters');
    const languageButtons = sortedLanguages.map(language => {
        const tooltip = LANGUAGE_CODES[language] || language;
        const displayText = language;
        return `<button class="filter-btn" onclick="filterByLanguage('${language.replace(/'/g, "\\'")}')" title="${tooltip}">${displayText}</button>`;
    }).join('');
    languageContainer.innerHTML = `<button class="filter-btn active" onclick="filterByLanguage(null)" title="Show all languages">All Languages</button>${languageButtons}`;

    console.log(`✅ Populated ${sortedTargets.length} target regions and ${sortedLanguages.length} languages`);
}

/**
 * Switch between time and frequency views
 */
function switchTab(view) {
    currentView = view;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    renderStations();
}

/**
 * Switch between table and card display modes
 */
function switchDisplay(mode) {
    displayMode = mode;

    // Update toggle buttons
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`toggle-${mode}`).classList.add('active');

    // Update container class
    const container = document.getElementById('stations-container');
    container.className = mode === 'table' ? 'stations-table' : 'stations-grid';

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

    // Filter stations (show all, but filter by band, target, language, and search)
    let filteredStations = allStations.filter(station => {
        // Band filter
        if (currentBandFilter) {
            const [minFreq, maxFreq] = currentBandFilter;
            // Band filter values are in MHz, frequencies are in Hz
            if (station.frequency < minFreq * 1e6 || station.frequency > maxFreq * 1e6) {
                return false;
            }
        }

        // Target filter
        if (currentTargetFilter && station.target !== currentTargetFilter) {
            return false;
        }

        // Language filter
        if (currentLanguageFilter && station.language !== currentLanguageFilter) {
            return false;
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

    // Render based on display mode
    if (displayMode === 'table') {
        container.innerHTML = createStationsTable(filteredStations);
    } else {
        container.innerHTML = filteredStations.map(station => createStationCard(station)).join('');
    }

    updateStats();
}

/**
 * Render frequency-based view (grouped by frequency)
 */
function renderFrequencyView() {
    const container = document.getElementById('stations-container');
    const searchTerm = document.getElementById('search').value.toLowerCase();

    // Filter frequencies and their schedules
    let filteredFreqs = frequencyData.map(freq => {
        // Clone the frequency object
        const filteredFreq = { ...freq };

        // Filter schedules within this frequency
        filteredFreq.schedules = freq.schedules.filter(schedule => {
            // Target filter
            if (currentTargetFilter && schedule.target !== currentTargetFilter) {
                return false;
            }

            // Language filter
            if (currentLanguageFilter && schedule.language !== currentLanguageFilter) {
                return false;
            }

            // Search filter
            if (searchTerm) {
                const searchableText = [
                    schedule.station,
                    schedule.language,
                    schedule.target,
                    schedule.location || ''
                ].join(' ').toLowerCase();

                if (!searchableText.includes(searchTerm)) return false;
            }

            return true;
        });

        return filteredFreq;
    }).filter(freq => {
        // Band filter
        if (currentBandFilter) {
            const [minFreq, maxFreq] = currentBandFilter;
            // Band filter values are in MHz, frequencies are in Hz
            if (freq.frequency < minFreq * 1e6 || freq.frequency > maxFreq * 1e6) {
                return false;
            }
        }

        // Only include frequencies that have at least one schedule after filtering
        return freq.schedules.length > 0;
    });

    // Sort by frequency
    filteredFreqs.sort((a, b) => a.frequency - b.frequency);

    if (filteredFreqs.length === 0) {
        container.innerHTML = '<div class="loading">No frequencies found matching your criteria.</div>';
        return;
    }

    // Render based on display mode
    if (displayMode === 'table') {
        container.innerHTML = createFrequenciesTable(filteredFreqs);
    } else {
        container.innerHTML = filteredFreqs.map(freq => createFrequencyCard(freq)).join('');
    }

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
                ${isListening ? `<button class="btn-tune" onclick="openTuningPanel(${freq.frequency}, ${JSON.stringify(freq).replace(/"/g, '&quot;')})">🎛️ Tune</button>` : ''}
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
                ${isListening ? `<button class="btn-tune" onclick="openTuningPanel(${station.frequency}, ${JSON.stringify(station).replace(/"/g, '&quot;')})">🎛️ Tune</button>` : ''}
            </div>
        </div>
    `;
}

/**
 * Create compact table view for stations
 */
function createStationsTable(stations) {
    return `
        <table>
            <thead>
                <tr>
                    <th>Freq (kHz)</th>
                    <th>Station</th>
                    <th>Time (UTC)</th>
                    <th>Language</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${stations.map(station => createStationRow(station)).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Create a single table row for a station
 */
function createStationRow(station) {
    const isListening = activeAudioSessions.has(station.frequency);
    const rowClass = `${station.onAir ? 'on-air' : 'off-air'} ${isListening ? 'listening' : ''}`;
    const freqKHz = (station.frequency / 1000).toFixed(0);

    return `
        <tr class="${rowClass}" data-frequency="${station.frequency}">
            <td>${freqKHz}</td>
            <td><strong>${station.station}</strong></td>
            <td>${station.time}</td>
            <td>${station.language || 'N/A'}</td>
            <td>${station.target || 'N/A'}</td>
            <td>
                <span class="table-status ${station.onAir ? 'on-air' : 'off-air'}">
                    ${station.onAir ? '🔴 LIVE' : '⚫ OFF'}
                </span>
            </td>
            <td>
                <div class="table-actions">
                    <button 
                        class="table-btn ${isListening ? 'stop' : 'play'}" 
                        onclick="toggleAudio(${station.frequency})"
                        ${!station.onAir && !isListening ? 'disabled' : ''}
                    >
                        ${isListening ? '⏹️ Stop' : '▶️ Play'}
                    </button>
                    ${isListening ? `<button class="table-btn tune" onclick="openTuningPanel(${station.frequency}, ${JSON.stringify(station).replace(/"/g, '&quot;')})">🎛️</button>` : ''}
                </div>
            </td>
        </tr>
    `;
}

/**
 * Create compact table view for frequencies
 */
function createFrequenciesTable(frequencies) {
    return `
        <table>
            <thead>
                <tr>
                    <th>Freq (kHz)</th>
                    <th>Station</th>
                    <th>Schedules</th>
                    <th>Country</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${frequencies.map(freq => createFrequencyRow(freq)).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Create a single table row for a frequency
 */
function createFrequencyRow(freq) {
    const isListening = activeAudioSessions.has(freq.frequency);
    const rowClass = `${freq.onAir ? 'on-air' : 'off-air'} ${isListening ? 'listening' : ''}`;
    const freqKHz = (freq.frequency / 1000).toFixed(0);
    const scheduleCount = freq.schedules ? freq.schedules.length : 0;

    // Get unique station names from all schedules
    let stationNames = 'N/A';
    if (freq.schedules && freq.schedules.length > 0) {
        const uniqueStations = [...new Set(freq.schedules.map(s => s.station))];
        if (uniqueStations.length === 1) {
            stationNames = uniqueStations[0];
        } else {
            // Show first 2-3 stations, then "..."
            stationNames = uniqueStations.slice(0, 2).join(', ');
            if (uniqueStations.length > 2) {
                stationNames += `, +${uniqueStations.length - 2} more`;
            }
        }
    } else if (freq.station) {
        stationNames = freq.station;
    }

    return `
        <tr class="${rowClass}" data-frequency="${freq.frequency}">
            <td>${freqKHz}</td>
            <td><strong>${stationNames}</strong></td>
            <td>${scheduleCount} broadcast${scheduleCount !== 1 ? 's' : ''}</td>
            <td>${freq.location || 'N/A'}</td>
            <td>
                <span class="table-status ${freq.onAir ? 'on-air' : 'off-air'}">
                    ${freq.onAir ? '🔴 LIVE' : '⚫ OFF'}
                </span>
            </td>
            <td>
                <div class="table-actions">
                    <button 
                        class="table-btn ${isListening ? 'stop' : 'play'}" 
                        onclick="toggleAudio(${freq.frequency})"
                        ${!freq.onAir && !isListening ? 'disabled' : ''}
                    >
                        ${isListening ? '⏹️ Stop' : '▶️ Play'}
                    </button>
                    ${isListening ? `<button class="table-btn tune" onclick="openTuningPanel(${freq.frequency}, ${JSON.stringify(freq).replace(/"/g, '&quot;')})">🎛️</button>` : ''}
                </div>
            </td>
        </tr>
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
 * Filter by target region
 */
function filterByTarget(target) {
    // Remove active class from all buttons
    document.querySelectorAll('#target-filters .filter-btn').forEach(btn => btn.classList.remove('active'));

    // Set current filter
    currentTargetFilter = target;

    // Add active class to clicked button
    event.target.classList.add('active');

    console.log(`🌍 Filtering by target: ${target || 'All Regions'}`);
    renderStations();
}

/**
 * Filter by language
 */
function filterByLanguage(language) {
    // Remove active class from all buttons
    document.querySelectorAll('#language-filters .filter-btn').forEach(btn => btn.classList.remove('active'));

    // Set current filter
    currentLanguageFilter = language;

    // Add active class to clicked button
    event.target.classList.add('active');

    console.log(`🗣️ Filtering by language: ${language || 'All Languages'}`);
    renderStations();
}

/**
 * Toggle visibility of filter legend/guide
 */
function toggleLegend(legendId) {
    const legend = document.getElementById(legendId);
    if (legend.style.display === 'none') {
        legend.style.display = 'block';
    } else {
        legend.style.display = 'none';
    }
}

/**
 * Toggle collapse/expand state of filter section
 */
function toggleFilterSection(filterId) {
    const filterSection = document.getElementById(filterId);
    const button = event.currentTarget;

    if (filterSection.classList.contains('collapsed')) {
        // Expand
        filterSection.classList.remove('collapsed');
        button.classList.remove('collapsed');
    } else {
        // Collapse
        filterSection.classList.add('collapsed');
        button.classList.add('collapsed');
    }
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

// ====================
// Tuning Panel Functions
// ====================

let currentTuningSSRC = null;
let currentTuningStation = null;
let currentMode = 'AM';
let currentFilterPreset = 'medium';

// Mode presets with appropriate filter settings
const MODE_PRESETS = {
    AM: { low: -5000, high: 5000, shift: 0 },
    USB: { low: 200, high: 2800, shift: 0 },
    LSB: { low: -2800, high: -200, shift: 0 },
    CW: { low: -250, high: 250, shift: 800 }
};

// Filter bandwidth presets for AM
const FILTER_PRESETS = {
    narrow: { low: -3000, high: 3000 },
    medium: { low: -5000, high: 5000 },
    wide: { low: -7500, high: 7500 },
    custom: null
};

/**
 * Open tuning panel for a specific SSRC
 */
function openTuningPanel(ssrc, station) {
    currentTuningSSRC = ssrc;
    currentTuningStation = station;

    const panel = document.getElementById('tuning-panel');
    const stationInfo = document.getElementById('tuning-station-info');

    stationInfo.textContent = `${station.station} - ${(station.frequency / 1000).toFixed(1)} kHz`;
    panel.style.display = 'block';

    // Load saved settings or use defaults
    const savedSettings = loadSavedSettings(station.frequency);

    document.getElementById('agc-enable').checked = savedSettings.agcEnable || false;
    document.getElementById('manual-gain').value = savedSettings.gain || 30;
    document.getElementById('manual-gain-value').textContent = savedSettings.gain || '30';
    document.getElementById('filter-low').value = savedSettings.filterLow || -5000;
    document.getElementById('filter-high').value = savedSettings.filterHigh || 5000;
    document.getElementById('main-freq').value = (station.frequency / 1000).toFixed(1);
    document.getElementById('shift-freq').value = savedSettings.shift || 0;
    document.getElementById('squelch-threshold').value = savedSettings.squelch || -60;
    document.getElementById('squelch-value').textContent = savedSettings.squelch || '-60';

    // Set mode and filter preset based on saved settings
    currentMode = savedSettings.mode || 'AM';
    currentFilterPreset = savedSettings.filterPreset || 'medium';

    // Update UI to reflect current mode
    updateModeButtons();
    updateFilterButtons();
    updateAGC();

    // Update effective frequency display
    updateEffectiveFrequencyDisplay();
}

/**
 * Load saved settings for a frequency from localStorage
 */
function loadSavedSettings(frequency) {
    try {
        const key = `tuning_${frequency}`;
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : {};
    } catch (e) {
        return {};
    }
}

/**
 * Save current tuning settings
 */
function savePreset() {
    if (!currentTuningStation) return;

    const settings = {
        mode: currentMode,
        filterPreset: currentFilterPreset,
        agcEnable: document.getElementById('agc-enable').checked,
        gain: parseFloat(document.getElementById('manual-gain').value),
        filterLow: parseFloat(document.getElementById('filter-low').value),
        filterHigh: parseFloat(document.getElementById('filter-high').value),
        shift: parseFloat(document.getElementById('shift-freq').value),
        squelch: parseFloat(document.getElementById('squelch-threshold').value)
    };

    try {
        const key = `tuning_${currentTuningStation.frequency}`;
        localStorage.setItem(key, JSON.stringify(settings));
        console.log('✅ Settings saved for', currentTuningStation.station);

        // Visual feedback
        const btn = event.target;
        btn.textContent = '✓ Saved!';
        setTimeout(() => {
            btn.textContent = '💾 Save Preset';
        }, 2000);
    } catch (e) {
        console.error('❌ Failed to save settings:', e);
    }
}

/**
 * Reset all tuning controls to defaults
 */
function resetToDefaults() {
    // Reset to AM mode with medium filter
    setModePreset('AM');
    setFilterPreset('medium');

    // Reset other controls
    document.getElementById('agc-enable').checked = false;
    document.getElementById('manual-gain').value = 30;
    document.getElementById('manual-gain-value').textContent = '30';
    document.getElementById('shift-freq').value = 0;
    document.getElementById('squelch-threshold').value = -60;
    document.getElementById('squelch-value').textContent = '-60';

    // Apply changes
    updateAGC();
    updateGain(30);
    updateShift(0);
    updateSquelch(-60);
    updateEffectiveFrequencyDisplay();

    console.log('✅ Reset to defaults');
}

/**
 * Set mode preset (AM, USB, LSB, CW)
 */
function setModePreset(mode) {
    if (!currentTuningSSRC || !MODE_PRESETS[mode]) return;

    currentMode = mode;
    const preset = MODE_PRESETS[mode];

    // Update filter based on mode
    document.getElementById('filter-low').value = preset.low;
    document.getElementById('filter-high').value = preset.high;
    document.getElementById('shift-freq').value = preset.shift;

    // Apply changes
    updateFilter();
    updateShift(preset.shift);

    // Update button states
    updateModeButtons();

    console.log(`✅ Mode set to ${mode}`);
}

/**
 * Update mode button states
 */
function updateModeButtons() {
    const buttons = document.querySelectorAll('.tuning-section:first-child .preset-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.includes(currentMode)) {
            btn.classList.add('active');
        }
    });
}

/**
 * Set filter preset (narrow, medium, wide, custom)
 */
function setFilterPreset(preset) {
    if (!currentTuningSSRC) return;

    currentFilterPreset = preset;

    if (preset === 'custom') {
        // Show custom filter controls
        document.getElementById('custom-filter-controls').style.display = 'block';
    } else {
        // Hide custom filter controls and apply preset
        document.getElementById('custom-filter-controls').style.display = 'none';

        const filterSettings = FILTER_PRESETS[preset];
        if (filterSettings) {
            document.getElementById('filter-low').value = filterSettings.low;
            document.getElementById('filter-high').value = filterSettings.high;
            updateFilter();
        }
    }

    // Update button states
    updateFilterButtons();

    console.log(`✅ Filter preset set to ${preset}`);
}

/**
 * Update filter button states
 */
function updateFilterButtons() {
    const buttons = document.querySelectorAll('.tuning-section:nth-child(2) .preset-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.toLowerCase();
        if (btnText.includes(currentFilterPreset)) {
            btn.classList.add('active');
        }
    });
}

/**
 * Update effective frequency display (main freq + shift)
 */
function updateEffectiveFrequencyDisplay() {
    const mainFreq = parseFloat(document.getElementById('main-freq').value) || 0;
    const shift = parseFloat(document.getElementById('shift-freq').value) || 0;
    const effectiveFreq = mainFreq + (shift / 1000); // Convert shift from Hz to kHz

    const display = document.getElementById('effective-frequency');
    if (display) {
        display.textContent = `${effectiveFreq.toFixed(3)} kHz`;
    }
}

/**
 * Adjust frequency by a delta (in kHz)
 */
function adjustFrequency(deltaKHz) {
    const input = document.getElementById('main-freq');
    const currentFreq = parseFloat(input.value) || 0;
    const newFreq = currentFreq + deltaKHz;
    input.value = newFreq.toFixed(1);
    updateFrequency(newFreq.toFixed(1));
    updateEffectiveFrequencyDisplay();
}

/**
 * Adjust shift by a delta (in Hz)
 */
function adjustShift(deltaHz) {
    const input = document.getElementById('shift-freq');
    const currentShift = parseFloat(input.value) || 0;
    const newShift = currentShift + deltaHz;
    input.value = newShift;
    updateShift(newShift);
    updateEffectiveFrequencyDisplay();
}

/**
 * Close tuning panel
 */
function closeTuningPanel() {
    document.getElementById('tuning-panel').style.display = 'none';
    currentTuningSSRC = null;
    currentTuningStation = null;
}

/**
 * Update AGC settings
 */
async function updateAGC() {
    if (!currentTuningSSRC) return;

    const enabled = document.getElementById('agc-enable').checked;
    const hangtime = parseFloat(document.getElementById('agc-hangtime').value);
    const headroom = parseFloat(document.getElementById('agc-headroom').value);

    console.log(`🎛️ Updating AGC for SSRC ${currentTuningSSRC}: enable=${enabled}, hangtime=${hangtime}, headroom=${headroom}`);

    // Show/hide AGC parameters and manual gain based on AGC state
    document.getElementById('agc-params').style.display = enabled ? 'block' : 'none';
    document.getElementById('agc-headroom-ctrl').style.display = enabled ? 'block' : 'none';
    document.getElementById('manual-gain-section').style.display = enabled ? 'none' : 'block';

    try {
        const response = await fetch(`/api/audio/tune/${currentTuningSSRC}/agc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enable: enabled,
                hangtime: hangtime,
                headroom: headroom
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('❌ Failed to update AGC:', data);
        } else {
            console.log('✅ AGC updated successfully');
        }
    } catch (error) {
        console.error('❌ Error updating AGC:', error);
    }
}

/**
 * Update AGC parameter value display
 */
function updateAGCValue(param, value) {
    document.getElementById(`agc-${param}-value`).textContent = value;
    updateAGC();
}

/**
 * Update manual gain
 */
async function updateGain(value) {
    if (!currentTuningSSRC) return;

    document.getElementById('manual-gain-value').textContent = value;
    console.log(`🎛️ Updating gain for SSRC ${currentTuningSSRC}: ${value} dB`);

    try {
        const response = await fetch(`/api/audio/tune/${currentTuningSSRC}/gain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gain_db: parseFloat(value) })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('❌ Failed to update gain:', data);
        } else {
            console.log('✅ Gain updated successfully');
        }
    } catch (error) {
        console.error('❌ Error updating gain:', error);
    }
}

/**
 * Update filter settings
 */
async function updateFilter() {
    if (!currentTuningSSRC) return;

    const lowEdge = parseFloat(document.getElementById('filter-low').value);
    const highEdge = parseFloat(document.getElementById('filter-high').value);

    console.log(`🎛️ Updating filter for SSRC ${currentTuningSSRC}: low=${lowEdge} Hz, high=${highEdge} Hz`);

    try {
        const response = await fetch(`/api/audio/tune/${currentTuningSSRC}/filter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                low_edge: lowEdge,
                high_edge: highEdge
            })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('❌ Failed to update filter:', data);
        } else {
            console.log('✅ Filter updated successfully');
        }
    } catch (error) {
        console.error('❌ Error updating filter:', error);
    }
}

/**
 * Update main frequency
 */
async function updateFrequency(value) {
    if (!currentTuningSSRC) return;

    const frequencyHz = parseFloat(value) * 1000; // Convert kHz to Hz
    console.log(`📻 Updating frequency for SSRC ${currentTuningSSRC}: ${value} kHz (${frequencyHz} Hz)`);

    updateEffectiveFrequencyDisplay();

    try {
        const response = await fetch(`/api/audio/tune/${currentTuningSSRC}/frequency`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frequency_hz: frequencyHz })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('❌ Failed to update frequency:', data);
        } else {
            console.log('✅ Frequency updated successfully');
        }
    } catch (error) {
        console.error('❌ Error updating frequency:', error);
    }
}

/**
 * Update frequency shift
 */
async function updateShift(value) {
    if (!currentTuningSSRC) return;

    console.log(`🎛️ Updating shift for SSRC ${currentTuningSSRC}: ${value} Hz`);

    updateEffectiveFrequencyDisplay();

    try {
        const response = await fetch(`/api/audio/tune/${currentTuningSSRC}/shift`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shift_hz: parseFloat(value) })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('❌ Failed to update shift:', data);
        } else {
            console.log('✅ Shift updated successfully');
        }
    } catch (error) {
        console.error('❌ Error updating shift:', error);
    }
}


/**
 * Update squelch threshold
 */
async function updateSquelch(value) {
    if (!currentTuningSSRC) return;

    document.getElementById('squelch-value').textContent = value;
    console.log(`🔇 Updating squelch for SSRC ${currentTuningSSRC}: ${value} dB`);

    try {
        const response = await fetch(`/api/audio/tune/${currentTuningSSRC}/squelch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ threshold: parseFloat(value) })
        });

        const data = await response.json();
        if (!response.ok) {
            console.error('❌ Failed to update squelch:', data);
        } else {
            console.log('✅ Squelch updated successfully');
        }
    } catch (error) {
        console.error('❌ Error updating squelch:', error);
    }
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
