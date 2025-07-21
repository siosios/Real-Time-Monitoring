# IPFire Real-Time Connection Tracking Module

This repository introduces a modular, extensible module for the IPFire firewall, replacing the legacy `connections-realtime.cgi` with a modernized architecture for real-time network connection monitoring in the WebUI. It provides a user-friendly interface with zone-based coloring, dynamic filtering, and sorting, designed to integrate seamlessly with IPFire's infrastructure and support future real-time features.

## Background

The previous implementation relied on a single `connections-realtime.cgi` script, which combined backend logic (network zone mapping, conntrack data processing) and frontend rendering (static HTML table generation). This monolithic approach was functional but lacked modularity, making maintenance and extension difficult. The new module introduces a structured `/var/ipfire/realtime` directory with reusable Perl modules (`.pm`) and separates backend, frontend, and styling logic, improving maintainability, performance, and extensibility.

## Features

- **Real-Time Connection Monitoring**: Displays active network connections with details like protocol, source/destination IPs, ports, traffic (bytes in/out), connection state, and country flags.
- **Zone-Based Visualization**: Assigns colors to network zones (e.g., LAN, INTERNET, DMZ) for intuitive identification.
- **Dynamic Filtering and Sorting**: Supports client-side filtering by IP, port, protocol, and zones, with sortable tables and configurable auto-refresh.
- **Modular Architecture**: Introduces `/var/ipfire/realtime` for reusable Perl modules, simplifying maintenance and enabling other real-time features.
- **Reusable Frontend**: Provides a flexible JavaScript framework (`ipfire-realtime.js`) adaptable for other data displays.
- **Performance Optimization**: Implements caching for IP-to-zone lookups in `zoneutils.pm` for efficient handling of large connection tables.
- **JSON API**: Enables programmatic access to connection data for external tools.

## Improvements Over Legacy Implementation

- **Modularity**: Splits logic into dedicated Perl modules (`connections.pm`, `zoneutils.pm`, `realtime-functions.pl`) in the new `/var/ipfire/realtime` directory, replacing the monolithic `connections-realtime.cgi`.
- **Frontend Separation**: Moves table rendering to `ipfire-realtime.js` for dynamic, client-side interactions (sorting, filtering, auto-refresh) and styling to `ipfire-realtime.css` for customization.
- **Extensibility**: Adds a dispatcher (`realtime-functions.pl`) for handling multiple data types (e.g., connections, hardware), with placeholders for future modules like `firewalllogs.pm`.
- **Performance**: Introduces caching in `zoneutils.pm` for fast IP-to-zone lookups (O(1) vs. O(n) in the legacy script's linear network checks), significantly improving scalability for large connection tables.
- **User Experience**: Enhances the WebUI with dynamic tables, expandable process details, responsive search fields, and a zone legend toggle.

## Files

The module introduces a new `/var/ipfire/realtime` directory to organize modular Perl components (`.pm` files), simplifying maintenance and enabling reuse for other IPFire real-time features, such as firewall logs or hardware monitoring.

- **`connections-realtime.cgi` (13K, Jul 21 14:50)**: Backend CGI script that generates the WebUI and serves JSON data for AJAX-based updates. Handles input sanitization and zone-based filtering, significantly refactored from the legacy version.
- **`connections.pm` (5.9K, Jul 21 14:51)**: Perl module (`Realtime::Connections`) in `/var/ipfire/realtime` to fetch and filter conntrack data, integrating with IPFire's conntrack system for zone-based coloring and filtering.
- **`zoneutils.pm` (6.5K, Jul 20 12:44)**: Perl module (`Realtime::ZoneUtils`) in `/var/ipfire/realtime` for centralized IP-to-zone mapping with color assignment and caching, reducing lookup times for large connection tables.
- **`realtime-functions.pl` (4.1K, Jul 21 15:10)**: Perl module (`Realtime`) in `/var/ipfire/realtime`, acting as a central dispatcher for real-time data processing, routing requests to handlers (e.g., connections, hardware) and including JavaScript for the frontend.
- **`ipfire-realtime.js` (16K, Jul 21 16:09)**: Reusable JavaScript for dynamic table rendering, supporting client-side sorting, filtering, auto-refresh, and expandable process details, adaptable for other real-time features.
- **`ipfire-realtime.css` (2.1K, Jul 21 14:50)**: CSS for styling WebUI tables, including sort indicators, responsive search fields, and flag icon alignment, customizable for future extensions.

## Installation

No external dependencies are required, as all necessary modules (e.g., `general-functions.pl`, `network-functions.pl`, `header.pl`, `ids-functions.pl`, `location-functions.pl`, `jquery.js`) are part of the standard IPFire distribution.

1. **Prerequisites**:
   - IPFire firewall (version compatible with the module, e.g., IPFire 2.x).
   - Web server configured to serve CGI scripts (e.g., Apache).
   - JavaScript-enabled browser for the WebUI.

2. **Setup**:
   Clone the repository and ensure the files are placed in the correct IPFire directories with appropriate permissions, as shown below:

   ```bash
   # Clone the repository
   git clone https://github.com/<your-username>/ipfire-realtime-connections.git

   # Ensure files are in the correct locations with proper permissions
   # Expected structure (based on ls -l output):
   -rwxr-xr-x 1 root root  13K Jul 21 14:50 /srv/web/ipfire/cgi-bin/connections-realtime.cgi
   -rw-r--r-- 1 root root 5.9K Jul 21 14:51 /var/ipfire/realtime/connections.pm
   -rw-r--r-- 1 root root 6.5K Jul 20 12:44 /var/ipfire/realtime/zoneutils.pm
   -rw-r--r-- 1 root root 4.1K Jul 21 15:10 /var/ipfire/realtime/realtime-functions.pl
   -rw-r--r-- 1 root root  16K Jul 21 16:09 /srv/web/ipfire/html/include/ipfire-realtime.js
   -rw-r--r-- 1 root root 2.1K Jul 21 14:50 /srv/web/ipfire/html/include/ipfire-realtime.css

3. Configuration: Ensure the /var/ipfire/realtime directory exists and contains the .pm files.

4. Access: Navigate to the IPFire WebUI and access the real-time connections page (e.g., https://<ipfire-host>/cgi-bin/connections-realtime.cgi).

## Usage

   - WebUI: Access the connections page to view real-time connection data. Use the zone legend to toggle network zones, filter by IP, port, or protocol, and adjust the refresh interval (0, 2, 5, 10, 30, or 60 seconds).
   - Filtering: Enable the search toggle to filter connections by criteria like source IP, port, or protocol.
   - Sorting: Click table headers to sort columns (e.g., by TTL, bytes, or IP).
   - JSON API: Query /cgi-bin/connections-realtime.cgi?json=1 with optional parameters (e.g., zone=LAN, ip=192.168.1.1, port=80) for programmatic access.

## Extensibility

The module's modular design, centered around the new /var/ipfire/realtime directory, simplifies maintenance and enables reuse for other IPFire real-time features:

- Modular Perl Structure: The .pm modules (connections.pm, zoneutils.pm, realtime-functions.pl) in /var/ipfire/realtime are designed for reuse. New modules (e.g., firewalllogs.pm) can be added and integrated via realtime-functions.pl's dispatcher.
- Reusable JavaScript Framework: ipfire-realtime.js provides a flexible framework for dynamic tables, adaptable for other data types (e.g., hardware stats, firewall logs) by modifying the realtimeConfig object.
- Add New Zones: Extend zoneutils.pm's %zones hash to include additional network zones and colors.
- Extend Filters: Update connections-realtime.cgi and connections.pm to support new filter parameters (e.g., connection state, packet counts).
- New Data Types: Add handlers in realtime-functions.pl for new data types (e.g., firewalllogs.pm) and register them in the %handlers hash.
- Customize UI: Modify ipfire-realtime.js for new table columns or ipfire-realtime.css for styling tweaks (e.g., zebra striping, responsive layouts).
- API Integration: Leverage the JSON API for integration with external monitoring tools or dashboards.

## Development

- Debugging: Enable debug logging in connections-realtime.cgi, connections.pm, and realtime-functions.pl by setting $debug_level to 1 (info) or 2 (full debug). Logs are written to /var/ipfire/logs/httpd/error_log, the standard IPFire error log. For ipfire-realtime.js, set DEBUG = true to enable console logs.
- Dependencies: All required modules are part of IPFire's standard distribution (e.g., general-functions.pl, network-functions.pl, jquery.js). Note that ipfire-realtime.js relies on jQuery, which is included in IPFire. For future optimization, consider rewriting ipfire-realtime.js in Vanilla JavaScript to reduce load times, though this is optional given jQuery's integration in IPFire.
- Testing: Test on an IPFire instance with active network traffic to verify real-time updates, filtering, and zone visualization.
- Documentation: For easier onboarding, consider creating a DEVELOPER.md file or a flowchart (e.g., using Mermaid or an external tool) to document module interactions (e.g., how connections-realtime.cgi interacts with realtime-functions.pl and connections.pm).

## Contributing

Contributions are welcome! Please submit issues or pull requests on GitHub to enhance functionality, fix bugs, or improve documentation. Ensure pull requests follow IPFire's coding guidelines and include tests for new features.
