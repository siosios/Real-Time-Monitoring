#!/usr/bin/perl
###############################################################################
# File/path: /srv/web/ipfire/cgi-bin/firewalllogs-realtime.cgi                #
# Purpose: Generates the IPFire Web UI for displaying grouped firewall log     #
#          data, handling CGI parameters, and serving JSON for AJAX requests.  #
# Version: 0.9                                                                #
# Author: ummeegge                                                            #
# License: GNU General Public License, version 3 or later                     #
# Last Modified: July 22, 2025                                                #
###############################################################################

use strict;
use warnings;
use CGI;
use POSIX();
use JSON::PP;

# Load required IPFire modules
require '/var/ipfire/general-functions.pl';
require '/var/ipfire/location-functions.pl';
require '/var/ipfire/header.pl';
require '/var/ipfire/realtime/realtime-functions.pl';
require '/var/ipfire/realtime/zoneutils.pm';

# Initialize CGI object
my $cgi = CGI->new();
my $group = $cgi->param('group') || 'ip';     # Group by: ip | port | country
my $limit = $cgi->param('limit') || 10;       # Number of entries to display
my $refresh = $cgi->param('refresh') || 0;    # Auto-refresh interval in seconds
my $json = $cgi->param('json') || '';         # JSON mode for AJAX requests

# Date parameters: fallback to today if not provided
my @now = localtime();
my $today_day = $now[3];
my $today_month = $now[4];
my $today_year = $now[5] + 1900;
my $day = $cgi->param('day');
my $month = $cgi->param('month');

# Validate date inputs
$day = $today_day unless defined $day && $day =~ /^\d+$/ && $day >= 1 && $day <= 31;
$month = (defined $month && $month =~ /^\d+$/ && $month >= 1 && $month <= 12) ? $month - 1 : $today_month;
my $year = $today_year unless defined $cgi->param('year') && $cgi->param('year') =~ /^\d+$/;

# Format date for display
my $date_str = sprintf("%04d-%02d-%02d", $year, $month + 1, $day);

# JSON mode for AJAX requests
if ($json) {
    print $cgi->header('application/json');
    my $data = Realtime::fetch_data('firewalllogs', 
        group => $group,
        limit => $limit,
        day => $day,
        month => $month,
        year => $year
    );
    print JSON::PP::encode_json($data);
    exit;
}

# HTML mode for browser rendering
# Include JavaScript for dynamic table rendering
my $extra_header = Realtime::include_realtime_script();

# Output HTTP headers and start page
&Header::showhttpheaders();
&Header::openpage("Firewall Log - Grouped – $date_str", 1, $extra_header);
&Header::openbigbox('100%', 'left', '', '');

# Page title
print "<h2>Firewall Log – <b>" . ucfirst($group) . "</b> ($date_str)</h2>";

# Form for filtering and refresh
print qq|
<form method="get" action="" id="fwlogform" style="margin-bottom:1em;">
    <select name="group" class="filter-field" onchange="document.getElementById('fwlogform').submit()">
        <option value="ip" @{[$group eq 'ip' ? "selected" : ""]}>IP</option>
        <option value="port" @{[$group eq 'port' ? "selected" : ""]}>Port</option>
        <option value="country" @{[$group eq 'country' ? "selected" : ""]}>Country</option>
    </select>
    Limit: <input name="limit" type="number" class="filter-field" value="$limit" min="1" max="100"/>
    Day: <input type="number" name="day" class="filter-field" min="1" max="31" value="$day"/>
    Month: <input type="number" name="month" class="filter-field" min="1" max="12" value="|.($month + 1).qq|"/>
    Year: <input type="number" name="year" class="filter-field" min="2000" max="2100" value="$year"/>
|;

# Add refresh options for current day
if ($day == $today_day && $month == $today_month && $year == $today_year) {
    print qq|
    Refresh: <select name="refresh" class="filter-field" id="refresh_interval">
        <option value="0" @{[$refresh == 0 ? 'selected' : '']}>Off</option>
        <option value="5" @{[$refresh == 5 ? 'selected' : '']}>5s</option>
        <option value="10" @{[$refresh == 10 ? 'selected' : '']}>10s</option>
        <option value="30" @{[$refresh == 30 ? 'selected' : '']}>30s</option>
        <option value="60" @{[$refresh == 60 ? 'selected' : '']}>60s</option>
    </select>
    |;
} else {
    print qq|<input type="hidden" name="refresh" value="0" />|;
}

print qq| <input type="submit" value="Show"/>
</form>
<div id="error_msg" style="color: red; display: none;"></div>
|;

# Table structure (populated by JavaScript)
my $columns_def = "{ key: 'details', title: '', type: 'details' }," .
                  "{ key: 'key', title: '" . ($group eq 'ip' ? 'IP' : $group eq 'port' ? 'Port' : 'Country') . "', type: '$group' }";
$columns_def .= ",{ key: 'key_flag_icon', title: 'Country', type: 'flag' }" if $group eq 'ip';
$columns_def .= ",{ key: 'count', title: 'Count', type: 'number' }," .
                "{ key: 'percent', title: 'Percent', type: 'number' }";

print qq|
<table class="tbl" width="100%" style="margin-top:2em">
    <thead>
        <tr>
            <th width="10%" align="center"></th>
            <th data-sort="key">@{[$group eq 'ip' ? 'IP' : $group eq 'port' ? 'Port' : 'Country']}</th>
            @{[$group eq 'ip' ? '<th>Country</th>' : '']}
            <th data-sort="count">Count</th>
            <th data-sort="percent">Percent</th>
        </tr>
    </thead>
    <tbody>
        <tr><td colspan="@{[$group eq 'ip' ? 4 : 3]}" style="text-align:center;">Loading firewall logs...</td></tr>
    </tbody>
</table>
<script>
window.realtimeConfig = {
    endpoint: '$ENV{'SCRIPT_NAME'}?json=1',
    columns: [$columns_def],
    defaultSort: { column: 'count', direction: 'desc' },
    countLabel: 'entries',
    refreshInterval: $refresh,
    day: $day,
    month: $month,
    year: $year,
    group: '$group'
};
</script>
|;

# Complete page layout
&Header::closebigbox();
&Header::closepage();
exit 0;
