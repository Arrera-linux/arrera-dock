/* dock.js
 *
 * Arrera Dock - Modern desktop dock replacing native GNOME overview dash
 * Distribution Arrera Blue
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';

const DEFAULT_ICON_SIZE = 48;
const DOCK_HEIGHT = 68;

/**
 * DockAppIcon represents an individual application launcher inside Arrera Dock.
 * Inherits from Dash.DashIcon to reuse AppMenu, icon texture, and DND logic.
 */
export const DockAppIcon = GObject.registerClass(
class DockAppIcon extends Dash.DashIcon {
    _init(app, iconSize = DEFAULT_ICON_SIZE) {
        super._init(app);

        this._iconSize = iconSize;
        this.icon.setIconSize(iconSize);
        this.label_actor = null;
        this.add_style_class_name('dock-app-icon');

        this._tooltip = null;

        this.connect('notify::hover', () => {
            if (this.hover && (!this._menu || !this._menu.isOpen)) {
                this._showTooltip();
            } else {
                this._hideTooltip();
            }
        });

        // Hide tooltip when context menu opens
        this.connect('menu-state-changed', (actor, opened) => {
            if (opened)
                this._hideTooltip();
        });
    }

    _showTooltip() {
        if (!this._tooltip) {
            this._tooltip = new St.Label({
                style_class: 'dock-tooltip',
                text: this.app.get_name(),
            });
            Main.layoutManager.addChrome(this._tooltip);
        }

        this._tooltip.opacity = 0;
        this._tooltip.show();

        const [stageX, stageY] = this.get_transformed_position();
        const [w] = this.get_transformed_size();
        const [tw, th] = this._tooltip.get_preferred_size();
        const x = Math.round(stageX + (w - tw) / 2);
        const y = Math.round(stageY - th - 8);

        this._tooltip.set_position(x, y);
        this._tooltip.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideTooltip() {
        if (!this._tooltip)
            return;

        this._tooltip.ease({
            opacity: 0,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._tooltip)
                    this._tooltip.hide();
            },
        });
    }

    activate(button) {
        this._hideTooltip();

        const event = Clutter.get_current_event();
        const modifiers = event ? event.get_state() : 0;
        const isMiddleButton = button && button === Clutter.BUTTON_MIDDLE;
        const isCtrlPressed = (modifiers & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const openNewWindow = this.app.can_open_new_window() &&
                             this.app.state === Shell.AppState.RUNNING &&
                             (isCtrlPressed || isMiddleButton);

        if (openNewWindow) {
            this.animateLaunch();
            this.app.open_new_window(-1);
            if (Main.overview.visible)
                Main.overview.hide();
            return;
        }

        if (this.app.state === Shell.AppState.STOPPED) {
            this.animateLaunch();
            this.app.activate();
            if (Main.overview.visible)
                Main.overview.hide();
            return;
        }

        // App is already running: smart toggle / minimize / focus
        const windows = this.app.get_windows();
        const currentWorkspace = global.workspace_manager.get_active_workspace();
        const activeWindow = global.display.focus_window;

        if (windows.length > 0) {
            const hasFocusedWindow = activeWindow && windows.includes(activeWindow) &&
                                     activeWindow.located_on_workspace(currentWorkspace);

            if (hasFocusedWindow) {
                if (windows.length === 1) {
                    // Toggle minimize if only 1 window
                    activeWindow.minimize();
                } else {
                    // Cycle to next window for this app
                    const currentIdx = windows.indexOf(activeWindow);
                    const nextIdx = (currentIdx + 1) % windows.length;
                    const nextWin = windows[nextIdx];
                    if (nextWin.minimized)
                        nextWin.unminimize();
                    nextWin.activate(global.get_current_time());
                }
            } else {
                // Focus the app's window on current workspace or main window
                const workspaceWindows = windows.filter(w => w.located_on_workspace(currentWorkspace));
                const winToActivate = workspaceWindows[0] || windows[0];
                if (winToActivate.minimized)
                    winToActivate.unminimize();
                winToActivate.activate(global.get_current_time());
            }
        } else {
            this.app.activate();
        }

        if (Main.overview.visible)
            Main.overview.hide();
    }

    updateActiveState(focusWindow) {
        if (this.app.state === Shell.AppState.STOPPED) {
            this._dot.hide();
            this.remove_style_pseudo_class('running');
            this.remove_style_pseudo_class('focused');
            return;
        }

        this._dot.show();
        this.add_style_pseudo_class('running');

        const windows = this.app.get_windows();
        const isFocused = focusWindow && windows.includes(focusWindow);

        if (isFocused) {
            this._dot.add_style_class_name('focused');
            this.add_style_pseudo_class('focused');
        } else {
            this._dot.remove_style_class_name('focused');
            this.remove_style_pseudo_class('focused');
        }
    }

    destroy() {
        if (this._tooltip) {
            Main.layoutManager.removeChrome(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }
        super.destroy();
    }
});

/**
 * ShowAppsButton triggers GNOME Shell's application grid overview
 * and stays in sync with overview state.
 */
export const ShowAppsButton = GObject.registerClass(
class ShowAppsButton extends St.Button {
    _init(iconSize = DEFAULT_ICON_SIZE) {
        super._init({
            style_class: 'dock-item show-apps-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._icon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: Math.round(iconSize * 0.65),
            style_class: 'show-apps-icon',
        });
        this.set_child(this._icon);

        this._tooltip = null;

        this.connect('clicked', () => this._onClicked());
        this.connect('notify::hover', () => {
            if (this.hover)
                this._showTooltip();
            else
                this._hideTooltip();
        });

        // Sync with overview state
        Main.overview.connectObject(
            'showing', () => this._updateState(),
            'hiding', () => this._updateState(),
            this
        );

        const controls = Main.overview._overview?._controls;
        if (controls?._stateAdjustment) {
            controls._stateAdjustment.connectObject(
                'notify::value', () => this._updateState(),
                this
            );
        }

        this._updateState();
    }

    _onClicked() {
        this._hideTooltip();
        const controls = Main.overview._overview?._controls;
        if (Main.overview.visible) {
            if (controls && Math.round(controls._stateAdjustment.value) === OverviewControls.ControlsState.APP_GRID) {
                Main.overview.hide();
            } else if (controls) {
                controls._stateAdjustment.ease(OverviewControls.ControlsState.APP_GRID);
            } else {
                Main.overview.hide();
            }
        } else {
            Main.overview.show(OverviewControls.ControlsState.APP_GRID);
        }
    }

    _updateState() {
        const controls = Main.overview._overview?._controls;
        const isAppGrid = Main.overview.visible &&
            controls &&
            Math.round(controls._stateAdjustment.value) === OverviewControls.ControlsState.APP_GRID;

        if (isAppGrid)
            this.add_style_pseudo_class('checked');
        else
            this.remove_style_pseudo_class('checked');
    }

    _showTooltip() {
        if (!this._tooltip) {
            this._tooltip = new St.Label({
                style_class: 'dock-tooltip',
                text: _('Applications'),
            });
            Main.layoutManager.addChrome(this._tooltip);
        }

        this._tooltip.opacity = 0;
        this._tooltip.show();

        const [stageX, stageY] = this.get_transformed_position();
        const [w] = this.get_transformed_size();
        const [tw, th] = this._tooltip.get_preferred_size();
        const x = Math.round(stageX + (w - tw) / 2);
        const y = Math.round(stageY - th - 8);

        this._tooltip.set_position(x, y);
        this._tooltip.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideTooltip() {
        if (!this._tooltip)
            return;

        this._tooltip.ease({
            opacity: 0,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._tooltip)
                    this._tooltip.hide();
            },
        });
    }

    destroy() {
        if (this._tooltip) {
            Main.layoutManager.removeChrome(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }
        Main.overview.disconnectObject(this);
        const controls = Main.overview._overview?._controls;
        if (controls?._stateAdjustment)
            controls._stateAdjustment.disconnectObject(this);

        super.destroy();
    }
});

/**
 * ArreraDock is the main dock widget container added to GNOME Shell's chrome.
 */
export const ArreraDock = GObject.registerClass(
class ArreraDock extends St.Widget {
    _init(extension) {
        super._init({
            name: 'arrera-dock-container',
            style_class: 'arrera-dock-container',
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
        });

        this._extension = extension;
        this._iconSize = DEFAULT_ICON_SIZE;

        // Floating pill container
        this._dockPill = new St.BoxLayout({
            style_class: 'arrera-dock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        this._dockPill._delegate = this;
        this.add_child(this._dockPill);

        // Icons box (favorites and running apps)
        this._iconsBox = new St.BoxLayout({
            style_class: 'arrera-dock-icons',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        this._dockPill.add_child(this._iconsBox);

        // Separator between apps and Show Apps launcher
        this._appsSeparator = new St.Widget({
            style_class: 'dock-separator',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._dockPill.add_child(this._appsSeparator);

        // Show Apps Button
        this._showAppsButton = new ShowAppsButton(this._iconSize);
        this._dockPill.add_child(this._showAppsButton);

        // Setup signal listeners
        this._appFavorites = AppFavorites.getAppFavorites();
        this._appFavorites.connectObject('changed', () => this._redisplay(), this);

        this._appSystem = Shell.AppSystem.get_default();
        this._appSystem.connectObject(
            'installed-changed', () => this._redisplay(),
            'app-state-changed', () => this._redisplay(),
            this
        );

        global.display.connectObject(
            'notify::focus-window', () => this._updateActiveWindow(),
            this
        );

        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this._updateActiveWindow(),
            this
        );

        this._redisplay();
    }

    getPreferredHeight() {
        return DOCK_HEIGHT;
    }

    updatePosition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const dockHeight = this.getPreferredHeight();
        this.set_position(monitor.x, monitor.y + monitor.height - dockHeight);
        this.set_size(monitor.width, dockHeight);
    }

    _redisplay() {
        const favorites = this._appFavorites.getFavorites();
        const running = this._appSystem.get_running();

        // Cache existing icon items by App ID
        const existingIcons = new Map();
        for (const child of this._iconsBox.get_children()) {
            if (child.app)
                existingIcons.set(child.app.get_id(), child);
        }

        // Clear icons container
        this._iconsBox.destroy_all_children();

        const favoriteIds = new Set();

        // 1. Add Favorites
        for (const app of favorites) {
            const id = app.get_id();
            favoriteIds.add(id);

            let iconItem = existingIcons.get(id);
            if (!iconItem)
                iconItem = new DockAppIcon(app, this._iconSize);

            this._iconsBox.add_child(iconItem);
        }

        // 2. Add Running apps not in favorites
        const nonFavoriteRunning = running.filter(app => !favoriteIds.has(app.get_id()));

        if (nonFavoriteRunning.length > 0 && favorites.length > 0) {
            const sep = new St.Widget({
                style_class: 'dock-separator',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._iconsBox.add_child(sep);
        }

        for (const app of nonFavoriteRunning) {
            const id = app.get_id();
            let iconItem = existingIcons.get(id);
            if (!iconItem)
                iconItem = new DockAppIcon(app, this._iconSize);

            this._iconsBox.add_child(iconItem);
        }

        this._updateActiveWindow();
    }

    _updateActiveWindow() {
        const focusWindow = global.display.focus_window;
        for (const child of this._iconsBox.get_children()) {
            if (child instanceof DockAppIcon)
                child.updateActiveState(focusWindow);
        }
    }

    // Drag and drop support: accept apps dropped on the dock to add/reorder favorites
    handleDragOver(source, _actor, x, _y, _time) {
        const app = Dash.Dash.getAppFromSource(source);
        if (!app || app.is_window_backed())
            return DND.DragMotionResult.NO_DROP;

        if (!global.settings.is_writable('favorite-apps'))
            return DND.DragMotionResult.NO_DROP;

        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source, _actor, x, _y, _time) {
        const app = Dash.Dash.getAppFromSource(source);
        if (!app || app.is_window_backed())
            return false;

        if (!global.settings.is_writable('favorite-apps'))
            return false;

        const id = app.get_id();
        const favorites = this._appFavorites.getFavorites();
        const children = this._iconsBox.get_children().filter(c => c instanceof DockAppIcon);

        let pos = Math.min(
            Math.floor(x / Math.max(1, this._iconsBox.width) * children.length),
            favorites.length
        );

        if (this._appFavorites.isFavorite(id))
            this._appFavorites.moveFavoriteToPos(id, pos);
        else
            this._appFavorites.addFavoriteAtPos(id, pos);

        return true;
    }

    destroy() {
        this._appFavorites.disconnectObject(this);
        this._appSystem.disconnectObject(this);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);

        super.destroy();
    }
});
