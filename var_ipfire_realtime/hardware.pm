#!/usr/bin/perl
################################################################################
# File/path: /var/ipfire/realtime/hardware.pm                                  #
# Purpose: Handles real-time hardware usage data (CPU, memory, disk, network)  #
# Version: 0.9.8                                                               #
# Author: ummeegge                                                             #
# Last Modified: August 05, 2025                                               #
################################################################################

package Realtime::Hardware;
use strict;
use warnings;
use POSIX qw(strftime);
use JSON::PP;
use HTML::Entities;
use List::Util qw(sum);

require '/var/ipfire/general-functions.pl';

# Debug config
my $debug_level = 2; # 0=none, 1=info, 2=full debug

# Static variable for network delta calculation (in-memory cache)
my $net_cache = {};
my $use_tmp_file = 1; # Set to 1 to use /tmp/net_cache.json, 0 for in-memory
my $net_cache_file = '/tmp/net_cache.json';

sub debug {
    my ($level, $message) = @_;
    return if !defined $message || $level > $debug_level;
    my $timestamp = strftime("%a %b %d %H:%M:%S %Y", localtime);
    my $prefix = $level == 1 ? "[INFO]" : "[DEBUG]";
    print STDERR "$prefix [$timestamp] Realtime::Hardware: $message\n";
}

sub get_cpu_usage {
    my %cpu;
    if (open my $l, '<', '/proc/loadavg') {
        my $line = <$l>; close $l;
        $line =~ /^([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)/ and @cpu{qw(load1 load5 load15)} = ($1,$2,$3);
        debug(2, "CPU usage: load1=$cpu{load1}, load5=$cpu{load5}, load15=$cpu{load15}");
        return ($cpu{load1}, "Load: $cpu{load1} $cpu{load5} $cpu{load15}");
    }
    debug(1, "Cannot open /proc/loadavg: $!");
    return (0, "Error: /proc/loadavg not readable");
}

sub get_cpu_info {
    my %cpu;
    open(my $fh, '<', '/proc/cpuinfo');
    while (<$fh>) {
        $cpu{model}   = $1 if /^model name\s*:\s*(.+)$/ && !$cpu{model};
        $cpu{mhz}     = $1 if /^cpu MHz\s*:\s*([\d.]+)/ && !$cpu{mhz};
        $cpu{cores}   = $1 if /^cpu cores\s*:\s*(\d+)/ && !$cpu{cores};
        $cpu{threads} = $1 if /^siblings\s*:\s*(\d+)/ && !$cpu{threads};
    }
    close $fh;
    $cpu{cores} ||= `nproc 2>/dev/null` || 1; chomp $cpu{cores};
    if (open my $l, '<', '/proc/loadavg') {
        my $line = <$l>; close $l;
        $line =~ /^([\d\.]+)\s+([\d\.]+)\s+([\d\.]+)/ and @cpu{qw(load1 load5 load15)} = ($1,$2,$3);
    }
    if (open my $up, '<', '/proc/uptime') {
        my $t = <$up>; close $up;
        my ($u) = split ' ', $t;
        my $days=int($u/86400); $u%=86400; my $h=int($u/3600); $u%=3600; my $m=int($u/60);
        $cpu{uptime}= sprintf("%dd %02dh %02dm", $days, $h, $m);
    }
    $cpu{temp} = undef;
    my @temps;
    if (`which sensors 2>/dev/null`) {
        debug(2, "Executing sensors command");
        if (open(my $sen, '-|', 'sensors 2>&1')) {
            my $sensors_output = join("", <$sen>);
            debug(2, "Sensors output: $sensors_output");
            while ($sensors_output =~ /(?:Core\s+\d+|Package id \d+):\s*\+([\d.]+)\s*[°C]/g) {
                push @temps, $1;
                debug(2, "Found temperature: $1°C");
            }
            if (!@temps) {
                while ($sensors_output =~ /temp\d+:\s*\+([\d.]+)\s*[°C]/g) {
                    push @temps, $1;
                    debug(2, "Found fallback temperature: $1°C");
                }
            }
            close $sen;
            if (@temps) {
                $cpu{temp} = sprintf("%.1f", sum(@temps) / @temps);
                debug(2, "CPU temperatures: @temps, average: $cpu{temp}°C");
            } else {
                debug(1, "No valid CPU temperatures found in sensors output");
            }
        } else {
            debug(1, "Failed to open sensors pipe: $!");
        }
    } else {
        debug(1, "sensors command not found");
    }
    debug(2, "CPU info: model=$cpu{model}, cores=$cpu{cores}, threads=$cpu{threads}, mhz=$cpu{mhz}, temp=$cpu{temp}");
    return \%cpu;
}

sub get_mem_info {
    my %mem;
    if (open my $fh, '<', '/proc/meminfo') {
        while (<$fh>) {
            $mem{total} = $1 if /^MemTotal:\s+(\d+)/;
            $mem{free} = $1 if /^MemFree:\s+(\d+)/;
            $mem{available} = $1 if /^MemAvailable:\s+(\d+)/;
            $mem{buffers} = $1 if /^Buffers:\s+(\d+)/;
            $mem{cached} = $1 if /^Cached:\s+(\d+)/;
            $mem{swap_total} = $1 if /^SwapTotal:\s+(\d+)/;
            $mem{swap_free} = $1 if /^SwapFree:\s+(\d+)/;
        }
        close $fh;
    }
    $mem{used} = $mem{total} - $mem{available} if defined $mem{total} && defined $mem{available};
    for (qw(total free available used buffers cached swap_total swap_free)) {
        $mem{$_} = int($mem{$_}/1024) if defined $mem{$_}; # in MB
    }
    $mem{swap_used} = $mem{swap_total} - $mem{swap_free} if defined $mem{swap_total} && defined $mem{swap_free};
    debug(2, "Memory info: total=$mem{total}MB, used=$mem{used}MB, free=$mem{free}MB, swap_used=$mem{swap_used}MB");
    return \%mem;
}

sub get_disk_info {
    my @partitions;
    open(my $df, '-|', 'df -T -P --block-size=1M');
    <$df>;
    while (<$df>) {
        chomp;
        my @f = split;
        next unless $f[0] =~ m{^/} && -d $f[6];
        my %p = (
            fs => $f[0], type => $f[1], size => $f[2], used => $f[3],
            avail => $f[4], usep => $f[5], mount => $f[6]
        );
        push @partitions, \%p;
    }
    close $df;
    debug(2, "Disk info: " . scalar(@partitions) . " partitions found");
    return \@partitions;
}

sub get_net_info {
    my @nics;
    open(my $if, '-|', 'ip -o -4 addr');
    my %ipbyif;
    while (<$if>) {
        my ($dev, $ip) = ($_ =~ /^\d+:\s+(\S+)\s+inet\s+([\d\.]+)\//);
        $ipbyif{$dev} = $ip if $dev;
    }
    close $if;

    my $now = time;
    my $prev_data = {};
    if ($use_tmp_file) {
        if (-e $net_cache_file) {
            if (open(my $fh, '<', $net_cache_file)) {
                local $/;
                my $json = <$fh>;
                close $fh;
                eval { $prev_data = decode_json($json) };
                if ($@) {
                    debug(1, "Failed to decode $net_cache_file: $@");
                    $prev_data = {};
                } else {
                    debug(2, "Loaded network data from $net_cache_file: $json");
                }
            } else {
                debug(1, "Cannot open $net_cache_file for reading: $!");
            }
        }
    } else {
        $prev_data = $net_cache;
    }

    open(my $s, '<', '/proc/net/dev');
    <$s>; <$s>;
    my $new_data = {};
    while (<$s>) {
        if (/^\s*([a-zA-Z0-9]+):\s*(.*)$/) {
            my $dev = $1;
            next if $dev eq 'lo';
            my @fields = split /\s+/, $2;
            my $rx_bytes = $fields[0] || 0;
            my $tx_bytes = $fields[8] || 0;
            my $prev = $prev_data->{$dev} || { rx_bytes => $rx_bytes, tx_bytes => $tx_bytes, timestamp => $now };
            my $delta_t = $now - $prev->{timestamp};
            $delta_t = 5 if $delta_t <= 0; # Ensure minimum 5 seconds for stable rates
            my $rx_rate = sprintf("%.2f", ($rx_bytes - $prev->{rx_bytes}) / (1024*1024) / $delta_t);
            my $tx_rate = sprintf("%.2f", ($tx_bytes - $prev->{tx_bytes}) / (1024*1024) / $delta_t);
            push @nics, {
                if => $dev,
                ip => $ipbyif{$dev} || '',
                rx_mb => sprintf("%.1f", $rx_bytes/(1024*1024)),
                tx_mb => sprintf("%.1f", $tx_bytes/(1024*1024)),
                rx_rate => $rx_rate > 0 ? $rx_rate : 0,
                tx_rate => $tx_rate > 0 ? $tx_rate : 0,
                rx_packets => $fields[1],
                tx_packets => $fields[9]
            };
            debug(2, "Net $dev: rx_bytes=$rx_bytes, tx_bytes=$tx_bytes, prev_rx=$prev->{rx_bytes}, prev_tx=$prev->{tx_bytes}, rx_rate=$rx_rate MB/s, tx_rate=$tx_rate MB/s, delta_t=$delta_t");
            $new_data->{$dev} = { rx_bytes => $rx_bytes, tx_bytes => $tx_bytes, timestamp => $now };
        }
    }
    close $s;

    if ($use_tmp_file) {
        if (open(my $fh, '>', $net_cache_file)) {
            print $fh encode_json($new_data);
            close $fh;
            debug(2, "Saved network data to $net_cache_file");
        } else {
            debug(1, "Cannot open $net_cache_file for writing: $!");
        }
    } else {
        $net_cache = $new_data;
        debug(2, "Updated in-memory network cache for " . scalar(keys %$net_cache) . " interfaces");
    }

    return \@nics;
}

sub get_sys_info {
    my ($kv, $arch, $hn);
    $kv = `uname -r`; chomp $kv;
    $arch = `uname -m`; chomp $arch;
    $hn = `uname -n`; chomp $hn;
    return {
        kernel => $kv,
        arch => $arch,
        hostname => $hn,
        date => strftime("%a %b %d %H:%M:%S %Y", localtime)
    };
}

sub get_top_cpu_processes {
    my @procs;
    open(my $fh, "-|", "ps axo pid,comm,pcpu --sort=-pcpu | head -n 11") or return [];
    <$fh>;
    while (<$fh>) {
        chomp;
        if (/^\s*(\d+)\s+(\S.*?)\s+([\d\.]+)/) {
            push @procs, { pid => $1, command => $2, cpu => "$3 %" };
        }
    }
    close $fh;
    debug(2, "Top CPU processes: " . scalar(@procs));
    return \@procs;
}

sub get_top_mem_processes {
    my @procs;
    open(my $fh, "-|", "ps axo pid,comm,rss --sort=-rss | head -n 11") or return [];
    <$fh>;
    while (<$fh>) {
        chomp;
        if (/^\s*(\d+)\s+(\S.*?)\s+(\d+)/) {
            my $mb = sprintf("%.1f MB", $3/1024);
            push @procs, { pid => $1, command => $2, mem => $mb };
        }
    }
    close $fh;
    debug(2, "Top memory processes: " . scalar(@procs));
    return \@procs;
}

sub fetch {
    my ($filters) = @_;
    debug(1, "Starting fetch() to collect hardware usage data");

    my $cpu = get_cpu_info();
    my $mem = get_mem_info();
    my $disks = get_disk_info();
    my $nets = get_net_info();
    my $sys = get_sys_info();

    my @table_data;
    my $cpu_tip = "Model: $cpu->{model}\nCores: $cpu->{cores}\nThreads: $cpu->{threads}\nFreq: $cpu->{mhz} MHz\nLoad: $cpu->{load1} $cpu->{load5} $cpu->{load15}\nUptime: $cpu->{uptime}";
    $cpu_tip .= "\nTemp: $cpu->{temp}°C" if defined $cpu->{temp};
    push @table_data, {
        resource => 'CPU',
        usage => (defined $cpu->{load1} ? sprintf("%.2f", $cpu->{load1}) : "-"),
        value => (defined $cpu->{temp} ? "$cpu->{temp}°C" : "No temp data"),
        details => "<span class=\"tooltip\" title=\"@{[ HTML::Entities::encode($cpu_tip, '<>&\"\'') ]}\">ⓘ</span> Uptime: $cpu->{uptime}",
        resource_colour => '#4CAF50'
    };

    my $mem_tip = "Total: $mem->{total}MB\nUsed: $mem->{used}MB\nFree: $mem->{free}MB\nBuffers: $mem->{buffers}MB\nCached: $mem->{cached}MB\nSwap: $mem->{swap_used}MB/$mem->{swap_total}MB";
    push @table_data, {
        resource => 'Memory',
        usage => (defined $mem->{used} && $mem->{total} ? sprintf("%.1f%%", $mem->{used}/$mem->{total}*100) : "-"),
        value => "$mem->{used}MB/$mem->{total}MB",
        details => "<span class=\"tooltip\" title=\"@{[ HTML::Entities::encode($mem_tip, '<>&\"\'') ]}\">ⓘ</span> Swap: $mem->{swap_used}/$mem->{swap_total}MB",
        resource_colour => '#2196F3'
    };

    my $mainfs = (grep { $_->{mount} eq "/" } @$disks)[0];
    my $disk_tip = join("\n", map { "$_->{mount}: $_->{used}/$_->{size}MB ($_->{type})" } @$disks);
    push @table_data, {
        resource => 'Disk',
        usage => ($mainfs ? $mainfs->{usep} : "-"),
        value => ($mainfs ? "$mainfs->{used}/$mainfs->{size}MB on /" : "-"),
        details => "<span class=\"tooltip\" title=\"@{[ HTML::Entities::encode($disk_tip, '<>&\"\'') ]}\">ⓘ</span> Main: $mainfs->{fs} ($mainfs->{type})",
        resource_colour => '#FF9800'
    };

    my ($red) = grep { $_->{if} eq 'red0' } @$nets;
    my $net_tip = join("\n", map { "$_->{if}: $_->{ip} (RX: $_->{rx_rate}MB/s, TX: $_->{tx_rate}MB/s)" } @$nets);
    push @table_data, {
        resource => 'Network',
        usage => ($red ? sprintf("%.2fMB/s in / %.2fMB/s out", $red->{rx_rate}, $red->{tx_rate}) : "-"),
        value => ($red && $red->{ip} ? $red->{ip} : "-"),
        details => "<span class=\"tooltip\" title=\"@{[ HTML::Entities::encode($net_tip, '<>&\"\'') ]}\">ⓘ</span> Interfaces: " . scalar(@$nets),
        resource_colour => '#F44336'
    };

    my $data = {
        data => \@table_data,
        interfaces => [ map { $_->{if} } @$nets ],
        actions => [],
        limit => 10
    };

    return $data;
}

1;
