#!/usr/bin/perl
###############################################################################
# File/path: /var/ipfire/realtime/firewalllogs.pm                             #
# Purpose: Aggregates firewall log entries by IP, port, or country for         #
#          IPFire Web UI, returning grouped data with zone colors and flags.   #
# Version: 0.9                                                                #
# Author: ummeegge                                                            #
# License: GNU General Public License, version 3 or later                     #
# Last Modified: July 22, 2025                                                #
###############################################################################

package Realtime::FirewallLogs;
use strict;
use warnings;

# Load required IPFire modules
require '/var/ipfire/general-functions.pl';
require '/var/ipfire/location-functions.pl';
require '/var/ipfire/realtime/zoneutils.pm';

sub fetch {
    my ($params) = @_;
    # Default grouping to 'ip' if not specified
    my $group = $params->{group} // 'ip';    # ip | port | country
    # Default limit to 10 entries
    my $limit = $params->{limit} // 10;

    # Date logic: fallback to today if not provided
    my ($day, $month, $year) = @{$params}{qw(day month year)};
    my @shortmonths = qw(Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec);
    my @now = localtime();
    $month //= $now[4];
    $day //= $now[3];
    $year //= $now[5] + 1900;

    # Format month and day for log file parsing
    my $monthstr = $shortmonths[$month];
    my $daystr = $day < 10 ? " $day" : "$day";
    my @logfiles = ("/var/log/messages");

    # Initialize data structures
    my %counter;    # Count occurrences of each key
    my %zone_map;   # Store zone colors for each key
    my %flag_map;   # Store flag icons for each key
    my $total = 0;  # Total number of processed log entries
    my @final;      # Array to store final results

    # Process each log file
    foreach my $file (@logfiles) {
        open my $fh, "<", $file or do {
            warn "Cannot open log file $file: $!";
            return [{ error => "Cannot open log file: $file" }]; # Return error for JSON
        };
        while (<$fh>) {
            # Only process firewall/kernel log lines
            next unless /^$monthstr $daystr\s+\d\d:\d\d:\d\d .* kernel:/;

            my ($key, $srcip, $zone_colour, $flag_icon);
            if ($group eq 'ip') {
                ($key) = /SRC=(\S+)/;
                $srcip = $key;
                $zone_colour = ($srcip) ? (Realtime::ZoneUtils::get_zone_info($srcip))[1] : '';
                $flag_icon = ($srcip) ? (&Location::Functions::get_flag_icon(&Location::Functions::lookup_country_code($srcip) || 'unknown')) : '/images/flags/unknown.png';
            }
            elsif ($group eq 'port') {
                ($key) = /DPT=(\d+)/;
                ($srcip) = /SRC=(\S+)/;
                $zone_colour = ($srcip) ? (Realtime::ZoneUtils::get_zone_info($srcip))[1] : '';
                $flag_icon = ''; # No flag for ports
            }
            elsif ($group eq 'country') {
                ($srcip) = /SRC=(\S+)/;
                $key = &Location::Functions::lookup_country_code($srcip) || 'unknown';
                $zone_colour = ($srcip) ? (Realtime::ZoneUtils::get_zone_info($srcip))[1] : '';
                $flag_icon = &Location::Functions::get_flag_icon($key) || '/images/flags/unknown.png';
            }
            else { next; }

            # Skip if key is undefined or empty
            next unless defined $key and $key ne '';
            $counter{$key}++;
            $total++;
            $zone_map{$key} = $zone_colour // '';
            $flag_map{$key} = $flag_icon // '';
        }
        close $fh;
    }

    # Sort keys by count in descending order and limit results
    my @results = sort { $counter{$b} <=> $counter{$a} } keys %counter;
    splice @results, $limit if @results > $limit;

    # Build result array
    foreach my $key (@results) {
        my $zone_name = '';
        my $zone_colour = '';
        if ($group eq 'ip' && defined $key) {
            ($zone_name, $zone_colour) = Realtime::ZoneUtils::get_zone_info($key);
        } else {
            $zone_name = '';
            $zone_colour = $zone_map{$key} // '';
        }
        my $flag_icon = $flag_map{$key} // '';
        my $info_url = $group eq 'ip' ? "/cgi-bin/ipinfo.cgi?ip=$key" :
                       $group eq 'port' ? "https://isc.sans.edu/port.html?port=$key" :
                       "/cgi-bin/country.cgi#$key";

        push @final, {
            key => $key,                    # Group value (ip/port/country)
            count => $counter{$key} // 0,   # Absolute count
            percent => $total ? sprintf("%.1f", 100 * $counter{$key} / $total) : 0,
            key_colour => $zone_colour // '', # Color for the current grouping
            key_zone => $zone_name // '',    # Zone name for IP
            zone_colour => $zone_colour // '',# Fallback for frontend renderer
            zone_name => $zone_name // '',   # Fallback for frontend tooltip/legend
            key_flag_icon => $flag_icon,     # Flag icon for IP/country
            key_info_url => $info_url,       # URL for links
        };
    }

    # Return results or error if no data found
    return @final ? \@final : [{ error => "No data found for the specified parameters" }];
}

1;
