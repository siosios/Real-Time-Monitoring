#!/usr/bin/perl
###############################################################################
# File/path: /srv/web/ipfire/cgi-bin/firewalllogs-realtime.cgi                #
# Purpose: Generates the IPFire Web UI for displaying grouped firewall log     #
#          data and raw logs, handling CGI parameters, and serving JSON for    #
#          AJAX requests.                                                     #
# Version: 0.9.15                                                             #
# Author: ummeegge                                                            #
# License: GNU General Public License, version 3 or later                     #
# Last Modified: August 5, 2025                                               #
###############################################################################

use strict;
use warnings;
use CGI;
use POSIX qw(strftime);
use JSON::PP;
use File::stat;
use HTML::Entities;

require '/var/ipfire/general-functions.pl';
require '/var/ipfire/location-functions.pl';
require '/var/ipfire/header.pl';
require '/var/ipfire/lang.pl';
require '/var/ipfire/realtime/zoneutils.pm';
require '/var/ipfire/realtime/firewalllogs.pm';

my $debug_level = 1;

sub debug {
    my ($level, $message) = @_;
    return if !defined $message || $level > $debug_level;
    my $timestamp = strftime("%a %b %d %H:%M:%S %Y", localtime);
    my $prefix = $level == 1 ? "[INFO]" : "[DEBUG]";
    print STDERR "$prefix [$timestamp] Firewalllogs Realtime: $message\n";
}

my $cgi = CGI->new();
my $group = $cgi->param('group') || 'ip';
my $limit = $cgi->param('limit') || 10;
my $raw_limit = $cgi->param('raw_limit') || 50;
my $refresh = $cgi->param('refresh') || 0;
my $json = $cgi->param('json') || '';
my $raw_logs = $cgi->param('raw_logs') || '';
my $search_ip = $cgi->param('search_ip') || '';
my $search_port = $cgi->param('search_port') || '';
my $search_interface = $cgi->param('search_interface') || '';
my $search_action = $cgi->param('search_action') || '';
my $search_protocol = $cgi->param('search_protocol') || '';
my $search_enabled = $cgi->param('search_enabled') || '';

my @now = localtime();
my $today_day = $now[3];
my $today_month = $now[4];
my $log_file = '/var/log/messages';
my $mtime = stat($log_file)->mtime || time();
my $today_year = (localtime($mtime))[5] + 1900;
my $day = $cgi->param('day') || $today_day;
my $month = $cgi->param('month') || $today_month + 1;
my $year = $cgi->param('year') || $today_year;

$day = $today_day unless defined $day && $day =~ /^\d+$/ && $day >= 1 && $day <= 31;
$month = $today_month + 1 unless defined $month && $month =~ /^\d+$/ && $month >= 1 && $month <= 12;
my $internal_month = $month - 1;
$year = $today_year unless defined $year && $year =~ /^\d+$/ && $year >= 2000 && $year <= 2100;

if ($limit) {
    $limit =~ s/\D//g;
    $limit = 10 unless $limit > 0;
    debug(2, "Sanitized limit: '$limit'");
}
if ($raw_limit) {
    $raw_limit =~ s/\D//g;
    $raw_limit = 50 unless $raw_limit > 0;
    debug(2, "Sanitized raw_limit: '$raw_limit'");
}

debug(1, "CGI params: day=" . ($cgi->param('day') // 'undef') . ", month=" . ($cgi->param('month') // 'undef') . ", year=" . ($cgi->param('year') // 'undef'));
debug(1, "Processed: day=$day, month=$internal_month, year=$year, today_day=$today_day, today_month=$today_month, today_year=$today_year");

my $date_str = sprintf("%04d-%02d-%02d", $year, $month, $day);

my $filter_text = '';
if ($search_enabled) {
    my @filter_parts;
    push @filter_parts, ($Lang::tr{'ip address'} || 'IP address') . ": " . encode_entities($search_ip // '') if $search_ip ne '';
    push @filter_parts, ($Lang::tr{'port'} || 'Port') . ": " . encode_entities($search_port // '') if $search_port ne '';
    push @filter_parts, ($Lang::tr{'interface'} || 'Interface') . ": " . encode_entities($search_interface // '') if $search_interface ne '';
    push @filter_parts, ($Lang::tr{'action'} || 'Action') . ": " . encode_entities($search_action // '') if $search_action ne '';
    push @filter_parts, ($Lang::tr{'protocol'} || 'Protocol') . ": " . encode_entities($search_protocol // '') if $search_protocol ne '';
    $filter_text = join(", ", @filter_parts) if @filter_parts;
}

if ($json) {
    print $cgi->header('application/json');
    my $data = Realtime::FirewallLogs::fetch({
        group => $group,
        limit => $limit,
        day => $day,
        month => $internal_month,
        year => $year
    });

    my $raw_logs_data = [];
    my $last_pos = 0;
    if ($raw_logs || ($day == $today_day && $internal_month == $today_month && $year == $today_year)) {
        ($raw_logs_data, $last_pos) = Realtime::FirewallLogs::fetch_raw({
            is_search => $search_enabled,
            refresh => $refresh,
            search_ip => $search_ip,
            search_port => $search_port,
            search_interface => $search_interface,
            search_action => $search_action,
            search_protocol => $search_protocol,
            month => $internal_month,
            day => $day,
            year => $year,
            limit => $raw_limit
        });
    }

    my ($interfaces, $actions) = Realtime::FirewallLogs::fetch_filters({
        month => $internal_month,
        day => $day,
        year => $year,
        search_interface => $search_interface
    });

    my $json_data = $raw_logs ? $raw_logs_data : {
        grouped => $data,
        raw_logs => $raw_logs_data,
        last_pos => $last_pos,
        interfaces => $interfaces,
        actions => $actions,
        filter_text => $filter_text ? $filter_text : 'None',
        limit => $limit,
        raw_limit => $raw_limit
    };
    debug(2, "JSON response prepared: grouped=" . scalar(@$data) . " entries, raw_logs=" . scalar(@$raw_logs_data) . " entries, interfaces=" . scalar(@$interfaces) . ", actions=" . scalar(@$actions));
    print JSON::PP::encode_json($json_data);
    exit;
}

my $extra_header = '<script src="/include/ipfire-realtime.js"></script>';

&Header::showhttpheaders();
&Header::openpage($Lang::tr{'firewall logs'} . " – $date_str", 1, $extra_header);
&Header::openbigbox('100%', 'left', '', '');

print qq|
<div style="margin-bottom: 1em;">
    <form method="get" action="" id="fwlogform">
        <label style='display:block;'>$Lang::tr{'connections refresh interval'}:
            <select id='refresh_interval' name='refresh' class='filter-field'>
                <option value='0' @{[$refresh == 0 ? 'selected' : '']}>$Lang::tr{'disabled'}</option>
                <option value='2' @{[$refresh == 2 ? 'selected' : '']}>2</option>
                <option value='5' @{[$refresh == 5 ? 'selected' : '']}>5</option>
                <option value='10' @{[$refresh == 10 ? 'selected' : '']}>10</option>
                <option value='30' @{[$refresh == 30 ? 'selected' : '']}>30</option>
                <option value='60' @{[$refresh == 60 ? 'selected' : '']}>60</option>
            </select>
        </label>
        <label style='margin-top:10px; display:block;'>$Lang::tr{'limit'}:
            <input type='number' name='limit' class='filter-field' value='$limit' min='1' step='1' />
        </label>
        <div style='margin-top:10px;'>
            <select name="group" class="filter-field" onchange="document.getElementById('fwlogform').submit()">
                <option value="ip" @{[$group eq 'ip' ? "selected" : ""]}>$Lang::tr{'ip address'}</option>
                <option value="port" @{[$group eq 'port' ? "selected" : ""]}>$Lang::tr{'port'}</option>
                <option value="country" @{[$group eq 'country' ? "selected" : ""]}>$Lang::tr{'country'}</option>
            </select>
            $Lang::tr{'day'}: <input type="number" name="day" class="filter-field" min="1" max="31" value="$day"/>
            $Lang::tr{'month'}: <input type="number" name="month" class="filter-field" min="1" max="12" value="$month"/>
            $Lang::tr{'year'}: <input type="number" name="year" class="filter-field" min="2000" max="2100" value="$year"/>
            <input type="submit" value="$Lang::tr{'show'}"/>
        </div>
    </form>
</div>
<div id="error_msg" style="color: red; display: none;"></div>
|;

&Header::openbox('100%', 'left', $Lang::tr{'firewall log grouped'} . " – " . ucfirst($group) . " ($date_str)");
debug(1, "Rendering grouped table for group=$group, date=$date_str");

my $columns_def = "{ key: 'details', title: '', type: 'details' }," .
                  "{ key: 'key', title: '" . ($group eq 'ip' ? $Lang::tr{'ip address'} : $group eq 'port' ? $Lang::tr{'port'} : $Lang::tr{'country'}) . "', type: '$group' }";
$columns_def .= ",{ key: 'key_flag_icon', title: '" . $Lang::tr{'country'} . "', type: 'flag' }" if $group eq 'ip';
$columns_def .= ",{ key: 'count', title: '" . $Lang::tr{'count'} . "', type: 'number' }," .
                "{ key: 'percent', title: '" . $Lang::tr{'percent'} . "', type: 'percent' }";

print qq|
<table id="grouped_table" class="tbl" width="100%" style="margin-top:2em;">
    <thead>
        <tr>
            <th width="10%" align="center"></th>
            <th data-sort="key">@{[$group eq 'ip' ? $Lang::tr{'ip address'} : $group eq 'port' ? $Lang::tr{'port'} : $Lang::tr{'country'}]}</th>
            @{[$group eq 'ip' ? '<th>' . $Lang::tr{'country'} . '</th>' : '']}
            <th data-sort="count">$Lang::tr{'count'}</th>
            <th data-sort="percent">$Lang::tr{'percent'}</th>
        </tr>
    </thead>
    <tbody>
        <tr><td colspan="@{[$group eq 'ip' ? 5 : 4]}" style="text-align:center;">$Lang::tr{'loading firewall logs'}</td></tr>
    </tbody>
</table>
<script>
window.realtimeConfig = {
    endpoint: '$ENV{'SCRIPT_NAME'}?json=1',
    columns: [$columns_def],
    defaultSort: { column: 'count', direction: 'desc' },
    countLabel: '$Lang::tr{'entries'}',
    refreshInterval: $refresh,
    day: $day,
    month: $internal_month,
    year: $year,
    group: '$group',
    limit: $limit,
    hasRawLogs: true,
    mainTableSelector: '#grouped_table tbody',
    rawTableSelector: '#raw_logs_table tbody',
    searchFormSelector: '#raw_logs_search_form',
    enablePagination: true
};
</script>
|;
&Header::closebox();

if ($day == $today_day && $internal_month == $today_month && $year == $today_year) {
    &Header::openbox('100%', 'left', $Lang::tr{'latest firewall logs'});
    debug(1, "Rendering raw logs table for $date_str");
    print qq|
    <div id="raw_logs_container">
        <p @{[ $search_enabled ? "" : "style='display:none;'" ]}><b>$Lang::tr{'logs filtered_by'} @{[ encode_entities($filter_text ? $filter_text : 'None') ]} <span id='row_count'>(0 $Lang::tr{'entries'})</span></b></p>
        <form id="raw_logs_search_form" style="margin-bottom: 1em;">
            <label>
                <input type='checkbox' id='search_toggle' name='search_enabled' class='filter-field' @{[ $search_enabled ? 'checked' : '' ]}>
                $Lang::tr{'search'}
            </label>
            <div class='search_fields' style='margin-top:10px; @{[ $search_enabled ? "" : "display:none;" ]}'>
                <div style='display:flex; gap:20px; margin-bottom:10px;'>
                    <label>$Lang::tr{'ip address'}: <input type='text' name='search_ip' class='filter-field' value='@{[encode_entities($search_ip // '')]}' placeholder='e.g., 192 or .110.' /></label>
                    <label>$Lang::tr{'port'}: <input type='number' name='search_port' class='filter-field' value='@{[encode_entities($search_port // '')]}' min='1' max='65535' placeholder='1-65535' /></label>
                    <label>$Lang::tr{'protocol'}: <input type='text' name='search_protocol' class='filter-field' value='@{[encode_entities($search_protocol // '')]}' placeholder='e.g., TCP' /></label>
                </div>
                <div style='display:flex; gap:20px; margin-bottom:10px;'>
                    <label>$Lang::tr{'interface'}: 
                        <select name='search_interface' class='filter-field' onchange='updateActions()'>
                            <option value=''>Any Interface</option>
                        </select>
                    </label>
                    <label>$Lang::tr{'action'}: 
                        <select name='search_action' class='filter-field'>
                            <option value=''>Any Action</option>
                        </select>
                    </label>
                    <label>$Lang::tr{'limit'}: <input type='number' name='raw_limit' class='filter-field' value='$raw_limit' min='1' step='1' /></label>
                </div>
                <div style='margin-bottom:10px;'>
                    <input type='submit' value='$Lang::tr{'search'}' />
                    <input type='button' value='$Lang::tr{'reset'}' onclick='resetSearchFields()' />
                </div>
            </div>
        </form>
        <table id="raw_logs_table" class="tbl" width="100%" style="margin-top:1em;">
            <thead>
                <tr>
                    <th>Timestamp</th>
                    <th>SRC</th>
                    <th>SPT</th>
                    <th>IN</th>
                    <th>DST</th>
                    <th>DPT</th>
                    <th>OUT</th>
                    <th>Protocol</th>
                    <th>Flag</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                <tr><td colspan="10" style="text-align:center;">Loading raw logs...</td></tr>
            </tbody>
        </table>
    </div>
    |;
    &Header::closebox();
}

&Header::closebigbox();
&Header::closepage();

exit 0;