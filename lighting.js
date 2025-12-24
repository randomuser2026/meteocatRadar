/* Real-time Lightning Layer with enhanced visuals and sound */

// Wrapped in IIFE to avoid global namespace pollution
(function () {

    // Configuration
    // Configuration
    const LIGHTNING_CONFIG = {
        WS_URL: "wss://www.radarspain.es:8443/ws",
        MAX_AGE_SECONDS: 900, // 15 minutes
        RECONNECT_DELAY: 5000,
        MAX_RECONNECTS: 10,
        // Toggle for geographical filtering
        FILTER_BOUNDS: true,
        // Catalonia Bounds
        BOUNDS: {
            minLat: 40.4,
            maxLat: 43.0,
            minLon: 0.1,
            maxLon: 3.5
        }
    };

    // State
    let map; // Local reference to the map
    let lightningLayer;
    let ws;
    let reconnectAttempts = 0;
    let lightningEnabled = true;
    let soundEnabled = true;
    let lastProcessedStrikeTime = 0;

    // Initialize Lightning Layer (Called from radar.js)
    window.initLightning = function (mapInstance) {
        map = mapInstance;
        lightningLayer = L.layerGroup().addTo(map);

        // Controls
        const controlContainer = L.control({ position: 'topleft' });
        controlContainer.onAdd = function (map) {
            const container = L.DomUtil.create('div', 'leaflet-bar');
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);

            // Helper to style buttons
            function styleBtn(btn) {
                btn.style.backgroundColor = '#fff';
                btn.style.width = '30px';
                btn.style.height = '30px';
                btn.style.lineHeight = '30px';
                btn.style.textAlign = 'center';
                btn.style.cursor = 'pointer';
                btn.style.display = 'block';
                btn.style.fontSize = '18px';
                btn.style.textDecoration = 'none';
                btn.style.color = 'black';
            }

            // Toggle Lightning
            const btnLight = L.DomUtil.create('a', '', container);
            btnLight.innerHTML = '⚡';
            btnLight.title = 'Activar Rayos';
            btnLight.href = '#';
            styleBtn(btnLight);
            // Default active style
            btnLight.style.backgroundColor = '#ffeb3b';

            btnLight.onclick = (e) => {
                e.preventDefault();
                lightningEnabled = !lightningEnabled;
                if (lightningEnabled) {
                    map.addLayer(lightningLayer);
                    btnLight.style.backgroundColor = '#ffeb3b'; // Active Yellow
                    btnLight.style.color = 'black';
                } else {
                    map.removeLayer(lightningLayer);
                    btnLight.style.backgroundColor = '#fff';
                    btnLight.style.color = '#ccc';
                }
            };

            // Toggle Sound
            const btnSound = L.DomUtil.create('a', '', container);
            btnSound.innerHTML = '🔊'; // Start with speaker
            btnSound.title = 'Sonido';
            btnSound.href = '#';
            styleBtn(btnSound);

            btnSound.onclick = (e) => {
                e.preventDefault();
                soundEnabled = !soundEnabled;
                btnSound.innerHTML = soundEnabled ? '🔊' : '🔇';
                btnSound.style.color = soundEnabled ? 'black' : '#ccc';
            };

            return container;
        };
        controlContainer.addTo(map);

        // Init Logic
        createAudioElement();
        connectWebSocket();
        setInterval(updateLightningVisuals, 1000);

        console.log("Lightning layer initialized");
    };



    function createAudioElement() {
        if (!document.getElementById('sonido-rayo')) {
            const audio = document.createElement('audio');
            audio.id = 'sonido-rayo';
            audio.src = 'sounds/lightning.mp3'; // Reliable public URL
            audio.preload = 'auto';
            document.body.appendChild(audio);
        }
    }

    // Colors based on age (Fresh = White/Yellow, Old = Red/Brown)
    function getColorByAge(timestamp) {
        const age = (Date.now() - timestamp) / 1000;
        if (age < 30) return '#ffffff';   // White (Fresh)
        if (age < 60) return '#ffff00';   // Yellow
        if (age < 120) return '#ffcc00';  // Gold
        if (age < 300) return '#ff6600';  // Orange
        if (age < 600) return '#cc0000';  // Red
        return '#660000';                 // Dark Red
    }

    function updateLightningVisuals() {
        const now = Date.now();
        lightningLayer.eachLayer(layer => {
            if (layer.options.timestamp) {
                const age = (now - layer.options.timestamp) / 1000;
                if (age > LIGHTNING_CONFIG.MAX_AGE_SECONDS) {
                    lightningLayer.removeLayer(layer);
                } else {
                    // Update opacity/color based on age
                    const color = getColorByAge(layer.options.timestamp);
                    if (layer.getElement()) {
                        layer.getElement().style.color = color;
                        layer.getElement().style.opacity = Math.max(0.2, 1 - (age / LIGHTNING_CONFIG.MAX_AGE_SECONDS));
                    }
                }
            }
        });
    }



    function connectWebSocket() {
        ws = new WebSocket(LIGHTNING_CONFIG.WS_URL);

        ws.onopen = () => {
            console.log(`Connected to Lightning WS: ${LIGHTNING_CONFIG.WS_URL}`);
            reconnectAttempts = 0;
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.strokes && Array.isArray(data.strokes) && lightningEnabled) {
                    const sorted = data.strokes.sort((a, b) => a.time - b.time);

                    // 1. Identify all NEW strikes based on time (regardless of location)
                    const newStrikes = sorted.filter(s => s.time > lastProcessedStrikeTime);

                    if (newStrikes.length > 0) {
                        // Update tracker so we don't process these again
                        const latest = newStrikes[newStrikes.length - 1];
                        lastProcessedStrikeTime = latest.time;

                        // 2. Filter for Catalonia Region (if enabled)
                        let cataloniaStrikes = newStrikes;

                        if (LIGHTNING_CONFIG.FILTER_BOUNDS) {
                            cataloniaStrikes = newStrikes.filter(s =>
                                s.lat >= LIGHTNING_CONFIG.BOUNDS.minLat &&
                                s.lat <= LIGHTNING_CONFIG.BOUNDS.maxLat &&
                                s.lon >= LIGHTNING_CONFIG.BOUNDS.minLon &&
                                s.lon <= LIGHTNING_CONFIG.BOUNDS.maxLon
                            );
                        }

                        // 3. Add to map and play sound only if we have local (or all, if unfiltered) strikes
                        if (cataloniaStrikes.length > 0) {
                            cataloniaStrikes.forEach(strike => {
                                addLightningMarker(strike.lat, strike.lon, strike.time);
                            });

                            playSound();
                        }
                    }
                }
            } catch (e) {
                console.error('WS Data Error:', e);
            }
        };

        ws.onclose = () => {
            if (reconnectAttempts < LIGHTNING_CONFIG.MAX_RECONNECTS) {
                reconnectAttempts++;
                setTimeout(connectWebSocket, LIGHTNING_CONFIG.RECONNECT_DELAY);
            }
        };
    }

    function addLightningMarker(lat, lon, timestamp) {
        // 1. The Bolt Icon (SVG)
        const boltIcon = L.divIcon({
            className: 'lightning-icon',
            html: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                 <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
               </svg>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        });

        const marker = L.marker([lat, lon], {
            icon: boltIcon,
            timestamp: timestamp // Custom prop for aging
        });

        // Initial Fresh Style
        marker.addTo(lightningLayer);

        // 2. Pulse Animation (Temporary circle)
        const pulseIcon = L.divIcon({
            className: 'lightning-pulse',
            html: '<div class="ring"></div>',
            iconSize: [60, 60],
            iconAnchor: [30, 30]
        });

        const pulse = L.marker([lat, lon], { icon: pulseIcon, interactive: false }).addTo(map);
        setTimeout(() => map.removeLayer(pulse), 1000);
    }

    function playSound() {
        if (!soundEnabled) return;
        const audio = document.getElementById('sonido-rayo');
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => console.warn("Audio play blocked", e));
        }
    }

    // Controls logic moved to initLightning

})(); // End IIFE
