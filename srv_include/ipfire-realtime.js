/*
 * File/path: /srv/web/ipfire/html/include/ipfire-realtime.js
 * Purpose: Universal real-time table renderer for IPFire Web UI
 * Version: 1.0.5
 * Author: ummeegge
 * License: GNU General Public License, version 3 or later
 * Last Modified: September 4, 2025
 */

/**
 * Configuration object for real-time table rendering
 * @typedef {Object} RealtimeConfig
 * @property {string} endpoint - API endpoint URL
 * @property {string} [rawTableSelector='#raw_logs_table tbody'] - Selector for raw logs table body
 * @property {string} [searchFormSelector='#zone_form'] - Selector for search form
 * @property {string} [mainTableSelector='.tbl tbody'] - Selector for main table body
 * @property {string} [group='ip'] - Grouping parameter
 * @property {number} [day] - Day for data filtering
 * @property {number} [month] - Month for data filtering
 * @property {number} [year] - Year for data filtering
 * @property {number} [limit=10] - Limit for rows per page
 * @property {boolean} [hasRawLogs=false] - Enable raw logs
 * @property {boolean} [enablePagination=false] - Enable pagination
 * @property {number} [refreshInterval=0] - Refresh interval in seconds
 * @property {Object[]} columns - Array of column configurations
 * @property {string} columns[].key - Column data key
 * @property {string} columns[].type - Data type (e.g., 'ip', 'port', 'bytes')
 * @property {Object} [defaultSort] - Default sort configuration
 * @property {string} defaultSort.column - Column to sort by
 * @property {string} defaultSort.direction - 'asc' or 'desc'
 * @property {string} countLabel - Label for row count
 * @property {string[]} [clickableRows] - Resources for clickable rows
 * @property {Object} [detailEndpoints] - Endpoints for details
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
		refreshInterval: parseInt(window.realtimeConfig.refreshInterval || document.querySelector('#refresh_interval')?.value || 0) * 1000,
		clickableRows: window.realtimeConfig.clickableRows || [], // From 1.0.3
		detailEndpoints: window.realtimeConfig.detailEndpoints || {} // From 1.0.3
	};

	// DOM elements with centralized validation
	function getElement(selector, errorMessage) {
		const element = document.querySelector(selector);
		if (!element && errorMessage) {
			console.error(errorMessage);
			document.querySelector('#error_msg').textContent = errorMessage;
			document.querySelector('#error_msg').style.display = 'block';
		}
		return element;
	}

	const mainTbody = getElement(config.mainTableSelector, `Error: Main table not found at selector '${config.mainTableSelector}'`);
	if (!mainTbody) return;

	const rawLogsTbody = config.hasRawLogs ? getElement(config.rawTableSelector, `Error: Raw logs table not found at selector '${config.rawTableSelector}'`) : null;
	const searchForm = config.hasRawLogs ? getElement(config.searchFormSelector) : null;
	const searchToggle = getElement('#search_toggle');
	const searchFields = getElement('.search_fields');
	let rawPaginationContainer = null;

	// Initialize pagination containers
	if (config.enablePagination) {
		const paginationContainer = getElement('#pagination') || createPaginationContainer(config.mainTableSelector.replace(' tbody', '') || '.tbl');
		if (paginationContainer) console.log('DEBUG:: Main pagination container initialized');
	}
	if (config.hasRawLogs) {
		rawPaginationContainer = getElement('#raw_pagination') || createPaginationContainer(config.rawTableSelector.replace(' tbody', '') || '.raw_logs_table');
		if (rawPaginationContainer) console.log('DEBUG:: Raw pagination container initialized');
	}

	// State management
	let state = {
		isFetching: false,
		lastFetchTime: 0,
		abortController: new AbortController(),
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
		modifiedFields: new Set() // From 1.0.3
	};

	// LocalStorage caching
	const localCacheKey = `ipfire-realtime-${config.endpoint}-${config.group}-${config.day}-${config.month}-${config.year}`;
	const ajaxCache = {};

	// Validate DOM elements
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
			state.modifiedFields.add('search_toggle');
			updateTable('search_enabled');
		});
	} else {
		console.warn('DEBUG:: search_toggle or search_fields not found in DOM');
	}

	// Utility functions
	function sanitizeValue(value) {
		return value ? value.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : '';
	}

	function formatValue(value, type, extra) {
		value = sanitizeValue(value);
		if (type === 'bytes') return value || '0 B';
		if (type === 'ip') return `<a href="/cgi-bin/ipinfo.cgi?ip=${encodeURIComponent(value)}" target="_blank" style="color:#fff !important">${value}</a>`;
		if (type === 'port') return `<a href="https://isc.sans.edu/port.html?port=${encodeURIComponent(value)}" target="_blank" style="color:#fff !important">${value}</a>`;
		if (type === 'country') return `<a href="/cgi-bin/country.cgi#${encodeURIComponent(value)}" style="color:#fff !important">${value.toUpperCase()}</a>`;
		if (type === 'flag') return `<a href="/cgi-bin/country.cgi#${encodeURIComponent(extra.country || '')}"><img src="${value || '/images/flags/unknown.png'}" border="0" align="absmiddle" alt="${sanitizeValue(extra.country || '')}" title="${sanitizeValue(extra.country || '')}" /></a>`;
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

	const comparators = {
		ip: compareIP,
		number: (a, b) => Number(a || 0) - Number(b || 0),
		string: (a, b) => String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase()),
		ttl: (a, b) => parseTTL(a) - parseTTL(b),
		port: (a, b) => Number(a || 0) - Number(b || 0),
		percent: (a, b) => Number(a || 0) - Number(b || 0),
		bytes: (a, b) => Number(a || 0) - Number(b || 0),
		country: (a, b) => String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase())
	};

	// Web Worker for sorting
	let sortWorker = new Worker(URL.createObjectURL(new Blob([`
		self.addEventListener('message', (e) => {
			const { data, column, direction, type } = e.data;
			const comparators = {
				ip: (a, b) => {
					const partsA = (a || '0.0.0.0').split('.').map(Number);
					const partsB = (b || '0.0.0.0').split('.').map(Number);
					for (let i = 0; i < 4; i++) {
						if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
					}
					return 0;
				},
				number: (a, b) => Number(a || 0) - Number(b || 0),
				string: (a, b) => String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase()),
				ttl: (a, b) => {
					const parseTTL = (ttl) => {
						let seconds = 0;
						const matches = (ttl || '').match(/(\\d+d)?\\s*(\\d+h)?\\s*(\\d+m)?\\s*(\\d+s)?/);
						if (matches) {
							if (matches[1]) seconds += parseInt(matches[1]) * 86400;
							if (matches[2]) seconds += parseInt(matches[2]) * 3600;
							if (matches[3]) seconds += parseInt(matches[3]) * 60;
							if (matches[4]) seconds += parseInt(matches[4]);
						}
						return seconds;
					};
					return parseTTL(a) - parseTTL(b);
				},
				port: (a, b) => Number(a || 0) - Number(b || 0),
				percent: (a, b) => Number(a || 0) - Number(b || 0),
				bytes: (a, b) => Number(a || 0) - Number(b || 0),
				country: (a, b) => String(a || '').toLowerCase().localeCompare(String(b || '').toLowerCase())
			};
			const comparator = comparators[type] || comparators.string;
			const multiplier = direction === 'asc' ? 1 : -1;
			const sorted = data.slice().sort((a, b) => {
				let valA = a[column] || '';
				let valB = b[column] || '';
				if (['bytes_in', 'bytes_out', 'ttl', 'count', 'percent'].includes(column)) {
					const rawKey = column + '_raw';
					valA = Number(a[rawKey] || valA || 0);
					valB = Number(b[rawKey] || valB || 0);
				}
				return comparator(valA, valB) * multiplier;
			});
			self.postMessage(sorted);
		});
	`], { type: 'text/javascript' })));

	function sortWithWorker(data) {
		const cacheKey = JSON.stringify({ length: data.length, sortOrder: state.sortOrder });
		if (sortCache.has(data) && sortCache.get(data).key === cacheKey) {
			console.log('DEBUG:: Sort cache hit');
			return Promise.resolve(sortCache.get(data).result);
		}
		if (state.sortOrder.length === 0 || Object.values(state.sortStates).every(state => state === 'none')) {
			if (config.defaultSort) {
				state.sortOrder = [{ column: config.defaultSort.column, direction: config.defaultSort.direction }];
				state.sortStates[config.defaultSort.column] = config.defaultSort.direction === 'asc' ? 'up' : 'down';
			} else {
				console.warn('DEBUG:: No sort order defined, returning unsorted data');
				return Promise.resolve(data);
			}
		}
		const { column, direction } = state.sortOrder[0];
		const columnConfig = config.columns.find(col => col.key === column);
		const type = columnConfig?.type || 'string';
		return new Promise((resolve) => {
			sortWorker.onmessage = (e) => {
				sortCache.set(data, { key: cacheKey, result: e.data });
				resolve(e.data);
			};
			sortWorker.postMessage({ data, column, direction, type });
		});
	}

	const sortCache = new WeakMap();

	function createPaginationContainer(tableSelector) {
		const table = getElement(tableSelector);
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

	function renderPagination(totalRows) {
		if (!config.enablePagination || state.rowsPerPage <= 0) return;
		const paginationContainer = getElement('#pagination');
		if (!paginationContainer) {
			console.error('ERROR:: #pagination container not found for main table');
			return;
		}
		const totalPages = Math.ceil(totalRows / state.rowsPerPage);
		paginationContainer.innerHTML = `
			<button class="page-btn" data-page="${state.currentPage - 1}" ${state.currentPage === 1 ? 'disabled' : ''}>Previous</button>
			<span>Page ${state.currentPage} of ${totalPages}</span>
			<button class="page-btn" data-page="${state.currentPage + 1}" ${state.currentPage === totalPages ? 'disabled' : ''}>Next</button>
		`;
		console.log(`DEBUG:: Rendered main pagination: Page ${state.currentPage} of ${totalPages}`);
	}

	function renderRawPagination(totalRows) {
		if (!config.hasRawLogs || !rawPaginationContainer) {
			console.error('DEBUG:: rawPaginationContainer not initialized or hasRawLogs is false');
			return;
		}
		const totalPages = Math.ceil(totalRows / state.rawRowsPerPage);
		rawPaginationContainer.innerHTML = `
			<button class="page-btn" data-page="${state.rawCurrentPage - 1}" ${state.rawCurrentPage === 1 ? 'disabled' : ''}>Previous</button>
			<span>Page ${state.rawCurrentPage} of ${totalPages}</span>
			<button class="page-btn" data-page="${state.rawCurrentPage + 1}" ${state.rawCurrentPage === totalPages ? 'disabled' : ''}>Next</button>
		`;
		console.log(`DEBUG:: Rendered raw pagination: Page ${state.rawCurrentPage} of ${totalPages}`);
	}

	function renderTable(data) {
		requestAnimationFrame(() => {
			const fragment = document.createDocumentFragment();
			if (config.enablePagination) {
				const limitInput = getElement('input[name="limit"]');
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

			paginatedData.forEach((item, index) => {
				const row = document.createElement('tr');
				if (config.clickableRows && config.clickableRows.includes(item.key?.toLowerCase())) {
					row.dataset.resource = item.key.toLowerCase();
					row.style.cursor = 'pointer';
				}
				config.columns.forEach(col => {
					const td = document.createElement('td');
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
					td.innerHTML = formatValue(value, col.type, extra);
					const align = col.type === 'number' || col.type === 'bytes' || col.type === 'percent' ? 'text-right' : col.type === 'flag' || col.type === 'details' ? 'text-center' : 'text-left';
					td.className = align;
					let cellColour = item[col.key + '_colour'] || item.zone_colour || '';
					if (cellColour && col.type !== 'details') {
						td.style.background = cellColour;
						td.style.color = '#fff';
					}
					row.appendChild(td);
				});
				fragment.appendChild(row);
			});

			mainTbody.innerHTML = ''; // Clear only after new content is ready
			mainTbody.appendChild(fragment);
			if (fragment.childNodes.length === 0) {
				mainTbody.innerHTML = `<tr><td colspan="${config.columns.length}" style="text-align:center;">No data available</td></tr>`;
				document.querySelector('#error_msg').textContent = 'No data available';
				document.querySelector('#error_msg').style.display = 'block';
			}
			console.log('DEBUG:: Rendered table rows:', paginatedData.length);

			const rowCount = getElement('#row_count');
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
				const paginationContainer = getElement('#pagination');
				if (paginationContainer) paginationContainer.innerHTML = '';
			}
		});
	}

	function renderRawLogs(data) {
		if (!rawLogsTbody) {
			console.error(`DEBUG:: ${config.rawTableSelector} not found in DOM`);
			return;
		}
		requestAnimationFrame(() => {
			const rawLimitInput = getElement('input[name="raw_limit"]');
			state.rawRowsPerPage = rawLimitInput && rawLimitInput.value && parseInt(rawLimitInput.value) > 0 ? parseInt(rawLimitInput.value) : 50;
			const start = (state.rawCurrentPage - 1) * state.rawRowsPerPage;
			const end = start + state.rawRowsPerPage;
			const paginatedData = data.slice(start, end).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

			const fragment = document.createDocumentFragment();
			paginatedData.forEach(item => {
				const row = document.createElement('tr');
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
					const td = document.createElement('td');
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
					td.innerHTML = formatValue(value, col.type, extra);
					const align = col.type === 'flag' ? 'text-center' : 'text-left';
					td.className = align;
					if (col.key === 'src_ip' && item.src_zone_colour) {
						td.style.background = item.src_zone_colour;
						td.style.color = '#fff';
					} else if (col.key === 'src_port' && item.src_zone_colour) {
						td.style.background = item.src_zone_colour;
						td.style.color = '#fff';
					} else if (col.key === 'dst_ip' && item.dst_zone_colour) {
						td.style.background = item.dst_zone_colour;
						td.style.color = '#fff';
					} else if (col.key === 'dst_port' && item.dst_zone_colour) {
						td.style.background = item.dst_zone_colour;
						td.style.color = '#fff';
					} else if (col.key === 'action') {
						const actionValue = td.innerHTML;
						td.style.background = actionValue.includes('DROP') ? '#993333' : actionValue.includes('ACCEPT') ? '#339933' : '';
						td.style.color = td.style.background ? '#fff' : '';
					}
					row.appendChild(td);
				});
				fragment.appendChild(row);
			});

			// Minimize flicker by clearing only after fragment is ready
			rawLogsTbody.innerHTML = '';
			rawLogsTbody.appendChild(fragment);
			if (fragment.childNodes.length === 0) {
				rawLogsTbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">No recent logs available</td></tr>';
				document.querySelector('#error_msg').textContent = 'No recent logs available';
				document.querySelector('#error_msg').style.display = 'block';
			}
			console.log('DEBUG:: Rendered raw logs rows:', paginatedData.length);
			rawLogsTbody.style.display = 'table-row-group';
			rawLogsTbody.style.visibility = 'visible';
			rawLogsTbody.parentElement.style.display = 'table';

			const rowCount = getElement('#row_count');
			if (rowCount) {
				const totalPages = Math.ceil(data.length / state.rawRowsPerPage);
				rowCount.textContent = `(${data.length} ${config.countLabel}, Page ${state.rawCurrentPage} of ${totalPages})`;
			}

			renderRawPagination(data.length);
		});
	}

	function showDetailsModal(resource, data) {
		const modal = document.createElement('div');
		modal.className = 'modal';
		modal.setAttribute('role', 'dialog');
		modal.setAttribute('aria-labelledby', 'modal-title');
		let html = `<div class="modal-content"><h2 id="modal-title">${resource.toUpperCase()} Details</h2><table class="tbl"><thead><tr>`;
		if (resource === 'network') {
			html += `<th>Interface</th><th>IP</th><th>RX (MB/s)</th><th>TX (MB/s)</th>`;
		} else {
			html += `<th>PID</th><th>Command</th><th>${resource === 'cpu' ? 'CPU (%)' : 'Memory'}</th>`;
		}
		html += `</tr></thead><tbody>`;
		data.forEach(row => {
			html += `<tr>`;
			if (resource === 'network') {
				html += `<td>${sanitizeValue(row.if)}</td><td>${sanitizeValue(row.ip || '-')}</td><td>${sanitizeValue(row.rx_rate || '-')}</td><td>${sanitizeValue(row.tx_rate || '-')}</td>`;
			} else {
				html += `<td>${sanitizeValue(row.pid)}</td><td>${sanitizeValue(row.command)}</td><td>${resource === 'cpu' ? sanitizeValue(row.cpu) : sanitizeValue(row.mem)}</td>`;
			}
			html += `</tr>`;
		});
		html += `</tbody></table><button onclick="this.parentElement.parentElement.remove()">Close</button></div>`;
		modal.innerHTML = html;
		document.body.appendChild(modal);
	}

	function populateDropdowns(interfaces, actions) {
		const interfaceSelect = getElement('select[name="search_interface"]');
		const actionSelect = getElement('select[name="search_action"]');
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

	async function fetchData(url) {
		const cacheKey = url;
		if (ajaxCache[cacheKey] && Date.now() - ajaxCache[cacheKey].timestamp < 60000) {
			console.log('DEBUG:: AJAX hit from cache');
			return ajaxCache[cacheKey].data;
		}
		try {
			state.abortController.abort();
			state.abortController = new AbortController();
			const response = await fetch(url, {
				signal: state.abortController.signal,
				headers: { 'If-None-Match': localStorage.getItem(`etag_${url}`) || '' }
			});
			if (response.status === 304) {
				console.log('DEBUG:: Data unchanged (304), using cache');
				return ajaxCache[cacheKey]?.data || null;
			}
			if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
			const data = await response.json();
			const etag = response.headers.get('ETag');
			if (etag) localStorage.setItem(`etag_${url}`, etag);
			ajaxCache[cacheKey] = { data, timestamp: Date.now() };
			return data;
		} catch (error) {
			if (error.name === 'AbortError') {
				console.log('DEBUG:: Fetch aborted');
				return null;
			}
			console.error(`ERROR:: Failed to fetch ${url}: ${error.message}`);
			document.querySelector('#error_msg').textContent = `Failed to fetch data: ${error.message}`;
			document.querySelector('#error_msg').style.display = 'block';
			return null;
		}
	}

	async function fetchGroupedData(params) {
		let url = new URL(config.endpoint, window.location.origin);
		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined && value !== '') url.searchParams.append(key, value);
		});
		const data = await fetchData(url.toString());
		if (!data) return state.tableData;
		state.tableData = data;
		localStorage.setItem(localCacheKey, JSON.stringify({ data: { tableData: data, rawLogsData: state.rawLogsData }, timestamp: Date.now() }));
		return data;
	}

	async function fetchRawLogs(params) {
		let url = new URL(config.endpoint, window.location.origin);
		url.searchParams.append('raw_logs', '1');
		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined && value !== '') url.searchParams.append(key, value);
		});
		const data = await fetchData(url.toString());
		if (!data) return state.rawLogsData;
		state.rawLogsData = data.raw_logs || [];
		localStorage.setItem(localCacheKey, JSON.stringify({ data: { tableData: state.tableData, rawLogsData: state.rawLogsData }, timestamp: Date.now() }));
		return state.rawLogsData;
	}

	async function fetchFilters(params) {
		let url = new URL(config.endpoint, window.location.origin);
		url.searchParams.append('filters', '1');
		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined && value !== '') url.searchParams.append(key, value);
		});
		const data = await fetchData(url.toString());
		return data || { interfaces: [], actions: [] };
	}

	async function updateTable(trigger = '') {
		if (state.isFetching) {
			console.log('DEBUG:: Fetch in progress, aborting update');
			return;
		}
		state.isFetching = true;
		console.log('DEBUG:: Updating table, trigger:', trigger);
		try {
			let params = {
				group: config.group,
				day: config.day,
				month: config.month,
				year: config.year,
				limit: config.limit
			};
			if (searchForm) {
				const formData = new FormData(searchForm);
				params.search_ip = formData.get('search_ip') || '';
				params.search_port = formData.get('search_port') || '';
				params.search_interface = formData.get('search_interface') || '';
				params.search_action = formData.get('search_action') || '';
				params.search_protocol = formData.get('search_protocol') || '';
				params.is_search = searchToggle?.checked ? 1 : 0;
			}

			const rawLogFields = ['search_ip', 'search_port', 'search_interface', 'search_action', 'search_protocol', 'search_toggle'];
			const hasActiveRawFilters = rawLogFields.some(field => state.modifiedFields.has(field));
			const updateRawLogs = config.hasRawLogs && (hasActiveRawFilters || state.rawLogsData.length === 0 || trigger === 'refresh');

			const [groupedData, rawData, filterData] = await Promise.all([
				fetchGroupedData(params),
				updateRawLogs ? fetchRawLogs(params) : Promise.resolve(state.rawLogsData),
				config.hasRawLogs ? fetchFilters(params) : Promise.resolve({ interfaces: [], actions: [] })
			]);

			if (groupedData && Array.isArray(groupedData)) {
				const sortedData = await sortWithWorker(groupedData);
				renderTable(sortedData);
			} else {
				console.error('ERROR:: Invalid grouped data received');
				mainTbody.innerHTML = `<tr><td colspan="${config.columns.length}" style="text-align:center;">Error loading data</td></tr>`;
				document.querySelector('#error_msg').textContent = 'Error loading grouped data';
				document.querySelector('#error_msg').style.display = 'block';
			}

			if (config.hasRawLogs && updateRawLogs && rawData && Array.isArray(rawData)) {
				renderRawLogs(rawData);
				if (filterData && filterData.interfaces && filterData.actions) {
					populateDropdowns(filterData.interfaces, filterData.actions);
				}
			}

			state.lastFetchTime = Date.now();
			state.isFetching = false;
			state.modifiedFields.clear();
		} catch (error) {
			console.error('ERROR:: Update table failed:', error);
			document.querySelector('#error_msg').textContent = `Update failed: ${error.message}`;
			document.querySelector('#error_msg').style.display = 'block';
			state.isFetching = false;
			state.modifiedFields.clear();
		}
	}

	// Event listeners
	const table = mainTbody.closest('table');
	if (table) {
		table.addEventListener('click', async (event) => {
			const th = event.target.closest('th[data-sort]');
			const pageBtn = event.target.closest('.page-btn');
			const row = event.target.closest('tr[data-resource]');
			if (th) {
				const column = th.dataset.sort;
				const currentState = state.sortStates[column];
				state.sortStates = Object.fromEntries(Object.keys(state.sortStates).map(k => [k, 'none']));
				state.sortStates[column] = currentState === 'up' ? 'down' : 'up';
				state.sortOrder = [{ column, direction: state.sortStates[column] === 'up' ? 'asc' : 'desc' }];
				th.setAttribute('aria-sort', state.sortStates[column] === 'up' ? 'ascending' : 'descending');
				console.log(`DEBUG:: Sorting column ${column} ${state.sortStates[column]}`);
				const sortedData = await sortWithWorker(state.tableData);
				renderTable(sortedData);
			} else if (pageBtn) {
				const page = parseInt(pageBtn.dataset.page);
				if (page && page !== state.currentPage) {
					state.currentPage = page;
					console.log('DEBUG:: Changed page to:', page);
					renderTable(state.tableData);
				}
			} else if (row && config.clickableRows) {
				const resource = row.dataset.resource;
				const endpoint = config.detailEndpoints[resource];
				if (endpoint) {
					const data = await fetchData(endpoint);
					if (data) {
						showDetailsModal(resource, data);
					} else {
						document.querySelector('#error_msg').textContent = `Failed to load details for ${resource}`;
						document.querySelector('#error_msg').style.display = 'block';
					}
				}
			}
		});
	}

	if (rawPaginationContainer) {
		rawPaginationContainer.addEventListener('click', (event) => {
			const pageBtn = event.target.closest('.page-btn');
			if (pageBtn) {
				const page = parseInt(pageBtn.dataset.page);
				if (page && page !== state.rawCurrentPage) {
					state.rawCurrentPage = page;
					console.log('DEBUG:: Changed raw logs page to:', page);
					renderRawLogs(state.rawLogsData);
				}
			}
		});
	}

	if (searchForm) {
		searchForm.addEventListener('input', (event) => {
			const input = event.target;
			if (input.name) {
				state.modifiedFields.add(input.name);
				console.log(`DEBUG:: Input changed: ${input.name}=${input.value}`);
				setTimeout(() => updateTable('input'), state.debounceDelay);
			}
		});
	}

	// Refresh interval
	if (config.refreshInterval > 0) {
		state.refreshTimer = setInterval(() => {
			console.log('DEBUG:: Auto-refresh triggered');
			updateTable('refresh');
		}, config.refreshInterval);
	}

	// Initial load
	updateTable('initial');
});
