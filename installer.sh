#!/bin/bash

#
# Real-Time-Monitoring Installer/Uninstaller for IPFire
#
# This script downloads and installs the Real-Time-Monitoring module for IPFire,
# supports uninstall with backup/restoration of menu files, and update.
#
# Usage:
#   sudo ./rtm_install.sh
#   Then follow the interactive menu.
#
# Author: ummeegge
# Date: 2025-08-05
#
# Note: Must be run on an IPFire system.
#

BASE_URL="https://raw.githubusercontent.com/ummeegge/Real-Time-Monitoring/refs/heads/main"

CGI_DIR="/srv/web/ipfire/cgi-bin"
INCLUDE_DIR="/srv/web/ipfire/html/include"
ADDON_LANG_DIR="/var/ipfire/addon-lang"
MENU_DIR="/var/ipfire/menu.d"
MENU_FILE="$MENU_DIR/00-menu.main"
MENU_BACKUP="$MENU_DIR/00-menu.main.bak"
REALTIME_DIR="/var/ipfire/realtime"

declare -A FILES=(
    ["$ADDON_LANG_DIR/realtime-logs.de.pl"]="$BASE_URL/addon-lang/realtime-logs.de.pl"
    ["$ADDON_LANG_DIR/realtime-logs.en.pl"]="$BASE_URL/addon-lang/realtime-logs.en.pl"
    ["$CGI_DIR/connections-realtime.cgi"]="$BASE_URL/srv_cgi-bin/connections-realtime.cgi"
    ["$CGI_DIR/firewalllogs-realtime.cgi"]="$BASE_URL/srv_cgi-bin/firewalllogs-realtime.cgi"
    ["$CGI_DIR/hardware-realtime.cgi"]="$BASE_URL/srv_cgi-bin/hardware-realtime.cgi"
    ["$INCLUDE_DIR/ipfire-realtime.css"]="$BASE_URL/srv_include/ipfire-realtime.css"
    ["$INCLUDE_DIR/ipfire-realtime.js"]="$BASE_URL/srv_include/ipfire-realtime.js"
    ["$REALTIME_DIR/connections.pm"]="$BASE_URL/var_ipfire_realtime/connections.pm"
    ["$REALTIME_DIR/firewalllogs.pm"]="$BASE_URL/var_ipfire_realtime/firewalllogs.pm"
    ["$REALTIME_DIR/hardware.pm"]="$BASE_URL/var_ipfire_realtime/hardware.pm"
    ["$REALTIME_DIR/realtime-functions.pl"]="$BASE_URL/var_ipfire_realtime/realtime-functions.pl"
    ["$REALTIME_DIR/zoneutils.pm"]="$BASE_URL/var_ipfire_realtime/zoneutils.pm"
    ["$MENU_DIR/80-realtime.menu"]="$BASE_URL/var_menu.d/80-realtime.menu"
)

# Check if system is IPFire
function check_ipfire() {
    if grep -q "ipfire" /var/ipfire/fireinfo/profile 2>/dev/null; then
        return 0
    else
        echo "This script must be run on an IPFire system only."
        return 1
    fi
}

# Show files with ll or fallback to ls -l
function show_files_ll() {
    if command -v ll >/dev/null 2>&1; then
        ll "$@"
    else
        ls -l "$@"
    fi
}

# Install files and set permissions
function install_module() {
    echo "Installation started..."

    mkdir -p "$CGI_DIR" "$INCLUDE_DIR" "$ADDON_LANG_DIR" "$MENU_DIR" "$REALTIME_DIR"

    for file in "${!FILES[@]}"; do
        url="${FILES[$file]}"
        echo "Downloading $url to $file"
        wget -q -O "$file" "$url"
        if [ $? -ne 0 ]; then
            echo "Error downloading $url"
            exit 1
        fi
    done

    # Set permissions
    chmod 755 "$CGI_DIR"/*.cgi                 # executable scripts
    chmod 644 "$INCLUDE_DIR/ipfire-realtime.css" "$INCLUDE_DIR/ipfire-realtime.js"  # web assets
    chmod 004 "$ADDON_LANG_DIR/realtime-logs.de.pl" "$ADDON_LANG_DIR/realtime-logs.en.pl"  # restricted lang files
    chmod 644 "$MENU_DIR/00-menu.main" "$MENU_DIR/80-realtime.menu"  # menu files
    chmod 644 "$REALTIME_DIR"/*.pm "$REALTIME_DIR/realtime-functions.pl"  # perl modules

    clear
    echo "Installation completed."
    echo ""
    echo "Installed files:"
    # Liste alle installierten Dateien auf
    show_files_ll "${!FILES[@]}"
    echo ""
}

# Uninstall files, backup and restore menu file
function uninstall_module() {
    check_ipfire || return 1

    echo "Uninstallation started..."

    if [ -f "$MENU_FILE" ]; then
        echo "Backing up $MENU_FILE to $MENU_BACKUP"
        cp "$MENU_FILE" "$MENU_BACKUP"
    else
        echo "Menu file $MENU_FILE not found, no backup made."
    fi

    # Dateien vor dem Entfernen erfassen (falls vorhanden)
    removed_files=()
    for file in "${!FILES[@]}"; do
        if [[ "$file" != "$MENU_FILE" ]]; then
            if [ -f "$file" ]; then
                removed_files+=("$file")
                echo "Removing $file"
                rm -f "$file"
            fi
        fi
    done

    rmdir --ignore-fail-on-non-empty "$REALTIME_DIR"

    if [ -f "$MENU_BACKUP" ]; then
        echo "Restoring $MENU_FILE from backup."
        cp "$MENU_BACKUP" "$MENU_FILE"
        rm -f "$MENU_BACKUP"
    else
        echo "No backup of $MENU_FILE found to restore."
    fi

    clear
    echo "Uninstallation completed."
    echo ""
    if [ "${#removed_files[@]}" -gt 0 ]; then
        echo "Removed files:"
        for f in "${removed_files[@]}"; do
            echo "$f"
        done
    else
        echo "No files were removed."
    fi
    echo ""
}

# Update by uninstall then install
function update_module() {
    check_ipfire || return 1

    echo "Update started..."
    uninstall_module
    install_module
    clear
    echo "Update completed."
    echo ""
    echo "Updated files:"
    show_files_ll "${!FILES[@]}"
    echo ""
}

# Show interactive menu for user input
function show_menu() {
    echo ""
    echo "Real-Time-Monitoring Module - Choose an option:"
    echo "1) Install"
    echo "2) Uninstall"
    echo "3) Update (Uninstall + Install)"
    echo "4) Exit"
    echo -n "Please enter your choice (1-4): "
}

# Main interactive loop
while true; do
    show_menu
    read -r choice
    case "$choice" in
        1)
            install_module
            ;;
        2)
            uninstall_module
            ;;
        3)
            update_module
            ;;
        4)
            echo "Exiting."
            exit 0
            ;;
        *)
            echo "Invalid input. Please enter a number from 1 to 4."
            ;;
    esac
done

# EOF

