#!/usr/bin/perl

###############################################################################
# File/path: /var/ipfire/realtime/connections.pm
#
# Purpose: Handles real-time connection tracking data for IPFire firewall.
# Functions: fetch() to get current connection info filtered and colored.
#
# Usage: Included by realtime-functions.pl under 'connections' handler.
# Version: 0.8                                                                 
# Author: ummeegge                                                             
#                                                                              
# License: GNU General Public License, version 3 or later                      
# Last Modified: July 21, 2025                                                 
###############################################################################

package Realtime::Connections;
use strict;
use warnings;

require '/var/ipfire/general-functions.pl';
require '/var/ipfire/network-functions.pl';
require '/var/ipfire/ids-functions.pl';
require '/var/ipfire/location-functions.pl';
require '/var/ipfire/header.pl';
require '/var/ipfire/realtime/zoneutils.pm';  # <-- Jetzt zentral!

# --- Debugging configuration ---
my $debug_level = 0; # Debug level: 0=none, 1=info (default), 2=full debug

# Debugging function
sub debug {
    my ($level, $message) = @_;
    return if !defined $message || $level > $debug_level;
    my $timestamp = scalar localtime;
    my $prefix = $level == 1 ? "[INFO]" : "[DEBUG]";
    print STDERR "$prefix [$timestamp] Realtime::Connections: $message\n";
}

sub fetch {
    my ($filters) = @_;
    my @table_data = ();

    debug(1, "Starting fetch() to collect connection data");

    # Pull conntrack lines
    my @conntrack_data = &General::system_output("/usr/local/bin/getconntracktable");
    debug(1, "Retrieved " . scalar(@conntrack_data) . " conntrack entries");

    # TTL-sort
    my @sorted_conntrack = sort {
        my ($ttl_a) = $a =~ /[\w\s]+ (\d+) /;
        my ($ttl_b) = $b =~ /[\w\s]+ (\d+) /;
        ($ttl_b || 0) <=> ($ttl_a || 0)
    } @conntrack_data;

    # Process each conntrack line
    foreach my $line (@sorted_conntrack) {
        # Skip empty or invalid lines
        next unless $line && $line =~ /\S/;
        debug(2, "Processing conntrack line: $line");

        # Parse protocol, TTL, and fields; status is optional for UDP/ICMP
        unless ($line =~ /^ipv4\s+\d+\s+(\w+)\s+\d+\s+(\d+)\s+(?:(?:\w+)\s+)?(.+)/) {
            debug(1, "Skipping invalid conntrack line: $line");
            next;
        }
        my ($l4proto, $ttl, $fields) = ($1, $2, $3);
        my $conn_state = $l4proto eq 'udp' || $l4proto eq 'icmp'
            ? 'NONE'
            : ($line =~ /\s+(\w+)\s+src=/ && $1) || 'UNKNOWN';
        debug(2, "Parsed: proto=$l4proto, ttl=$ttl, state=$conn_state, fields=$fields");

        # Parse direction fields (handle TCP/UDP and ICMP differently)
        my ($dir1_raw, $dir2_raw);
        if ($l4proto eq 'icmp') {
            ($dir1_raw, $dir2_raw) = $fields =~
                /(src=\S+\s+dst=\S+\s+type=\d+\s+code=\d+\s+id=\d+\s+packets=\d+\s+bytes=\d+)\s+
                 (src=\S+\s+dst=\S+\s+type=\d+\s+code=\d+\s+id=\d+\s+packets=\d+\s+bytes=\d+.*)?/x;
        } else {
            ($dir1_raw, $dir2_raw) = $fields =~
                /(src=\S+\s+dst=\S+\s+sport=\d+\s+dport=\d+\s+packets=\d+\s+bytes=\d+)\s+
                 (src=\S+\s+dst=\S+\s+sport=\d+\s+dport=\d+\s+packets=\d+\s+bytes=\d+.*)?/x;
        }

        unless ($dir1_raw && $dir2_raw) {
            debug(1, "Skipping line with missing direction fields: $line");
            next;
        }

        my %dir1 = $dir1_raw =~ /(\w+)=([^\s]+)/g;
        my %dir2 = $dir2_raw =~ /(\w+)=([^\s]+)/g;

        # For ICMP, use type/code as placeholders for sport/dport
        my $sip       = $dir1{src}   || '';
        my $dip       = $dir1{dst}   || '';
        my $sport     = $l4proto eq 'icmp' ? ($dir1{type} . '/' . ($dir1{code} || '0')) : ($dir1{sport} || '');
        my $dport     = $l4proto eq 'icmp' ? ($dir2{type} . '/' . ($dir2{code} || '0')) : ($dir1{dport} || '');
        my $bytes_out = $dir1{bytes} || 0;
        my $bytes_in  = $dir2{bytes} || 0;

        # Optional flag
        my ($assured_flag) = $fields =~ /\[(\w+)\]/;
        $assured_flag //= '';
        debug(2, "Connection: $sip:$sport -> $dip:$dport, proto=$l4proto, state=$conn_state, assured=$assured_flag");

        # -------- Filtering, wenn aktiviert (optional) --------
        if ($filters->{search_enabled}) {
            my @zones = ref($filters->{zones}) eq 'ARRAY' ? @{$filters->{zones}} : ();
            my $ip = $filters->{ip} || '';
            my $port = $filters->{port} || '';
            my $proto = $filters->{protocol} || '';

            if (@zones) {
                my ($src_zone, undef) = Realtime::ZoneUtils::get_zone_info($sip);
                my ($dst_zone, undef) = Realtime::ZoneUtils::get_zone_info($dip);
                debug(2, "Zones: src=$src_zone, dst=$dst_zone");
                next unless grep { $_ eq $src_zone || $_ eq $dst_zone } @zones;
            }
            next if $ip    && $sip !~ /\Q$ip\E/ && $dip !~ /\Q$ip\E/;
            next if $port  && $sport ne $port && $dport ne $port;
            next if $proto && $l4proto !~ /\Q$proto\E/i;
        }
        # -------- Ende Filtering --------

        my ($src_zone, $src_colour) = Realtime::ZoneUtils::get_zone_info($sip);
        my ($dst_zone, $dst_colour) = Realtime::ZoneUtils::get_zone_info($dip);

        my $src_flag      = &Location::Functions::lookup_country_code($sip) || '';
        my $dst_flag      = &Location::Functions::lookup_country_code($dip) || '';
        my $src_flag_icon = $src_flag ? "/images/flags/$src_flag.png" : '/images/flags/unknown.png';
        my $dst_flag_icon = $dst_flag ? "/images/flags/$dst_flag.png" : '/images/flags/unknown.png';

        push @table_data, {
            protocol          => $l4proto,
            src_ip            => $sip,
            src_ip_colour     => $src_colour,
            src_zone          => $src_zone,
            src_port          => $sport,
            src_port_colour   => $src_colour,
            dst_ip            => $dip,
            dst_ip_colour     => $dst_colour,
            dst_zone          => $dst_zone,
            dst_port          => $dport,
            dst_port_colour   => $dst_colour,
            bytes_in          => &General::formatBytes($bytes_in),
            bytes_out         => &General::formatBytes($bytes_out),
            bytes_in_raw      => $bytes_in,
            bytes_out_raw     => $bytes_out,
            state             => $conn_state,
            assured           => $assured_flag,
            ttl               => &General::format_time($ttl),
            src_flag_icon     => $src_flag_icon,
            dst_flag_icon     => $dst_flag_icon,
            src_country       => $src_flag,
            dst_country       => $dst_flag,
            # Optional: dst_port_colour, src_port_colour, wenn du Ports einfärben möchtest
        };
    }

    debug(1, "Returning " . scalar(@table_data) . " connection entries");
    return \@table_data;
}

1;
