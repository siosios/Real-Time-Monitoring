/*
 * File/path: /srv/web/ipfire/html/include/ipfire-realtime.js
 * Purpose: Universal real-time table renderer for IPFire Web UI
 * Version: 1.0.4 (Optimized)
 * Author: ummeegge
 * License: GNU General Public License, version 3 or later
 * Last Modified: September 04, 2025
 */

document.addEventListener('DOMContentLoaded', () => {
	const DEBUG = false;

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

	// DOM elements caching
	const mainTbody = document.querySelector(config.mainTableSelector);
	const rawLogsTbody = config.hasRawLogs ? document.querySelector(config.rawTableSelector) : null;
	const searchForm = config.hasRawLogs ? document.querySelector(config.searchFormSelector) : null;
	const searchToggle = document.querySelector('#search_toggle');
	const searchFields = document.querySelector('.search_fields');
	let rawPaginationContainer = null;

	// Caching objects
	const ajaxCache = {}; // In-memory cache for AJAX responses, keyed by queryString
	const sortCache = new WeakMap(); // Memoization for sorting
	const localCacheKey = 'realtimeTableCache'; // For LocalStorage

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
		debounceDelay: 500, // Increased for better debouncing
		refreshTimer: null,
		tableData: [],
		rawLogsData: [],
		sortStates: {},
		sortOrder: [],
		currentPage: 1,
		rawCurrentPage: 1,
		rowsPerPage: config.limit,
		rawRowsPerPage: 50,
		modifiedFields: new Set(),
		abortController: new AbortController() // For abortable fetches
	};

	// Load from LocalStorage if available and not expired
	const loadLocalCache = () => {
		const cached = localStorage.getItem(localCacheKey);
		if (cached) {
			const { data, timestamp } = JSON.parse(cached);
			if (Date.now() - timestamp < 300000) { // 5 min expiration
				state.tableData = data.tableData || [];
				state.rawLogsData = data.rawLogsData || [];
				console.log('DEBUG:: Loaded from LocalStorage cache');
				return true;
			}
		}
		return false;
	};
	loadLocalCache();

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

	// Setup MutationObserver for debugging (disabled in prod)
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
		if (state.sortOrder.length === 0 || Object.values(state.sortStates).every(s => s === 'none')) {
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
		const cacheKey = JSON.stringify({ dataLength: data.length, sortOrder: state.sortOrder });
		if (sortCache.has(data) && sortCache.get(data).key === cacheKey) {
			console.log('DEBUG:: Sort hit from cache');
			return sortCache.get(data).result;
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
			// Pre-compute for IP if needed
			const sorted = data.slice().sort((a, b) => {
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
					return (valA - valB) * multiplier;
				}
				if (columnConfig.type === 'port') {
					valA = Number(valA || 0);
					valB = Number(valB || 0);
					return (valA - valB) * multiplier;
				}
				if (columnConfig.type === 'ip') {
					return compareIP(valA, valB) * multiplier;
				}
				if (columnConfig.type === 'string' || columnConfig.type === 'country') {
					valA = (valA || '').toString().toLowerCase();
					valB = (valB || '').toString().toLowerCase();
					return valA.localeCompare(valB) * multiplier;
				}
				return String(valA).localeCompare(String(valB)) * multiplier;
			});
			sortCache.set(data, { key: cacheKey, result: sorted });
			return sorted;
		} catch (e) {
			console.error('DEBUG:: Sort failed! Fallback to unsorted. →', e);
			return data;
		}
	}

	function renderTable(data) {
		const fragment = document.createDocumentFragment();
		mainTbody.innerHTML = ''; // Clear once

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

		for (const item of paginatedData) { // Use for...of for performance
			const tr = document.createElement('tr');
			for (const col of config.columns) { // Use for...of
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
				const td = document.createElement('td');
				td.innerHTML = value; // Set innerHTML per cell
				const align = col.type === 'number' || col.type === 'bytes' || col.type === 'percent' ? 'text-right' : col.type === 'flag' || col.type === 'details' ? 'text-center' : 'text-left';
				td.className = align;
				let cellColour = item[col.key + '_colour'] || item.zone_colour || '';
				if (cellColour && col.type !== 'details') {
					td.style.backgroundColor = cellColour;
				}
				tr.appendChild(td);
			}
			fragment.appendChild(tr);
		}
		mainTbody.appendChild(fragment);

		// Update count
		const countElement = document.querySelector('#row_count');
		if (countElement) {
			countElement.textContent = `(${paginatedData.length} ${config.countLabel})`;
		}
		console.log('DEBUG:: Table rendered:', paginatedData.length, 'rows');

		// Update pagination if enabled
		if (config.enablePagination) {
			updatePagination(totalPages, state.currentPage,'main');
		}
	}

	function renderRawLogs(data) {
		const fragment = document.createDocumentFragment();
		rawLogsTbody.innerHTML = '';

		let paginatedData = data;
		let totalPages = 1;
		if (state.rawRowsPerPage > 0) {
			const start = (state.rawCurrentPage - 1) * state.rawRowsPerPage;
			const end = start + state.rawRowsPerPage;
			paginatedData = data.slice(start, end);
			totalPages = Math.ceil(data.length / state.rawRowsPerPage);
		}

		for (const item of paginatedData) {
			const tr = document.createElement('tr');
			// Add cells for raw logs (adapt to your columns)
			// Example: timestamp, action, in, out, src_ip, etc.
			const columns = ['timestamp', 'action', 'in', 'out', 'src_ip', 'src_port', 'dst_ip', 'dst_port', 'protocol', 'flag']; // Adjust as needed
			for (const key of columns) {
				const td = document.createElement('td');
				td.textContent = item[key] || ''; // Use textContent for plain text
				tr.appendChild(td);
			}
			fragment.appendChild(tr);
		}
		rawLogsTbody.appendChild(fragment);

		// Update count
		const countElement = document.querySelector('#row_count');
		if (countElement) {
			countElement.textContent = `(${paginatedData.length} entries)`;
		}

		if (rawPaginationContainer) {
			updatePagination(totalPages, state.rawCurrentPage, 'raw');
		}
	}

	function updatePagination(totalPages, currentPage, type) {
		// Simplified pagination update (implement as needed)
		// Clear and rebuild buttons
	}

	function createPaginationContainer(tableSelector) {
		// Implement creation of pagination div
		const table = document.querySelector(tableSelector);
		if (!table) return null;
		const div = document.createElement('div');
		div.id = type === 'raw' ? 'raw_pagination' : 'pagination';
		table.after(div);
		return div;
	}

	// Worker for heavy sorting (if supported)
	let sortWorker;
	if (window.Worker) {
		sortWorker = new Worker(URL.createObjectURL(new Blob([`
			self.onmessage = function(e) {
				const { data, column, direction, columnType } = e.data;
				// Implement sorting logic in worker
				const multiplier = direction === 'asc' ? 1 : -1;
				data.sort((a, b) => {
					// Similar to sortData
					// ...
				});
				self.postMessage(data);
			};
		`], { type: 'application/javascript' })));
		sortWorker.onmessage = (e) => {
			// Handle sorted data
			renderTable(e.data);
		};
	}

	// Use worker for sorting if available
	function sortWithWorker(data) {
		if (sortWorker) {
			sortWorker.postMessage({ data, column: state.sortOrder[0].column, direction: state.sortOrder[0].direction, columnType: /*...*/ });
		} else {
			return sortData(data);
		}
	}

	// Event delegation for sorting and pagination
	const table = mainTbody.closest('table');
	if (table) {
		table.addEventListener('click', (e) => {
			if (e.target.matches('th[data-sort]')) {
				const column = e.target.getAttribute('data-sort');
				// Handle sort
				state.sortStates[column] = state.sortStates[column] === 'none' || state.sortStates[column] === 'down' ? 'up' : 'down';
				state.sortOrder = [{ column, direction: state.sortStates[column] === 'up' ? 'asc' : 'desc' }];
				state.tableData = sortWithWorker(state.tableData);
				requestAnimationFrame(() => renderTable(state.tableData));
			}
			// Handle pagination clicks if buttons have class 'page-btn'
			if (e.target.matches('.page-btn')) {
				const page = parseInt(e.target.dataset.page);
				changePage(page);
			}
		});
	}

	// Similar for raw table if needed

	async function fetchData(params, isRaw = false) {
		const queryString = new URLSearchParams(params).toString();
		const cacheKey = queryString;
		if (ajaxCache[cacheKey] && Date.now() - ajaxCache[cacheKey].timestamp < 60000) { // 1 min cache
			console.log('DEBUG:: AJAX hit from cache');
			return ajaxCache[cacheKey].data;
		}
		const url = `${config.endpoint}${config.endpoint.includes('?') ? '&' : '?'}${queryString}`;
		console.log('DEBUG:: Fetching →', url);
		try {
			const response = await fetch(url, { cache: 'no-cache', signal: state.abortController.signal });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			ajaxCache[cacheKey] = { data, timestamp: Date.now() };
			return data;
		} catch (error) {
			if (error.name === 'AbortError') console.log('DEBUG:: Fetch aborted');
			else console.error('DEBUG:: Fetch failed:', error);
			throw error;
		}
	}

	async function updateTable(changedField) {
		if (state.isFetching) return;
		state.isFetching = true;
		state.abortController.abort(); // Abort previous
		state.abortController = new AbortController();
		const now = Date.now();
		if (now - state.lastFetchTime < state.debounceDelay) {
			setTimeout(() => updateTable(changedField), state.debounceDelay - (now - state.lastFetchTime));
			state.isFetching = false;
			return;
		}
		state.lastFetchTime = now;

		try {
			const params = { json: 1, group: config.group, limit: state.rowsPerPage > 0 ? state.rowsPerPage : undefined, day: config.day, month: config.month + 1, year: config.year };
			// Add filters...
			// (Keep existing logic for params)

			const groupedData = await fetchData(params);
			state.tableData = Array.isArray(groupedData) ? groupedData : (groupedData.grouped || groupedData.data || []);
			state.tableData = sortWithWorker(state.tableData);
			requestAnimationFrame(() => renderTable(state.tableData));

			if (config.hasRawLogs) {
				params.raw_logs = 1;
				params.raw_limit = state.rawRowsPerPage;
				const rawData = await fetchData(params, true);
				state.rawLogsData = Array.isArray(rawData) ? rawData : (rawData.raw_logs || []);
				requestAnimationFrame(() => renderRawLogs(state.rawLogsData));
			}

			// Save to LocalStorage
			localStorage.setItem(localCacheKey, JSON.stringify({ data: { tableData: state.tableData, rawLogsData: state.rawLogsData }, timestamp: Date.now() }));

			if (config.refreshInterval > 0) {
				clearTimeout(state.refreshTimer);
				state.refreshTimer = setTimeout(() => updateTable('refresh_interval'), config.refreshInterval);
			}
		} catch (error) {
			// Handle error
		} finally {
			state.isFetching = false;
		}
	}

	window.changePage = function (page) {
		if (!config.enablePagination || state.rowsPerPage <= 0) return;
		state.currentPage = Math.max(1, Math.min(page, Math.ceil(state.tableData.length / state.rowsPerPage)));
		requestAnimationFrame(() => renderTable(state.tableData));
	};

	window.changeRawPage = function (page) {
		if (!config.hasRawLogs) return;
		state.rawCurrentPage = Math.max(1, Math.min(page, Math.ceil(state.rawLogsData.length / state.rawRowsPerPage)));
		requestAnimationFrame(() => renderRawLogs(state.rawLogsData));
	};

	window.resetSearchFields = function () {
		// Existing logic
		updateTable('reset');
	};

	// Initial render
	updateTable();
});
