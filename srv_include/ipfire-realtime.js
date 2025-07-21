/*
 * File/path: /srv/web/ipfire/html/include/ipfire-realtime.js
 * Purpose: Universal real-time table renderer for IPFire WebUI
 *          - Handles colored background per zone (all columns, generic logic)
 *          - Ensures readable text (white text on colored background)
 *          - Column sorting, filter auto-update, AJAX loading
 *          - Supports expandable process list per resource (CPU/memory) with live update
 * Version: 1.3.1-perplexity
 * Author: IPFire Team / Extended by Perplexity
 * License: GNU GPL v3 or later
 * Last Modified: July 2025
 */

$(document).ready(function () {
    // Debug logging
    const DEBUG = true;
    const config = window.realtimeConfig || {
        endpoint: '/cgi-bin/connections-realtime.cgi?json=1',
        columns: [],
        defaultSort: { column: 'ttl', direction: 'desc' },
        countLabel: 'records'
    };

    let refreshInterval = parseInt($("#refresh_interval").val() || 0) * 1000;
    let refreshTimer;
    let tableData = [];
    let sortStates = {};
    let sortOrder = [];
    // Track which resource's process detail is open and at which row
    let currentDetailResource = null;  // e.g. "cpu"
    let currentDetailRowIndex = null;  // e.g. 0 (row-index in table)

    // Setup default sorting state
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

    // Show/hide filter fields
    if ($("#search_toggle").prop("checked")) $(".search_fields").show();
    $("#search_toggle").change(function () { $(".search_fields").toggle(); });

    // Format cell values
    function formatValue(value, type, extra) {
        if (type === 'bytes') {
            return value || '0 B';
        } else if (type === 'ip') {
            return `<a href="/cgi-bin/ipinfo.cgi?ip=${encodeURIComponent(value)}" style="color:#fff !important">${value}</a>`;
        } else if (type === 'port') {
            return `<a href="https://isc.sans.edu/port.html?port=${encodeURIComponent(value)}" target="_blank" style="color:#fff !important">${value}</a>`;
        } else if (type === 'flag') {
            return `<a href="country.cgi#${encodeURIComponent(extra.country || '')}"><img src="${value || '/images/flags/unknown.png'}" border="0" align="absmiddle" alt="${extra.country || ''}" title="${extra.country || ''}" /></a>`;
        }
        return value || '';
    }

    // Sort helpers
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

    // Main sort routine
    function sortData(data) {
        if (sortOrder.length === 0 || Object.values(sortStates).every(state => state === 'none')) {
            if (config.defaultSort) {
                sortOrder = [{ column: config.defaultSort.column, direction: config.defaultSort.direction }];
                sortStates[config.defaultSort.column] = config.defaultSort.direction === 'asc' ? 'up' : 'down';
            }
        }
        if (sortOrder.length === 0) return data;
        const { column, direction } = sortOrder[0];
        const columnConfig = config.columns.find(col => col.key === column);
        const multiplier = direction === 'asc' ? 1 : -1;
        if (!columnConfig) return data;
        if (!config.columns.some(col => col.key === 'ttl')) {
            config.columns.push({ key: 'ttl', type: 'number' });
        }
        try {
            return data.slice().sort((a, b) => {
                let valA = a[column] || '';
                let valB = b[column] || '';
                if (column === 'usage') {
                    valA = Number((valA + "").replace(/[^\d.]+/g, ''));
                    valB = Number((valB + "").replace(/[^\d.]+/g, ''));
                    return (valA - valB) * multiplier;
                }
                if (column === 'bytes_in' || column === 'bytes_out' || column === 'ttl') {
                    if (column === 'ttl') {
                        valA = parseTTL(a[column]); valB = parseTTL(b[column]);
                    } else {
                        const rawKey = column + '_raw';
                        valA = Number(a[rawKey] || a[column] || 0);
                        valB = Number(b[rawKey] || b[column] || 0);
                    }
                    return (valA - valB) * multiplier;
                }
                if (columnConfig.type === 'port') {
                    valA = Number(valA || 0); valB = Number(valB || 0);
                    return (valA - valB) * multiplier;
                }
                if (columnConfig.type === 'ip') return compareIP(valA, valB) * multiplier;
                if (columnConfig.type === 'string') {
                    valA = (valA || '').toString().toLowerCase();
                    valB = (valB || '').toString().toLowerCase();
                    return valA.localeCompare(valB) * multiplier;
                }
                return String(valA).localeCompare(String(valB)) * multiplier;
            });
        } catch (e) {
            return data;
        }
    }

    // Insert or update process-detail content (the .proc-detail-row stays present!)
    function updateProcessDetailContent(resType) {
        if (typeof currentDetailRowIndex !== "number") return;
        let $rows = $(".tbl tbody tr");
        let $tr = $rows.eq(currentDetailRowIndex);
        let $next = $tr.next(".proc-detail-row");
        if ($next.length === 0) return; // Not present
        let $content = $next.find(".proc-detail-content");
        if ($content.length === 0) return;
        $content.html('<em>Loading…</em>');
        $.getJSON(config.endpoint + "&detail=" + resType, function (list) {
            let html = "<b>Top Processes by " + (resType === "cpu" ? "CPU" : "Memory") + ":</b><br>";
            html += '<table class="proc-table" style="width:98%;font-size:90%"><thead><tr><th>PID</th><th>Command</th>'
                + (resType === "cpu" ? '<th>CPU (%)</th>' : '<th>Memory</th>')
                + '</tr></thead><tbody>';
            list.forEach(function (p) {
                html += "<tr><td>" + p.pid + "</td><td>" + p.command + "</td>"
                    + (resType === "cpu" ? "<td>" + p.cpu + "</td>" : "<td>" + p.mem + "</td>")
                    + "</tr>";
            });
            html += "</tbody></table>";
            $content.html(html);
        });
    }

    // Expand/collapse process-detail row (remains in DOM, content is always refreshed)
    $(".tbl tbody").on("click", "td:first-child", function () {
        const resType = $(this).text().toLowerCase().trim();
        if (!["cpu", "memory"].includes(resType)) return;
        const $tr = $(this).closest("tr");
        const rowIndex = $tr.index();
        // Already open? Remove detail row
        if ($tr.next().hasClass("proc-detail-row")) {
            $tr.next().remove();
            currentDetailResource = null;
            currentDetailRowIndex = null;
            return;
        }
        // Remove other open details
        $(".proc-detail-row").remove();
        currentDetailResource = resType;
        currentDetailRowIndex = rowIndex;
        // Add the detail row right after the target
        $tr.after('<tr class="proc-detail-row"><td colspan="4"><div class="proc-detail-content"></div></td></tr>');
        updateProcessDetailContent(resType);
    });

    // Main table renderer
    function renderTable(data) {
        const tbody = $(".tbl tbody");
        tbody.empty();
        let html = [];
        const groupColKey = config.columns.length > 0 ? config.columns[0].key : "";
        $.each(data, function (_, item) {
            let row = '<tr>';
            config.columns.forEach(col => {
                let value = item[col.key] || '';
                let infoField = col.key + '_info_url';
                if (item[infoField]) {
                    value = `<a href="${item[infoField]}" target="_blank" style="color:#fff !important">${value}</a>`;
                }
                let extra = {
                    country: item[
                        col.key === 'src_flag_icon' ? 'src_country'
                        : col.key === 'dst_flag_icon' ? 'dst_country'
                        : ''
                    ],
                    colour: item[
                        col.key === 'src_ip' ? 'src_colour'
                        : col.key === 'dst_ip' ? 'dst_colour'
                        : ''
                    ]
                };
                value = formatValue(value, col.type, extra);
                const align =
                    col.type === 'number' || col.type === 'bytes' ? 'text-right'
                    : col.type === 'flag' ? 'text-center'
                    : 'text-left';
                let style = '';
                let cellColour =
                    item[col.key + '_colour']
                    || item.zone_colour
                    || '';
                if (cellColour) {
                    style = `style="background:${cellColour};color:#fff;"`;
                }
                row += `<td class="${align}" ${style}>${value}</td>`;
            });
            row += '</tr>';
            html.push(row);
        });
        tbody.html(html.join(""));

        // If process-detail is open, re-insert it after correct row
        if (currentDetailResource !== null && typeof currentDetailRowIndex === "number") {
            let $rows = $(".tbl tbody tr");
            let $tr = $rows.eq(currentDetailRowIndex);
            // If not already present, insert
            if ($tr.length && !$tr.next().hasClass("proc-detail-row")) {
                $tr.after('<tr class="proc-detail-row"><td colspan="4"><div class="proc-detail-content"></div></td></tr>');
            }
        }
        $("#row_count").text(`(${data.length} ${config.countLabel})`);
    }

    // Main table update AJAX routine
    function updateTable() {
        const params = {};
        const zones = $("input[name='zone']").map(function () { return $(this).val(); }).get().filter(zone => zone);
        if (zones.length > 0) {
            params.zone = zones;
            params.search_enabled = 1;
        }
        $(".filter-field").each(function () {
            const name = $(this).attr('name');
            if ($(this).is('select')) {
                params[name] = $(this).val();
            } else if ($(this).is(':checkbox')) {
                params[name] = $(this).is(':checked') ? 1 : 0;
            } else {
                params[name] = $(this).val() || '';
            }
        });
        if (zones.length > 0 || params.ip || params.port || params.protocol) {
            params.search_enabled = 1;
        }
        const queryString = $.param(params, true);
        if (DEBUG) console.log("DEBUG:: AJAX request →", config.endpoint, queryString);

        $.ajax({
            url: config.endpoint + (config.endpoint.includes('?') ? '&' : '?') + queryString,
            dataType: 'json',
            success: function (data) {
                if (!Array.isArray(data)) {
                    $("#error_msg").text("Error: Invalid data format").show();
                    $("#row_count").text("(Error)");
                    tableData = [];
                    return;
                }
                $("#error_msg").hide();
                tableData = sortData(data);
                renderTable(tableData);
                $(".tbl thead th[data-sort]").removeClass("sort-up sort-down sort-none");
                $.each(sortStates, function (column, state) {
                    $(`.tbl thead th[data-sort="${column}"]`).addClass(`sort-${state}`);
                });

                // If process detail open, only update its content
                if (currentDetailResource !== null && typeof currentDetailRowIndex === "number") {
                    updateProcessDetailContent(currentDetailResource);
                }
            },
            error: function (jqXHR, textStatus) {
                $("#error_msg").text(`Error loading data: ${jqXHR.status} ${textStatus}`).show();
                $("#row_count").text(`(Error: ${jqXHR.status})`);
            }
        });
    }

    // Sorting handler
    $(".tbl thead th[data-sort]").click(function () {
        const column = $(this).attr("data-sort");
        const currentState = sortStates[column];
        let newState = 'none', newDirection = null;
        if (currentState === 'none') {
            newState = 'up'; newDirection = 'asc';
        } else if (currentState === 'up') {
            newState = 'down'; newDirection = 'desc';
        } else if (currentState === 'down') {
            newState = 'none'; newDirection = null;
        }
        $.each(sortStates, function (col) {
            sortStates[col] = (col === column) ? newState : 'none';
        });
        sortOrder = [];
        if (newState !== 'none') {
            sortOrder.push({ column, direction: newDirection });
        }
        if (DEBUG) console.log(`DEBUG:: Clicked column: ${column}. New direction: ${newDirection}`);
        if (tableData.length > 0) {
            tableData = sortData(tableData);
            renderTable(tableData);
        }
        $(".tbl thead th[data-sort]").removeClass("sort-up sort-down sort-none");
        $.each(sortStates, function (col, state) {
            $(`.tbl thead th[data-sort="${col}"]`).addClass(`sort-${state}`);
        });
        // If process detail open, we need to make sure it's still shown after resort
        if (currentDetailResource !== null && typeof currentDetailRowIndex === "number") {
            // After sort, the detail row index may have changed, so close detail
            $(".proc-detail-row").remove();
            currentDetailResource = null;
            currentDetailRowIndex = null;
        }
    });

    // Auto-refresh interval handler
    $("#refresh_interval").change(function () {
        clearInterval(refreshTimer);
        refreshInterval = parseInt($(this).val() || 0) * 1000;
        if (refreshInterval > 0) {
            refreshTimer = setInterval(updateTable, refreshInterval);
        }
    });

    // Initial load
    updateTable();
    if (refreshInterval > 0) {
        refreshTimer = setInterval(updateTable, refreshInterval);
    }
});

