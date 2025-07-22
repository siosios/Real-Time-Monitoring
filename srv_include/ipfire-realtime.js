/*
 * File/path: /srv/web/ipfire/html/include/ipfire-realtime.js
 * Purpose: Universal real-time table renderer for IPFire Web UI
 *          - Handles colored background per zone (all columns, generic logic)
 *          - Maintains readable text (white text on colored background)
 *          - Supports column sorting, filter auto-updates, and AJAX loading
 * Version: 0.9
 * Author: ummeegge
 * License: GNU General Public License, version 3 or later
 * Last Modified: July 22, 2025
 */

document.addEventListener('DOMContentLoaded', () => {
    // Enable debug logging
    const DEBUG = true;

    // Load dynamic table configuration from window.realtimeConfig
    if (!window.realtimeConfig) {
        console.error('ERROR:: window.realtimeConfig is required but not defined');
        document.querySelector('#error_msg').textContent = 'Configuration error: window.realtimeConfig not found';
        document.querySelector('#error_msg').style.display = 'block';
        return;
    }
    const config = window.realtimeConfig;

    // Initialize runtime variables
    let refreshInterval = parseInt(config.refreshInterval || document.querySelector('#refresh_interval')?.value || 0) * 1000;
    let refreshTimer;
    let tableData = [];
    let sortStates = {};
    let sortOrder = [];
    let isFetching = false; // Prevent multiple simultaneous fetches
    let lastFetchTime = 0;
    const debounceDelay = 500; // 500ms debounce for AJAX requests

    // Setup sorting state for each column
    config.columns.forEach(col => { sortStates[col.key] = 'none'; });
    if (config.defaultSort) {
        const otherColumnsSorted = Object.keys(sortStates)
            .some(key => key !== config.defaultSort.column && sortStates[key] !== 'none');
        if (!otherColumnsSorted) {
            sortStates[config.defaultSort.column] = config.defaultSort.direction === 'asc' ? 'up' : 'down';
            sortOrder = [{ column: config.defaultSort.column, direction: config.defaultSort.direction }];
            if (DEBUG) console.log(`%cDEBUG:: Applying default sort: ${config.defaultSort.column} (${config.defaultSort.direction})`, 'color: blue');
        }
    }

    // Toggle search fields visibility
    const searchToggle = document.querySelector('#search_toggle');
    const searchFields = document.querySelector('.search_fields');
    if (searchToggle && searchFields) {
        if (searchToggle.checked) searchFields.style.display = 'block';
        searchToggle.addEventListener('change', () => {
            searchFields.style.display = searchToggle.checked ? 'block' : 'none';
        });
    } else {
        if (DEBUG) console.warn('DEBUG:: search_toggle or search_fields not found in DOM');
    }

    // Format table cell values based on column type
    function formatValue(value, type, extra) {
        if (type === 'bytes') {
            return value || '0 B';
        } else if (type === 'ip') {
            // Render IP with link to ipinfo.cgi
            return `<a href="/cgi-bin/ipinfo.cgi?ip=${encodeURIComponent(value)}" style="color:#fff !important">${value}</a>`;
        } else if (type === 'port') {
            // Render port with link to external port info
            return `<a href="https://isc.sans.edu/port.html?port=${encodeURIComponent(value)}" target="_blank" style="color:#fff !important">${value}</a>`;
        } else if (type === 'country') {
            // Render country with uppercase text and link to country.cgi
            return `<a href="/cgi-bin/country.cgi#${encodeURIComponent(value)}" style="color:#fff !important">${value.toUpperCase()}</a>`;
        } else if (type === 'flag') {
            // Render flag icon with link to country.cgi
            return `<a href="/cgi-bin/country.cgi#${encodeURIComponent(extra.country || '')}">
                <img src="${value || '/images/flags/unknown.png'}" border="0" align="absmiddle"
                alt="${extra.country || ''}" title="${extra.country || ''}" /></a>`;
        } else if (type === 'percent') {
            // Render percentage with % suffix
            return `${value}%`;
        } else if (type === 'number') {
            // Render plain number
            return value || '0';
        } else if (type === 'details') {
            // Render details button based on group (ip, port, country)
            const script = extra.group === 'ip' ? 'showrequestfromip.dat' :
                          extra.group === 'port' ? 'showrequestfromport.dat' :
                          'showrequestfromcountry.dat';
            const paramKey = extra.group === 'ip' ? 'ip' :
                            extra.group === 'port' ? 'port' : 'country';
            return `<form method="post" action="/cgi-bin/logs.cgi/${script}">
                <input type="hidden" name="MONTH" value="${extra.month}">
                <input type="hidden" name="DAY" value="${extra.day}">
                <input type="hidden" name="${paramKey}" value="${encodeURIComponent(extra.key)}">
                <input type="submit" value="Details">
            </form>`;
        }
        return value || '';
    }

    // Compare IPs numerically for sorting
    function compareIP(ipA, ipB) {
        const partsA = (ipA || '0.0.0.0').split('.').map(Number);
        const partsB = (ipB || '0.0.0.0').split('.').map(Number);
        for (let i = 0; i < 4; i++) {
            if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
        }
        return 0;
    }

    // Parse TTL for numerical sorting
    function parseTTL(ttl) {
        let seconds = 0;
        const matches = (ttl || '').match(/(\d+d)?\s*(\d+h)?\s*(\d+m)?\s*(\d+s)?/);
        if (matches) {
            if (matches[1]) seconds += parseInt(matches[1]) * 86400;
            if (matches[2]) seconds += parseInt(matches[2]) * 3600;
            if (matches[3]) seconds += parseInt(matches[3]) * 60;
            if (matches[4]) seconds += parseInt(matches[4]);
        }
        return seconds;
    }

    // Sort table data based on current sort order
    function sortData(data) {
        if (sortOrder.length === 0 || Object.values(sortStates).every(state => state === 'none')) {
            if (config.defaultSort) {
                sortOrder = [{ column: config.defaultSort.column, direction: config.defaultSort.direction }];
                sortStates[config.defaultSort.column] = config.defaultSort.direction === 'asc' ? 'up' : 'down';
                if (DEBUG) console.log(`%cDEBUG:: Applying default sort: ${config.defaultSort.column} (${config.defaultSort.direction})`, 'color: blue');
            }
        }
        if (sortOrder.length === 0) {
            if (DEBUG) console.warn(`DEBUG:: No sort order defined, returning unsorted data`);
            return data;
        }
        const { column, direction } = sortOrder[0];
        const columnConfig = config.columns.find(col => col.key === column);
        const multiplier = direction === 'asc' ? 1 : -1;
        if (DEBUG) console.log(`%cDEBUG:: Sorting by "${column}" (${direction})`, 'color: green');
        if (!columnConfig) {
            if (DEBUG) console.warn(`DEBUG:: No config found for column: ${column}`);
            return data;
        }
        try {
            return data.slice().sort((a, b) => {
                let valA = a[column] || '';
                let valB = b[column] || '';
                if (column === 'bytes_in' || column === 'bytes_out' || column === 'ttl' || column === 'count' || column === 'percent') {
                    if (column === 'ttl') {
                        valA = parseTTL(a[column]);
                        valB = parseTTL(b[column]);
                    } else {
                        const rawKey = column + '_raw';
                        valA = Number(a[rawKey] || a[column] || 0);
                        valB = Number(b[rawKey] || b[column] || 0);
                    }
                    if (DEBUG) console.log(`DEBUG:: Compare numbers: ${valA} vs ${valB} for ${column}`);
                    return (valA - valB) * multiplier;
                }
                if (columnConfig.type === 'port') {
                    valA = Number(valA || 0);
                    valB = Number(valB || 0);
                    if (DEBUG) console.log(`DEBUG:: Compare ports: ${valA} vs ${valB}`);
                    return (valA - valB) * multiplier;
                }
                if (columnConfig.type === 'ip') {
                    if (DEBUG) console.log(`DEBUG:: Compare IPs: ${valA} vs ${valB}`);
                    return compareIP(valA, valB) * multiplier;
                }
                if (columnConfig.type === 'string' || columnConfig.type === 'country') {
                    valA = (valA || '').toString().toLowerCase();
                    valB = (valB || '').toString().toLowerCase();
                    if (DEBUG) console.log(`DEBUG:: Compare strings: ${valA} vs ${valB} for ${column}`);
                    return valA.localeCompare(valB) * multiplier;
                }
                if (DEBUG) console.log(`DEBUG:: Compare default: ${valA} vs ${valB}`);
                return String(valA).localeCompare(String(valB)) * multiplier;
            });
        } catch (e) {
            console.error('DEBUG:: Sort failed! Fallback to unsorted. →', e);
            return data;
        }
    }

    // Render table with colored cells and white text
    function renderTable(data) {
        const tbody = document.querySelector('.tbl tbody');
        if (!tbody) {
            if (DEBUG) console.error('DEBUG:: Table body (.tbl tbody) not found in DOM');
            return;
        }
        tbody.innerHTML = '';
        let html = [];

        data.forEach(item => {
            let row = '<tr>';
            config.columns.forEach(col => {
                let value = item[col.key] || '';

                // Universal info link wrapping
                let infoField = col.key + '_info_url';
                if (item[infoField]) {
                    value = `<a href="${item[infoField]}" target="_blank" style="color:#fff !important">${value}</a>`;
                }

                // Extra data for flags/zones or details
                let extra = {
                    country: item[
                        col.key === 'src_flag_icon' ? 'src_country' :
                        col.key === 'dst_flag_icon' ? 'dst_country' :
                        col.key === 'key_flag_icon' ? item.key : ''
                    ],
                    colour: item[
                        col.key === 'src_ip' ? 'src_colour' :
                        col.key === 'dst_ip' ? 'dst_colour' :
                        col.key === 'key' ? 'key_colour' : ''
                    ],
                    key: item.key,
                    day: config.day,
                    month: config.month,
                    group: config.group
                };
                value = formatValue(value, col.type, extra);

                // Cell alignment
                const align = col.type === 'number' || col.type === 'bytes' || col.type === 'percent'
                    ? 'text-right'
                    : col.type === 'flag' || col.type === 'details'
                    ? 'text-center'
                    : 'text-left';

                let style = '';
                // Universal coloring logic: use column-specific color or fallback
                let cellColour = item[col.key + '_colour'] || item.zone_colour || '';
                if (cellColour && col.type !== 'details') {
                    style = `style="background:${cellColour};color:#fff;"`;
                }

                row += `<td class="${align}" ${style}>${value}</td>`;
            });
            row += '</tr>';
            html.push(row);
        });

        tbody.innerHTML = html.join('');
        const rowCount = document.querySelector('#row_count');
        if (rowCount) {
            rowCount.textContent = `(${data.length} ${config.countLabel})`;
        } else {
            if (DEBUG) console.warn('DEBUG:: #row_count not found in DOM');
        }
        if (DEBUG) console.log('DEBUG:: Rendered table rows:', data.length);
    }

    // Debounced AJAX data update routine
    async function updateTable() {
        if (isFetching) {
            if (DEBUG) console.log('DEBUG:: Fetch already in progress, skipping');
            return;
        }
        const now = Date.now();
        if (now - lastFetchTime < debounceDelay) {
            if (DEBUG) console.log(`DEBUG:: Debouncing fetch, waiting ${debounceDelay - (now - lastFetchTime)}ms`);
            setTimeout(updateTable, debounceDelay - (now - lastFetchTime));
            return;
        }
        isFetching = true;
        lastFetchTime = now;

        const params = {};
        // Collect selected zones from form inputs
        const zoneInputs = document.querySelectorAll('input[name="zone"]');
        const zones = Array.from(zoneInputs)
            .filter(zoneInput => zoneInput.checked && zoneInput.value)
            .map(zoneInput => zoneInput.value);
        if (DEBUG) console.log('DEBUG:: Selected zones for AJAX request:', zones);

        if (zones.length > 0) {
            params.zone = zones;
            params.search_enabled = 1;
        } else {
            if (DEBUG) console.warn('DEBUG:: No zones selected, fetching all data');
        }

        // Collect filter parameters from form inputs
        document.querySelectorAll('.filter-field').forEach(input => {
            const name = input.name;
            if (input.tagName === 'SELECT') {
                params[name] = input.value;
            } else if (input.type === 'checkbox') {
                params[name] = input.checked ? 1 : 0;
            } else {
                params[name] = input.value || '';
            }
        });
        if (zones.length > 0 || params.ip || params.port || params.protocol || params.group) {
            params.search_enabled = 1;
        }

        const queryString = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) {
                value.forEach(val => queryString.append(key, val));
            } else {
                queryString.append(key, value);
            }
        }
        const url = `${config.endpoint}${config.endpoint.includes('?') ? '&' : '?'}${queryString.toString()}`;
        if (DEBUG) console.log('DEBUG:: AJAX request →', url);

        try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            if (DEBUG) console.log('DEBUG:: Received data:', data);
            if (!Array.isArray(data)) {
                throw new Error(`Invalid data format: ${JSON.stringify(data)}`);
            }
            // Client-side zone filtering as a fallback
            if (zones.length > 0) {
                const validZones = new Set(zones);
                tableData = data.filter(item => {
                    const src_zone = item.src_zone || '';
                    const dst_zone = item.dst_zone || '';
                    const isValid = validZones.has(src_zone) || validZones.has(dst_zone);
                    if (DEBUG && !isValid) {
                        console.log(`DEBUG:: Filtered out item: src_zone=${src_zone}, dst_zone=${dst_zone}`);
                    }
                    return isValid;
                });
                if (DEBUG) console.log('DEBUG:: Client-side filtered data for zones', zones, ':', tableData.length, 'entries');
            } else {
                tableData = data;
            }
            document.querySelector('#error_msg').style.display = 'none';
            tableData = sortData(tableData);
            renderTable(tableData);
            // Update sort indicators
            document.querySelectorAll('.tbl thead th[data-sort]').forEach(th => {
                th.classList.remove('sort-up', 'sort-down', 'sort-none');
                th.classList.add(`sort-${sortStates[th.dataset.sort]}`);
            });
        } catch (error) {
            if (DEBUG) console.error('DEBUG:: AJAX request failed:', error, 'URL:', url);
            document.querySelector('#error_msg').textContent = `Error loading data: ${error.message}`;
            document.querySelector('#error_msg').style.display = 'block';
            document.querySelector('#row_count').textContent = `(Error: ${error.message})`;
        } finally {
            isFetching = false;
        }
    }

    // Debounced update wrapper
    function debounceUpdate() {
        if (isFetching) {
            if (DEBUG) console.log('DEBUG:: Fetch already in progress, scheduling debounced update');
            setTimeout(debounceUpdate, debounceDelay);
            return;
        }
        updateTable();
    }

    // Handle zone checkbox changes
    const zoneForm = document.querySelector('#zone_form');
    if (zoneForm) {
        zoneForm.addEventListener('change', (e) => {
            if (e.target.name === 'zone') {
                if (DEBUG) console.log('DEBUG:: Zone checkbox changed, updating table');
                debounceUpdate();
            }
        });
    } else {
        if (DEBUG) console.warn('DEBUG:: #zone_form not found in DOM');
    }

    // Handle column sort clicks
    document.querySelectorAll('.tbl thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            const currentState = sortStates[column];
            let newState = 'none', newDirection = null;
            if (currentState === 'none') {
                newState = 'up';
                newDirection = 'asc';
            } else if (currentState === 'up') {
                newState = 'down';
                newDirection = 'desc';
            } else if (currentState === 'down') {
                newState = 'none';
                newDirection = null;
            }
            Object.keys(sortStates).forEach(col => {
                sortStates[col] = col === column ? newState : 'none';
            });
            sortOrder = [];
            if (newState !== 'none') {
                sortOrder.push({ column, direction: newDirection });
            }
            if (DEBUG) console.log(`%cDEBUG:: Clicked column: ${column}. New direction: ${newDirection}`);
            if (tableData.length > 0) {
                tableData = sortData(tableData);
                renderTable(tableData);
            }
            document.querySelectorAll('.tbl thead th[data-sort]').forEach(th => {
                th.classList.remove('sort-up', 'sort-down', 'sort-none');
                th.classList.add(`sort-${sortStates[th.dataset.sort]}`);
            });
        });
    });

    // Handle refresh interval changes
    const refreshIntervalSelect = document.querySelector('#refresh_interval');
    if (refreshIntervalSelect) {
        refreshIntervalSelect.addEventListener('change', (e) => {
            clearInterval(refreshTimer);
            refreshInterval = parseInt(e.target.value || 0) * 1000;
            if (refreshInterval > 0) {
                refreshTimer = setInterval(debounceUpdate, refreshInterval);
                if (DEBUG) console.log(`DEBUG:: Updated refresh interval to ${refreshInterval}ms`);
            } else {
                if (DEBUG) console.log('DEBUG:: Auto-refresh disabled');
            }
            debounceUpdate(); // Immediate update on change
        });
    } else {
        if (DEBUG) console.warn('DEBUG:: #refresh_interval not found in DOM');
    }

    // Initialize table update and auto-refresh
    if (DEBUG) console.log('DEBUG:: Initializing table update');
    debounceUpdate();
    if (refreshInterval > 0) {
        if (DEBUG) console.log(`DEBUG:: Setting auto-refresh interval to ${refreshInterval}ms`);
        refreshTimer = setInterval(debounceUpdate, refreshInterval);
    }
});