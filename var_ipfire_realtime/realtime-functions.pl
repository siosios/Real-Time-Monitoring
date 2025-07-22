#!/usr/bin/perl
###############################################################################
# File/path: /var/ipfire/realtime/realtime-functions.pl                        #
# Purpose: Provides core functions for real-time data processing in the IPFire #
#          Web UI, acting as a dispatcher for data types like connections,     #
#          hardware, and firewall logs.                                        #
# Version: 0.8                                                                 #
# Author: ummeegge                                                             #
# License: GNU General Public License, version 3 or later                      #
# Last Modified: July 22, 2025                                                 #
###############################################################################

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
require '/var/ipfire/realtime/firewalllogs.pm'; # Added for firewall log support

# Configure debug level: 0=none, 1=info (default), 2=full debug
my $debug_level = 2; # Enable debugging for detailed logs

# Debug function to log messages with timestamp and level
sub debug {
    my ($level, $message) = @_;
    # Skip if debug level is insufficient or message is undefined
    return if !defined $message || $level > $debug_level;
    # Format current timestamp
    my $timestamp = strftime("%a %b %d %H:%M:%S %Y", localtime);
    # Set log prefix based on debug level
    my $prefix = $level == 1 ? "[INFO]" : "[DEBUG]";
    # Output log to stderr
    print STDERR "$prefix [$timestamp] Realtime: $message\n";
}

# Include JavaScript files for the Web UI frontend
sub include_realtime_script {
    debug(1, "Including JavaScript for realtime frontend");
    # Return HTML script tags for ipfire-realtime.js
    return <<END;
    <script type="text/javascript" src="/include/ipfire-realtime.js"></script>
END
}

# Central dispatcher function to fetch data based on type and filters
sub fetch_data {
    my ($data_type, %filters) = @_;
    # Log the requested data type
    debug(1, "Fetching data for type: $data_type");
    # Log filter details for debugging, handling arrays and undefined values
    debug(2, "Filters: " . (scalar keys %filters ? join(", ", map {
        ref($filters{$_}) eq 'ARRAY' ? "$_=[" . (scalar @{$filters{$_}} ? join(",", @{$filters{$_}}) : "empty") . "]" :
        defined $filters{$_} ? "$_=$filters{$_}" : "$_=undef"
    } keys %filters) : "none"));
    # Log CGI query string
    debug(2, "CGI request: " . ($ENV{'QUERY_STRING'} || "none"));

    # Define handlers for supported data types
    my %handlers = (
        'connections' => \&Realtime::Connections::fetch, # Handler for connection data
        'hardware' => \&Realtime::Hardware::fetch,      # Handler for hardware data
        'firewalllogs' => \&Realtime::FirewallLogs::fetch, # Handler for firewall log data
    );

    # Validate the requested data type
    unless (exists $handlers{$data_type}) {
        debug(1, "Invalid data_type: $data_type");
        return [{ error => "Invalid data_type: $data_type" }]; # Return error response
    }

    # Log handler invocation
    debug(2, "Calling handler for $data_type");
    # Call the handler with filters
    my $result = $handlers{$data_type}->(\%filters);
    # Log result size
    debug(1, "Handler for $data_type returned " . (ref($result) eq 'ARRAY' ? scalar(@$result) : "non-array") . " entries");
    # Return the fetched data
    return $result;
}

1; # End of package