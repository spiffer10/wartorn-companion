// ==UserScript==
// @name         Wartorn Companion
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Silently feeds live Torn DOM data to the Wartorn Dashboard, plus condensed left-edge panels. Auto-links from an active Wartorn login.
// @author       Calvaros
// @match        https://www.torn.com/*
// @match        https://wartorn.spiffer10.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      wartorn.spiffer10.com
// @downloadURL  https://update.greasyfork.org/scripts/595166/Wartorn%20Companion.user.js
// @updateURL    https://update.greasyfork.org/scripts/595166/Wartorn%20Companion.meta.js
// @license MIT
// ==/UserScript==
 
(function() {
    'use strict';
    const WARTORN_HOST = 'https://wartorn.spiffer10.com';
 
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
        if (!GM_getValue('wt_api_key', '')) {
            fetch('/api/companion/link', { credentials: 'same-origin' })
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data && data.apiKey) GM_setValue('wt_api_key', data.apiKey); })
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
        link.style.cssText = `position: fixed; top: 25vh; left: 9px; z-index: 9999999; opacity: 0.85; transition: all 0.2s ease; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 40px; height: 130px; overflow: hidden;`;

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
        
        link.addEventListener('mouseenter', () => { link.style.opacity = '1'; link.style.transform = 'scale(1.05)'; });
        link.addEventListener('mouseleave', () => { link.style.opacity = '0.35'; link.style.transform = 'scale(1)'; });
        
        link.appendChild(img);
        document.body.appendChild(link);
    }
 
    injectGhostLogo();
 
    // --- 2. AUTHENTICATION ---
    // No more pasting a raw API key into a Tampermonkey prompt - the key
    // this needs is pulled automatically from an active Wartorn login (see
    // the DASHBOARD HANDSHAKE block above). If that hasn't happened yet,
    // this just sends you to log in there instead of asking you to hand
    // your key to a popup dialog directly.
    let userApiKey = GM_getValue('wt_api_key', '');

    GM_registerMenuCommand(userApiKey ? '✅ Wartorn Linked (re-link)' : '⚙️ Link Wartorn Account', () => {
        window.open(`${WARTORN_HOST}/login`, '_blank');
    });

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
        notice.addEventListener('click', () => window.open(`${WARTORN_HOST}/login`, '_blank'));
        document.body.appendChild(notice);
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
    // full roster dump), Chain Targets (the FFScouter-scouted target
    // list), and Chain Hits (call a hit number in the 10-hit buildup before
    // a chain milestone, and vote on who takes the bonus-awarding hit -
    // same shared chain_hit_calls/chain_bonus_votes state the dashboard's
    // own buildup UI reads/writes). Bars/cooldowns were dropped from here -
    // that's already visible on Torn's own page. Skipped inside popups
    // (window.opener set - the attack window, any window.open() the
    // dashboard spawns) since those are small, single-purpose windows
    // where this would just be clutter, same reasoning as the chat-hider
    // above.
    if (!window.opener) {
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
        function openAttackPopup(id) {
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
        function rowHtml(name, subtitleHtml, actionHtml) {
            return `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 0; border-bottom:1px solid #1f2229;">
                <div style="min-width:0;">
                    <div style="color:#fff; font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${name}</div>
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
                PANEL_DEFS[activePanelKey].render();
            }, 15000);
        }

        async function renderTargetsPanel() {
            const body = document.getElementById('wt-panel-body');
            if (!body) return;
            try {
                const data = await getPanelData('targets', 'targets?limit=30&preset=respect');
                if (activePanelKey !== 'targets' || !document.getElementById('wt-panel-body')) return;
                if (data.error || !data.targets || !data.targets.length) {
                    body.innerHTML = `<div style="color:#888;">${data.error || 'No targets found.'}</div>`;
                    return;
                }
                body.innerHTML = data.targets.map(t => {
                    const tag = abbreviateStatus(t.state, t.until, t.desc);
                    const okay = t.state === 'Okay';
                    return rowHtml(
                        t.name,
                        `<span style="color:#888;">Lv ${t.level || 0}</span> · <span style="color:#00e5ff;">FF ${t.fair_fight ? t.fair_fight.toFixed(2) : '-'}</span> · <span style="color:${tag.color};">${tag.label}</span>`,
                        okay ? attackButtonHtml(t.player_id) : ''
                    );
                }).join('');
                wireAttackButtons(body);
            } catch (e) {
                if (activePanelKey === 'targets' && document.getElementById('wt-panel-body')) {
                    document.getElementById('wt-panel-body').innerHTML = '<div style="color:#f44336;">Failed to load - check your Wartorn key is still valid.</div>';
                }
            }
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
                // Same "targets under your current power level" filter as the
                // Priority Target box on the dashboard's War tab (sort_stat
                // <= your own stat, strongest-beatable first) - not the full
                // enemy roster. That's what makes this an actual hit list
                // instead of a scroll-through of everyone regardless of
                // whether you could even beat them.
                const effectiveUserStat = data.current_user_stat || 0;
                const validTargets = effectiveUserStat > 0
                    ? data.them.filter(m => m.sort_stat > 0 && m.sort_stat <= effectiveUserStat).sort((a, b) => b.sort_stat - a.sort_stat)
                    : [];

                const chainHtml = data.chain ? `<div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #333; color:#FF9800; font-weight:bold;">⛓️ Chain: ${data.chain.current || 0}${data.chain.timeout ? ` · ${formatDuration(data.chain.timeout)} left` : ''}</div>` : '';
                const rowsHtml = validTargets.map(m => {
                    const okay = m.state === 'Okay';
                    const tag = abbreviateStatus(m.state, m.until, m.desc);
                    return rowHtml(
                        m.name,
                        `<span style="color:${tag.color};">${tag.label}</span>`,
                        okay ? attackButtonHtml(m.id) : ''
                    );
                }).join('');
                document.getElementById('wt-panel-body').innerHTML = chainHtml + (rowsHtml || '<div style="color:#888;">No valid targets found under your stats.</div>');
                wireAttackButtons(document.getElementById('wt-panel-body'));
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

        const PANEL_DEFS = {
            war: { icon: '⚔️', title: 'War Targets', render: renderWarTargetsPanel, ticking: true },
            targets: { icon: '⛓️', title: 'Chain Targets', render: renderTargetsPanel, ticking: true },
            milestone: { icon: '🔥', title: 'Chain Hits', render: renderMilestonePanel, ticking: true }
        };

        function closeSidePanel() {
            stopPanelTick();
            const p = document.getElementById('wt-side-panel');
            if (p) p.remove();
            document.querySelectorAll('.wt-side-btn').forEach(b => { b.style.background = 'rgba(21,23,28,0.85)'; });
            activePanelKey = null;
        }

        function openSidePanel(key) {
            if (activePanelKey === key) { closeSidePanel(); return; }
            closeSidePanel();
            activePanelKey = key;
            const def = PANEL_DEFS[key];

            const panel = document.createElement('div');
            panel.id = 'wt-side-panel';
            panel.style.cssText = 'position:fixed; top:25vh; left:56px; width:290px; max-height:70vh; overflow-y:auto; background:#15171c; border:1px solid #3a3f4b; border-left:3px solid #00e5ff; border-radius:0 6px 6px 0; box-shadow:0 10px 30px rgba(0,0,0,0.8); z-index:9999998; font-family:sans-serif; color:#ccc;';
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
                b.style.background = (b.dataset.key === key) ? 'rgba(0,229,255,0.25)' : 'rgba(21,23,28,0.85)';
            });

            def.render();
            if (def.ticking) startPanelTick();
        }

        function injectSidePanels() {
            if (document.getElementById('wt-side-buttons')) return;
            const wrap = document.createElement('div');
            wrap.id = 'wt-side-buttons';
            // Directly below the logo, which sits at top:25vh and is 130px
            // tall - see injectGhostLogo() above.
            wrap.style.cssText = 'position:fixed; top:calc(25vh + 140px); left:10px; z-index:9999999; display:flex; flex-direction:column; gap:6px;';
            Object.keys(PANEL_DEFS).forEach(key => {
                const def = PANEL_DEFS[key];
                const btn = document.createElement('div');
                btn.className = 'wt-side-btn';
                btn.dataset.key = key;
                btn.title = def.title;
                btn.innerText = def.icon;
                btn.style.cssText = 'width:34px; height:34px; display:flex; align-items:center; justify-content:center; background:rgba(21,23,28,0.85); border:1px solid #3a3f4b; border-radius:6px; cursor:pointer; font-size:1.1em; transition:0.15s; box-shadow:0 2px 8px rgba(0,0,0,0.5);';
                btn.addEventListener('mouseenter', () => { if (activePanelKey !== key) btn.style.background = 'rgba(0,229,255,0.15)'; });
                btn.addEventListener('mouseleave', () => { if (activePanelKey !== key) btn.style.background = 'rgba(21,23,28,0.85)'; });
                btn.addEventListener('click', () => openSidePanel(key));
                wrap.appendChild(btn);
            });
            document.body.appendChild(wrap);
        }

        injectSidePanels();
    }

})();