#!/usr/bin/perl
##############################################################################
# File/path: /srv/web/ipfire/cgi-bin/connections-realtime.cgi                #
# Purpose: Generates the IPFire Web UI for displaying real-time connection   #
#          data, handling CGI parameters, and serving JSON data for AJAX     #
# Version: 0.8.3                                                             #
# Author: ummeegge                                                           #
# License: GNU General Public License, version 3 or later                    #
# Last Modified: August 5, 2025                                              #
##############################################################################

use strict;
use CGI qw(escape);
use HTML::Entities;
use JSON::PP;

require '/var/ipfire/general-functions.pl';
require "${General::swroot}/lang.pl";
require "${General::swroot}/header.pl";
require "${General::swroot}/realtime/realtime-functions.pl";
require "${General::swroot}/ids-functions.pl";
require "${General::swroot}/location-functions.pl";
require "${General::swroot}/network-functions.pl";

my $debug_level = 1;

sub debug {
    my ($level, $message) = @_;
    return if !defined $message || $level > $debug_level;
    my $timestamp = scalar localtime;
    my $prefix = $level == 1 ? "[INFO]" : "[DEBUG]";
    print STDERR "$prefix [$timestamp] $message\n";
}

my $cgi = CGI->new;
my @valid_zones = qw(LAN INTERNET DMZ Wireless IPFire VPN WireGuard OpenVPN Multicast);
my @raw_zone_params = $cgi->multi_param('zone');
debug(1, "Raw zone parameters received: " . (@raw_zone_params ? join(", ", @raw_zone_params) : "none"));
my @selected_zones = grep {
    my $z = $_;
    defined $z && $z ne '' && grep { $_ eq $z } @valid_zones
} map { CGI::escapeHTML($_) } @raw_zone_params;
debug(1, "Selected valid zones: " . (@selected_zones ? join(", ", @selected_zones) : "none"));
my %selected_zones_hash = map { $_ => 1 } @selected_zones;

my $search_ip        = $cgi->param('ip') || '';
my $search_port      = $cgi->param('port') || '';
my $search_protocol  = $cgi->param('protocol') || '';
my $search_enabled   = $cgi->param('search_enabled') || '';
my $refresh_interval = $cgi->param('refresh_interval') || 0;
my $limit           = $cgi->param('limit') || 50; # Neues Limit-Feld, Standard: 50
my $json            = $cgi->param('json') || '';
debug(2, "Parameters - IP: '$search_ip', Port: '$search_port', Protocol: '$search_protocol', Enabled: '$search_enabled', Refresh: '$refresh_interval', Limit: '$limit', JSON: '$json'");

if ($search_ip) {
    $search_ip =~ s/[^0-9.]//g;
    debug(2, "Sanitized IP: '$search_ip'");
}
if ($search_port) {
    $search_port =~ s/\D//g;
    if ($search_port < 0 || $search_port > 65535) {
        $search_port = '';
        debug(1, "Invalid port detected, reset to empty");
    }
}
if ($search_protocol) {
    $search_protocol =~ s/[^a-zA-Z0-9]//g;
    debug(2, "Sanitized protocol: '$search_protocol'");
}
if ($limit) {
    $limit =~ s/\D//g; # Nur Zahlen erlauben
    $limit = 50 unless $limit > 0; # Fallback auf 50, wenn ungültig
    debug(2, "Sanitized limit: '$limit'");
}

# Filter-Text vor dem JSON-Block erstellen
my $filter_text = '';
if (@selected_zones || $search_enabled) {
    my @filter_parts;
    if (@selected_zones) {
        my @zone_labels = grep { defined $_ } map { get_zone_label($_) } @selected_zones;
        push @filter_parts, join(", ", @zone_labels) if @zone_labels;
    }
    if ($search_enabled) {
        push @filter_parts, ($Lang::tr{'ip address'} || 'IP address') . ": " . encode_entities($search_ip) if $search_ip && $search_ip ne '';
        push @filter_parts, "$Lang::tr{'port'}: " . encode_entities($search_port) if $search_port && $search_port ne '';
        push @filter_parts, "$Lang::tr{'protocol'}: " . encode_entities($search_protocol) if $search_protocol && $search_protocol ne '';
    }
    $filter_text = join(", ", @filter_parts) if @filter_parts;
}

if ($json) {
    debug(1, "JSON API mode activated");
    print $cgi->header('application/json');
    my $data;
    eval {
        $data = Realtime::fetch_data('connections',
            search_enabled => $search_enabled,
            zones          => \@selected_zones,
            ip             => $search_ip,
            port           => $search_port,
            protocol       => $search_protocol
        );
        debug(2, "Fetched connection data: " . encode_json($data));
    };
    if ($@) {
        debug(1, "Error fetching data: $@");
        print encode_json({ error => "Failed to fetch connection data: $@" });
        exit;
    }
    unless (ref($data) eq 'ARRAY') {
        debug(1, "Invalid data format returned from fetch_data");
        print encode_json({ error => "Invalid data format" });
        exit;
    }
    if (@selected_zones) {
        $data = [ grep {
            my $entry = $_;
            my $src_zone = defined $entry->{src_zone} ? $entry->{src_zone} : '';
            my $dst_zone = defined $entry->{dst_zone} ? $entry->{dst_zone} : '';
            ($selected_zones_hash{$src_zone} || $selected_zones_hash{$dst_zone})
        } @$data ];
        debug(2, "Filtered data for zones [" . join(", ", @selected_zones) . "]: " . scalar(@$data) . " entries");
    }
    print encode_json({
        data => $data,
        limit => $limit,
        filter_text => $filter_text ? $filter_text : 'None'
    });
    exit;
}

my $colour_multicast = "#A0A0A0";
my %zones = (
    'LAN'        => ${Header::colourgreen},
    'INTERNET'   => ${Header::colourred},
    'DMZ'        => ${Header::colourorange},
    'Wireless'   => ${Header::colourblue},
    'IPFire'     => ${Header::colourfw},
    'VPN'        => ${Header::colourvpn},
    'WireGuard'  => ${Header::colourwg},
    'OpenVPN'    => ${Header::colourovpn},
    'Multicast'  => $colour_multicast,
);

&Header::showhttpheaders();
&Header::openpage(
    $Lang::tr{'connections'}, 1, <<END
<link rel="stylesheet" href="/include/ipfire-realtime.css">
<script src="/include/ipfire-realtime.js"></script>
<script>
window.realtimeConfig = {
    endpoint: '$ENV{'SCRIPT_NAME'}?json=1',
    mainTableSelector: '#connections_table tbody',
    columns: [
        { key: 'protocol', title: '$Lang::tr{"protocol"}', type: 'string' },
        { key: 'src_ip', title: '$Lang::tr{"src ip"}', type: 'ip' },
        { key: 'src_port', title: '$Lang::tr{"fwdfw use srcport"}', type: 'port' },
        { key: 'src_flag_icon', title: '$Lang::tr{"country"}', type: 'flag' },
        { key: 'dst_ip', title: '$Lang::tr{"dst ip"}', type: 'ip' },
        { key: 'dst_port', title: '$Lang::tr{"dst port"}', type: 'port' },
        { key: 'dst_flag_icon', title: '$Lang::tr{"country"}', type: 'flag' },
        { key: 'bytes_out', title: '$Lang::tr{"upload"}', type: 'bytes' },
        { key: 'bytes_in', title: '$Lang::tr{"download"}', type: 'bytes' },
        { key: 'state', title: '$Lang::tr{"connection"}<br>$Lang::tr{"status"}', type: 'string' },
        { key: 'ttl', title: '$Lang::tr{'expires'}<br>($Lang::tr{"hours:minutes:seconds"})', type: 'number' }
    ],
    defaultSort: { column: 'ttl', direction: 'desc' },
    countLabel: '$Lang::tr{"connections"}',
    refreshInterval: $refresh_interval,
    limit: $limit,
    enablePagination: true,
    hasRawLogs: true
};
</script>
END
);

&Header::openbigbox('100%', 'left');
&Header::opensection();

print <<END;
    <form method='get' action='$ENV{'SCRIPT_NAME'}' id='zone_form'>
    <table style='width:100%'>
        <tr>
            <td style='text-align:center;'>
                <b>$Lang::tr{'legend'} :</b>
            </td>
END

foreach my $zone (@valid_zones) {
    my $checked = $selected_zones_hash{$zone} ? 'checked' : '';
    my $style = $selected_zones_hash{$zone} ? "background-color: #e0e0e0;" : "";
    my $label = get_zone_label($zone) || $zone;
    print <<END;
            <td style='text-align:center; color:#FFFFFF; background-color:$zones{$zone}; font-weight:bold; $style'>
                <label style='cursor:pointer;'>
                    <input type='checkbox' name='zone' value='$zone' $checked />
                    <span style='color:#FFFFFF; text-decoration:none;'><b>$label</b></span>
                </label>
            </td>
END
}
print <<END;
        </tr>
    </table>
    <br>
    <div id="error_msg" style="color: red; display: none;"></div>
END

print "<p><b>$Lang::tr{'connections filtered_by'} " . encode_entities($filter_text ? $filter_text : 'None') . " <span id='row_count'>(0 $Lang::tr{'connections'})</span></b></p>";

print <<END;
        <label>
            <input type='checkbox' id='search_toggle' name='search_enabled' class='filter-field' @{[ $search_enabled ? 'checked' : '' ]}>
            $Lang::tr{'search'}
        </label>
        <div class='search_fields' style='margin-top:10px; @{[ $search_enabled ? "" : "display:none;" ]}'>
            <div style='display:flex; gap:20px; margin-bottom:10px;'>
                <label>$Lang::tr{'ip address'}: <input type='text' name='ip' class='filter-field' value='$search_ip' placeholder='e.g., 192 or .110.' /></label>
                <label>$Lang::tr{'port'}: <input type='number' name='port' class='filter-field' value='$search_port' min='1' max='65535' placeholder='1-65535' /></label>
                <label>$Lang::tr{'protocol'}: <input type='text' name='protocol' class='filter-field' value='$search_protocol' placeholder='e.g., TCP' /></label>
            </div>
            <div style='margin-bottom:10px;'>
                <input type='submit' value='$Lang::tr{'search'}' />
                <input type='button' value='$Lang::tr{'reset'}' onclick='resetSearchFields()' />
            </div>
        </div>
        <label style='margin-top:10px; display:block;'>$Lang::tr{'connections refresh interval'}:
            <select id='refresh_interval' name='refresh_interval' class='filter-field'>
                <option value='0' @{[ $refresh_interval == 0 ? 'selected' : '' ]}>$Lang::tr{'disabled'}</option>
                <option value='2' @{[ $refresh_interval == 2 ? 'selected' : '' ]}>2</option>
                <option value='5' @{[ $refresh_interval == 5 ? 'selected' : '' ]}>5</option>
                <option value='10' @{[ $refresh_interval == 10 ? 'selected' : '' ]}>10</option>
                <option value='30' @{[ $refresh_interval == 30 ? 'selected' : '' ]}>30</option>
                <option value='60' @{[ $refresh_interval == 60 ? 'selected' : '' ]}>60</option>
            </select>
        </label>
        <label style='margin-top:10px; display:block;'>$Lang::tr{'limit'}:
            <input type='number' name='limit' class='filter-field' value='$limit' min='1' step='1' />
        </label>
    </form>
    <br>
    <script>
        function resetSearchFields() {
            const form = document.getElementById('zone_form');
            if (form) {
                form.querySelectorAll('input[name="ip"], input[name="port"], input[name="protocol"]').forEach(input => {
                    input.value = '';
                });
                const searchToggle = form.querySelector('#search_toggle');
                if (searchToggle) {
                    searchToggle.checked = false;
                }
                const searchFields = form.querySelector('.search_fields');
                if (searchFields) {
                    searchFields.style.display = 'none';
                }
                const limitInput = form.querySelector('input[name="limit"]');
                if (limitInput) {
                    limitInput.value = '50';
                }
            }
        }
    </script>
    <table class="tbl" id="connections_table">
        <thead>
            <tr>
                <th data-sort="protocol">$Lang::tr{'protocol'}</th>
                <th data-sort="src_ip">$Lang::tr{'src ip'}</th>
                <th data-sort="src_port">$Lang::tr{'fwdfw use srcport'}</th>
                <th>$Lang::tr{'country'}</th>
                <th data-sort="dst_ip">$Lang::tr{'dst ip'}</th>
                <th data-sort="dst_port">$Lang::tr{'dst port'}</th>
                <th>$Lang::tr{'country'}</th>
                <th data-sort="bytes_out">$Lang::tr{'upload'}</th>
                <th data-sort="bytes_in">$Lang::tr{'download'}</th>
                <th data-sort="state">$Lang::tr{'connection'}<br>$Lang::tr{'status'}</th>
                <th data-sort="ttl">$Lang::tr{'expires'}<br>($Lang::tr{'hours:minutes:seconds'})</th>
            </tr>
        </thead>
        <tbody>
            <tr><td colspan="11" style="text-align:center;">Loading connections...</td></tr>
        </tbody>
    </table>
END

&Header::closesection();
&Header::closebigbox();
&Header::closepage();

sub get_zone_label {
    my $zone = shift;
    return $zone unless defined $zone && $zone ne '';
    if ($zone eq 'IPFire') {
        return 'IPFire';
    } elsif ($zone eq 'Multicast') {
        return 'Multicast';
    } elsif ($zone eq 'OpenVPN') {
        return $Lang::tr{'OpenVPN'} || 'OpenVPN';
    } else {
        return $Lang::tr{lc($zone)} || $zone;
    }
}

sub build_zone_href {
    my ($zone, $selected_zones_ref) = @_;
    return '#' unless defined $zone && $zone ne '';
    my @new_zones = @$selected_zones_ref;
    if ($selected_zones_hash{$zone}) {
        @new_zones = grep { $_ ne $zone } @new_zones;
    } else {
        push @new_zones, $zone;
    }
    my $href = "?" . join("&", map { "zone=" . CGI::escape($_) } @new_zones);
    return $href;
}

1;