#!/usr/bin/perl
################################################################################
# File and path: /var/ipfire/realtime/realtime-functions.pl                    #
# Purpose: Provides core functions for real-time data processing in the IPFire #
#          Web UI, acting as a dispatcher for data types like connections      #
# Version: 0.8                                                                 #
# Author: ummeegge                                                             #
#                                                                              #
# License: GNU General Public License, version 3 or later                      #
# Last Modified: July 21, 2025                                                 #
################################################################################

# Define the Realtime package for modular organization
package Realtime;
use strict;
use warnings;
use JSON::PP;
use CGI;
use POSIX qw(strftime);

# Load core IPFire modules for general, network, IDS, and location functionality
require '/var/ipfire/general-functions.pl';
require '/var/ipfire/network-functions.pl';
require '/var/ipfire/ids-functions.pl';
require '/var/ipfire/location-functions.pl';

# Load specialized modules for handling data
require '/var/ipfire/realtime/connections.pm';
require '/var/ipfire/realtime/hardware.pm';
# Later e.g. require '/var/ipfire/realtime/firewalllogs.pm'; # Placeholder for future extensions

# Configure debug level: 0=none, 1=info (default), 2=full debug
my $debug_level = 2; # Debugging aktiviert für detaillierte Logs

# Debug function to log messages with timestamp and level
sub debug {
    my ($level, $message) = @_;
    return if !defined $message || $level > $debug_level; # Skip if debug level is insufficient
    my $timestamp = strftime("%a %b %d %H:%M:%S %Y", localtime); # Format current timestamp
    my $prefix = $level == 1 ? "[INFO]" : "[DEBUG]"; # Set log prefix based on debug level
    print STDERR "$prefix [$timestamp] Realtime: $message\n"; # Output log to stderr
}

# Include JavaScript files for the Web UI frontend
sub include_realtime_script {
    debug(1, "Including JavaScript for realtime frontend"); # Log JavaScript inclusion
    return <<END; # Return HTML script tags for ipfire-realtime.js
    <script type="text/javascript" src="/include/ipfire-realtime.js"></script>
END
}

# Central dispatcher function to fetch data based on type and filters
sub fetch_data {
    my ($data_type, %filters) = @_;
    debug(1, "Fetching data for type: $data_type"); # Log the requested data type
    # Log filter details for debugging, handling arrays and undefined values
    debug(2, "Filters: " . (scalar keys %filters ? join(", ", map {
        ref($filters{$_}) eq 'ARRAY' ? "$_=[" . (scalar @{$filters{$_}} ? join(",", @{$filters{$_}}) : "empty") . "]" :
        defined $filters{$_} ? "$_=$filters{$_}" : "$_=undef"
    } keys %filters) : "none"));
    debug(2, "CGI request: " . ($ENV{'QUERY_STRING'} || "none")); # Log CGI query string

    # Define handlers for supported data types
    my %handlers = (
        'connections' => \&Realtime::Connections::fetch, # Handler for connection data
        'hardware' => \&Realtime::Hardware::fetch,      # Neu: Handler für Hardware-Daten
        # 'firewalllogs' => \&Realtime::FirewallLogs::fetch, # Placeholder for future firewall log support
    );

    # Validate the requested data type
    unless (exists $handlers{$data_type}) {
        debug(1, "Invalid data_type: $data_type"); # Log invalid data type error
        return [{ error => "Invalid data_type: $data_type" }]; # Return error response
    }

    debug(2, "Calling handler for $data_type"); # Log handler invocation
    my $result = $handlers{$data_type}->(\%filters); # Call the handler with filters
    debug(1, "Handler for $data_type returned " . (ref($result) eq 'ARRAY' ? scalar(@$result) : "non-array") . " entries"); # Log result size
    return $result; # Return the fetched data
}

1; # End of package