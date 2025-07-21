#!/usr/bin/perl

###############################################################################
# File: zoneutils.pm
# Purpose: Central mapping of IPs to IPFire network zones and zone colors.
# Exports: get_zone_info($ip) -> ($zone, $color)
# Author: IPFire Team
# License: GNU GPL v3 or later
###############################################################################

package Realtime::ZoneUtils;
use strict;
use warnings;

require '/var/ipfire/general-functions.pl';
require '/var/ipfire/network-functions.pl';
require '/var/ipfire/header.pl';
require '/var/ipfire/ids-functions.pl';

# Zones and their colors (UI style)
my %zones = (
    'LAN'        => ${Header::colourgreen},
    'INTERNET'   => ${Header::colourred},
    'DMZ'        => ${Header::colourorange},
    'Wireless'   => ${Header::colourblue},
    'IPFire'     => ${Header::colourfw},
    'VPN'        => ${Header::colourvpn},
    'WireGuard'  => ${Header::colourwg},
    'OpenVPN'    => ${Header::colourovpn},
    'Multicast'  => "#A0A0A0",
);

# Netblock => Zonenfarbe
my %networks;

# Cache for fast repeated lookups
my %zone_cache;

sub _build_networks {
    %networks = (
        '127.0.0.0/8'   => ${Header::colourfw},
        '224.0.0.0/3'   => $zones{'Multicast'},
    );

    # Eth settings
    my %settings = ();
    &General::readhash("/var/ipfire/ethernet/settings", \%settings);

    $networks{"$settings{'GREEN_ADDRESS'}/32"}       = ${Header::colourfw}    if $settings{'GREEN_ADDRESS'};
    $networks{"$settings{'GREEN_NETADDRESS'}/$settings{'GREEN_NETMASK'}"} = ${Header::colourgreen} if $settings{'GREEN_NETADDRESS'} && $settings{'GREEN_NETMASK'};
    $networks{"$settings{'BLUE_ADDRESS'}/32"}        = ${Header::colourfw}    if $settings{'BLUE_ADDRESS'};
    $networks{"$settings{'BLUE_NETADDRESS'}/$settings{'BLUE_NETMASK'}"}   = ${Header::colourblue}   if $settings{'BLUE_NETADDRESS'} && $settings{'BLUE_NETMASK'};
    $networks{"$settings{'ORANGE_ADDRESS'}/32"}      = ${Header::colourfw}    if $settings{'ORANGE_ADDRESS'};
    $networks{"$settings{'ORANGE_NETADDRESS'}/$settings{'ORANGE_NETMASK'}"} = ${Header::colourorange} if $settings{'ORANGE_NETADDRESS'} && $settings{'ORANGE_NETMASK'};

    # RED external interface
    my $red_ip = &IDS::get_red_address();
    $networks{"${red_ip}/32"} = ${Header::colourfw} if $red_ip;

    # Aliases
    my @aliases = &IDS::get_aliases();
    for my $alias (@aliases) {
        $networks{"${alias}/32"} = ${Header::colourfw};
    }

    # Interface based routing
    my %interfaces;
    $interfaces{$settings{'GREEN_DEV'}}  = ${Header::colourgreen} if $settings{'GREEN_DEV'};
    $interfaces{$settings{'BLUE_DEV'}}   = ${Header::colourblue}  if $settings{'BLUE_DEV'};
    $interfaces{$settings{'ORANGE_DEV'}} = ${Header::colourorange} if $settings{'ORANGE_DEV'};
    $interfaces{"gre[0-9]+"}             = ${Header::colourvpn};
    $interfaces{"vti[0-9]+"}             = ${Header::colourvpn};
    $interfaces{"tun[0-9]+"}             = ${Header::colourovpn};

    my @routes = &General::system_output("ip", "route", "show");
    foreach my $intf (keys %interfaces) {
        next if ($intf eq "");
        foreach my $route (grep(/dev ${intf}/, @routes)) {
            if ($route =~ m/^(\d+\.\d+\.\d+\.\d+\/\d+)/) {
                $networks{$1} = $interfaces{$intf};
            }
        }
    }

    # VPN, WireGuard, OpenVPN, IPsec etc.
    if (-e "/var/ipfire/wireguard/settings") {
        my %wgsettings = ();
        &General::readhash("/var/ipfire/wireguard/settings", \%wgsettings);
        $networks{$wgsettings{'CLIENT_POOL'}} = ${Header::colourwg} if $wgsettings{'CLIENT_POOL'};
    }
    if (-e "/var/ipfire/wireguard/peers") {
        my %wgpeers = ();
        &General::readhasharray("/var/ipfire/wireguard/peers", \%wgpeers);
        foreach my $key (keys %wgpeers) {
            my $ns = $wgpeers{$key}[8];
            my @ns = split(/\|/, $ns);
            foreach my $net (@ns) {
                $networks{$net} = ${Header::colourwg} if $net;
            }
        }
    }
    if (-e "/var/ipfire/ovpn/settings") {
        my %ovpnsettings = ();
        &General::readhash("/var/ipfire/ovpn/settings", \%ovpnsettings);
        $networks{$ovpnsettings{'DOVPN_SUBNET'}} = ${Header::colourovpn} if $ovpnsettings{'DOVPN_SUBNET'};
    }
    if (-e "/var/ipfire/ovpn/ccd.conf") {
        open(OVPNSUB, "/var/ipfire/ovpn/ccd.conf");
        foreach my $line (<OVPNSUB>) {
            my @ovpn = split(',', $line);
            $networks{$ovpn[3]} = ${Header::colourovpn} if $ovpn[3];
        }
        close(OVPNSUB);
    }
    if (-e "/var/ipfire/vpn/config") {
        open(IPSEC, "/var/ipfire/vpn/config");
        my @ipsec = <IPSEC>;
        close(IPSEC);
        foreach my $line (@ipsec) {
            my @vpn = split(',', $line);
            my @subnets = split(/\|/, $vpn[12]);
            for my $subnet (@subnets) {
                $networks{$subnet} = ${Header::colourvpn};
            }
        }
    }
    if (-e "/var/ipfire/ovpn/n2nconf") {
        open(OVPNN2N, "/var/ipfire/ovpn/ovpnconfig");
        foreach my $line (<OVPNN2N>) {
            my @ovpn = split(',', $line);
            next if ($ovpn[4] ne 'net');
            $networks{$ovpn[12]} = ${Header::colourovpn} if $ovpn[12];
        }
        close(OVPNN2N);
    }
}

# Ensure networks/hashmaps are initialized
_build_networks();

# Map IP to (zone-name, zone-color)
sub get_zone_info {
    my ($ip) = @_;
    return ('', $zones{'INTERNET'}) unless defined $ip && $ip =~ /\d+\.\d+\.\d+\.\d+/;
    return @{$zone_cache{$ip}} if $zone_cache{$ip};

    # Prefer longer prefix match (more specific net)
    my @nets_sorted = reverse sort { &Network::get_prefix($a) <=> &Network::get_prefix($b) } keys %networks;
    foreach my $net (@nets_sorted) {
        next unless defined $net && &Network::check_subnet($net);
        if (&Network::ip_address_in_network($ip, $net)) {
            # Now, get zone name for color (reverse lookup)
            foreach my $zone (keys %zones) {
                if ($networks{$net} eq $zones{$zone}) {
                    $zone_cache{$ip} = [$zone, $zones{$zone}];
                    return ($zone, $zones{$zone});
                }
            }
            # Fallback if color but no zone
            $zone_cache{$ip} = ['', $networks{$net}];
            return ('', $networks{$net});
        }
    }
    # Default = INTERNET (red)
    $zone_cache{$ip} = [ 'INTERNET', $zones{'INTERNET'} ];
    return ( 'INTERNET', $zones{'INTERNET'} );
}

# Export zones/colors for e.g. legend
sub get_zones_hashref {
    return \%zones;
}

1;


