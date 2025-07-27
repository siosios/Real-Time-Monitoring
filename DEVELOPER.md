# Developer Guide for IPFire Real-Time Monitoring Module

This guide provides technical details for developers contributing to the Real-Time Connection Tracking module, which is under active development but fully functional. The module is designed for extensibility to support additional real-time monitoring features, such as hardware monitoring.

## Architecture
The module uses a modular structure in '/var/ipfire/realtime':
* **connections-realtime.cgi**: Backend CGI for serving the WebUI and JSON data for connections.
* **connections.pm**: Fetches and filters conntrack data from '/usr/local/bin/getconntracktable'.
* **zoneutils.pm**: Maps IPs to network zones and colors with O(1) caching.
* **realtime-functions.pl**: Dispatcher for data handlers, supporting multiple data types.
* **ipfire-realtime.js**: Vanilla JavaScript for dependency-free, dynamic table rendering.
* **ipfire-realtime.css**: Lightweight CSS for consistent table styling.
* **/var/ipfire/addon-langs/**: Dedicated addon language file for localized UI strings, keeping core system translations clean.

### Interaction Flow
```mermaid
graph TD
    A[WebUI] -->|HTTP Request| B[connections-realtime.cgi]
    B -->|Calls| C[realtime-functions.pl]
    C -->|Loads| D[connections.pm]
    C -->|Loads| E[zoneutils.pm]
    C -->|Future Loads| J[Future Modules<br/>(e.g., Hardware, Firewall)]
    B -->|Serves| F[ipfire-realtime.js]
    F -->|Renders| G[Dynamic Table]
    F -->|Styles| H[ipfire-realtime.css]
    B -->|Uses| I[/var/ipfire/addon-langs/]
```

## Technical Details
* **Frontend**:
  * 'ipfire-realtime.js' uses Vanilla JavaScript, replacing jQuery for improved performance and no external dependencies. It renders dynamic tables configured via 'window.realtimeConfig' (defined in CGIs, e.g., 'connections-realtime.cgi'), supporting zone-based coloring (via 'ipfire-realtime.js'), client-side sorting/filtering, AJAX updates with 500ms debouncing, and links to IP/port/country details.
```js
  * 'window.realtimeConfig' structure:
        {
          endpoint: string,          // JSON API URL (e.g., "/cgi-bin/connections-realtime.cgi?json=1")
          columns: string,          // Array of key, title, type (e.g., {"key":"src_ip","title":"Src IP","type":"ip"})
          defaultSort: string,      // Column and direction (e.g., {"column":"ttl","direction":"desc"})
          countLabel: string,       // Label for row count (e.g., "Connections")
          refreshInterval: number,  // Refresh interval (e.g., 30)
        }
  ```
  * 'ipfire-realtime.css' provides: styling for centered tables, sorting indicators (arrows), white links on colored cells, and planned features like zebra striping and responsive scrolling for mobile devices. Search fields are toggled by 'ipfire-realtime.js'.
* **Backend**:
  * 'connections-realtime.cgi' handles ipfire wall, real-time CGI parameters (zones, IP, port, protocol), serves JSON data, and renders the HTML interface with a zone legend. It sanitizes inputs for security.
  * 'connections.pm' processes conntrack data, applies filters (zones, IP, port, protocol), and adds zone colors (via 'zoneutils.pm') and country flags (via 'location-functions.pl').
  * 'zoneutils.pm' maps IPs to zones (LAN, INTERNET, DMZ, etc.) with cached lookups for O(1) performance, using colors from 'Header::colour*'. Cache invalidation may be needed for network configuration changes.
  * 'realtime-functions.pl' dispatches data requests to handlers (e.g., 'connections.pm') via '%handlers'. New handlers are added by defining a new key-value pair, e.g., ''new_type' => \&NewModule::fetch', returning an array-ref with data or an error '{ error => "message" }'.
  * '/var/ipfire/addon-langs/' provides localized strings for UI elements (e.g., "Connections", "Refresh Interval"), separate from core '/var/ipfire/langs'.
* **Caching**: 'zoneutils.pm' uses an O(1) cache for IP-to-zone lookups.
* **JSON API**: Query '/cgi-bin/connections-realtime.cgi?json=1' with parameters (e.g., 'zone', 'ip').

## Debugging
* **Backend**: Set '$debug_level = 1' (info) or '2' (full) in Perl modules. 'realtime-functions.pl' uses '$debug_level = 2' for detailed logs, while 'connections.pm' and 'zoneutils.pm' use '$debug_level = 0' by default. Logs go to '/var/ipfire/logs/httpd/error_log'. Example errors include invalid data types or failed data fetches.
* **Frontend**: Enable 'DEBUG = true' in 'ipfire-realtime.js' for console logs (e.g., sorting, AJAX requests). Error messages are displayed in '#error_msg' (e.g., AJAX failures, invalid data format).

## Extending the Module
* Add new '.pm' files in '/var/ipfire/realtime' for new data types (e.g., hardware monitoring, registered as ''hardware' => \&Realtime::Hardware::fetch' in 'realtime-functions.pl').
* Register handlers in 'realtime-functions.pl' via '%handlers', ensuring the handler returns an array-ref with data or '{ error => "message" }'.
* Update 'window.realtimeConfig' in the relevant CGI for new data types or columns.
* Customize 'ipfire-realtime.css' for new styling needs (e.g., enable zebra striping or responsive scrolling).
* Add new strings to '/var/ipfire/addon-langs/' for localization.

## Testing
* Test the WUI with active traffic to verify filtering, sorting, and zone visualization.
* Use 'curl' for JSON API tests (e.g., `curl -u admin:<password> 'https://<ipfire-host>:444/cgi-bin/connections-realtime.cgi?json=1'`).
* Consider 'Test::More' for Perl unit tests (to be implemented).

## Dependencies
No external dependencies; all modules (e.g., 'general-functions.pl', 'network-functions.pl') are part of IPFire. The Details button uses core scripts (e.g., 'showrequestfromip.dat').

## Improvement Suggestions
* Add ARIA attributes (e.g., 'aria-sort' for tables) to 'ipfire-realtime.js' and 'ipfire-realtime.css' for improved accessibility.
* Optimize 'connections.pm' filtering for very large connection datasets.

## Contributing
Submit pull requests with tests. Report issues on [GitHub](https://github.com/ummeegge/Real-Time-Monitoring).
