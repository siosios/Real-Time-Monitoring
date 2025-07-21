===== USER_GUIDE.md =====

# IPFire Real-Time Connection Tracking Module: User Guide

This guide is intended for IPFire administrators using the Real-Time Connection Tracking Module to monitor network connections via the WebUI. It explains how to access and use the module, including filtering, sorting, and interpreting connection data.

## Accessing the WebUI
1. Log in to the IPFire WebUI:
- Open your browser and navigate to https://<ipfire-host>:444/cgi-bin/connections-realtime.cgi (replace <ipfire-host> with your IPFire server's IP address or hostname).
- Log in with your admin credentials.
- Navigate to the Connections Page:
- The real-time connections page displays a table of active network connections, including protocol, source/destination IPs and ports, traffic (bytes in/out), connection state, and country flags.

## Using the WebUI

Zone Legend:
- Overview: The top of the page shows a legend with colored labels for network zones (e.g., LAN, INTERNET, DMZ, VPN, WireGuard, OpenVPN, IPFire, Multicast).
- Usage: Click on a zone (e.g., "LAN") to toggle its visibility in the connection table. This filters the table to show only connections involving the selected zone.
- Example: To monitor only LAN traffic, click the green "LAN" label to hide other zones.

##Filtering Connections:

- Search Toggle: Enable the search toggle (a checkbox or button in the WebUI) to activate filtering.

Filter Criteria:

- Source/Destination IP: Enter an IP address (e.g., 192.168.1.100 or even .168.) to show connections involving that IP.

- Port: Enter a port number (e.g., 80 for HTTP) to filter by source or destination port.

- Protocol: Select a protocol (e.g., TCP, UDP, ICMP) and enter it manually.

- Zone: Combine with the zone legend to filter by network zone (e.g., LAN or INTERNET).

Example: To find HTTP traffic from a specific IP, enable the search toggle, enter 192.168.1.100 in the source IP field, and 80 in the destination port field.

## Sorting Connections

- Sortable Columns: Click on table headers (e.g., "TTL", "Bytes", "Source IP") to sort the connection table ascending or descending.
- Example: Click the "Bytes" header to sort by traffic volume, identifying high-bandwidth connections.

## Auto-Refresh

- Refresh Interval: Adjust the refresh interval (0, 2, 5, 10, 30, or 60 seconds) via a dropdown or button in the WebUI.
- Usage: Set a shorter interval (e.g., 2 seconds) for real-time monitoring or a longer interval (e.g., 60 seconds) to reduce system load.
- Example: For troubleshooting a network issue, set the interval to 2 seconds to see immediate changes in connections.


##Interpreting Connection Data

- Columns:

- Protocol: Shows the protocol (e.g., TCP, UDP, ICMP, IGMP).
- Source/Destination IP and Port: Displays the IP addresses and ports, with links to ipinfo.cgi for IP details and external port information (e.g., isc.sans.edu).
- Country Flags: Indicates the country of the source/destination IP (based on location-functions.pl).
- Data Transfer: Shows bytes in (received) and bytes out (sent), formatted for readability (e.g., KB, MB).
- Connection Status: For TCP, shows states like ESTABLISHED, SYN_SENT, etc.
- Expires (TTL): Time-to-live in hours:minutes:seconds until the connection expires.
- Zone Colors: Connections are color-coded by network zone (e.g., green for LAN, red for INTERNET) for quick identification.

Example: A row showing TCP, 192.168.1.100:12345 (green), 8.8.8.8:53 (red), and a US flag indicates a LAN device querying Google's DNS server.

## Using the JSON API

Access: Query https://<ipfire-host>:444/cgi-bin/connections-realtime.cgi?json=1 to retrieve connection data in JSON format.

- Parameters:

- zone=<zone>: Filter by zone (e.g., LAN, INTERNET).
- ip=<address>: Filter by source or destination IP (e.g., 192.168.1.100).
- port=<number>: Filter by source or destination port (e.g., 80).

Example: https://<ipfire-host>:444/cgi-bin/connections-realtime.cgi?json=1&zone=LAN&port=80 returns JSON data for HTTP traffic in the LAN zone.

## Use Case: Integrate with monitoring tools (e.g., Grafana) to visualize connection data.

Tips:

- Monitor High Traffic: Sort by "Bytes" to identify bandwidth-intensive connections.
- Troubleshoot Issues: Use short refresh intervals and filters (e.g., by IP or protocol) to debug network problems.
- External Tools: Use the JSON API to feed connection data into scripts or dashboards for automated monitoring.

Screenshots ?

