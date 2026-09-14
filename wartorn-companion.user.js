// ==UserScript==
// @name         Wartorn Companion
// @namespace    http://tampermonkey.net/
// @version      2.9.9
// @description  Silently feeds live Torn DOM data to the Wartorn Dashboard, plus condensed left-edge panels. Auto-links from an active Wartorn login.
// @author       Calvaros
// @match        https://www.torn.com/*
// @match        https://wartorn.spiffer10.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      wartorn.spiffer10.com
// @connect      api.torn.com
// @downloadURL  https://update.greasyfork.org/scripts/595166/Wartorn%20Companion.user.js
// @updateURL    https://update.greasyfork.org/scripts/595166/Wartorn%20Companion.meta.js
// @license MIT
// ==/UserScript==
 
(function() {
    'use strict';
    const WARTORN_HOST = 'https://wartorn.spiffer10.com';

    // Defensive wrappers around Tampermonkey's GM_* storage/menu API.
    // Leading theory for why TornPDA's embedded browser only ever showed
    // the ghost logo (even after the window.name popup-detection fix):
    // GM_getValue is the very first GM_* call that runs right after the
    // logo renders (see the auth section below) - if that environment's
    // script engine doesn't fully support it and it throws, every line
    // after it silently never executes for the rest of this run, which
    // matches the symptom exactly. Falling back to localStorage instead of
    // hard-crashing means the rest of the script - buttons, panels, all of
    // it - can still run even somewhere GM_getValue/GM_setValue don't work,
    // just without settings persisting across page loads there.
    function safeGmGet(key, def) {
        try {
            if (typeof GM_getValue === 'function') return GM_getValue(key, def);
        } catch (e) {}
        try {
            const raw = localStorage.getItem('wt_gm_' + key);
            return raw !== null ? JSON.parse(raw) : def;
        } catch (e) {}
        return def;
    }
    function safeGmSet(key, val) {
        try {
            if (typeof GM_setValue === 'function') { GM_setValue(key, val); return; }
        } catch (e) {}
        try { localStorage.setItem('wt_gm_' + key, JSON.stringify(val)); } catch (e) {}
    }
    function safeRegisterMenuCommand(label, fn) {
        try {
            if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn);
        } catch (e) {}
    }
 
    // --- DASHBOARD HANDSHAKE ---
    if (window.location.href.includes('wartorn.spiffer10.com')) {
        // Flag the DOM so the dashboard knows the script is installed
        document.body.dataset.companionInstalled = 'true';

        // Auto-link: if this browser doesn't have a key stashed yet, pull it
        // from whatever account is actively logged into the dashboard right
        // now. The auth_token cookie is httpOnly and same-origin, so it's
        // invisible to the torn.com side of this script - a plain fetch()
        // here on wartorn.spiffer10.com is the only place that can use it.
        // If nobody's logged in, this 401s and does nothing; the torn.com
        // side just stays unlinked until someone visits the dashboard and
        // logs in (see the menu command below for the manual path there).
        if (!safeGmGet('wt_api_key', '')) {
            fetch('/api/companion/link', { credentials: 'same-origin' })
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data && data.apiKey) safeGmSet('wt_api_key', data.apiKey); })
                .catch(() => {});
        }
        return;
    }
 
    // --- 0. HIDE CHAT ON THE ATTACK POPUP ---
    // The dashboard's Attack button opens Torn's attack page in a small
    // popup (window.open(..., 'attack_window', 'width=450,height=750,...'))
    // sized just for the attack log/action buttons. Torn's chat widget floats
    // fixed at the bottom of every page, including this popup, and at that
    // size it covers the attack controls. Hide it ONLY on this page - not
    // site-wide - and run unconditionally (before the Wartorn-key gate below)
    // so it works even for someone who hasn't linked a key yet.
    //
    // Only do this when the window is taller than it is wide (the 450x750
    // popup, or a phone screen) - a normal wide desktop browser tab
    // ("monitor" shape) has plenty of room for chat not to overlap
    // anything, so hiding it there would just remove wanted functionality
    // for no reason.
    //
    // Best-known selector for Torn's chat container as of this writing is
    // #chatRoot. If Torn changes their markup and this stops working, right-
    // click the chat overlay in the attack popup -> Inspect, and swap in
    // whatever id/class actually wraps it.
    if (/sid=attack/.test(window.location.href) && window.innerHeight > window.innerWidth) {
        const style = document.createElement('style');
        style.id = 'wt-hide-attack-chat';
        style.textContent = `
            #chatRoot, .chat-wrap, #chat-form-wrap, .chat-box-wrap { display: none !important; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }
 
    // Logo + button stack both live inside this one wrapper so the "hide
    // buttons" toggle (added in the gated module below, since it's
    // meaningless without buttons) can slide BOTH together with a single
    // transform on the wrapper, without touching either element's own
    // transform (the logo already uses its own for the hover scale-up, and
    // stomping that from two places would fight itself). A transformed
    // element becomes the containing block for its position:fixed
    // descendants, so the logo/buttons keep their exact normal-state
    // top/left values unchanged while still sliding with this wrapper.
    // Created here (unconditionally, alongside the logo) rather than in the
    // gated module below, since the logo itself renders even on the attack
    // popup where that module never runs.
    function getOrCreateEdgeCluster() {
        let cluster = document.getElementById('wt-edge-cluster');
        if (!cluster) {
            cluster = document.createElement('div');
            cluster.id = 'wt-edge-cluster';
            cluster.style.cssText = 'position:fixed; inset:0; pointer-events:none; transform:translateX(0); transition:transform 0.3s ease; z-index:9999999;';
            document.body.appendChild(cluster);
        }
        return cluster;
    }

    // --- 1. THE GHOST HUD LOGO ---
    function injectGhostLogo() {
        if (document.getElementById('wt-ghost-logo')) return;

        const link = document.createElement('a');
        link.id = 'wt-ghost-logo';
        link.href = WARTORN_HOST;
        link.target = 'wartorn_dashboard'; 
        
        // 25% down the viewport, with the side-panel button stack directly
        // below it (see injectSidePanels()'s wrapper top offset). Sized to
        // the FINAL (post-rotation) footprint - 40 wide x 130 tall.
        link.style.cssText = `position: fixed; top: 25vh; left: 9px; z-index: 9999999; opacity: 0.85; transition: all 0.2s ease; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 40px; height: 130px; overflow: hidden; pointer-events: auto;`;

        const img = document.createElement('img');
        img.src = `${WARTORN_HOST}/wartornlogo.png`;
        // Rotated to read vertically alongside the button stack below it.
        // A 90-degree rotation swaps an element's visual width/height, so
        // to land on the container's 40x130 footprint above, the image's
        // OWN (pre-rotation) box is declared as 130 wide x 40 tall here -
        // object-fit: contain then fits the actual logo into that box
        // without distortion regardless of its real aspect ratio, and the
        // rotation swaps it back to exactly match the container, centered,
        // with nothing clipped or bleeding into the button stack below.
        img.style.cssText = `width: 130px; height: 40px; object-fit: contain; filter: drop-shadow(0 0 2px rgba(0,229,255,0.8)); transform: rotate(-90deg);`;
        
        // Base opacity is 0.85 (set above) - mouseleave used to drop it to
        // 0.35, well below that, making the logo look far more transparent
        // after hovering than it was before. Restores to the same 0.85 it
        // started at instead.
        link.addEventListener('mouseenter', () => { link.style.opacity = '1'; link.style.transform = 'scale(1.05)'; });
        link.addEventListener('mouseleave', () => { link.style.opacity = '0.85'; link.style.transform = 'scale(1)'; });
        
        link.appendChild(img);
        getOrCreateEdgeCluster().appendChild(link);
    }
 
    injectGhostLogo();
 
    // --- 2. AUTHENTICATION ---
    // No more pasting a raw API key into a Tampermonkey prompt - the key
    // this needs is pulled automatically from an active Wartorn login (see
    // the DASHBOARD HANDSHAKE block above). If that hasn't happened yet,
    // this just sends you to log in there instead of asking you to hand
    // your key to a popup dialog directly.
    let userApiKey = safeGmGet('wt_api_key', '');

    // The dashboard-side auto-link (see DASHBOARD HANDSHAKE above) writes
    // the key via safeGmSet() on wartorn.spiffer10.com, and this side reads
    // it via safeGmGet() on torn.com - that only actually crosses origins
    // through real, globally-shared GM_setValue/GM_getValue storage.
    //
    // Tried detecting that with typeof GM_getValue === 'function' and
    // branching on it, but that turned out unreliable in practice: an
    // environment (TornPDA, apparently) can define these as real callable
    // functions without them actually behaving like standard Tampermonkey
    // storage shared across every domain the script runs on - so the
    // detection said "should work" while the actual cross-origin bridge
    // still silently didn't. Rather than keep guessing at environment
    // detection, both entry points below now always offer the manual path
    // as a visible second option, so it doesn't matter whether the
    // automatic one can be verified to work - there's always a way through.
    function linkWartorn() {
        window.open(`${WARTORN_HOST}/login`, '_blank');
    }
    function linkWartornManually() {
        const key = prompt('Paste your Torn API key to link Wartorn manually:', userApiKey);
        if (key !== null && key.trim()) {
            userApiKey = key.trim();
            safeGmSet('wt_api_key', userApiKey);
            alert('Linked! Reload the page for it to take effect.');
        }
    }

    safeRegisterMenuCommand(userApiKey ? '✅ Wartorn Linked (re-link)' : '⚙️ Link Wartorn Account', linkWartorn);
    safeRegisterMenuCommand('🔑 Link Wartorn Manually (paste key)', linkWartornManually);

    // A browser blocks window.open() unless it's a direct result of a user
    // gesture, so this can't pop the login page open on its own - instead,
    // this is a small clickable notice next to the (now hard to miss)
    // logo, since the Tampermonkey extension menu above is easy to never
    // notice at all. Clicking it is a real gesture, so that window.open()
    // always goes through.
    if (!userApiKey) {
        const notice = document.createElement('div');
        notice.id = 'wt-link-notice';
        notice.style.cssText = 'position: fixed; top: calc(25vh + 140px); left: 10px; z-index: 9999999; width: 60px; background: #15171c; border: 1px solid #00e5ff; border-radius: 6px; padding: 8px 6px; text-align: center; cursor: pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.6);';
        notice.innerHTML = '<div style="font-size:1.3em; line-height:1;">🔗</div><div style="color:#00e5ff; font-size:0.65em; font-weight:bold; margin-top:4px; line-height:1.2;">Link Wartorn</div>';
        notice.addEventListener('click', linkWartorn);
        document.body.appendChild(notice);

        // Always-visible manual fallback right below it, for whenever the
        // automatic dashboard-login link doesn't actually work (TornPDA,
        // or anywhere else GM storage doesn't bridge origins the standard
        // way) - no environment detection to get wrong, just a second
        // option that's always reliable regardless of why the first one
        // didn't work.
        const manualLink = document.createElement('div');
        manualLink.id = 'wt-link-manual';
        manualLink.style.cssText = 'position: fixed; top: calc(25vh + 195px); left: 10px; z-index: 9999999; width: 60px; text-align: center; color: #888; font-size: 0.62em; cursor: pointer; text-decoration: underline; line-height: 1.3;';
        manualLink.innerText = "Auto-link not working? Paste key manually";
        manualLink.addEventListener('click', linkWartornManually);
        document.body.appendChild(manualLink);
        return;
    }
 
    // --- 3. CORE COMMUNICATION ENGINE ---
    function sendToWartorn(endpoint, payload) {
        GM_xmlhttpRequest({
            method: "POST",
            url: `${WARTORN_HOST}/api/companion/${endpoint}`,
            headers: { "Content-Type": "application/json", "x-wartorn-key": userApiKey },
            data: JSON.stringify(payload)
        });
    }
 
    // --- 4. MODULE: ZERO-LATENCY MARKET SCRAPER ---
    // Previously gated on `index.php?page=people` - unrelated to the travel
    // agency market this actually scrapes (.travel-agency-market), so this
    // never fired in practice. The item shop lives at sid=travel, but Torn's
    // Travel Agency is a single-page app: switching between the hub, a
    // country, and that country's shop never changes window.location.href,
    // so a one-shot check on load only ever catches whatever happened to
    // already be rendered at that instant. A MutationObserver watches for the
    // shop's markup actually appearing/updating instead, no matter how the
    // user navigated there.
    let lastMarketSignature = '';
    function scrapeItemMarket() {
        const countryTitle = document.querySelector('.travel-agency-market .title-black');
        if (!countryTitle) return;
        const countryName = countryTitle.innerText.trim();
        const items = [];

        document.querySelectorAll('.items-list li').forEach(li => {
            const idMatch = li.className.match(/item-(\d+)/);
            if (!idMatch) return;
            const qtyElement = li.querySelector('.stck-amount');
            if (qtyElement) {
                items.push({ id: parseInt(idMatch[1]), quantity: parseInt(qtyElement.innerText.replace(/,/g, ''), 10) || 0 });
            }
        });

        if (items.length === 0) return;

        // Skip sending a snapshot identical to the last one - the shop
        // re-renders on far more than just stock changing (price ticks,
        // countdowns), and this avoids a network call every time it does.
        const signature = countryName + '|' + items.map(i => i.id + ':' + i.quantity).sort().join(',');
        if (signature === lastMarketSignature) return;
        lastMarketSignature = signature;

        sendToWartorn('market', { country: countryName, items: items });
    }

    if (/sid=travel/.test(window.location.href)) {
        let marketScrapeTimer = null;
        const scheduleMarketScrape = () => {
            if (marketScrapeTimer) return;
            // Debounced, not instant - the observer below can fire dozens of
            // times a second on a busy page, and there's no need to re-scan
            // the DOM that often for something that only changes on restock.
            marketScrapeTimer = setTimeout(() => { marketScrapeTimer = null; scrapeItemMarket(); }, 800);
        };
        new MutationObserver(scheduleMarketScrape).observe(document.body, { childList: true, subtree: true });
        scheduleMarketScrape();
    }

    // --- 5. MODULE: LEFT-EDGE CONDENSED PANELS ---
    // Three small buttons stacked under the ghost logo, each opening a
    // slide-out panel: War Targets (enemy members under your own current
    // power level, strongest-beatable-first, abbreviated status - the same
    // filter as the Priority Target box on the dashboard's War tab, not a
    // full roster dump - plus a call/release button per target so the
    // faction doesn't pile multiple hits onto the same person - or toggle
    // to a compact 2-column view showing our own faction's status
    // alongside enemies, both with an online/idle/offline dot), Chain
    // Targets (the FFScouter-scouted target
    // list), and Chain Hits (call a hit number in the 10-hit buildup before
    // a chain milestone, and vote on who takes the bonus-awarding hit -
    // same shared chain_hit_calls/chain_bonus_votes state the dashboard's
    // own buildup UI reads/writes). Bars/cooldowns were dropped from here -
    // that's already visible on Torn's own page. Skipped specifically on
    // the attack popup (matched by window.name, the exact name every
    // window.open() call in this app and the dashboard uses for it) since
    // that's a small, single-purpose window where this would just be
    // clutter. Previously checked `!window.opener` instead, which also
    // hid every button inside TornPDA's embedded browser - that webview
    // apparently sets window.opener on its own for unrelated reasons, so a
    // generic "has an opener" check was too broad a net. A fourth button,
    // ⚙️ Settings, holds panel width/height/font size/opacity, the Chain
    // Targets FF value, the two War Targets toggles above, and two sound
    // alerts (flight landing, chain timeout warning) ported from the
    // dashboard's own audio alerts so they work while browsing torn.com
    // directly.
    if (window.name !== 'attack_window') {
        function fetchFromWartorn(endpoint) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `${WARTORN_HOST}/api/companion/${endpoint}`,
                    headers: { 'x-wartorn-key': userApiKey },
                    timeout: 10000,
                    onload: (res) => {
                        try { resolve(JSON.parse(res.responseText)); }
                        catch (e) { reject(e); }
                    },
                    onerror: () => reject(new Error('network error')),
                    ontimeout: () => reject(new Error('timeout'))
                });
            });
        }

        // Same as sendToWartorn() but resolves with the response instead of
        // firing and forgetting - calling/voting on a chain hit needs to
        // know whether it actually succeeded (someone else may have already
        // claimed that exact hit number) so the panel can react.
        function postToWartorn(endpoint, payload) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${WARTORN_HOST}/api/companion/${endpoint}`,
                    headers: { 'Content-Type': 'application/json', 'x-wartorn-key': userApiKey },
                    data: JSON.stringify(payload),
                    timeout: 10000,
                    onload: (res) => {
                        let data = {};
                        try { data = JSON.parse(res.responseText); } catch (e) {}
                        resolve({ status: res.status, data });
                    },
                    onerror: () => reject(new Error('network error')),
                    ontimeout: () => reject(new Error('timeout'))
                });
            });
        }

        // Short client-side cache so re-opening a panel (or the 1s countdown
        // tick re-render below) doesn't re-hit the backend every time -
        // war-status and targets are shared straight from the same
        // fetchCached()/fetchFfScouter()-backed handlers the dashboard itself
        // polls, so this is purely to avoid redundant round-trips, not a
        // second rate limit.
        const PANEL_CACHE_TTL = 20000;
        const panelCache = {};
        // Torn's server clock vs this machine's local clock - a countdown
        // computed against a drifted local clock won't "match reality"
        // (Torn's own on-page timers), so this is captured whenever
        // war-status hands back a server_time and applied to every
        // countdown below instead of raw Date.now(). Chain Targets doesn't
        // carry its own server_time, so it rides on whatever the War
        // Targets panel last supplied - close enough, since this is
        // correcting clock drift (typically well under a minute), not
        // network latency.
        let serverClockOffsetMs = 0;
        function nowServerMs() { return Date.now() + serverClockOffsetMs; }
        function secsUntil(untilEpochSecs) {
            if (!untilEpochSecs) return null;
            const diff = untilEpochSecs - Math.floor(nowServerMs() / 1000);
            return diff > 0 ? diff : null;
        }
        async function getPanelData(cacheKey, endpoint) {
            const cached = panelCache[cacheKey];
            if (cached && (Date.now() - cached.ts) < PANEL_CACHE_TTL) return cached.data;
            const data = await fetchFromWartorn(endpoint);
            if (cacheKey === 'war' && data && data.user_cooldowns && data.user_cooldowns.server_time) {
                serverClockOffsetMs = (data.user_cooldowns.server_time * 1000) - Date.now();
            }
            panelCache[cacheKey] = { data, ts: Date.now() };
            return data;
        }

        // Chain timeout display only (not tied to any target's clock-drift-
        // sensitive countdown) - human "4m 12s" style is fine there.
        function formatDuration(totalSecs) {
            if (!totalSecs || totalSecs <= 0) return null;
            const h = Math.floor(totalSecs / 3600);
            const m = Math.floor((totalSecs % 3600) / 60);
            const s = Math.floor(totalSecs % 60);
            if (h > 0) return `${h}h ${m}m`;
            if (m > 0) return `${m}m ${s}s`;
            return `${s}s`;
        }
        // H:MM - matches how Torn itself displays flight time remaining.
        function formatHM(totalSecs) {
            if (totalSecs == null || totalSecs <= 0) return null;
            totalSecs = Math.floor(totalSecs);
            const h = Math.floor(totalSecs / 3600);
            const m = Math.floor((totalSecs % 3600) / 60);
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
        // H:MM:SS - hospital/jail countdowns run down to the second.
        function formatHMS(totalSecs) {
            if (totalSecs == null || totalSecs <= 0) return null;
            totalSecs = Math.floor(totalSecs);
            const h = Math.floor(totalSecs / 3600);
            const m = Math.floor((totalSecs % 3600) / 60);
            const s = totalSecs % 60;
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        // Same country list/matching syntax as the backend's own
        // syncFactionMembersToDb() - keeps destination parsing consistent
        // with however server.js already reads Torn's status descriptions.
        const COUNTRY_ABBR = {
            mexico: 'MEX', cayman: 'CAY', canada: 'CAN', hawaii: 'HAW',
            'united kingdom': 'UK', argentina: 'ARG', switzerland: 'SWI',
            japan: 'JPN', china: 'CHN', uae: 'UAE', 'south africa': 'SA'
        };
        function parseDestination(desc) {
            const d = String(desc || '').toLowerCase();
            for (const name in COUNTRY_ABBR) {
                if (d.includes(name)) return COUNTRY_ABBR[name];
            }
            return null;
        }
        // Opens the same small attack popup the dashboard's own Attack
        // button does (page.php?sid=attack, not a full new tab) - the
        // previous loader2.php?sid=getInAttack URL was an old, no-longer-
        // working endpoint. This has to be a real click listener rather
        // than an inline onclick="" string: Tampermonkey scripts commonly
        // run in a sandboxed scope separate from the page's own `window`,
        // so a function referenced from injected HTML's onclick attribute
        // wouldn't resolve. Buttons instead carry a data-attack-id and get
        // wired up via wireAttackButtons() after every render.
        function attackButtonHtml(id) {
            return `<span class="wt-attack-btn" data-attack-id="${id}" style="background:#4CAF50; color:#fff; padding:4px 9px; border-radius:3px; font-size:0.85em; font-weight:bold; white-space:nowrap; cursor:pointer;">⚔️</span>`;
        }
        // Populated by renderWarTargetsPanel() from /api/companion/target-calls -
        // shared here so EVERY attack button (War Targets and Chain Targets
        // alike) warns before piling onto a target someone else already
        // called, not just the panel that happens to fetch the data.
        let companionTargetCalls = { calls: {}, myPlayerId: null };

        // War Targets panel view mode - persisted via GM_setValue so the
        // choice sticks across page loads instead of resetting on every
        // torn.com navigation.
        let showFactionStatusPanel = safeGmGet('wt_show_faction_status', false);
        // Defaults on to match the panel's original always-beatable-only
        // behavior - turning it off is what's new, not the other way
        // around, so nobody who never touches this setting sees a change.
        let beatableOnlyFilter = safeGmGet('wt_beatable_only', true);

        // All settings below live in one place (the ⚙️ Settings panel) -
        // these are just the persisted values, all defaulting to whatever
        // the panel already looked/behaved like before this existed, so
        // nobody who never opens Settings sees any change.
        let panelWidthSetting = safeGmGet('wt_panel_width', 360);
        let panelHeightVhSetting = safeGmGet('wt_panel_height_vh', 70);
        let fontSizeSetting = safeGmGet('wt_font_size', 14);
        let opacitySetting = safeGmGet('wt_panel_opacity', 0.9);
        let chainFfSetting = safeGmGet('wt_chain_ff', 3.0);
        // Sound alerts default OFF - opt-in, since audio surprising someone
        // mid-browsing is worse than them having to turn it on once.
        let flightSoundEnabled = safeGmGet('wt_flight_sound', false);
        let chainSoundEnabled = safeGmGet('wt_chain_sound', false);

        function getPanelBaseStyle() {
            return `position:fixed; top:25vh; left:56px; width:${panelWidthSetting}px; max-height:${panelHeightVhSetting}vh; overflow-y:auto; background:rgba(21,23,28,${opacitySetting}); border:1px solid #3a3f4b; border-left:3px solid #00e5ff; border-radius:0 6px 6px 0; box-shadow:0 10px 30px rgba(0,0,0,0.8); z-index:9999998; font-family:sans-serif; color:#ccc; font-size:${fontSizeSetting}px; scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.15) transparent;`;
        }
        // Applies current settings to whichever panel is open right now,
        // for live feedback while dragging a slider in Settings - a fresh
        // openSidePanel() call already picks these up via getPanelBaseStyle()
        // on its own, this is only needed for the panel already on screen.
        function applyLivePanelStyle() {
            const p = document.getElementById('wt-side-panel');
            if (p) p.style.cssText = getPanelBaseStyle();
        }

        function openAttackPopup(id) {
            const call = companionTargetCalls.calls[id];
            if (call && call.callerId !== companionTargetCalls.myPlayerId) {
                if (!confirm(`${call.callerName} already called this target - attack anyway?`)) return;
            }
            window.open(`https://www.torn.com/page.php?sid=attack&user2ID=${id}`, 'attack_window', 'width=450,height=750,left=150,top=100,popup=yes,scrollbars=yes');
        }
        function wireAttackButtons(container) {
            container.querySelectorAll('.wt-attack-btn').forEach(btn => {
                btn.addEventListener('click', () => openAttackPopup(btn.dataset.attackId));
            });
        }
        // Torn's own status strings ("Traveling", "In a federal jail", full
        // "Hospitalized until ..." descriptions, etc.) are too long for a
        // 290px-wide condensed row - collapse them to a short tag + a
        // countdown that actually matches Torn's own (clock-drift-corrected
        // via secsUntil(), not raw local time). Hospital/jail/federal count
        // down to the second (H:MM:SS); travel shows H:MM plus the
        // destination, matching how Torn displays flight time remaining.
        function abbreviateStatus(state, untilSecs, desc) {
            const secsLeft = secsUntil(untilSecs);
            const s = String(state || '').toLowerCase();
            if (s === 'okay') return { label: 'OK', color: '#4CAF50' };
            if (s.includes('hospital')) {
                const t = formatHMS(secsLeft);
                return { label: t ? `HOSP ${t}` : 'HOSP', color: '#f44336' };
            }
            if (s.includes('federal')) {
                const t = formatHMS(secsLeft);
                return { label: t ? `FED ${t}` : 'FED', color: '#9C27B0' };
            }
            if (s.includes('jail')) {
                const t = formatHMS(secsLeft);
                return { label: t ? `JAIL ${t}` : 'JAIL', color: '#FF9800' };
            }
            if (s.includes('travel')) {
                const dest = parseDestination(desc);
                const t = formatHM(secsLeft);
                return { label: `TRN${dest ? ' > ' + dest : ''}${t ? ' ' + t : ''}`.trim(), color: '#2196F3' };
            }
            if (s.includes('abroad')) {
                // Landed, not counting down a flight - no timer to show.
                const dest = parseDestination(desc);
                return { label: `ABR${dest ? ' ' + dest : ''}`, color: '#2196F3' };
            }
            return { label: (state || '?').slice(0, 10), color: '#888' };
        }
        // Torn's last_action.status ("Online"/"Idle"/anything else means
        // offline) - a separate signal from state (Okay/Hospital/etc.):
        // someone can be "Okay" but not actually at the keyboard right now,
        // which matters when deciding who's likely to react.
        function onlineDotHtml(onlineStatus) {
            const color = onlineStatus === 'Online' ? '#4CAF50' : (onlineStatus === 'Idle' ? '#FF9800' : '#666');
            return `<span style="color:${color}; font-size:0.7em; margin-right:4px;" title="${onlineStatus || 'Offline'}">●</span>`;
        }
        function rowHtml(name, subtitleHtml, actionHtml, onlineStatus) {
            const dot = onlineStatus !== undefined ? onlineDotHtml(onlineStatus) : '';
            return `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid #1f2229;">
                <div style="min-width:0;">
                    <div style="color:#fff; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${dot}${name}</div>
                    <div style="font-size:0.8em;">${subtitleHtml}</div>
                </div>
                ${actionHtml || ''}
            </div>`;
        }

        let activePanelKey = null;
        let panelTickTimer = null;
        let panelRefreshTimer = null;

        function stopPanelTick() {
            if (panelTickTimer) clearInterval(panelTickTimer);
            panelTickTimer = null;
            if (panelRefreshTimer) clearInterval(panelRefreshTimer);
            panelRefreshTimer = null;
        }
        function startPanelTick() {
            stopPanelTick();
            // Cheap 1s re-render off the already-cached snapshot, purely to
            // keep countdown text (hosp/travel ETA, chain timeout) ticking
            // down smoothly without hitting the backend every second.
            panelTickTimer = setInterval(() => {
                if (!activePanelKey) { stopPanelTick(); return; }
                PANEL_DEFS[activePanelKey].render();
            }, 1000);
            // War status and milestone buildup both genuinely change while
            // a war/chain is active (members come out of hospital, hits get
            // called, votes come in) - force past the 20s client cache
            // every 15s so these stay live while someone's actually
            // watching, not just a snapshot from whenever the panel opened.
            panelRefreshTimer = setInterval(() => {
                if (activePanelKey !== 'war' && activePanelKey !== 'milestone') return;
                delete panelCache[activePanelKey];
                if (activePanelKey === 'war') delete panelCache.targetCalls;
                PANEL_DEFS[activePanelKey].render();
            }, 15000);
        }

        async function renderTargetsPanel() {
            const body = document.getElementById('wt-panel-body');
            if (!body) return;
            try {
                // Exact 3.0 uses the same optimized "respect" preset the
                // dashboard's Chains tab does for that specific value;
                // anything else is a real min/max FF query. Cache key
                // includes the FF value so changing it in Settings doesn't
                // return a stale result cached under the old value.
                const ff = parseFloat(chainFfSetting) || 3.0;
                const endpoint = ff === 3.0 ? 'targets?limit=30&preset=respect' : `targets?limit=30&minff=${ff}&maxff=${ff}&inactive=1`;
                const data = await getPanelData('targets_' + ff, endpoint);
                if (activePanelKey !== 'targets' || !document.getElementById('wt-panel-body')) return;
                if (data.error || !data.targets || !data.targets.length) {
                    body.innerHTML = `<div style="color:#888;">${data.error || 'No targets found.'}</div>`;
                    return;
                }
                // Same endpoint/response as the dashboard's Chains tab, but the
                // dashboard re-sorts client-side (favorites first, then highest
                // level) instead of showing FFScouter's raw match order - without
                // matching that here, this panel's "top" targets were often
                // completely different people from the dashboard's, effectively
                // burying whichever ones the dashboard puts first further down
                // this much smaller panel's list. No favorites concept here, so
                // just the level sort.
                const sortedTargets = [...data.targets].sort((a, b) => (b.level || 0) - (a.level || 0));
                body.innerHTML = sortedTargets.map(t => {
                    const tag = abbreviateStatus(t.state, t.until, t.desc);
                    const okay = t.state === 'Okay';
                    return rowHtml(
                        t.name,
                        `<span style="color:#888;">Lv ${t.level || 0}</span> · <span style="color:#00e5ff;">FF ${t.fair_fight ? t.fair_fight.toFixed(2) : '-'}</span> · <span style="color:${tag.color};">${tag.label}</span>`,
                        okay ? attackButtonHtml(t.player_id) : '',
                        t.online_status
                    );
                }).join('');
                wireAttackButtons(body);
            } catch (e) {
                if (activePanelKey === 'targets' && document.getElementById('wt-panel-body')) {
                    document.getElementById('wt-panel-body').innerHTML = '<div style="color:#f44336;">Failed to load - check your Wartorn key is still valid.</div>';
                }
            }
        }

        async function callTargetCompanion(id, name) {
            try { await postToWartorn('target-calls/call', { target_id: id, target_name: name }); } catch (e) {}
            delete panelCache.war;
            delete panelCache.targetCalls;
            renderWarTargetsPanel();
        }
        async function releaseTargetCompanion(id) {
            try { await postToWartorn('target-calls/release', { target_id: id }); } catch (e) {}
            delete panelCache.war;
            delete panelCache.targetCalls;
            renderWarTargetsPanel();
        }

        async function renderWarTargetsPanel() {
            const body = document.getElementById('wt-panel-body');
            if (!body) return;
            try {
                const data = await getPanelData('war', 'war-status');
                if (activePanelKey !== 'war' || !document.getElementById('wt-panel-body')) return;
                if (data.error || !data.them) {
                    document.getElementById('wt-panel-body').innerHTML = `<div style="color:#888;">${data.error || 'No active war.'}</div>`;
                    return;
                }

                // "We often fight over targets" - lets someone claim a target
                // they're about to attack so the rest of the faction sees
                // it's taken. Shares the same target_calls rows the
                // dashboard's roster reads/writes.
                const callsData = await getPanelData('targetCalls', 'target-calls').catch(() => ({ calls: {}, myPlayerId: null }));
                companionTargetCalls = callsData || { calls: {}, myPlayerId: null };

                // Same "targets under your current power level" filter as the
                // Priority Target box on the dashboard's War tab (sort_stat
                // <= your own stat, strongest-beatable first) - not the full
                // enemy roster. That's what makes this an actual hit list
                // instead of a scroll-through of everyone regardless of
                // whether you could even beat them. Now user-toggleable
                // (beatableOnlyFilter) instead of always-on, and shared by
                // both view modes so it also scopes the 2-column enemy side.
                const effectiveUserStat = data.current_user_stat || 0;
                const enemyList = (beatableOnlyFilter && effectiveUserStat > 0)
                    ? data.them.filter(m => m.sort_stat > 0 && m.sort_stat <= effectiveUserStat)
                    : data.them.slice();
                enemyList.sort((a, b) => (b.sort_stat || 0) - (a.sort_stat || 0));
                const validTargets = enemyList;

                const chainHtml = data.chain ? `<div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #333; color:#FF9800; font-weight:bold;">⛓️ Chain: ${data.chain.current || 0}${data.chain.timeout ? ` · ${formatDuration(data.chain.timeout)} left` : ''}</div>` : '';

                // "Show our faction too" and "Beatable only" now live in the
                // ⚙️ Settings panel instead of inline checkboxes here - one
                // place for both this panel's view and everything else.
                let contentHtml;
                if (showFactionStatusPanel) {
                    // Compact 2-column overview: no action buttons, just
                    // name + online dot + abbreviated status, so both sides
                    // fit side by side in the panel.
                    const compactRow = (m) => {
                        const tag = abbreviateStatus(m.state, m.until, m.desc);
                        return `<div style="display:flex; align-items:center; gap:3px; padding:3px 0; border-bottom:1px solid #1f2229; font-size:0.72em; overflow:hidden;">
                            ${onlineDotHtml(m.online_status)}
                            <span style="color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0;">${m.name}</span>
                            <span style="color:${tag.color}; white-space:nowrap; flex-shrink:0;">${tag.label}</span>
                        </div>`;
                    };
                    // Same descending-by-stat sort as the enemy side, so
                    // strongest-first ordering is consistent on both columns
                    // instead of whatever raw order war-status happened to
                    // return "our faction" in.
                    const usList = (data.us || []).slice().sort((a, b) => (b.sort_stat || 0) - (a.sort_stat || 0));
                    const usRows = usList.map(compactRow).join('') || '<div style="color:#666; font-size:0.75em;">No data</div>';
                    const themRows = validTargets.map(compactRow).join('') || '<div style="color:#666; font-size:0.75em;">No data</div>';
                    contentHtml = `<div style="display:flex; gap:8px;">
                        <div style="flex:1; min-width:0;">
                            <div style="color:#4CAF50; font-weight:bold; font-size:0.7em; margin-bottom:4px; text-align:center;">OUR FACTION</div>
                            ${usRows}
                        </div>
                        <div style="flex:1; min-width:0; border-left:1px solid #333; padding-left:8px;">
                            <div style="color:#f44336; font-weight:bold; font-size:0.7em; margin-bottom:4px; text-align:center;">ENEMY</div>
                            ${themRows}
                        </div>
                    </div>`;
                } else {
                    const rowsHtml = validTargets.map(m => {
                        const okay = m.state === 'Okay';
                        const tag = abbreviateStatus(m.state, m.until, m.desc);
                        const call = companionTargetCalls.calls ? companionTargetCalls.calls[m.id] : null;
                        const mine = call && call.callerId === companionTargetCalls.myPlayerId;

                        let actionHtml = '';
                        if (call && !mine) {
                            actionHtml = `<span style="color:#FF9800; font-size:0.7em; white-space:nowrap;">📣 ${call.callerName}</span>`;
                        } else if (okay) {
                            const safeName = String(m.name || '').replace(/"/g, '&quot;');
                            const callBtn = mine
                                ? `<span class="wt-release-target-btn" data-tid="${m.id}" style="background:#1b5e20; border:1px solid #4CAF50; color:#4CAF50; padding:3px 6px; border-radius:3px; font-size:0.8em; cursor:pointer;">✅</span>`
                                : `<span class="wt-call-target-btn" data-tid="${m.id}" data-tname="${safeName}" style="background:#252525; border:1px solid #444; color:#ccc; padding:3px 6px; border-radius:3px; font-size:0.8em; cursor:pointer;">📣</span>`;
                            actionHtml = `<div style="display:flex; gap:4px; align-items:center;">${callBtn}${attackButtonHtml(m.id)}</div>`;
                        }
                        return rowHtml(m.name, `<span style="color:${tag.color};">${tag.label}</span>`, actionHtml, m.online_status);
                    }).join('');
                    contentHtml = rowsHtml || `<div style="color:#888;">${beatableOnlyFilter ? 'No valid targets found under your stats.' : 'No enemy members found.'}</div>`;
                }

                document.getElementById('wt-panel-body').innerHTML = chainHtml + contentHtml;
                if (!showFactionStatusPanel) {
                    wireAttackButtons(document.getElementById('wt-panel-body'));
                    document.querySelectorAll('.wt-call-target-btn').forEach(btn => {
                        btn.addEventListener('click', () => callTargetCompanion(parseInt(btn.dataset.tid, 10), btn.dataset.tname));
                    });
                    document.querySelectorAll('.wt-release-target-btn').forEach(btn => {
                        btn.addEventListener('click', () => releaseTargetCompanion(parseInt(btn.dataset.tid, 10)));
                    });
                }
            } catch (e) {
                if (activePanelKey === 'war' && document.getElementById('wt-panel-body')) {
                    document.getElementById('wt-panel-body').innerHTML = '<div style="color:#f44336;">Failed to load - check your Wartorn key is still valid.</div>';
                }
            }
        }

        // Same coordination mechanism as the dashboard's own milestone
        // buildup UI - reads/writes the exact same chain_hit_calls/
        // chain_bonus_votes rows via the mirrored /api/companion/chain-calls*
        // routes, so calling a hit here shows up on the dashboard instantly
        // (well, next ~15s poll) and vice versa.
        async function renderMilestonePanel() {
            const body = document.getElementById('wt-panel-body');
            if (!body) return;
            try {
                const data = await getPanelData('milestone', 'chain-calls');
                if (activePanelKey !== 'milestone' || !document.getElementById('wt-panel-body')) return;
                if (!data || !data.active) {
                    document.getElementById('wt-panel-body').innerHTML = '<div style="color:#888;">No chain hit coordination active right now.</div>';
                    return;
                }

                let html = `<div style="color:#FF9800; font-weight:bold; margin-bottom:8px;">Chain Hit ${data.milestone} - ${data.hitsRemaining} hit${data.hitsRemaining === 1 ? '' : 's'} away</div>`;
                data.hitNumbers.forEach(hit => {
                    const call = data.calls[hit];
                    const isMine = call && call.playerId === data.myPlayerId;
                    const isBonus = hit === data.milestone;
                    const action = call
                        ? `<span style="color:#aaa; font-size:0.8em;">${call.playerName}${isMine ? ' (you)' : ''}</span>`
                        : `<span class="wt-call-btn" data-hit="${hit}" style="background:#4CAF50; color:#fff; padding:2px 8px; border-radius:3px; font-size:0.8em; cursor:pointer;">Call</span>`;
                    html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid #1f2229;">
                        <span style="color:${isBonus ? '#f44336' : '#00e5ff'}; font-weight:bold;">#${hit}${isBonus ? ' 🎁' : ''}</span>
                        ${action}
                    </div>`;
                });

                html += `<div style="margin-top:10px; padding-top:8px; border-top:1px solid #333; color:#f44336; font-weight:bold; font-size:0.85em;">🎁 Vote for bonus hit:</div>`;
                (data.bonusCandidates || []).forEach(c => {
                    const isMyVote = data.myVote === c.playerId;
                    const safeName = String(c.playerName || 'Unknown').replace(/"/g, '&quot;');
                    html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0;">
                        <span style="color:#fff; font-size:0.85em;">${c.playerName} (${c.votes})</span>
                        <span class="wt-vote-btn" data-cid="${c.playerId}" data-cname="${safeName}" style="background:${isMyVote ? '#4CAF50' : '#252525'}; border:1px solid #444; color:#fff; padding:2px 8px; border-radius:3px; font-size:0.8em; cursor:pointer;">${isMyVote ? '✓' : 'Vote'}</span>
                    </div>`;
                });

                document.getElementById('wt-panel-body').innerHTML = html;
                document.querySelectorAll('.wt-call-btn').forEach(btn => {
                    btn.addEventListener('click', () => callMilestoneHit(parseInt(btn.dataset.hit, 10)));
                });
                document.querySelectorAll('.wt-vote-btn').forEach(btn => {
                    btn.addEventListener('click', () => voteMilestoneBonus(parseInt(btn.dataset.cid, 10), btn.dataset.cname));
                });
            } catch (e) {
                if (activePanelKey === 'milestone' && document.getElementById('wt-panel-body')) {
                    document.getElementById('wt-panel-body').innerHTML = '<div style="color:#f44336;">Failed to load - check your Wartorn key is still valid.</div>';
                }
            }
        }
        async function callMilestoneHit(hit) {
            try { await postToWartorn('chain-calls/call', { hit_number: hit }); } catch (e) {}
            delete panelCache.milestone;
            renderMilestonePanel();
        }
        async function voteMilestoneBonus(candidateId, candidateName) {
            try { await postToWartorn('chain-calls/vote', { candidate_id: candidateId, candidate_name: candidateName }); } catch (e) {}
            delete panelCache.milestone;
            renderMilestonePanel();
        }

        function renderSettingsPanel() {
            const body = document.getElementById('wt-panel-body');
            if (!body) return;

            const slider = (id, label, value, min, max, step, unit) => `
                <label style="display:flex; flex-direction:column; gap:3px; color:#aaa; font-size:0.75em;">
                    <span>${label}: <span id="${id}-val" style="color:#00e5ff; font-weight:bold;">${value}${unit || ''}</span></span>
                    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="cursor:pointer;">
                </label>`;

            body.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:12px;">
                    ${slider('wt-set-width', 'Panel Width', panelWidthSetting, 280, 520, 10, 'px')}
                    ${slider('wt-set-height', 'Panel Height', panelHeightVhSetting, 30, 90, 5, 'vh')}
                    ${slider('wt-set-font', 'Font Size', fontSizeSetting, 10, 18, 1, 'px')}
                    ${slider('wt-set-opacity', 'Opacity', Math.round(opacitySetting * 100), 50, 100, 5, '%')}

                    <label style="display:flex; flex-direction:column; gap:3px; color:#aaa; font-size:0.75em;">
                        Chain Target FF (exact value, e.g. 3.0)
                        <input type="number" id="wt-set-chainff" min="1" max="10" step="0.1" value="${chainFfSetting}" style="background:#0b0c10; border:1px solid #444; color:#fff; padding:5px 8px; border-radius:3px;">
                    </label>

                    <div style="display:flex; flex-direction:column; gap:8px; border-top:1px solid #333; padding-top:10px;">
                        <label style="display:flex; align-items:center; gap:8px; color:#ccc; font-size:0.85em; cursor:pointer;">
                            <input type="checkbox" id="wt-set-showfaction" ${showFactionStatusPanel ? 'checked' : ''} style="cursor:pointer;">
                            Show our faction too (War Targets)
                        </label>
                        <label style="display:flex; align-items:center; gap:8px; color:#ccc; font-size:0.85em; cursor:pointer;">
                            <input type="checkbox" id="wt-set-beatable" ${beatableOnlyFilter ? 'checked' : ''} style="cursor:pointer;">
                            Beatable targets only
                        </label>
                        <label style="display:flex; align-items:center; gap:8px; color:#ccc; font-size:0.85em; cursor:pointer;">
                            <input type="checkbox" id="wt-set-flightsound" ${flightSoundEnabled ? 'checked' : ''} style="cursor:pointer;">
                            ✈️ Flight landing sound (30s warning)
                        </label>
                        <label style="display:flex; align-items:center; gap:8px; color:#ccc; font-size:0.85em; cursor:pointer;">
                            <input type="checkbox" id="wt-set-chainsound" ${chainSoundEnabled ? 'checked' : ''} style="cursor:pointer;">
                            ⛓️ Chain warning sound
                        </label>
                    </div>
                </div>
            `;

            const bindSlider = (id, gmKey, setter, unit, isPercent) => {
                document.getElementById(id).addEventListener('input', (e) => {
                    const raw = parseInt(e.target.value, 10);
                    const stored = isPercent ? raw / 100 : raw;
                    setter(stored);
                    safeGmSet(gmKey, stored);
                    document.getElementById(id + '-val').innerText = raw + unit;
                    applyLivePanelStyle();
                });
            };
            bindSlider('wt-set-width', 'wt_panel_width', (v) => panelWidthSetting = v, 'px', false);
            bindSlider('wt-set-height', 'wt_panel_height_vh', (v) => panelHeightVhSetting = v, 'vh', false);
            bindSlider('wt-set-font', 'wt_font_size', (v) => fontSizeSetting = v, 'px', false);
            bindSlider('wt-set-opacity', 'wt_panel_opacity', (v) => opacitySetting = v, '%', true);

            document.getElementById('wt-set-chainff').addEventListener('change', (e) => {
                chainFfSetting = parseFloat(e.target.value) || 3.0;
                safeGmSet('wt_chain_ff', chainFfSetting);
            });
            document.getElementById('wt-set-showfaction').addEventListener('change', (e) => {
                showFactionStatusPanel = e.target.checked;
                safeGmSet('wt_show_faction_status', showFactionStatusPanel);
            });
            document.getElementById('wt-set-beatable').addEventListener('change', (e) => {
                beatableOnlyFilter = e.target.checked;
                safeGmSet('wt_beatable_only', beatableOnlyFilter);
            });
            document.getElementById('wt-set-flightsound').addEventListener('change', (e) => {
                flightSoundEnabled = e.target.checked;
                safeGmSet('wt_flight_sound', flightSoundEnabled);
                if (flightSoundEnabled) unlockAudioContext();
            });
            document.getElementById('wt-set-chainsound').addEventListener('change', (e) => {
                chainSoundEnabled = e.target.checked;
                safeGmSet('wt_chain_sound', chainSoundEnabled);
                if (chainSoundEnabled) unlockAudioContext();
            });
        }

        const PANEL_DEFS = {
            war: { icon: '⚔️', title: 'War Targets', render: renderWarTargetsPanel, ticking: true },
            targets: { icon: '⛓️', title: 'Chain Targets', render: renderTargetsPanel, ticking: true },
            milestone: { icon: '🔥', title: 'Chain Hits', render: renderMilestonePanel, ticking: true },
            settings: { icon: '⚙️', title: 'Settings', render: renderSettingsPanel, ticking: false }
        };

        function closeSidePanel() {
            stopPanelTick();
            const p = document.getElementById('wt-side-panel');
            if (p) p.remove();
            document.querySelectorAll('.wt-side-btn').forEach(b => { b.style.background = 'rgba(21,23,28,0.9)'; b.style.opacity = '0.85'; });
            activePanelKey = null;
        }

        function openSidePanel(key) {
            if (activePanelKey === key) { closeSidePanel(); return; }
            closeSidePanel();
            activePanelKey = key;
            const def = PANEL_DEFS[key];

            const panel = document.createElement('div');
            panel.id = 'wt-side-panel';
            panel.style.cssText = getPanelBaseStyle();
            panel.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#0b0c10; border-bottom:1px solid #333;">
                    <span style="color:#00e5ff; font-weight:bold; font-size:0.9em;">${def.icon} ${def.title}</span>
                    <span id="wt-panel-close" style="cursor:pointer; color:#888; font-size:1.2em; line-height:1; padding:0 4px;">&times;</span>
                </div>
                <div id="wt-panel-body" style="padding:10px 12px; font-size:0.85em;">Loading...</div>
            `;
            document.body.appendChild(panel);
            // Manually drive scrolling and stop the wheel event from
            // bubbling - Torn's own page can otherwise swallow/intercept
            // wheel events before the browser's native overflow-y:auto
            // scrolling on this injected, unrelated element gets a chance
            // to apply.
            panel.addEventListener('wheel', (e) => {
                e.stopPropagation();
                panel.scrollTop += e.deltaY;
            }, { passive: true });
            document.getElementById('wt-panel-close').addEventListener('click', closeSidePanel);
            document.querySelectorAll('.wt-side-btn').forEach(b => {
                const isActive = b.dataset.key === key;
                b.style.background = isActive ? 'rgba(10,11,14,0.95)' : 'rgba(21,23,28,0.9)';
                b.style.opacity = isActive ? '1' : '0.85';
            });

            def.render();
            if (def.ticking) startPanelTick();
        }

        function injectSidePanels() {
            if (document.getElementById('wt-side-buttons')) return;

            // Webkit scrollbar pseudo-elements can't be set via an inline
            // style attribute - needs a real stylesheet rule. Targets the
            // panel by ID, so this one-time injection covers every future
            // #wt-side-panel even though it's fully destroyed and recreated
            // on each open/close.
            const scrollbarStyle = document.createElement('style');
            scrollbarStyle.textContent = `
                #wt-side-panel::-webkit-scrollbar { width: 6px; }
                #wt-side-panel::-webkit-scrollbar-track { background: transparent; }
                #wt-side-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
                #wt-side-panel::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
                @keyframes wt-danger-pulse {
                    0%, 100% { filter: drop-shadow(0 0 3px rgba(244,67,54,0.9)) drop-shadow(0 0 2px rgba(244,67,54,0.9)); }
                    50% { filter: drop-shadow(0 0 16px rgba(244,67,54,1)) drop-shadow(0 0 8px rgba(244,67,54,1)); }
                }
                @keyframes wt-away-pulse {
                    0%, 100% { filter: drop-shadow(0 0 3px rgba(255,152,0,0.85)) drop-shadow(0 0 2px rgba(255,152,0,0.85)); }
                    50% { filter: drop-shadow(0 0 14px rgba(255,152,0,1)) drop-shadow(0 0 6px rgba(255,152,0,1)); }
                }
                #wt-ghost-logo img.wt-logo-danger { animation: wt-danger-pulse 1s ease-in-out infinite; }
                #wt-ghost-logo img.wt-logo-away { animation: wt-away-pulse 1.4s ease-in-out infinite; }
            `;
            document.head.appendChild(scrollbarStyle);

            const wrap = document.createElement('div');
            wrap.id = 'wt-side-buttons';
            // Directly below the logo, which sits at top:25vh and is 130px
            // tall - see injectGhostLogo() above.
            const WRAP_TRANSITION = 'opacity 0.3s ease, transform 0.3s ease';
            wrap.style.cssText = `position:fixed; top:calc(25vh + 131px); left:10px; z-index:9999999; display:flex; flex-direction:column; gap:6px; pointer-events:auto; transform-origin:top center; transition:${WRAP_TRANSITION};`;
            Object.keys(PANEL_DEFS).forEach(key => {
                const def = PANEL_DEFS[key];
                const btn = document.createElement('div');
                btn.className = 'wt-side-btn';
                btn.dataset.key = key;
                btn.title = def.title;
                btn.innerText = def.icon;
                // Same opacity scheme as the ghost logo (0.85 base, 1 on
                // hover) for visual consistency across the whole left-edge
                // UI - background color separately signals which panel (if
                // any) is currently open.
                btn.style.cssText = 'width:34px; height:34px; display:flex; align-items:center; justify-content:center; background:rgba(21,23,28,0.9); border:1px solid #3a3f4b; border-radius:6px; cursor:pointer; font-size:1.1em; transition:0.15s; box-shadow:0 2px 8px rgba(0,0,0,0.5); opacity:0.85;';
                btn.addEventListener('mouseenter', () => {
                    btn.style.opacity = '1';
                    btn.style.transform = 'scale(1.05)';
                    if (activePanelKey !== key) btn.style.background = 'rgba(10,11,14,0.95)';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.opacity = activePanelKey === key ? '1' : '0.85';
                    btn.style.transform = 'scale(1)';
                    if (activePanelKey !== key) btn.style.background = 'rgba(21,23,28,0.9)';
                });
                btn.addEventListener('click', () => openSidePanel(key));
                wrap.appendChild(btn);
            });
            const cluster = getOrCreateEdgeCluster();
            cluster.appendChild(wrap);

            // --- HIDE/SHOW TOGGLE ---
            // Collapsing has two stages: the buttons shrink and fade upward
            // as if being pulled into the logo above them, then (only once
            // that finishes) the whole cluster - logo included - slides left
            // to nearly off-screen. Expanding reverses the order: slide back
            // in first, then the buttons drop back down out of the logo.
            // The toggle tab itself lives OUTSIDE the cluster (appended to
            // body, not into it) so it never slides away and stays
            // reachable no matter how collapsed things are.
            const EDGE_SLIDE_PX = 32; // logo is 40px wide - this leaves ~8px peeking out
            const EDGE_ANIM_MS = 300;
            const CLUSTER_TRANSITION = 'transform 0.3s ease';
            let edgeCollapsed = safeGmGet('wt_edge_collapsed', false);

            const TOGGLE_OPACITY_EXPANDED = '0.85';
            const TOGGLE_OPACITY_COLLAPSED = '0.2'; // nearly hidden away, not competing for attention

            const toggle = document.createElement('div');
            toggle.id = 'wt-edge-toggle';
            toggle.title = 'Hide/show the Wartorn buttons';
            // Sits just above the logo (top:25vh) rather than between the
            // logo and the button stack - that gap was thin enough that it
            // visually ran into the War Targets button below it.
            toggle.style.cssText = 'position:fixed; top:calc(25vh - 9px); left:9px; z-index:9999999; width:40px; height:10px; display:flex; align-items:center; justify-content:center; background:rgba(21,23,28,0.9); border:1px solid #3a3f4b; border-bottom:none; border-radius:4px 4px 0 0; cursor:pointer; font-size:8px; line-height:1; color:#00e5ff; opacity:0.85; transition:0.15s; pointer-events:auto;';
            toggle.addEventListener('mouseenter', () => { toggle.style.opacity = '1'; });
            toggle.addEventListener('mouseleave', () => { toggle.style.opacity = edgeCollapsed ? TOGGLE_OPACITY_COLLAPSED : TOGGLE_OPACITY_EXPANDED; });

            function applyEdgeCollapsed(animate) {
                toggle.innerText = edgeCollapsed ? '›' : '‹'; // › : ‹
                toggle.style.opacity = edgeCollapsed ? TOGGLE_OPACITY_COLLAPSED : TOGGLE_OPACITY_EXPANDED;
                if (edgeCollapsed) {
                    wrap.style.pointerEvents = 'none';
                    wrap.style.opacity = '0';
                    wrap.style.transform = 'translateY(-120px) scale(0.4)';
                    setTimeout(() => { cluster.style.transform = `translateX(-${EDGE_SLIDE_PX}px)`; }, animate ? EDGE_ANIM_MS : 0);
                } else {
                    cluster.style.transform = 'translateX(0)';
                    setTimeout(() => {
                        wrap.style.opacity = '1';
                        wrap.style.transform = 'translateY(0) scale(1)';
                        wrap.style.pointerEvents = 'auto';
                    }, animate ? EDGE_ANIM_MS : 0);
                }
            }

            toggle.addEventListener('click', () => {
                edgeCollapsed = !edgeCollapsed;
                safeGmSet('wt_edge_collapsed', edgeCollapsed);
                if (edgeCollapsed) closeSidePanel();
                applyEdgeCollapsed(true);
            });
            document.body.appendChild(toggle);

            // Apply a persisted collapsed state instantly on page load,
            // skipping the transition - only an actual click should animate,
            // not every fresh page load landing back in the same state.
            if (edgeCollapsed) {
                cluster.style.transition = 'none';
                wrap.style.transition = 'none';
                applyEdgeCollapsed(false);
                requestAnimationFrame(() => {
                    cluster.style.transition = CLUSTER_TRANSITION;
                    wrap.style.transition = WRAP_TRANSITION;
                });
            }
        }

        injectSidePanels();

        // --- 6. MODULE: SOUND ALERTS ---
        // Same two alerts the dashboard itself has (Flight Alert, chain
        // timeout warning), ported here so they work while browsing
        // torn.com directly, not just with the dashboard tab open. Both
        // default off (see the settings declarations above) - opt in via
        // ⚙️ Settings.
        let sharedAudioCtx = null;
        function unlockAudioContext() {
            try {
                if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
            } catch (e) {}
        }
        // Browsers block audio until a real user gesture happens on the
        // page - this is that gesture, same trick the dashboard uses.
        // Companion pages are shorter-lived than the dashboard's own tab
        // though (a fresh script instance runs per page load, not once for
        // a whole session) - someone who loads torn.com and immediately
        // alt-tabs away to another game without ever clicking anything on
        // THAT specific page load never unlocks audio for it, so both
        // alerts silently no-op for the rest of that page's lifetime even
        // though everything else (polling, threshold checks) keeps working.
        // Listening for several common gesture types instead of only
        // 'click' catches more of what someone does in the ordinary course
        // of arriving at/using a Torn page before switching away.
        // unlockAudioContext() is idempotent, so redundant listeners are
        // harmless - whichever fires first does the real work.
        ['click', 'keydown', 'mousedown', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, unlockAudioContext, { once: true, passive: true });
        });

        // Airline-style double-chime, same synthesis as the dashboard's
        // playBongBong() - two sine "bong" notes with a slow exponential
        // decay so it reads as a landing chime, not a beep.
        function playTravelLandingChime() {
            if (!sharedAudioCtx) return;
            try {
                const ctx = sharedAudioCtx;
                const playBong = (startTime, freq) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, startTime);
                    gain.gain.setValueAtTime(0, startTime);
                    gain.gain.linearRampToValueAtTime(0.7, startTime + 0.05);
                    gain.gain.exponentialRampToValueAtTime(0.01, startTime + 1.5);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(startTime);
                    osc.stop(startTime + 1.8);
                };
                const now = ctx.currentTime;
                playBong(now, 659.25);
                playBong(now + 0.5, 523.25);
            } catch (e) {}
        }

        // Matches the dashboard's checkChainAudioAlerts(): a soft single
        // beep with over a minute left, an urgent double square-wave beep
        // under 90s.
        function playChainBeep(urgent) {
            if (!sharedAudioCtx) return;
            try {
                const ctx = sharedAudioCtx;
                const beep = (startTime) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = urgent ? 'square' : 'sine';
                    osc.frequency.setValueAtTime(urgent ? 880 : 440, startTime);
                    gain.gain.setValueAtTime(0.2, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, startTime + (urgent ? 0.15 : 0.3));
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(startTime);
                    osc.stop(startTime + (urgent ? 0.15 : 0.3));
                };
                beep(ctx.currentTime);
                if (urgent) beep(ctx.currentTime + 0.2);
            } catch (e) {}
        }

        let hasPlayedTravelAlert = false;
        let lastChainBeepTime = 0;

        // Flight landing timing used to ride on the same war-status fetch as
        // everything else, which goes through Wartorn's backend and its own
        // cache - fine for a roster list, but it meant the countdown here
        // could be several seconds stale. The script already runs on
        // torn.com with the user's own real Torn API key in hand
        // (userApiKey - see DASHBOARD HANDSHAKE above), so this instead
        // hits api.torn.com directly: no backend round-trip, no shared
        // cache, and it's each player's own key/quota, not the server's
        // shared one, so this doesn't touch the shared-queue rate limits.
        //
        // travel.time_left is "seconds remaining as of this specific call",
        // not perfectly monotonic between calls - Torn's own rounding/
        // caching can report a couple seconds MORE remaining on one poll
        // than the previous one implied. Re-deriving the countdown fresh
        // from that value every 5s poll let a noisy reading nudge the
        // estimate back above 30s right as the alert flag had just been
        // reset for landing, re-arming it and firing the chime again on
        // the next crossing - repeating roughly every poll. So instead
        // this locks in one absolute landing timestamp (travelLandAtMs)
        // that can only be pulled EARLIER by a later poll, never later,
        // unless the jump is big enough to mean a genuinely new/extended
        // trip rather than jitter - that's the only case allowed to push
        // it later, and it also re-arms the alert for the new countdown.
        let travelLandAtMs = null;
        const TRAVEL_NEW_TRIP_JUMP_SECS = 60;

        function fetchTornTravel() {
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `https://api.torn.com/user/?selections=travel&key=${encodeURIComponent(userApiKey)}`,
                    timeout: 8000,
                    onload: (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            resolve((data && !data.error) ? data.travel : null);
                        } catch (e) { resolve(null); }
                    },
                    onerror: () => resolve(null),
                    ontimeout: () => resolve(null)
                });
            });
        }

        // Right after a real landing, Torn's API can briefly still return a
        // small leftover time_left (a stale/cached read from just before it
        // actually hit 0) instead of a clean 0. Since landing had already
        // nulled travelLandAtMs, that stray reading looked like a brand
        // new trip and got accepted immediately - re-arming the alert
        // under the 30s threshold and firing the chime again right after
        // you'd just landed. Torn's shortest real flight is many minutes,
        // so any "first" reading (starting fresh from null) under this
        // floor is almost certainly that kind of stale artifact, not an
        // actual trip, and is ignored rather than accepted.
        const MIN_FRESH_TRAVEL_SECS = 45;

        async function checkTravelStatus() {
            if (!flightSoundEnabled || !userApiKey) { travelLandAtMs = null; return; }
            const travel = await fetchTornTravel();
            if (!travel || typeof travel.time_left !== 'number' || travel.time_left <= 0) {
                travelLandAtMs = null;
                return;
            }
            if (travelLandAtMs === null && travel.time_left < MIN_FRESH_TRAVEL_SECS) return;
            const candidateLandAtMs = Date.now() + travel.time_left * 1000;
            if (travelLandAtMs === null || candidateLandAtMs > travelLandAtMs + TRAVEL_NEW_TRIP_JUMP_SECS * 1000) {
                travelLandAtMs = candidateLandAtMs;
                hasPlayedTravelAlert = false;
            } else if (candidateLandAtMs < travelLandAtMs) {
                travelLandAtMs = candidateLandAtMs;
            }
        }
        setInterval(checkTravelStatus, 5000);
        checkTravelStatus();

        // Pulses the ghost logo when a war is active and an enemy with
        // higher stats than you is both attackable and present:
        //   Red    - Online (actually at the keyboard right now)
        //   Orange - Idle (logged in, but not actively at the keyboard)
        // "Attackable" depends on where you are: normally that's just
        // being Okay, but if you're abroad yourself, only enemies who are
        // ALSO abroad actually count - someone sitting in Torn can't be
        // the one who hits you while you're overseas, so they're excluded
        // even if they're online and stronger than you. Always-on (not a
        // Settings toggle, unlike the sounds) since it's a passive visual
        // state, not something that interrupts with noise. Red takes
        // priority over orange when both would apply.
        function updateLogoDangerState(dangerTarget, awayTarget) {
            const img = document.querySelector('#wt-ghost-logo img');
            const link = document.getElementById('wt-ghost-logo');
            if (!img || !link) return;
            img.classList.remove('wt-logo-danger', 'wt-logo-away');
            if (dangerTarget) {
                img.classList.add('wt-logo-danger');
                link.title = `⚠️ ${dangerTarget.name} (higher stats than you) is Online and able to attack you right now.`;
            } else if (awayTarget) {
                img.classList.add('wt-logo-away');
                link.title = `🕐 ${awayTarget.name} (higher stats than you) is Away and able to attack you.`;
            } else {
                link.title = '';
            }
        }

        // Network fetch and the actual threshold checks are deliberately
        // decoupled: fetching war-status every 5s (checkLiveAlerts) keeps
        // load reasonable, but only checking the 30s/120s/90s thresholds
        // at that same 5s cadence meant an alert could fire several
        // seconds late - a threshold crossed between two polls wasn't
        // caught until the next one. tickLocalAlertClocks() instead
        // recomputes against the last fetched snapshot every 1s using pure
        // elapsed-time math, so it catches the exact second a threshold is
        // crossed without needing a fresh network round-trip for it.
        let lastAlertSnapshot = null; // { amAbroad, chainTimeoutAtFetch, chainCount, chainOnCooldown, fetchedAtMs }

        async function checkLiveAlerts() {
            try {
                const data = await fetchFromWartorn('war-status');
                if (!data || data.error) {
                    lastAlertSnapshot = null;
                    updateLogoDangerState(null, null);
                    return;
                }
                if (data.user_cooldowns && data.user_cooldowns.server_time) {
                    serverClockOffsetMs = (data.user_cooldowns.server_time * 1000) - Date.now();
                }

                const me = (data.us || []).find(m => String(m.id) === String(data.current_user_id));
                const myStateLower = me ? String(me.state || '').toLowerCase() : '';
                const amAbroad = myStateLower.includes('travel') || myStateLower.includes('abroad');

                lastAlertSnapshot = {
                    amAbroad,
                    chainTimeoutAtFetch: data.chain ? (data.chain.timeout || 0) : 0,
                    chainCount: data.chain ? (data.chain.current || 0) : 0,
                    chainOnCooldown: data.chain ? (data.chain.cooldown || 0) > 0 : false,
                    fetchedAtMs: Date.now()
                };

                // "Attackable" depends on where you are: normally that
                // means Okay (in Torn, not hospital/jail/traveling). If
                // you're abroad yourself, only enemies who are ALSO abroad
                // are actually able to reach you - someone sitting in Torn
                // can't be the one who hits you while you're overseas, so
                // they shouldn't count as a threat right now even if
                // they're online and stronger than you.
                const nowSecs = Math.floor(nowServerMs() / 1000);
                const warIsActive = data.start_time > 0 && data.start_time <= nowSecs && data.end_time === 0;
                const myStat = data.current_user_stat || 0;
                let dangerTarget = null; // red: Online
                let awayTarget = null;   // orange: Idle
                if (warIsActive && myStat > 0 && data.them) {
                    data.them.forEach(m => {
                        if (m.sort_stat <= myStat) return;
                        const enemyStateLower = String(m.state || '').toLowerCase();
                        const enemyAbroad = enemyStateLower.includes('abroad') || enemyStateLower.includes('travel');
                        const isAttackable = amAbroad ? enemyAbroad : m.state === 'Okay';
                        if (!isAttackable) return;
                        if (m.online_status === 'Online') {
                            if (!dangerTarget || m.sort_stat > dangerTarget.sort_stat) dangerTarget = m;
                        } else if (m.online_status === 'Idle') {
                            if (!awayTarget || m.sort_stat > awayTarget.sort_stat) awayTarget = m;
                        }
                    });
                }
                updateLogoDangerState(dangerTarget, awayTarget);
            } catch (e) {}
        }
        setInterval(checkLiveAlerts, 5000);
        checkLiveAlerts(); // don't wait 5s for the first check

        function tickLocalAlertClocks() {
            // Flight timing is self-contained (travelLandAtMs, tracked
            // above from direct Torn API polls) and shouldn't depend on
            // war-status having loaded, so it's checked before the
            // lastAlertSnapshot guard below rather than inside it.
            if (flightSoundEnabled && travelLandAtMs !== null) {
                const travelSecsNow = (travelLandAtMs - Date.now()) / 1000;
                if (travelSecsNow <= 0) {
                    // Landed - clear the target and let the next poll (or
                    // a new trip) start a fresh countdown from scratch.
                    travelLandAtMs = null;
                    hasPlayedTravelAlert = false;
                } else if (travelSecsNow <= 30 && !hasPlayedTravelAlert) {
                    playTravelLandingChime();
                    hasPlayedTravelAlert = true;
                }
            }

            const s = lastAlertSnapshot;
            if (s && chainSoundEnabled && s.chainTimeoutAtFetch > 0 && !s.chainOnCooldown && s.chainCount >= 10) {
                // chain.timeout is a plain "seconds remaining as of when we
                // fetched it" duration, not an absolute timestamp, so this
                // one DOES need elapsed-time correction.
                const elapsedSecs = (Date.now() - s.fetchedAtMs) / 1000;
                const chainSecsNow = s.chainTimeoutAtFetch - elapsedSecs;
                if (chainSecsNow > 0 && chainSecsNow <= 120) {
                    const now = Date.now();
                    if (now - lastChainBeepTime >= 4000) {
                        lastChainBeepTime = now;
                        playChainBeep(chainSecsNow <= 90);
                    }
                }
            }
        }
        setInterval(tickLocalAlertClocks, 1000);
    }

})();