# IPFire Real-Time Connection Tracking Module

This repository introduces a modular, extensible module for the IPFire firewall, replacing the legacy `connections.cgi` with a modernized architecture for real-time network connection monitoring in the WUI. It provides a user-friendly interface with zone-based coloring, dynamic filtering, and sorting, designed to integrate seamlessly with IPFire's infrastructure and support future real-time features.

## Background

The previous implementation relied on the `connections.cgi` script, which combined backend logic (network zone mapping, conntrack data processing) and frontend rendering (static HTML table generation). This monolithic approach was functional but lacked modularity, making maintenance and extension difficult. The new module introduces a structured `/var/ipfire/realtime` directory with reusable Perl modules (`.pm`) and separates backend, frontend, and styling logic, improving maintainability, performance, and extensibility.

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
- **Extensibility**: Adds a dispatcher (`realtime-functions.pl`) for handling multiple data types, with placeholders for future modules.
- **Performance**: Introduces caching in `zoneutils.pm` for fast IP-to-zone lookups (O(1) vs. O(n) in the legacy script's linear network checks), significantly improving scalability for large connection tables.
- **User Experience**: Enhances the WebUI with dynamic tables, expandable process details, responsive search fields, and a zone legend toggle.

## Files

The module introduces a new `/var/ipfire/realtime` directory to organize modular Perl components (`.pm` files), simplifying maintenance and enabling reuse for other IPFire real-time features.

- **`connections-realtime.cgi` (13K, Jul 21 14:50)**: Backend CGI script that generates the WebUI and serves JSON data for AJAX-based updates. Handles input sanitization and zone-based filtering, significantly refactored from the legacy version.
- **`connections.pm` (5.9K, Jul 21 14:51)**: Perl module (`Realtime::Connections`) in `/var/ipfire/realtime` to fetch and filter conntrack data, integrating with IPFire's conntrack system for zone-based coloring and filtering.
- **`zoneutils.pm` (6.5K, Jul 20 12:44)**: Perl module (`Realtime::ZoneUtils`) in `/var/ipfire/realtime` for centralized IP-to-zone mapping with color assignment and caching, reducing lookup times for large connection tables.
- **`realtime-functions.pl` (4.1K, Jul 21 15:10)**: Perl module (`Realtime`) in `/var/ipfire/realtime`, acting as a central dispatcher for real-time data processing, routing requests to handlers and including JavaScript for the frontend.
- **`ipfire-realtime.js` (16K, Jul 21 16:09)**: Reusable JavaScript in `/srv/web/ipfire/html/include` for dynamic table rendering, supporting client-side sorting, filtering, auto-refresh, and expandable process details, adaptable for other real-time features. Built with Vanilla JavaScript for improved performance and no external dependencies.
- **`ipfire-realtime.css` (2.1K, Jul 21 14:50)**: CSS for styling WebUI tables in `/srv/web/ipfire/html/include`, including sort indicators, responsive search fields, and flag icon alignment, customizable for future extensions.

## Installation

See [USER_GUIDE.md](USER_GUIDE.md) for detailed installation instructions for administrators. In brief:
1. Clone the repository and place files in the correct IPFire directories.
2. Ensure the `/var/ipfire/realtime` directory exists.
3. Access the WUI to use the module.

## Extensibility

The module's modular design simplifies maintenance and enables reuse for other IPFire real-time features:
- **Modular Perl Structure**: The `.pm` modules in `/var/ipfire/realtime` are designed for reuse. New modules can be added and integrated via `realtime-functions.pl`'s dispatcher.
- **Reusable JavaScript Framework**: `ipfire-realtime.js` provides a flexible framework for dynamic tables, adaptable for other data types by modifying the `realtimeConfig` object.
- **Add New Zones**: Extend `zoneutils.pm`'s `%zones` hash to include additional network zones and colors.
- **Extend Filters**: Update `connections-realtime.cgi` and `connections.pm` to support new filter parameters.
- **New Data Types**: Add handlers in `realtime-functions.pl` for new data types and register them in the `%handlers` hash.
- **Customize UI**: Modify `ipfire-realtime.js` for new table columns or `ipfire-realtime.css` for styling tweaks.
- **API Integration**: Leverage the JSON API for integration with external tools.

## Development

See [DEVELOPER.md](DEVELOPER.md) for detailed development instructions, including debugging, testing, and extending the module.

## Contributing

Contributions are welcome! Submit issues or pull requests on [GitHub](https://github.com/ummeegge/Real-Time-Connection-Tracking) to enhance functionality, fix bugs, or improve documentation. Follow IPFire's coding guidelines and include tests for new features.

## About

Developed by [ummeegge](https://github.com/ummeegge) for IPFire.