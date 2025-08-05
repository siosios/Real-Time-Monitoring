#!/usr/bin/perl
################################################################################
# File/path: /srv/web/ipfire/cgi-bin/hardware-realtime.cgi                    #
# Purpose: Real-time hardware UI + compact, modal details for IPFire WebUI     #
# Version: 0.9.5                                                              #
# Author: ummeegge                                                            #
# Last Modified: August 05, 2025                                              #
################################################################################

use strict;
use warnings;
use CGI qw(escape);
use HTML::Entities;
use JSON::PP;
use POSIX qw(strftime);

require '/var/ipfire/general-functions.pl';
require "${General::swroot}/lang.pl";
require "${General::swroot}/header.pl";
require "${General::swroot}/realtime/hardware.pm";

# Debug config
my $debug_level = 2;

sub debug {
    my ($level, $message) = @_;
    return if !defined $message || $level > $debug_level;
    my $timestamp = strftime("%a %b %d %H:%M:%S %Y", localtime);
    my $prefix = $level == 1 ? "[INFO]" : "[DEBUG]";
    print STDERR "$prefix [$timestamp] hardware-realtime.cgi: $message\n";
}

my $cgi = CGI->new;
my @valid_resources = qw(none cpu memory disk network system all);

my $resource_filter  = $cgi->param('resource')         || '';
my $search_enabled   = $cgi->param('search_enabled')   || '';
my $refresh_interval = $cgi->param('refresh_interval') || 0;
my $json             = $cgi->param('json')             || '';
my $detail           = $cgi->param('detail')           || '';

debug(2, "Parameters - Resource: '$resource_filter', Enabled: '$search_enabled', Refresh: '$refresh_interval', JSON: '$json', Detail: '$detail'");
debug(2, "Lang usage: $Lang::tr{'usage'}") if exists $Lang::tr{'usage'};

if ($resource_filter) {
    $resource_filter =~ s/[^a-zA-Z]//g;
    $resource_filter = '' unless grep { $_ eq $resource_filter } @valid_resources;
    debug(2, "Sanitized resource: '$resource_filter'");
}

# JSON endpoints for process/network details
if ($json && $detail eq 'cpu') {
    debug(1, "JSON process details: top CPU");
    print $cgi->header('application/json; charset=UTF-8');
    print encode_json(Realtime::Hardware::get_top_cpu_processes());
    exit;
}
elsif ($json && $detail eq 'memory') {
    debug(1, "JSON process details: top MEM");
    print $cgi->header('application/json; charset=UTF-8');
    print encode_json(Realtime::Hardware::get_top_mem_processes());
    exit;
}
elsif ($json && $detail eq 'network') {
    debug(1, "JSON detail for network");
    print $cgi->header('application/json; charset=UTF-8');
    print encode_json(Realtime::Hardware::get_net_info());
    exit;
}

# Main JSON endpoint
if ($json) {
    debug(1, "JSON API mode activated");
    print $cgi->header('application/json; charset=UTF-8');
    my $filters = { search_enabled => $search_enabled, resource => $resource_filter };
    my $data = Realtime::Hardware::fetch($filters);
    debug(2, "Fetched hardware data: " . encode_json($data));
    print encode_json($data);
    exit;
}

# HTML Frontend
my $cache_buster = time; # Cache-busting for CSS/JS

&Header::showhttpheaders('text/html; charset=UTF-8');
&Header::openpage(
    $Lang::tr{'hardware usage'} || 'Hardware Usage',
    1,
    <<"END_HTML"
<link rel="stylesheet" href="/include/ipfire-realtime.css?$cache_buster">
<script src="/include/ipfire-realtime.js?$cache_buster"></script>
<style>
    .modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 1000;
    }
    .modal-content {
        background: #fff;
        margin: 10% auto;
        padding: 20px;
        width: 80%;
        max-width: 600px;
        border-radius: 5px;
        position: relative;
    }
    .modal-content h2 {
        margin-top: 0;
    }
    .close-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        cursor: pointer;
        font-size: 20px;
    }
</style>
<script>
    window.realtimeConfig = {
        endpoint: '$ENV{SCRIPT_NAME}?json=1',
        columns: [
            { key: 'resource', title: '@{[ $Lang::tr{resource} || "Resource" ]}', type: 'string' },
            { key: 'usage', title: '@{[ $Lang::tr{usage} || "Usage" ]}', type: 'string' },
            { key: 'value', title: '@{[ $Lang::tr{value} || "Value" ]}', type: 'string' },
            { key: 'details', title: '@{[ $Lang::tr{details} || "Details" ]}', type: 'string' }
        ],
        defaultSort: { column: 'resource', direction: 'asc' },
        countLabel: '@{[ $Lang::tr{metrics} || "Metrics" ]}',
        clickableRows: ['cpu', 'memory', 'network'],
        detailEndpoints: {
            'cpu': '$ENV{SCRIPT_NAME}?json=1&detail=cpu',
            'memory': '$ENV{SCRIPT_NAME}?json=1&detail=memory',
            'network': '$ENV{SCRIPT_NAME}?json=1&detail=network'
        }
    };

    function showModal(resource) {
        if (!['cpu', 'memory', 'network'].includes(resource)) return;
        fetch(window.realtimeConfig.detailEndpoints[resource], { cache: 'no-cache' })
            .then(response => response.json())
            .then(data => {
                let html = '<div class="modal-content">';
                html += '<span class="close-btn" onclick="this.parentElement.parentElement.remove()">&times;</span>';
                html += '<h2>' + resource.toUpperCase() + ' Details</h2>';
                html += '<table class="tbl"><thead><tr>';
                if (resource === 'network') {
                    html += '<th>Interface</th><th>IP</th><th>RX (MB/s)</th><th>TX (MB/s)</th>';
                } else {
                    html += '<th>PID</th><th>Command</th><th>' + (resource === 'cpu' ? 'CPU (%)' : 'Memory') + '</th>';
                }
                html += '</tr></thead><tbody>';
                data.forEach(row => {
                    html += '<tr>';
                    if (resource === 'network') {
                        html += '<td>' + (row['if'] || '-') + '</td><td>' + (row.ip || '-') + '</td><td>' + (row.rx_rate || '-') + '</td><td>' + (row.tx_rate || '-') + '</td>';
                    } else {
                        html += '<td>' + (row.pid || '-') + '</td><td>' + (row.command || '-') + '</td><td>' + (resource === 'cpu' ? row.cpu : row.mem) + '</td>';
                    }
                    html += '</tr>';
                });
                html += '</tbody></table></div>';

                const modal = document.createElement('div');
                modal.className = 'modal';
                modal.style.display = 'block';
                modal.innerHTML = html;
                document.body.appendChild(modal);
                window.currentModalResource = resource;
            })
            .catch(error => {
                console.error('Failed to fetch details for ' + resource + ':', error);
                const errorMsg = document.querySelector('#error_msg');
                errorMsg.textContent = 'Error loading ' + resource + ' details: ' + error.message;
                errorMsg.style.display = 'block';
            });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const resourceSelect = document.querySelector('select[name="resource"]');
        const refreshIntervalSelect = document.querySelector('#refresh_interval');
        let refreshIntervalId = null;

        if (resourceSelect) {
            resourceSelect.addEventListener('change', () => {
                const selectedResource = resourceSelect.value;
                const existingModal = document.querySelector('.modal');
                if (existingModal) existingModal.remove();

                if (selectedResource && selectedResource !== 'none' && selectedResource !== 'all') {
                    showModal(selectedResource);
                } else {
                    window.currentModalResource = null;
                }
            });

            if (resourceSelect.value && resourceSelect.value !== 'none' && resourceSelect.value !== 'all') {
                showModal(resourceSelect.value);
            }
        }

        function updateModal() {
            if (window.currentModalResource && ['cpu', 'memory', 'network'].includes(window.currentModalResource)) {
                const existingModal = document.querySelector('.modal');
                if (existingModal) existingModal.remove();
                showModal(window.currentModalResource);
            }
        }

        if (refreshIntervalSelect) {
            refreshIntervalSelect.addEventListener('change', () => {
                const interval = parseInt(refreshIntervalSelect.value) * 1000;
                if (refreshIntervalId) clearInterval(refreshIntervalId);
                if (interval > 0) {
                    refreshIntervalId = setInterval(() => {
                        document.dispatchEvent(new Event('realtimeRefresh'));
                        updateModal();
                    }, interval);
                }
            });

            if (refreshIntervalSelect.value && parseInt(refreshIntervalSelect.value) > 0) {
                refreshIntervalId = setInterval(() => {
                    document.dispatchEvent(new Event('realtimeRefresh'));
                    updateModal();
                }, parseInt(refreshIntervalSelect.value) * 1000);
            }
        }
    });
</script>
END_HTML
);

&Header::openbigbox('100%', 'left');
&Header::opensection();

my $filter_text = '';
if ($search_enabled && $resource_filter) {
    $filter_text = ($Lang::tr{'resource'} || 'Resource') . ': ' . encode_entities($resource_filter);
}

my $row_count_html = $filter_text
    ? '<p><b>' . ($Lang::tr{'filtered_by'} || 'Filtered by') . ' '
      . encode_entities($filter_text)
      . ' <span id="row_count">(0 ' . ($Lang::tr{'metrics'} || 'Metrics') . ')</span></b></p>'
    : '<p><span id="row_count">(0 ' . ($Lang::tr{'metrics'} || 'Metrics') . ')</span></p>';

print <<END_HTML;
<form method='get' action='$ENV{SCRIPT_NAME}'>
    <label>
        <input type='checkbox' id='search_toggle' name='search_enabled' class='filter-field' @{[ $search_enabled ? 'checked' : '' ]}>
        @{[ $Lang::tr{'search'} || 'Search' ]}
    </label>
    <div class='search_fields' style='margin-top:10px;'>
        <label>@{[ $Lang::tr{'resource'} || 'Resource' ]}:
            <select name='resource' class='filter-field'>
                <option value='none' @{[ $resource_filter eq 'none' ? 'selected' : '' ]}>None</option>
                <option value='all' @{[ $resource_filter eq 'all' ? 'selected' : '' ]}>All</option>
                <option value='cpu' @{[ $resource_filter eq 'cpu' ? 'selected' : '' ]}>CPU</option>
                <option value='memory' @{[ $resource_filter eq 'memory' ? 'selected' : '' ]}>Memory</option>
                <option value='disk' @{[ $resource_filter eq 'disk' ? 'selected' : '' ]}>Disk</option>
                <option value='network' @{[ $resource_filter eq 'network' ? 'selected' : '' ]}>Network</option>
                <option value='system' @{[ $resource_filter eq 'system' ? 'selected' : '' ]}>System</option>
            </select>
        </label>
        <input type='submit' value='@{[ $Lang::tr{'search'} || 'Search' ]}' />
    </div>
    $row_count_html
    <label style='margin-top:10px; display:block;'>@{[ $Lang::tr{'refresh interval'} || 'Refresh interval' ]}:
        <select id='refresh_interval' name='refresh_interval' class='filter-field'>
            <option value='0' @{[ $refresh_interval == 0 ? 'selected' : '' ]}>@{[ $Lang::tr{'disabled'} || 'Disabled' ]}</option>
            <option value='2' @{[ $refresh_interval == 2 ? 'selected' : '' ]}>2</option>
            <option value='5' @{[ $refresh_interval == 5 ? 'selected' : '' ]}>5</option>
            <option value='10' @{[ $refresh_interval == 10 ? 'selected' : '' ]}>10</option>
        </select>
    </label>
</form>

<div id="error_msg" style="color:red; display:none; margin-top:10px;"></div>

<div class='table-hint' style="margin-top:8px; color:#444; font-size:90%;">
    @{[ $Lang::tr{'click_on_resource_to_see_processes'} || 'Click on resource to see processes' ]} (CPU, Memory, Network)
</div>
<br>
<table class="tbl">
    <thead>
        <tr>
            <th data-sort="resource">@{[ $Lang::tr{'resource'} || 'Resource' ]}</th>
            <th data-sort="usage">@{[ $Lang::tr{'usage'} || 'Usage' ]}</th>
            <th data-sort="value">@{[ $Lang::tr{'value'} || 'Value' ]}</th>
            <th data-sort="details">@{[ $Lang::tr{'details'} || 'Details' ]}</th>
        </tr>
    </thead>
    <tbody>
        <tr><td colspan="4" style="text-align:center;">Loading hardware data...</td></tr>
    </tbody>
</table>
END_HTML

&Header::closebigbox();
&Header::closepage();

1;
