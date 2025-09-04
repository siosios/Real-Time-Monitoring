#!/usr/bin/perl
###############################################################################
# File/path: /var/ipfire/realtime/firewalllogs.pm                             #
# Purpose: Aggregates firewall log entries by IP, port, or country for        #
#          IPFire Web UI, returning grouped data with zone colors and flags.  #
#          Also fetches raw logs for real-time display and search.            #
# Version: 0.9.4                                                              #
# Author: ummeegge                                                            #
# License: GNU General Public License, version 3 or later                     #
# Last Modified: September 4, 2025                                            #
###############################################################################

package Realtime::FirewallLogs;
use strict;
use warnings;
use Time::Piece;
use Fcntl qw(:seek);
use File::stat;
use POSIX qw(strftime);

# Load required IPFire modules
require '/var/ipfire/general-functions.pl';
require '/var/ipfire/location-functions.pl';
require '/var/ipfire/realtime/zoneutils.pm';

# Configure debug level: 0=none, 1=info (default), 2=full debug
my $debug_level = 1;

# Debug function to log messages with timestamp and level
sub debug {
	my ($level, $message) = @_;
	return if !defined $message || $level > $debug_level;
	my $timestamp = strftime("%a %b %d %H:%M:%S %Y", localtime);
	my $prefix = $level == 1 ? "[INFO]" : "[DEBUG]";
	print STDERR "$prefix [$timestamp] firewalllogs.pm: $message\n";
}

# Cache for search
my @cached_lines = ();
my $cache_mtime = 0;

sub fetch {
	my ($params) = @_;
	my $group = $params->{group} // 'ip';
	my $limit = $params->{limit} // 10;
	my ($day, $month, $year) = @{$params}{qw(day month year)};
	my @shortmonths = qw(Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec);
	my @now = localtime();
	$month //= $now[4];
	$day //= $now[3];
	$year //= $now[5] + 1900;

	my $monthstr = $shortmonths[$month];
	my $daystr = $day < 10 ? " $day" : "$day";
	my @logfiles = ("/var/log/messages");

	my %counter;
	my %zone_map;
	my %flag_map;
	my $total = 0;
	my @final;

	foreach my $file (@logfiles) {
		open my $fh, "<", $file or do {
			warn "Cannot open log file $file: $!";
			debug(1, "Cannot open log file: $file: $!");
			return [{ error => "Cannot open log file: $file" }];
		};
		while (<$fh>) {
			next unless /^(\w+\s+\d+\s+\d\d:\d\d:\d\d) .* kernel:/;
			my ($timestamp) = $1;
			next if defined $monthstr && defined $daystr && $monthstr ne '' && $daystr ne '' && !/^$monthstr $daystr\s+\d\d:\d\d:\d\d/;

			my ($key, $srcip, $zone_colour, $flag_icon);
			if ($group eq 'ip') {
				($key) = /SRC=([\d.]+)/;
				$srcip = $key;
				$zone_colour = ($srcip) ? (Realtime::ZoneUtils::get_zone_info($srcip))[1] : '';
				$flag_icon = ($srcip) ? (&Location::Functions::get_flag_icon(&Location::Functions::lookup_country_code($srcip) || 'unknown')) : '/images/flags/unknown.png';
			}
			elsif ($group eq 'port') {
				($key) = /DPT=(\d+)/;
				($srcip) = /SRC=([\d.]+)/;
				$zone_colour = ($srcip) ? (Realtime::ZoneUtils::get_zone_info($srcip))[1] : '';
				$flag_icon = '';
			}
			elsif ($group eq 'country') {
				($srcip) = /SRC=([\d.]+)/;
				$key = &Location::Functions::lookup_country_code($srcip) || 'unknown';
				$zone_colour = ($srcip) ? (Realtime::ZoneUtils::get_zone_info($srcip))[1] : '';
				$flag_icon = &Location::Functions::get_flag_icon($key) || '/images/flags/unknown.png';
			}
			else { next; }

			next unless defined $key and $key ne '';
			$counter{$key}++;
			$total++;
			$zone_map{$key} = $zone_colour // '';
			$flag_map{$key} = $flag_icon // '';
			debug(2, "Processed line for key=$key, group=$group, total=$total");
		}
		close $fh;
	}

	my @results = sort { $counter{$b} <=> $counter{$a} } keys %counter;
	splice @results, $limit if @results > $limit;

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
			key => $key,
			count => $counter{$key} // 0,
			percent => $total ? sprintf("%.1f", 100 * $counter{$key} / $total) : 0,
			key_colour => $zone_colour // '',
			key_zone => $zone_name // '',
			zone_colour => $zone_colour // '',
			zone_name => $zone_name // '',
			key_flag_icon => $flag_icon,
			key_info_url => $info_url,
		};
	}

	debug(1, "Fetched grouped data: " . scalar(@final) . " entries, total=$total");
	return @final ? \@final : [{ error => "No data found for the specified parameters" }];
}

sub fetch_raw {
	my ($params) = @_;
	my $is_search = $params->{is_search} // 0;
	my $refresh = $params->{refresh} // 0;
	my $last_pos = $params->{last_pos} // 0;
	my $search_ip = $params->{search_ip} // '';
	my $search_port = $params->{search_port} // '';
	my $search_interface = $params->{search_interface} // '';
	my $search_action = $params->{search_action} // '';
	my $search_protocol = $params->{search_protocol} // '';
	my $month = $params->{month} // (localtime)[4];
	my $day = $params->{day} // (localtime)[3];
	my $year = $params->{year} // (localtime)[5] + 1900;
	my $limit = $is_search ? undef : 50; # No limit if search enabled

	my $log_file = '/var/log/messages';
	my @logs = ();
	my $mtime = stat($log_file)->mtime || time();

	my @lines;
	if ($is_search || !$refresh) {
		if ($mtime > $cache_mtime) {
			open my $fh, '<', $log_file or do {
				warn "Cannot open $log_file: $!";
				debug(1, "Cannot open log file: $log_file: $!");
				return ([{ error => "Cannot open log file: $log_file: $!" }], 0);
			};
			@cached_lines = <$fh>;
			close $fh;
			$cache_mtime = $mtime;
			debug(2, "Loaded " . scalar(@cached_lines) . " lines into cache for $log_file");
		}
		@lines = @cached_lines;
	} else {
		open my $fh, '<', $log_file or do {
			warn "Cannot open $log_file: $!";
			debug(1, "Cannot open log file: $log_file: $!");
			return ([{ error => "Cannot open log file: $log_file: $!" }], 0);
		};
		seek($fh, $last_pos, SEEK_SET);
		@lines = <$fh>;
		$last_pos = tell($fh);
		close $fh;
		debug(2, "Read " . scalar(@lines) . " new lines from $log_file at last_pos=$last_pos");
	}

	my $line_count = 0;
	my $matched_count = 0;
	my @shortmonths = qw(Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec);
	my $monthstr = $shortmonths[$month];
	my $daystr = $day < 10 ? " $day" : "$day";
	foreach my $line (@lines) {
		$line_count++;
		if ($line =~ /^(\w+\s+\d+\s+\d\d:\d\d:\d\d)\s+([^\s]+)\s+kernel:\s+(\w+)\s+IN=(\w+)\s+OUT=(\w*)\s+.*SRC=([\d.]+)\s+DST=([\d.]+)\s+.*PROTO=(\w+)\s*(?:SPT=(\d+))?\s*(?:DPT=(\d+))?/) {
			my ($timestamp, $hostname, $action, $in, $out, $src_ip, $dst_ip, $protocol, $src_port, $dst_port) = ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
			$matched_count++;
			debug(2, "Matched log line: $line");
			if (!$is_search && defined $monthstr && defined $daystr && $monthstr ne '' && $daystr ne '' && $line !~ /^$monthstr $daystr\s+\d\d:\d\d:\d\d/) {
				debug(2, "Skipping log entry, date mismatch: expected $monthstr $daystr, got $line");
				next;
			}

			$timestamp .= " $year";
			if (!$is_search && $refresh) {
				my $log_time = eval { Time::Piece->strptime($timestamp, "%b %e %H:%M:%S %Y") };
				if ($@ || !$log_time) {
					debug(1, "Failed to parse timestamp: $timestamp");
					next;
				}
				if ((time() - $log_time->epoch) > $refresh) {
					debug(2, "Skipping log entry, too old: $timestamp (age: " . (time() - $log_time->epoch) . "s, refresh: ${refresh}s)");
					next;
				}
			}

			if ($is_search) {
				if ($search_ip && !($src_ip =~ /\Q$search_ip\E/ || $dst_ip =~ /\Q$search_ip\E/)) {
					debug(2, "Skipping log entry, IP filter mismatch: src=$src_ip, dst=$dst_ip, search_ip=$search_ip");
					next;
				}
				if ($search_port && ($search_port !~ /^\d+$/ || $search_port < 1 || $search_port > 65535)) {
					debug(2, "Skipping log entry, invalid port: search_port=$search_port");
					next;
				}
				if ($search_port && !($src_port && $src_port eq $search_port || $dst_port && $dst_port eq $search_port)) {
					debug(2, "Skipping log entry, port filter mismatch: src_port=$src_port, dst_port=$dst_port, search_port=$search_port");
					next;
				}
				if ($search_interface && !($in eq $search_interface || $out eq $search_interface)) {
					debug(2, "Skipping log entry, interface filter mismatch: in=$in, out=$out, search_interface=$search_interface");
					next;
				}
				if ($search_action && $action ne $search_action) {
					debug(2, "Skipping log entry, action filter mismatch: action=$action, search_action=$search_action");
					next;
				}
				if ($search_protocol && $protocol !~ /^\Q$search_protocol\E/i) {
					debug(2, "Skipping log entry, protocol filter mismatch: protocol=$protocol, search_protocol=$search_protocol");
					next;
				}
			}

			my ($src_zone, $src_colour) = Realtime::ZoneUtils::get_zone_info($src_ip);
			my ($dst_zone, $dst_colour) = Realtime::ZoneUtils::get_zone_info($dst_ip);
			my $src_country = &Location::Functions::lookup_country_code($src_ip) || '';
			my $dst_country = &Location::Functions::lookup_country_code($dst_ip) || '';
			my $src_flag = $src_country ? &Location::Functions::get_flag_icon($src_country) : '/images/flags/unknown.png';
			my $dst_flag = $dst_country ? &Location::Functions::get_flag_icon($dst_country) : '/images/flags/unknown.png';
			my $details_url_ip = $src_ip ? "/cgi-bin/logs.cgi/showrequestfromip.dat?ip=$src_ip&MONTH=$month&DAY=$day" : '';
			my $details_url_port = ($src_port || $dst_port) ? "/cgi-bin/logs.cgi/showrequestfromport.dat?port=" . ($src_port || $dst_port) . "&MONTH=$month&DAY=$day" : '';
			my $details_url_country = $src_country ? "/cgi-bin/country.cgi#$src_country" : '';

			push @logs, {
				timestamp => $timestamp,
				action => $action,
				in => $in,
				out => $out,
				src_ip => $src_ip,
				dst_ip => $dst_ip,
				protocol => $protocol,
				src_port => $src_port || '',
				dst_port => $dst_port || '',
				src_zone => $src_zone || '',
				src_zone_colour => $src_colour || '',
				src_flag_icon => $src_flag,
				dst_zone => $dst_zone || '',
				dst_zone_colour => $dst_colour || '',
				dst_flag_icon => $dst_flag,
				src_country => $src_country,
				dst_country => $dst_country,
				details_url_ip => $details_url_ip,
				details_url_port => $details_url_port,
				details_url_country => $details_url_country
			};

			last if defined $limit && @logs >= $limit;
		} else {
			#debug(2, "Line did not match regex: $line");
		}
	}
	debug(1, "Processed $line_count lines, matched $matched_count firewall log entries, added " . scalar(@logs) . " to raw_logs");

	return (\@logs, $last_pos);
}

sub fetch_filters {
	my ($params) = @_;
	my $month = $params->{month} // (localtime)[4];
	my $day = $params->{day} // (localtime)[3];
	my $year = $params->{year} // (localtime)[5] + 1900;
	my $search_interface = $params->{search_interface} // '';
	my $log_file = '/var/log/messages';

	my %interfaces;
	my %actions;
	open my $fh, '<', $log_file or do {
		warn "Cannot open $log_file: $!";
		debug(1, "Cannot open log file: $log_file: $!");
		return ([], []);
	};
	my @shortmonths = qw(Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec);
	my $monthstr = $shortmonths[$month];
	my $daystr = $day < 10 ? " $day" : "$day";
	while (my $line = <$fh>) {
		next unless $line =~ /^(\w+\s+\d+\s+\d\d:\d\d:\d\d)\s+([^\s]+)\s+kernel:/;
		next if defined $monthstr && defined $daystr && $monthstr ne '' && $daystr ne '' && $line !~ /^$monthstr $daystr\s+\d\d:\d\d:\d\d/;
		if (my ($in) = $line =~ /IN=(\w+)/) {
			$interfaces{$in} = 1;
		}
		if (my ($out) = $line =~ /OUT=(\w+)/) {
			$interfaces{$out} = 1;
		}
		if (my ($action) = $line =~ /\s+(\w+)\s+IN=/) {
			if ($search_interface) {
				next unless ($line =~ /IN=\Q$search_interface\E/ || $line =~ /OUT=\Q$search_interface\E/);
			}
			$actions{$action} = 1;
		}
	}
	close $fh;
	my @interfaces = sort keys %interfaces;
	my @actions = sort keys %actions;
	debug(1, "Fetched filters: interfaces=[" . join(", ", @interfaces) . "], actions=[" . join(", ", @actions) . "]" . ($search_interface ? " for interface=$search_interface" : ""));
	return (\@interfaces, \@actions);
}

1;
