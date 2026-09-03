/* appLauncher.js
 *
 * macOS 26 Style Floating Applications Launcher Panel
 * Displays installed applications in a sleek, glassmorphic floating window
 * with live search, category pills, and 7-column grid.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COLUMNS = 7;
const ICON_SIZE = 56;
const WINDOW_WIDTH = 780;
const WINDOW_HEIGHT = 540;

/**
 * Individual Application Item in the 7-column grid
 */
const MacAppItem = GObject.registerClass(
class MacAppItem extends St.Button {
    _init(app, launcher) {
        super._init({
            style_class: 'mac-app-item',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._app = app;
        this._launcher = launcher;

        const container = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'mac-app-item-box',
        });
        this.set_child(container);

        // Icon texture bin
        const iconTexture = app.create_icon_texture(ICON_SIZE);
        const iconBin = new St.Bin({
            child: iconTexture,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'mac-app-icon-bin',
        });
        container.add_child(iconBin);

        // Label
        const label = new St.Label({
            text: app.get_name(),
            style_class: 'mac-app-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.set_line_wrap(true);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        label.clutter_text.set_max_length(18);
        container.add_child(label);

        this.connect('clicked', () => {
            this._app.activate();
            this._launcher.close();
        });
    }

    get app() {
        return this._app;
    }
});

/**
 * AppLaucher: Floating modal applications panel
 */
export const AppLaucher = GObject.registerClass({
    Signals: {
        'opened': {},
        'closed': {},
    },
}, class AppLaucher extends St.Widget {
    _init(extension) {
        super._init({
            name: 'mac-app-launcher',
            style_class: 'mac-app-launcher-root',
            layout_manager: new Clutter.BinLayout(),
            visible: false,
            reactive: true,
        });

        this._extension = extension;
        this._grab = null;
        this._isOpen = false;
        this._allApps = [];

        // Backdrop to catch outside clicks and dismiss
        this._backdrop = new Clutter.Actor({
            reactive: true,
            x_expand: true,
            y_expand: true,
        });
        this._backdrop.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._backdrop);

        this._window = new St.BoxLayout({
            name: 'mac-app-launcher-window',
            style_class: 'mac-app-launcher-window',
            vertical: true,
            reactive: true,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._window.set_pivot_point(0.5, 0.5);
        // Prevent clicks inside the window from bubbling to the backdrop
        this._window.connect('button-press-event', () => Clutter.EVENT_STOP);
        this.add_child(this._window);

        this._buildHeader();
        this._buildGrid();

        // Add to main uiGroup so it overlays cleanly
        Main.uiGroup.add_child(this);

        // Listen for installed applications changes
        this._appSystem = Shell.AppSystem.get_default();
        this._appSystem.connectObject('installed-changed', () => this._reloadApps(), this);

        // Synchronize with GNOME accent color settings
        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._interfaceSettings.connectObject('changed::accent-color', () => this._syncAccentColor(), this);
        this._syncAccentColor();
    }

    _syncAccentColor() {
        const colorName = this._interfaceSettings?.get_string('accent-color') || 'blue';
        const allColors = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];

        for (const c of allColors) {
            this.remove_style_class_name(`accent-${c}`);
            this._window?.remove_style_class_name(`accent-${c}`);
        }

        this.add_style_class_name(`accent-${colorName}`);
        this._window?.add_style_class_name(`accent-${colorName}`);
    }

    get isOpen() {
        return this._isOpen;
    }

    _buildHeader() {
        const header = new St.BoxLayout({
            style_class: 'mac-launcher-header',
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._window.add_child(header);

        // App Store / Applications icon
        const appIcon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: 20,
            style_class: 'mac-launcher-title-icon',
        });
        header.add_child(appIcon);

        // Search Entry
        this._searchEntry = new St.Entry({
            style_class: 'mac-launcher-search-entry',
            hint_text: 'Applications',
            can_focus: true,
            x_expand: true,
        });
        this._searchEntry.clutter_text.connect('text-changed', () => this._refilterApps());
        header.add_child(this._searchEntry);

        // Close button (...)
        const closeBtn = new St.Button({
            style_class: 'mac-launcher-close-btn',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                icon_size: 14,
            }),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        closeBtn.connect('clicked', () => this.close());
        header.add_child(closeBtn);
    }

    _buildGrid() {
        this._scrollView = new St.ScrollView({
            style_class: 'mac-launcher-scroll',
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });
        this._window.add_child(this._scrollView);

        this._gridBox = new St.BoxLayout({
            style_class: 'mac-launcher-grid',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        this._scrollView.set_child(this._gridBox);
    }

    _reloadApps() {
        const appSys = this._appSystem;
        const installed = appSys.get_installed();
        const apps = [];

        for (const appInfo of installed) {
            try {
                if (!appInfo || !appInfo.should_show())
                    continue;

                const id = appInfo.get_id();
                if (!id)
                    continue;

                const app = appSys.lookup_app(id);
                if (app)
                    apps.push(app);
            } catch (_e) {
                // Ignore invalid desktop files
            }
        }

        apps.sort((a, b) => a.get_name().localeCompare(b.get_name()));
        this._allApps = apps;
        this._refilterApps();
    }

    _refilterApps() {
        this._gridBox.destroy_all_children();

        const query = this._searchEntry.get_text().trim().toLowerCase();

        const filtered = this._allApps.filter(app => {
            if (query.length > 0) {
                const name = app.get_name().toLowerCase();
                const id = (app.get_id() || '').toLowerCase();
                if (!name.includes(query) && !id.includes(query))
                    return false;
            }
            return true;
        });

        for (let r = 0; r < filtered.length; r += COLUMNS) {
            const rowBox = new St.Widget({
                style_class: 'mac-app-row',
                layout_manager: new Clutter.BoxLayout({
                    spacing: 12,
                    homogeneous: true,
                }),
                x_expand: true,
            });
            const slice = filtered.slice(r, r + COLUMNS);
            for (const app of slice) {
                const item = new MacAppItem(app, this);
                rowBox.add_child(item);
            }
            for (let pad = slice.length; pad < COLUMNS; pad++) {
                const dummy = new St.Widget({ x_expand: true });
                rowBox.add_child(dummy);
            }
            this._gridBox.add_child(rowBox);
        }
    }

    _updateGeometry() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        this.set_position(monitor.x, monitor.y);
        this.set_size(monitor.width, monitor.height);

        const w = Math.min(WINDOW_WIDTH, monitor.width - 40);
        const h = Math.min(WINDOW_HEIGHT, monitor.height - 120);

        this._window.set_size(w, h);
    }

    open() {
        if (this._isOpen)
            return;

        if (this._allApps.length === 0)
            this._reloadApps();
        else
            this._refilterApps();

        this._updateGeometry();
        this._isOpen = true;

        // Reset search and scroll
        this._searchEntry.set_text('');
        const adj = this._scrollView.vadjustment;
        if (adj)
            adj.value = 0;

        // Modal grab
        this._grab = Main.pushModal(this);

        this.opacity = 0;
        this.visible = true;

        this._window.scale_x = 0.94;
        this._window.scale_y = 0.94;

        this.ease({
            opacity: 255,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._window.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });

        this._searchEntry.grab_key_focus();
        this.emit('opened');
    }

    close() {
        if (!this._isOpen)
            return;

        this._isOpen = false;

        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }

        this.ease({
            opacity: 0,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.visible = false;
                this.emit('closed');
            },
        });

        this._window.ease({
            scale_x: 0.95,
            scale_y: 0.95,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    vfunc_key_press_event(event) {
        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Escape) {
            if (this._searchEntry.get_text().length > 0)
                this._searchEntry.set_text('');
            else
                this.close();
            return Clutter.EVENT_STOP;
        }

        if (symbol === Clutter.KEY_Super_L || symbol === Clutter.KEY_Super_R) {
            this.close();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        this.close();
        if (this._interfaceSettings) {
            this._interfaceSettings.disconnectObject(this);
            this._interfaceSettings = null;
        }
        this._appSystem.disconnectObject(this);
        super.destroy();
    }
});

export const AppLauncher = AppLaucher;
export const MacAppLauncher = AppLaucher;
