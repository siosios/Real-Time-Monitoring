/*
 * File/path: /srv/web/ipfire/html/include/ipfire-realtime.js
 * Purpose: Universal real-time table renderer for IPFire Web UI
 * Version: 1.0.3
 * Author: ummeegge
 * License: GNU General Public License, version 3 or later
 * Last Modified: August 5, 2025
 */

document.addEventListener('DOMContentLoaded', () => {
    const DEBUG = true;

    // Validate configuration
    if (!window.realtimeConfig) {
        console.error('ERROR:: window.realtimeConfig is required but not defined');
        document.querySelector('#error_msg').textContent = 'Configuration error: window.realtimeConfig not found';
        document.querySelector('#error_msg').style.display = 'block';
        return;
    }

    const config = {
        ...window.realtimeConfig,
        rawTableSelector: window.realtimeConfig.rawTableSelector || '#raw_logs_table tbody',
        searchFormSelector: window.realtimeConfig.searchFormSelector || '#zone_form',
        mainTableSelector: window.realtimeConfig.mainTableSelector || '.tbl tbody',
        group: window.realtimeConfig.group || 'ip',
        day: window.realtimeConfig.day || new Date().getDate(),
        month: window.realtimeConfig.month || new Date().getMonth(),
        year: window.realtimeConfig.year || new Date().getFullYear(),
        limit: parseInt(window.realtimeConfig.limit || 10),
        hasRawLogs: window.realtimeConfig.hasRawLogs || false,
        enablePagination: window.realtimeConfig.enablePagination || false,
        refreshInterval: parseInt(window.realtimeConfig.refreshInterval || document.querySelector('#refresh_interval')?.value || 0) * 1000
    };

    // DOM elements
    const mainTbody = document.querySelector(config.mainTableSelector);
    const rawLogsTbody = config.hasRawLogs ? document.querySelector(config.rawTableSelector) : null;
    const searchForm = config.hasRawLogs ? document.querySelector(config.searchFormSelector) : null;
    const searchToggle = document.querySelector('#search_toggle');
    const searchFields = document.querySelector('.search_fields');
    let rawPaginationContainer = null;

    // Initialize pagination containers
    if (config.enablePagination) {
        const paginationContainer = document.querySelector('#pagination') || createPaginationContainer(config.mainTableSelector.replace(' tbody', '') || '.tbl');
        if (paginationContainer) console.log('DEBUG:: Main pagination container initialized');
    }
    if (config.hasRawLogs) {
        rawPaginationContainer = document.querySelector('#raw_pagination') || createPaginationContainer(config.rawTableSelector.replace(' tbody', '') || '.raw_logs_table');
        if (rawPaginationContainer) console.log('DEBUG:: Raw pagination container initialized');
    }

    // State management
    let state = {
        isFetching: false,
        lastFetchTime: 0,
        debounceDelay: 500,
        refreshTimer: null,
        tableData: [],
        rawLogsData: [],
        sortStates: {},
        sortOrder: [],
        currentPage: 1,
        rawCurrentPage: 1,
        rowsPerPage: config.limit,
        rawRowsPerPage: 50,
        modifiedFields: new Set()
    };

    // Validate DOM elements
    if (!mainTbody) {
        console.error(`ERROR:: ${config.mainTableSelector} not found in DOM`);
        document.querySelector('#error_msg').textContent = `Error: Main table not found at selector '${config.mainTableSelector}'`;
        document.querySelector('#error_msg').style.display = 'block';
        return;
    }
    if (config.hasRawLogs && !rawLogsTbody) {
        console.warn(`DEBUG:: ${config.rawTableSelector} not found in DOM, raw logs disabled`);
        config.hasRawLogs = false;
    }
    if (config.hasRawLogs && !searchForm) {
        console.warn(`DEBUG:: ${config.searchFormSelector} not found in DOM`);
    }

    // Setup MutationObserver for debugging
    if (DEBUG) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                console.warn('DEBUG:: DOM mutation detected on tbody:', mutation.target.id || config.mainTableSelector, 'New HTML:', mutation.target.innerHTML.substring(0, 100) + '...');
            });
        });
        if (mainTbody) observer.observe(mainTbody, { childList: true, subtree: true, characterData: true });
        if (rawLogsTbody) observer.observe(rawLogsTbody, { childList: true, subtree: true, characterData: true });
        console.log('DEBUG:: MutationObserver set up for mainTbody and rawLogsTbody');
        console.log('DEBUG:: Initialized config:', config);
    }

    // Initialize sorting
    config.columns.forEach(col => { state.sortStates[col.key] = 'none'; });
    if (config.defaultSort) {
        state.sortStates[config.defaultSort.column] = config.defaultSort.direction === 'asc' ? 'up' : 'down';
        state.sortOrder = [{ column: config.defaultSort.column, direction: config.defaultSort.direction }];
        console.log(`%cDEBUG:: Applying default sort: ${config.defaultSort.column} (${config.defaultSort.direction})`, 'color: blue');
    }

    // Search toggle handling
    if (searchToggle && searchFields) {
        if (searchToggle.checked) searchFields.style.display = 'block';
        searchToggle.addEventListener('change', () => {
            searchFields.style.display = searchToggle.checked ? 'block' : 'none';
            console.log(`DEBUG:: Search toggle changed: ${searchToggle.checked}`);
            updateTable('search_enabled');
        });
    } else {
        console.warn('DEBUG:: search_toggle or search_fields not found in DOM');
    }

    // Utility functions
    function formatValue(value, type, extra) {
        if (type === 'bytes') return value || '0 B';
        if (type === 'ip') return `<a href="/cgi-bin/ipinfo.cgi?ip=${encodeURIComponent(value)}" target="_blank" style="color:#fff !important">${value}</a>`;
        if (type === 'port') return `<a href="https://isc.sans.edu/port.html?port=${encodeURIComponent(value)}" target="_blank" style="color:#fff !important">${value}</a>`;
        if (type === 'country') return `<a href="/cgi-bin/country.cgi#${encodeURIComponent(value)}" style="color:#fff !important">${value.toUpperCase()}</a>`;
        if (type === 'flag') return `<a href="/cgi-bin/country.cgi#${encodeURIComponent(extra.country || '')}"><img src="${value || '/images/flags/unknown.png'}" border="0" align="absmiddle" alt="${extra.country || ''}" title="${extra.country || ''}" /></a>`;
        if (type === 'percent') return `${value}%`;
        if (type === 'number') return value || '0';
        if (type === 'details') {
            const script = extra.group === 'ip' ? 'showrequestfromip.dat' : extra.group === 'port' ? 'showrequestfromport.dat' : 'showrequestfromcountry.dat';
            const paramKey = extra.group === 'ip' ? 'ip' : extra.group === 'port' ? 'port' : 'country';
            return `<form method="post" action="/cgi-bin/logs.cgi/${script}"><input type="hidden" name="MONTH" value="${extra.month}"><input type="hidden" name="DAY" value="${extra.day}"><input type="hidden" name="${paramKey}" value="${encodeURIComponent(extra.key)}"><input type="submit" value="Details" class="details-btn"></form>`;
        }
        return value || '';
    }

    function compareIP(ipA, ipB) {
        const partsA = (ipA || '0.0.0.0').split('.').map(Number);
        const partsB = (ipB || '0.0.0.0').split('.').map(Number);
        for (let i = 0; i < 4; i++) {
            if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
        }
        return 0;
    }

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

    function sortData(data) {
        if (state.sortOrder.length === 0 || Object.values(state.sortStates).every(state => state === 'none')) {
            if (config.defaultSort) {
                state.sortOrder = [{ column: config.defaultSort.column, direction: config.defaultSort.direction }];
                state.sortStates[config.defaultSort.column] = config.defaultSort.direction === 'asc' ? 'up' : 'down';
                console.log(`%cDEBUG:: Applying default sort: ${config.defaultSort.column} (${config.defaultSort.direction})`, 'color: blue');
            }
        }
        if (state.sortOrder.length === 0) {
            console.warn(`DEBUG:: No sort order defined, returning unsorted data`);
            return data;
        }
        const { column, direction } = state.sortOrder[0];
        const columnConfig = config.columns.find(col => col.key === column);
        const multiplier = direction === 'asc' ? 1 : -1;
        console.log(`%cDEBUG:: Sorting by "${column}" (${direction})`, 'color: green');
        if (!columnConfig) {
            console.warn(`DEBUG:: No config found for column: ${column}`);
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
                    console.log(`DEBUG:: Compare numbers: ${valA} vs ${valB} for ${column}`);
                    return (valA - valB) * multiplier;
                }
                if (columnConfig.type === 'port') {
                    valA = Number(valA || 0);
                    valB = Number(valB || 0);
                    console.log(`DEBUG:: Compare ports: ${valA} vs ${valB}`);
                    return (valA - valB) * multiplier;
                }
                if (columnConfig.type === 'ip') {
                    console.log(`DEBUG:: Compare IPs: ${valA} vs ${valB}`);
                    return compareIP(valA, valB) * multiplier;
                }
                if (columnConfig.type === 'string' || columnConfig.type === 'country') {
                    valA = (valA || '').toString().toLowerCase();
                    valB = (valB || '').toString().toLowerCase();
                    console.log(`DEBUG:: Compare strings: ${valA} vs ${valB} for ${column}`);
                    return valA.localeCompare(valB) * multiplier;
                }
                console.log(`DEBUG:: Compare default: ${valA} vs ${valB}`);
                return String(valA).localeCompare(String(valB)) * multiplier;
            });
        } catch (e) {
            console.error('DEBUG:: Sort failed! Fallback to unsorted. →', e);
            return data;
        }
    }

    function renderTable(data) {
        mainTbody.innerHTML = '';
        let html = [];

        if (config.enablePagination) {
            const limitInput = document.querySelector('input[name="limit"]');
            if (limitInput && limitInput.value) {
                state.rowsPerPage = parseInt(limitInput.value) || 10;
                config.limit = state.rowsPerPage;
                console.log('DEBUG:: Updated rowsPerPage from form input:', state.rowsPerPage);
            } else if (config.limit > 0) {
                state.rowsPerPage = config.limit;
            } else {
                state.rowsPerPage = 10;
            }
        } else {
            state.rowsPerPage = 0;
        }

        let paginatedData = data;
        let totalPages = 1;
        if (config.enablePagination && state.rowsPerPage > 0) {
            const start = (state.currentPage - 1) * state.rowsPerPage;
            const end = start + state.rowsPerPage;
            paginatedData = data.slice(start, end);
            totalPages = Math.ceil(data.length / state.rowsPerPage);
        }

        paginatedData.forEach(item => {
            let row = '<tr>';
            config.columns.forEach(col => {
                let value = item[col.key] || '';
                let extra = {
                    country: item[
                        col.key === 'src_flag_icon' ? 'src_country' :
                        col.key === 'dst_flag_icon' ? 'dst_country' :
                        col.key === 'key_flag_icon' ? item.key : ''
                    ],
                    colour: item[
                        col.key === 'src_ip' ? 'src_colour' :
                        col.key === 'dst_ip' ? 'dst_colour' :
                        col.key === 'key' ? 'key_colour' :
                        col.key === 'key_flag_icon' ? 'key_colour' : ''
                    ],
                    key: item.key,
                    day: config.day,
                    month: config.month,
                    group: config.group
                };
                value = formatValue(value, col.type, extra);
                const align = col.type === 'number' || col.type === 'bytes' || col.type === 'percent' ? 'text-right' : col.type === 'flag' || col.type === 'details' ? 'text-center' : 'text-left';
                let style = '';
                let cellColour = item[col.key + '_colour'] || item.zone_colour || '';
                if (cellColour && col.type !== 'details') {
                    style = `style="background:${cellColour};color:#fff;"`;
                }
                row += `<td class="${align}" ${style}>${value}</td>`;
            });
            row += '</tr>';
            html.push(row);
        });

        mainTbody.innerHTML = html.join('');
        console.log('DEBUG:: Rendered table rows:', paginatedData.length, 'HTML:', mainTbody.innerHTML.substring(0, 100) + '...');
        mainTbody.style.display = 'table-row-group';
        mainTbody.style.visibility = 'visible';
        mainTbody.parentElement.style.display = 'table';
        console.log('DEBUG:: Forced visibility for mainTbody and table');

        setTimeout(() => {
            if (mainTbody.innerHTML.includes('Loading') || mainTbody.innerHTML === '') {
                console.error('DEBUG:: mainTbody reverted to placeholder or empty:', mainTbody.innerHTML.substring(0, 100) + '...');
            } else {
                console.log('DEBUG:: mainTbody render verified:', mainTbody.innerHTML.substring(0, 100) + '...');
            }
        }, 1000);

        const rowCount = document.querySelector('#row_count');
        if (rowCount) {
            if (config.enablePagination && state.rowsPerPage > 0) {
                rowCount.textContent = `(${data.length} ${config.countLabel}, Page ${state.currentPage} of ${totalPages})`;
            } else {
                rowCount.textContent = `(${data.length} ${config.countLabel})`;
            }
        }

        if (config.enablePagination && state.rowsPerPage > 0) {
            renderPagination(data.length);
        } else {
            const paginationContainer = document.querySelector('#pagination');
            if (paginationContainer) paginationContainer.innerHTML = '';
        }

        // Initialize clickable rows for hardware details
        if (config.clickableRows) {
            mainTbody.querySelectorAll('tr').forEach(row => {
                const resource = row.cells[0]?.textContent.toLowerCase();
                if (config.clickableRows.includes(resource)) {
                    row.style.cursor = 'pointer';
                    row.addEventListener('click', () => {
                        const endpoint = config.detailEndpoints[resource];
                        if (endpoint) {
                            fetch(endpoint, { cache: 'no-cache' })
                                .then(response => response.json())
                                .then(data => showDetailsModal(resource, data))
                                .catch(error => {
                                    console.error(`DEBUG:: Failed to fetch details for ${resource}:`, error);
                                    document.querySelector('#error_msg').textContent = `Error loading ${resource} details: ${error.message}`;
                                    document.querySelector('#error_msg').style.display = 'block';
                                });
                        }
                    });
                }
            });
        }
    }

    function showDetailsModal(resource, data) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        let html = `<div class="modal-content"><h2>${resource.toUpperCase()} Details</h2><table class="tbl"><thead><tr>`;
        if (resource === 'network') {
            html += `<th>Interface</th><th>IP</th><th>RX (MB/s)</th><th>TX (MB/s)</th>`;
        } else {
            html += `<th>PID</th><th>Command</th><th>${resource === 'cpu' ? 'CPU (%)' : 'Memory'}</th>`;
        }
        html += `</tr></thead><tbody>`;
        data.forEach(row => {
            html += `<tr>`;
            if (resource === 'network') {
                html += `<td>${row.if}</td><td>${row.ip || '-'}</td><td>${row.rx_rate || '-'}</td><td>${row.tx_rate || '-'}</td>`;
            } else {
                html += `<td>${row.pid}</td><td>${row.command}</td><td>${resource === 'cpu' ? row.cpu : row.mem}</td>`;
            }
            html += `</tr>`;
        });
        html += `</tbody></table><button onclick="this.parentElement.parentElement.remove()">Close</button></div>`;
        modal.innerHTML = html;
        document.body.appendChild(modal);
    }

    function renderPagination(totalRows) {
        if (!config.enablePagination || state.rowsPerPage <= 0) return;
        const paginationContainer = document.querySelector('#pagination');
        if (!paginationContainer) {
            console.error('ERROR:: #pagination container not found for main table');
            return;
        }
        const totalPages = Math.ceil(totalRows / state.rowsPerPage);
        paginationContainer.innerHTML = `
            <button id="main_prev_page" ${state.currentPage === 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${state.currentPage} of ${totalPages}</span>
            <button id="main_next_page" ${state.currentPage === totalPages ? 'disabled' : ''}>Next</button>
        `;
        console.log(`DEBUG:: Rendered main pagination: Page ${state.currentPage} of ${totalPages}`);
        const prevButton = paginationContainer.querySelector('#main_prev_page');
        const nextButton = paginationContainer.querySelector('#main_next_page');
        prevButton?.removeEventListener('click', state.mainPrevHandler);
        nextButton?.removeEventListener('click', state.mainNextHandler);
        state.mainPrevHandler = () => changePage(state.currentPage - 1);
        state.mainNextHandler = () => changePage(state.currentPage + 1);
        prevButton?.addEventListener('click', state.mainPrevHandler);
        nextButton?.addEventListener('click', state.mainNextHandler);
    }

    function createPaginationContainer(tableSelector) {
        const table = document.querySelector(tableSelector);
        if (!table) {
            console.error(`ERROR:: Table not found at selector '${tableSelector}' for pagination`);
            return null;
        }
        const div = document.createElement('div');
        div.id = tableSelector.includes('raw_logs_table') ? 'raw_pagination' : 'pagination';
        div.style.marginTop = '1em';
        div.style.textAlign = 'center';
        table.after(div);
        return div;
    }

    function renderRawLogs(data) {
        if (!rawLogsTbody) {
            console.error(`DEBUG:: ${config.rawTableSelector} not found in DOM`);
            return;
        }
        const rawLimitInput = document.querySelector('input[name="raw_limit"]');
        state.rawRowsPerPage = rawLimitInput && rawLimitInput.value && parseInt(rawLimitInput.value) > 0 ? parseInt(rawLimitInput.value) : 50;
        const start = (state.rawCurrentPage - 1) * state.rawRowsPerPage;
        const end = start + state.rawRowsPerPage;
        const paginatedData = data.slice(start, end).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        let html = [];
        paginatedData.forEach(item => {
            let row = '<tr>';
            const columns = [
                { key: 'timestamp', title: 'Timestamp', type: 'string' },
                { key: 'src_ip', title: 'SRC', type: 'ip' },
                { key: 'src_port', title: 'SPT', type: 'port' },
                { key: 'in', title: 'IN', type: 'string' },
                { key: 'dst_ip', title: 'DST', type: 'ip' },
                { key: 'dst_port', title: 'DPT', type: 'port' },
                { key: 'out', title: 'OUT', type: 'string' },
                { key: 'protocol', title: 'Protocol', type: 'string' },
                { key: 'src_flag_icon', title: 'Flag', type: 'flag' },
                { key: 'action', title: 'Action', type: 'string' }
            ];
            columns.forEach(col => {
                let value = item[col.key] || '';
                let extra = {
                    country: item[col.key === 'src_flag_icon' ? 'src_country' : 'dst_country'],
                    colour: item[
                        col.key === 'src_ip' ? 'src_zone_colour' :
                        col.key === 'src_port' ? 'src_zone_colour' :
                        col.key === 'dst_ip' ? 'dst_zone_colour' :
                        col.key === 'dst_port' ? 'dst_zone_colour' : ''
                    ],
                    key: item[
                        col.key === 'src_ip' ? 'src_ip' :
                        col.key === 'dst_ip' ? 'dst_ip' :
                        col.key === 'src_flag_icon' ? 'src_country' : ''
                    ],
                    day: config.day,
                    month: config.month,
                    group: col.key === 'src_ip' ? 'ip' : col.key === 'dst_ip' ? 'ip' : col.key === 'src_flag_icon' ? 'country' : ''
                };
                value = formatValue(value, col.type, extra);
                const align = col.type === 'flag' ? 'text-center' : 'text-left';
                let style = '';
                if (col.key === 'src_ip' && item.src_zone_colour) style = `style="background:${item.src_zone_colour};color:#fff;"`;
                else if (col.key === 'src_port' && item.src_zone_colour) style = `style="background:${item.src_zone_colour};color:#fff;"`;
                else if (col.key === 'dst_ip' && item.dst_zone_colour) style = `style="background:${item.dst_zone_colour};color:#fff;"`;
                else if (col.key === 'dst_port' && item.dst_zone_colour) style = `style="background:${item.dst_zone_colour};color:#fff;"`;
                else if (col.key === 'action') style = value.includes('DROP') ? `style="background:#993333;color:#fff;"` : value.includes('ACCEPT') ? `style="background:#339933;color:#fff;"` : '';
                row += `<td class="${align}" ${style}>${value}</td>`;
            });
            row += '</tr>';
            html.push(row);
        });

        rawLogsTbody.innerHTML = html.length > 0 ? html.join('') : '<tr><td colspan="10" style="text-align:center;">No recent logs available</td></tr>';
        console.log('DEBUG:: Rendered raw logs rows:', paginatedData.length, 'HTML:', rawLogsTbody.innerHTML.substring(0, 100) + '...');
        rawLogsTbody.style.display = 'table-row-group';
        rawLogsTbody.style.visibility = 'visible';
        rawLogsTbody.parentElement.style.display = 'table';
        console.log('DEBUG:: Forced visibility for raw_logs_table tbody and table');

        const rowCount = document.querySelector('#row_count');
        if (rowCount) {
            const totalPages = Math.ceil(data.length / state.rawRowsPerPage);
            rowCount.textContent = `(${data.length} ${config.countLabel}, Page ${state.rawCurrentPage} of ${totalPages})`;
        }

        renderRawPagination(data.length);
    }

    function renderRawPagination(totalRows) {
        if (!config.hasRawLogs || !rawPaginationContainer) {
            console.error('DEBUG:: rawPaginationContainer not initialized or hasRawLogs is false');
            return;
        }
        const totalPages = Math.ceil(totalRows / state.rawRowsPerPage);
        rawPaginationContainer.innerHTML = `
            <button id="raw_prev_page" ${state.rawCurrentPage === 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${state.rawCurrentPage} of ${totalPages}</span>
            <button id="raw_next_page" ${state.currentPage === totalPages ? 'disabled' : ''}>Next</button>
        `;
        console.log(`DEBUG:: Rendered raw pagination: Page ${state.rawCurrentPage} of ${totalPages}`);
        const prevButton = rawPaginationContainer.querySelector('#raw_prev_page');
        const nextButton = rawPaginationContainer.querySelector('#raw_next_page');
        prevButton?.removeEventListener('click', state.rawPrevHandler);
        nextButton?.removeEventListener('click', state.rawNextHandler);
        state.rawPrevHandler = () => changeRawPage(state.rawCurrentPage - 1);
        state.rawNextHandler = () => changeRawPage(state.rawCurrentPage + 1);
        prevButton?.addEventListener('click', state.rawPrevHandler);
        nextButton?.addEventListener('click', state.rawNextHandler);
    }

    function populateDropdowns(interfaces, actions) {
        const interfaceSelect = document.querySelector('select[name="search_interface"]');
        const actionSelect = document.querySelector('select[name="search_action"]');
        if (interfaceSelect) {
            const currentValue = interfaceSelect.value;
            interfaceSelect.innerHTML = '<option value="">Any Interface</option>';
            interfaces.forEach(iface => {
                if (iface) {
                    const option = document.createElement('option');
                    option.value = iface;
                    option.textContent = iface;
                    if (iface === currentValue) option.selected = true;
                    interfaceSelect.appendChild(option);
                }
            });
            console.log('DEBUG:: Populated interface dropdown with:', interfaces);
        }
        if (actionSelect) {
            const currentValue = actionSelect.value;
            actionSelect.innerHTML = '<option value="">Any Action</option>';
            actions.forEach(action => {
                if (action) {
                    const option = document.createElement('option');
                    option.value = action;
                    option.textContent = action;
                    if (action === currentValue) option.selected = true;
                    actionSelect.appendChild(option);
                }
            });
            console.log('DEBUG:: Populated action dropdown with:', actions);
        }
    }

    async function updateActions() {
        const interfaceSelect = document.querySelector('select[name="search_interface"]');
        const searchInterface = interfaceSelect ? interfaceSelect.value : '';
        const params = { json: 1, group: config.group, limit: config.limit, day: config.day, month: config.month + 1, year: config.year, search_interface: searchInterface };
        const queryString = new URLSearchParams(params).toString();
        const url = `${config.endpoint}${config.endpoint.includes('?') ? '&' : '?'}${queryString}`;
        console.log('DEBUG:: Fetching actions for interface:', searchInterface, 'URL:', url);
        try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
            const data = await response.json();
            console.log('DEBUG:: Received data for actions update:', data);
            populateDropdowns(data.interfaces || [], data.actions || []);
        } catch (error) {
            console.error('DEBUG:: Failed to fetch actions:', error);
            document.querySelector('#error_msg').textContent = `Error loading actions: ${error.message}`;
            document.querySelector('#error_msg').style.display = 'block';
        }
    }

    window.resetSearchFields = function () {
        if (!searchForm) return;
        searchForm.reset();
        searchFields.style.display = 'none';
        if (searchToggle) searchToggle.checked = false;
        document.querySelector('input[name="raw_limit"]').value = 50;
        document.querySelector('input[name="limit"]').value = 50;
        document.querySelectorAll('input[name="zone"], input[name="zone[]"]').forEach(input => input.checked = false);
        state.rawCurrentPage = 1;
        state.currentPage = 1;
        state.modifiedFields.clear();
        updateTable('reset');
    };

    if (config.hasRawLogs && searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(searchForm);
            const params = { json: 1, raw_logs: 1, group: config.group, limit: config.limit, day: config.day, month: config.month + 1, year: config.year };
            let hasValidInput = false;
            formData.forEach((value, key) => {
                if (['raw_limit', 'search_ip', 'ip', 'search_port', 'port', 'search_protocol', 'protocol', 'search_interface', 'search_action', 'zone'].includes(key) && value) {
                    params[key] = value;
                    hasValidInput = true;
                    state.modifiedFields.add(key);
                }
                if (['day', 'month', 'year'].includes(key) && value) {
                    params[key] = value;
                    state.modifiedFields.add(key);
                    hasValidInput = true;
                }
            });
            if (!hasValidInput) {
                console.log('DEBUG:: Search form submitted with no valid inputs, skipping fetch');
                return;
            }
            params.search_enabled = 1;
            const queryString = new URLSearchParams(params).toString();
            const url = `${config.endpoint}${config.endpoint.includes('?') ? '&' : '?'}${queryString}`;
            console.log('DEBUG:: Search form submitted, fetching:', url);
            fetch(url, { cache: 'no-cache' })
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
                    return response.json();
                })
                .then(data => {
                    console.log('DEBUG:: Search data received:', data);
                    if (rawLogsTbody) {
                        state.rawLogsData = Array.isArray(data) ? data : (data.raw_logs || []);
                        state.rawCurrentPage = 1;
                        renderRawLogs(state.rawLogsData);
                        console.log('DEBUG:: Raw logs HTML set:', rawLogsTbody.innerHTML.substring(0, 100) + '...');
                    }
                    document.querySelector('#error_msg').style.display = 'none';
                })
                .catch(error => {
                    console.error('DEBUG:: Search request failed:', error);
                    document.querySelector('#error_msg').textContent = `Search error: ${error.message}`;
                    document.querySelector('#error_msg').style.display = 'block';
                    if (rawLogsTbody) rawLogsTbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Error loading raw logs</td></tr>';
                });
        });
    }

    async function fetchGroupedData(params) {
        const queryString = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) value.forEach(val => queryString.append(key, val));
            else if (value !== '' && value !== undefined && value !== null) queryString.append(key, value);
        }
        const url = `${config.endpoint}${config.endpoint.includes('?') ? '&' : '?'}${queryString.toString()}`;
        console.log('DEBUG:: Fetching grouped data →', url);
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        return await response.json();
    }

    async function fetchRawLogs(params) {
        const queryString = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) value.forEach(val => queryString.append(key, val));
            else if (value !== '' && value !== undefined && value !== null) queryString.append(key, value);
        }
        const url = `${config.endpoint}${config.endpoint.includes('?') ? '&' : '?'}${queryString.toString()}`;
        console.log('DEBUG:: Fetching raw logs →', url);
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        return await response.json();
    }

    async function updateTable(changedField) {
        if (state.isFetching) {
            console.log('DEBUG:: Fetch already in progress, skipping');
            return;
        }
        const now = Date.now();
        if (now - state.lastFetchTime < state.debounceDelay) {
            console.log(`DEBUG:: Debouncing fetch, waiting ${state.debounceDelay - (now - state.lastFetchTime)}ms`);
            setTimeout(() => updateTable(changedField), state.debounceDelay - (now - state.lastFetchTime));
            return;
        }
        state.isFetching = true;
        state.lastFetchTime = now;

        const rawLogFields = ['raw_limit', 'search_ip', 'ip', 'search_port', 'port', 'search_protocol', 'protocol', 'search_interface', 'search_action', 'zone', 'day', 'month', 'year'];
        const zoneInputs = document.querySelectorAll('input[name="zone"], input[name="zone[]"]');
        const zones = Array.from(zoneInputs).filter(input => input.checked && input.value).map(input => input.value);
        const hasActiveRawFilters = rawLogFields.some(field => {
            if (field === 'zone') return zones.length > 0;
            const input = document.querySelector(`[name="${field}"]`);
            return input && input.value && state.modifiedFields.has(field);
        });
        const updateRawLogs = config.hasRawLogs && rawLogsTbody && (changedField === undefined || (rawLogFields.includes(changedField) && state.modifiedFields.has(changedField)) || hasActiveRawFilters);
        console.log(`DEBUG:: updateRawLogs evaluated: ${updateRawLogs} (hasRawLogs=${config.hasRawLogs}, rawLogsTbody=${!!rawLogsTbody}, changedField=${changedField}, in rawLogFields=${rawLogFields.includes(changedField)}, modified=${state.modifiedFields.has(changedField)}, hasActiveRawFilters=${hasActiveRawFilters}, modifiedFields=`, [...state.modifiedFields]);

        try {
            const params = { json: 1, group: config.group, limit: state.rowsPerPage > 0 ? state.rowsPerPage : undefined, day: config.day, month: config.month + 1, year: config.year };
            document.querySelectorAll('.filter-field, input[name="zone"], input[name="zone[]"]').forEach(input => {
                const name = input.name;
                if (input.tagName === 'SELECT' && input.value) params[name] = input.value;
                else if (input.type === 'checkbox' && name !== 'zone' && name !== 'zone[]') params[name] = input.checked ? 1 : 0;
                else if (name !== 'zone' && name !== 'zone[]' && input.value) params[name] = input.value;
                if (input.value || input.checked) state.modifiedFields.add(name);
            });
            if (zones.length > 0) {
                params.zone = zones;
                params.search_enabled = 1;
            }
            if (params.search_ip || params.ip || params.search_port || params.port || params.search_interface || params.search_action || params.search_protocol || params.protocol || zones.length > 0) {
                params.search_enabled = 1;
            }

            // Fetch grouped data
            const groupedData = await fetchGroupedData(params);
            state.tableData = Array.isArray(groupedData) ? groupedData : (groupedData.grouped || groupedData.data || []);
            if (groupedData.interfaces && groupedData.actions) populateDropdowns(groupedData.interfaces, groupedData.actions);
            if (groupedData.limit) config.limit = parseInt(groupedData.limit);
            state.tableData = sortData(state.tableData);
            renderTable(state.tableData);

            // Fetch raw logs if needed
            if (updateRawLogs) {
                rawLogsTbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Loading raw logs...</td></tr>';
                params.raw_limit = document.querySelector('input[name="raw_limit"]')?.value || 50;
                params.raw_logs = 1;
                const rawData = await fetchRawLogs(params);
                state.rawLogsData = Array.isArray(rawData) ? rawData : (rawData.raw_logs || []);
                renderRawLogs(state.rawLogsData);
            } else if (state.rawLogsData.length > 0) {
                console.log('DEBUG:: Reusing existing rawLogsData, length:', state.rawLogsData.length);
                renderRawLogs(state.rawLogsData);
            }

            document.querySelector('#error_msg').style.display = 'none';

            // Schedule next refresh
            if (config.refreshInterval > 0) {
                clearTimeout(state.refreshTimer);
                state.refreshTimer = setTimeout(() => updateTable('refresh_interval'), config.refreshInterval);
                console.log(`DEBUG:: Scheduled next update in ${config.refreshInterval}ms`);
            }
        } catch (error) {
            console.error('DEBUG:: Fetch failed:', error);
            document.querySelector('#error_msg').textContent = `Error loading data: ${error.message}`;
            document.querySelector('#error_msg').style.display = 'block';
            mainTbody.innerHTML = `<tr><td colspan="${config.columns.length}" style="text-align:center;">Error loading data</td></tr>`;
            if (rawLogsTbody && updateRawLogs) rawLogsTbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Error loading raw logs</td></tr>';
        } finally {
            state.isFetching = false;
        }
    }

    window.changePage = function (page) {
        if (!config.enablePagination || state.rowsPerPage <= 0) return;
        if (page < 1 || page > Math.ceil(state.tableData.length / state.rowsPerPage)) return;
        state.currentPage = page;
        renderTable(state.tableData);
    };

    window.changeRawPage = function (page) {
        if (!config.hasRawLogs) return;
        const totalPages = Math.ceil(state.rawLogsData.length / state.rawRowsPerPage);
        if (page < 1 || page > totalPages) {
            console.warn(`DEBUG:: Invalid page ${page}, must be between 1 and ${totalPages}`);
            return;
        }
        state.rawCurrentPage = page;
        console.log(`DEBUG:: Changing raw logs page to ${state.rawCurrentPage}`);
        renderRawLogs(state.rawLogsData);
    };

    // Event listeners
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const column = th.getAttribute('data-sort');
            if (!state.sortStates[column]) return;
            console.log(`%cDEBUG:: Sorting column: ${column}, current state: ${state.sortStates[column]}`, 'color: purple');
            Object.keys(state.sortStates).forEach(key => {
                if (key !== column) state.sortStates[key] = 'none';
            });
            state.sortStates[column] = state.sortStates[column] === 'none' || state.sortStates[column] === 'down' ? 'up' : 'down';
            state.sortOrder = [{ column, direction: state.sortStates[column] === 'up' ? 'asc' : 'desc' }];
            state.tableData = sortData(state.tableData);
            renderTable(state.tableData);
        });
    });

    const refreshSelect = document.querySelector('#refresh_interval');
    if (refreshSelect) {
        refreshSelect.addEventListener('change', () => {
            config.refreshInterval = parseInt(refreshSelect.value) * 1000;
            console.log('DEBUG:: Refresh interval changed to:', config.refreshInterval);
            clearTimeout(state.refreshTimer);
            if (config.refreshInterval > 0) {
                state.refreshTimer = setTimeout(() => updateTable('refresh_interval'), config.refreshInterval);
                console.log(`DEBUG:: Scheduled first update in ${config.refreshInterval}ms`);
            }
        });
        // Trigger initial refresh if interval is set
        if (refreshSelect.value && parseInt(refreshSelect.value) > 0) {
            config.refreshInterval = parseInt(refreshSelect.value) * 1000;
            state.refreshTimer = setTimeout(() => updateTable('refresh_interval'), config.refreshInterval);
            console.log(`DEBUG:: Initial refresh interval set to ${config.refreshInterval}ms`);
        }
    }

    document.querySelectorAll('.filter-field, input[name="zone"], input[name="zone[]"]').forEach(input => {
        input.addEventListener('change', () => {
            console.log(`DEBUG:: Filter changed: ${input.name}=${input.value || input.checked}`);
            state.currentPage = 1;
            config.group = input.name === 'group' ? input.value : config.group;
            state.modifiedFields.add(input.name);
            updateTable(input.name);
        });
    });

    // Initial render
    updateTable();
});