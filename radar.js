/**
 * Meteocat Radar Basic Implementation
 */

// Configuration
const CONFIG = {
    // 6 minutes interval for Meteocat radar images
    INTERVAL_MINUTES: 6,
    // Delay to ensure image availability (server processing time)
    DELAY_MINUTES: 6,
    // Initial Center (Catalonia)
    CENTER: [41.7, 1.8],
    ZOOM: 8,
    // Tile URLs
    URLS: {
        rain: "https://static-m.meteo.cat/tiles/radar/{any}/{mes}/{dia}/{hora}/{minut}/{z}/000/000/{x}/000/000/{y}.png",
        snow: "https://static-m.meteo.cat/tiles/plujaneu/{any}/{mes}/{dia}/{hora}/{minut}/{z}/000/000/{x}/000/000/{y}.png"
    },
    OPACITY: 0.4
};

// State
let map;
let currentLayer = null;
let currentMode = 'rain'; // 'rain' or 'snow'
let appliedMode = null;   // To track what is actually on map
let visibleTimestamp = null;
let isApplyingLayer = false;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    // Start the seek loop
    checkLatestImage();
    updateRadarLoop();

    // Set up controls
    document.getElementById('btn-rain').addEventListener('click', () => setMode('rain'));
    document.getElementById('btn-snow').addEventListener('click', () => setMode('snow'));
});

function initMap() {
    map = L.map('map').setView(CONFIG.CENTER, CONFIG.ZOOM);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    console.log("Map initialized");

    // Initialize Lightning Layer if module is loaded
    if (window.initLightning) {
        window.initLightning(map);
    }
}

function setMode(mode) {
    if (currentMode === mode) return;
    currentMode = mode;

    // Update UI
    document.getElementById('btn-rain').classList.toggle('active', mode === 'rain');
    document.getElementById('btn-snow').classList.toggle('active', mode === 'snow');

    // Trigger immediate re-check for the new mode
    // Force reset applying flag to ensure user click is processed immediately
    isApplyingLayer = false;
    checkLatestImage();
}

// Round a date down to the nearest 6-minute interval
function roundToInterval(date) {
    const d = new Date(date);
    let minutes = d.getUTCMinutes();
    const remainder = minutes % CONFIG.INTERVAL_MINUTES;
    d.setUTCMinutes(minutes - remainder);
    d.setUTCSeconds(0);
    d.setUTCMilliseconds(0);
    return d;
}

// The core Seek-and-Find logic
async function checkLatestImage() {
    if (isApplyingLayer) return; // Prevent overlapping checks
    isApplyingLayer = true;

    const display = document.getElementById('timestamp-display');
    // Only show "Cercant..." if we don't have a valid recent image or if mode changed
    if (!visibleTimestamp || appliedMode !== currentMode) {
        display.textContent = "Cercant dades...";
    }

    // Generate candidates (Try last 10 intervals ~ 1 hour)
    // We do this in parallel to ensure we always get the NEWEST available immediately
    // without waiting for 404s on future images.
    let candidates = [];
    let start = roundToInterval(new Date());
    const maxAttempts = 10;

    for (let i = 0; i < maxAttempts; i++) {
        candidates.push(new Date(start.getTime() - (i * CONFIG.INTERVAL_MINUTES * 60000)));
    }

    // Create array of check promises
    const checks = candidates.map(async (date) => {
        const url = getTestUrl(date);
        const exists = await checkImageExists(url);
        return { date, exists };
    });

    // Wait for all checks to complete (or for enough to determine winner - but Promise.all is simplest)
    // Since images load fast (or fail fast), checking 10 is negligible.
    try {
        const results = await Promise.all(checks);

        // Find the FIRST (newest) one that exists
        const winner = results.find(r => r.exists);

        if (winner) {
            const candidateDate = winner.date;

            // Update if:
            // 1. We haven't shown anything yet
            // 2. The new found timestamp is different from current
            // 3. Layer is missing
            // 4. The user switched mode (Rain <-> Snow) so we MUST re-apply even if time is same
            if (!visibleTimestamp ||
                candidateDate.getTime() !== visibleTimestamp.getTime() ||
                !currentLayer ||
                appliedMode !== currentMode) {

                console.log(`Updated to latest available: ${candidateDate.toISOString()}`);
                visibleTimestamp = candidateDate;
                applyLayer(visibleTimestamp);
                updateTimestampDisplay(visibleTimestamp);
            } else {
                updateTimestampDisplay(visibleTimestamp);
            }
        } else {
            console.error("Failed to find any radar images after 10 parallel attempts.");
            display.textContent = "ERROR SERVER";
            display.style.color = "red";
            if (currentLayer) map.removeLayer(currentLayer);
        }
    } catch (e) {
        console.error("Parallel check failed", e);
    }

    isApplyingLayer = false;
}

// Helper: Construct the specific test URL for existence check
function getTestUrl(date) {
    const testUrlTemplate = CONFIG.URLS[currentMode];
    let testUrl = formatUrl(testUrlTemplate, date);
    // Manual replacement for the test tile coordinates (Zoom 7, X 064, Y 080 - matches Catalonia center)
    return testUrl.replace('{z}', '07').replace('{x}', '064').replace('{y}', '080');
}

// Helper: Check if image exists without triggering CORS (using img tag logic)
function checkImageExists(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

// Apply the confirmed timestamp to the map
function applyLayer(date) {
    if (currentLayer) {
        map.removeLayer(currentLayer);
    }

    // Mark which mode we are applying so we don't re-apply it unnecessarily
    appliedMode = currentMode;

    const template = CONFIG.URLS[currentMode];
    // Base URL with time placeholders filled
    const urlWithTime = formatUrl(template, date);

    // Helpers
    function fillTo(val, len) {
        val = String(val);
        len = len || 3;
        var diff = len - val.length;
        var pad = "";
        for (var i = 0; i < diff; i++) pad += "0";
        return pad + val;
    }

    const MeteocatLayer = L.TileLayer.extend({
        getTileUrl: function (coords) {
            // Standard check
            if (!coords) return "";

            // Calculate TMS Y if needed
            var y = coords.y;
            if (this.options.tms) {
                y = this._globalTileRange.max.y - coords.y;
            }

            var data = {
                z: fillTo(coords.z, 2),
                x: fillTo(coords.x, 3),
                y: fillTo(y, 3)
            };

            // Use the URL that already has TIME filled in, just replace coords
            var url = this._url;
            url = url.replace('{z}', data.z);
            url = url.replace('{x}', data.x);
            url = url.replace('{y}', data.y);

            return url;
        }
    });

    currentLayer = new MeteocatLayer(urlWithTime, {
        opacity: CONFIG.OPACITY,
        attribution: 'Meteocat',
        zIndex: 100,
        tms: true,
        maxNativeZoom: 7,
        className: 'radar-pixelated' // CSS class to force nearest-neighbor interpolation
    });

    currentLayer.addTo(map);
}

function formatUrl(template, date) {
    const pad = (n) => String(n).padStart(2, '0');
    const replacements = {
        '{any}': date.getUTCFullYear(),
        '{mes}': pad(date.getUTCMonth() + 1),
        '{dia}': pad(date.getUTCDate()),
        '{hora}': pad(date.getUTCHours()),
        '{minut}': pad(date.getUTCMinutes())
    };

    let url = template;
    for (const [key, value] of Object.entries(replacements)) {
        url = url.replaceAll(key, value);
    }
    return url;
}

function updateRadarLoop() {
    // Poll every 60 seconds to see if a NEW image (newer than current) has appeared
    setInterval(() => {
        checkLatestImage();
    }, 60 * 1000);
}

function updateTimestampDisplay(date) {
    const display = document.getElementById('timestamp-display');
    if (display) {
        display.style.color = "#555"; // Reset color in case of previous error
        const localTime = new Date(date);

        const pad = (n) => String(n).padStart(2, '0');
        const day = pad(localTime.getDate());
        const month = pad(localTime.getMonth() + 1);
        const year = localTime.getFullYear();
        const hours = pad(localTime.getHours());
        const minutes = pad(localTime.getMinutes());

        display.textContent = `${day}/${month}/${year} ${hours}:${minutes}`;
    }
}
