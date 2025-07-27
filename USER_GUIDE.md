# User Guide for IPFire Real-Time Monitoring Module

This guide explains how to install and use the Real-Time Connection Tracking module for monitoring network connections in the IPFire Web User Interface (WUI). The module, under active development but fully functional, provides a user-friendly interface with real-time network monitoring, zone-based coloring, dynamic filtering, and sorting, with planned support for mobile devices.

## Installing the Module

This section is for administrators setting up the module on their IPFire system.

### Prerequisites
- IPFire firewall (version compatible with the module, e.g., IPFire 2.x).
- Web server configured to serve CGI scripts (e.g., Apache).
- JavaScript-enabled browser for the WUI.
- No external dependencies required; all necessary modules (e.g., `general-functions.pl`, `network-functions.pl`, `location-functions.pl`) are part of the standard IPFire distribution.

### Setup
1. Clone the repository:
      git clone https://github.com/ummeegge/Real-Time-Monitoring
2. Copy the files to the appropriate IPFire directories, ensuring correct permissions:
   - CGI scripts: '/srv/web/ipfire/cgi-bin/connections-realtime.cgi'
   - Perl modules: '/var/ipfire/realtime/' (e.g., 'connections.pm', 'zoneutils.pm', 'realtime-functions.pl')
   - JavaScript and CSS: '/srv/web/ipfire/html/include/' (e.g., 'ipfire-realtime.js', 'ipfire-realtime.css')
3. Ensure the '/var/ipfire/realtime' directory exists and contains the Perl modules.
4. Restart the web server to apply changes.

Future perspective: May an in- uninstaller script comes soon.

## Accessing the Module
1. Log in to the IPFire WUI (e.g., 'https://<ipfire-host>:444').
2. Navigate to the Connections page ('https://<ipfire-host>/cgi-bin/connections-realtime.cgi').

## Viewing Connections
The module displays a table of active connections with:
- **Protocol**: TCP, UDP, ICMP, etc.
- **Source/Destination IP**: Clickable links to '/cgi-bin/ipinfo.cgi' for IP details, color-coded by network zone.
- **Source/Destination Port**: Links to external port information (e.g., 'isc.sans.edu'), color-coded by zone.
- **Country**: Country flags with links to '/cgi-bin/country.cgi'.
- **Traffic**: Bytes in/out, formatted for readability.
- **State**: Connection status (e.g., ESTABLISHED, NONE for UDP/ICMP).
- **Expires**: Time-to-live (TTL) in hours:minutes:seconds.

## Features
- **Real-Time Connection Monitoring**: View active network connections with details like protocol, IPs, traffic, state, and country flags in real time.
- **Zone-Based Coloring**: Toggle the zone legend to select/deselect network zones (e.g., LAN, INTERNET, DMZ, VPN, WireGuard, OpenVPN, IPFire, Multicast). Zones are highlighted with colors (e.g., green for LAN, red for INTERNET), dynamically assigned by the backend.
- **Dynamic Filtering**: Enable the search toggle to filter by:
  - **IP**: e.g., '192.168.1.1' or partial IPs like '.168.'
  - **Port**: e.g., '80'
  - **Protocol**: e.g., 'TCP'
  Filters are applied server-side for efficiency and client-side as a fallback for large datasets, reducing server load.
- **Dynamic Sorting**: Click column headers to sort by protocol, IP, port, bytes, state, or TTL (ascending or descending).
- **Auto-Refresh**: Select refresh intervals (2, 5, 10, 30, 60 seconds).
- **Improved User Experience**: Dynamic tables, expandable process details, responsive search fields, and a zone legend toggle enhance usability compared to the legacy implementation.
- **JSON API**: Access data programmatically:
      `https://<ipfire-host>/cgi-bin/connections-realtime.cgi?json=1&zone=LAN&ip=192.168.1.1`
  Can be integrated with monitoring tools like Grafana for visualization.
- **Future Mobile Support**: Planned responsive design for improved usability on mobile devices.

## Tips
- **Monitor High Traffic**: Sort by "Bytes" to identify bandwidth-intensive connections.
- **Troubleshoot Issues**: Use short refresh intervals (e.g., 2 seconds) and filters (e.g., by IP or protocol) to debug network problems.
- **External Tools**: Use the JSON API to feed connection data into scripts or dashboards for automated monitoring.

## Troubleshooting
- **No connections**: Ensure conntrack is active ('/usr/local/bin/getconntracktable') and network traffic is present.
- **Error message displayed**: Check the red error message ('#error_msg') in the WUI for details (e.g., invalid data format, server errors). Review server logs ('/var/ipfire/logs/httpd/error_log') for more information.
- **Slow performance**: Increase the refresh interval for large datasets.
- **Missing zones**: Verify zone configuration in '/var/ipfire/ethernet/settings'.

## Feedback
Report issues or suggestions on [GitHub](https://github.com/ummeegge/Real-Time-Monitoring) to help improve the module.