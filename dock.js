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

const DEFAULT_ICON_SIZE = 36;
const DOCK_HEIGHT = 56;
const WAVE_MAX_SCALE = 2.1;
const WAVE_RADIUS = 165;
const WAVE_MAX_SHIFT = 28;

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
        this.set_pivot_point(0.5, 1.0);

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

        this.connect('destroy', () => {
            this._cleanupTooltip();
        });
    }

    _cleanupTooltip() {
        if (!this._tooltip)
            return;

        try {
            this._tooltip.remove_all_transitions();
            Main.layoutManager.removeChrome(this._tooltip);
            this._tooltip.destroy();
        } catch (_e) {
            // Already destroyed or disposed by parent during shutdown
        } finally {
            this._tooltip = null;
        }
    }

    _showTooltip() {
        if (!this.get_stage() || !this.app)
            return;

        if (!this._tooltip) {
            this._tooltip = new St.Label({
                style_class: 'dock-tooltip',
                text: this.app.get_name(),
            });
            this._tooltip.connect('destroy', () => {
                this._tooltip = null;
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

    updateTooltipPosition() {
        if (!this._tooltip || !this._tooltip.visible)
            return;

        const [stageX, stageY] = this.get_transformed_position();
        const [w] = this.get_transformed_size();
        const [tw, th] = this._tooltip.get_preferred_size();
        const x = Math.round(stageX + (w - tw) / 2);
        const y = Math.round(stageY - th - 8);
        this._tooltip.set_position(x, y);
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
        const windows = this.app.get_windows() || [];
        const currentWorkspace = global.workspace_manager.get_active_workspace();
        const activeWindow = global.display.focus_window;

        if (windows.length > 0) {
            const hasFocusedWindow = activeWindow && windows.includes(activeWindow) &&
                                     (activeWindow.is_on_all_workspaces?.() || activeWindow.located_on_workspace(currentWorkspace));

            if (hasFocusedWindow) {
                if (windows.length === 1) {
                    if (activeWindow.can_minimize?.())
                        activeWindow.minimize();
                } else {
                    const currentIdx = windows.indexOf(activeWindow);
                    const nextIdx = (currentIdx + 1) % windows.length;
                    const nextWin = windows[nextIdx];
                    if (nextWin.minimized)
                        nextWin.unminimize();
                    nextWin.activate(global.get_current_time());
                }
            } else {
                const workspaceWindows = windows.filter(w => w.is_on_all_workspaces?.() || w.located_on_workspace(currentWorkspace));
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
        if (!this.app || !this._dot)
            return;

        if (this.app.state === Shell.AppState.STOPPED) {
            this._dot.hide();
            this.remove_style_pseudo_class('running');
            this.remove_style_pseudo_class('focused');
            return;
        }

        this._dot.show();
        this.add_style_pseudo_class('running');

        const windows = this.app.get_windows() || [];
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
        this._cleanupTooltip();
        super.destroy();
    }
});

/**
 * ShowAppsButton triggers GNOME Shell's application grid overview
 * and stays in sync with overview state.
 */
export const ShowAppsButton = GObject.registerClass(
class ShowAppsButton extends St.Button {
    _init(dock, iconSize = DEFAULT_ICON_SIZE) {
        super._init({
            style_class: 'dock-item show-apps-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._dock = dock;
        this._icon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: iconSize,
            style_class: 'show-apps-icon',
        });
        this.set_child(this._icon);
        this.set_pivot_point(0.5, 1.0);

        this._tooltip = null;

        this.connect('clicked', () => this._onClicked());
        this.connect('notify::hover', () => {
            if (this.hover)
                this._showTooltip();
            else
                this._hideTooltip();
        });

        this.connect('destroy', () => {
            this._cleanupTooltip();
        });
    }

    _cleanupTooltip() {
        if (!this._tooltip)
            return;

        try {
            this._tooltip.remove_all_transitions();
            Main.layoutManager.removeChrome(this._tooltip);
            this._tooltip.destroy();
        } catch (_e) {
            // Already destroyed or disposed by parent during shutdown
        } finally {
            this._tooltip = null;
        }
    }

    _onClicked() {
        this._hideTooltip();
        this._dock.toggleAppLauncher();
    }

    _showTooltip() {
        if (!this.get_stage())
            return;

        if (!this._tooltip) {
            this._tooltip = new St.Label({
                style_class: 'dock-tooltip',
                text: _('Applications'),
            });
            this._tooltip.connect('destroy', () => {
                this._tooltip = null;
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

    updateTooltipPosition() {
        if (!this._tooltip || !this._tooltip.visible)
            return;

        const [stageX, stageY] = this.get_transformed_position();
        const [w] = this.get_transformed_size();
        const [tw, th] = this._tooltip.get_preferred_size();
        const x = Math.round(stageX + (w - tw) / 2);
        const y = Math.round(stageY - th - 8);
        this._tooltip.set_position(x, y);
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
        this._cleanupTooltip();
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
        this._appIcons = new Map();
        this._separator = null;

        // Floating pill container
        this._dockPill = new St.BoxLayout({
            style_class: 'arrera-dock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            reactive: true,
            track_hover: true,
        });
        this._dockPill._delegate = this;
        this.add_child(this._dockPill);

        this._dockPill.connect('motion-event', (_actor, event) => {
            const [stageX] = event.get_coords();
            this._applyWaveMagnification(stageX);
            return Clutter.EVENT_PROPAGATE;
        });

        this._dockPill.connect('leave-event', (_actor, event) => {
            const related = event.get_related();
            if (related && this._dockPill.contains(related))
                return Clutter.EVENT_PROPAGATE;

            this._resetWaveMagnification();
            return Clutter.EVENT_PROPAGATE;
        });

        this._dockPill.connect('notify::hover', () => {
            if (!this._dockPill.hover)
                this._resetWaveMagnification();
        });

        // Icons box (favorites and running apps)
        this._iconsBox = new St.BoxLayout({
            style_class: 'arrera-dock-icons',
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        this._iconsBox._delegate = this;
        this._dockPill.add_child(this._iconsBox);

        // Separator between apps and Show Apps launcher
        this._appsSeparator = new St.Widget({
            style_class: 'dock-separator',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._dockPill.add_child(this._appsSeparator);

        // Show Apps Button
        this._showAppsButton = new ShowAppsButton(this, this._iconSize);
        this._dockPill.add_child(this._showAppsButton);

        // Deferred work to coalesce redisplay updates
        this._workId = Main.initializeDeferredWork(
            this._iconsBox,
            () => this._redisplay()
        );

        // Setup signal listeners
        this._appFavorites = AppFavorites.getAppFavorites();
        this._appFavorites.connectObject('changed', () => this._queueRedisplay(), this);

        this._appSystem = Shell.AppSystem.get_default();
        this._appSystem.connectObject(
            'installed-changed', () => this._queueRedisplay(),
            'app-state-changed', () => this._queueRedisplay(),
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

        this._hasConnectedAdjustment = false;
        this._bindOverview();

        this._redisplay();
    }

    _bindOverview() {
        Main.overview.connectObject(
            'showing', () => this._syncWithOverview(),
            'hiding', () => this._syncWithOverview(),
            'hidden', () => this._onOverviewHidden(),
            this
        );

        this._connectStateAdjustment();
        this._syncWithOverview();
    }

    _connectStateAdjustment() {
        if (this._hasConnectedAdjustment)
            return;

        const controls = Main.overview._overview?._controls;
        if (controls?._stateAdjustment) {
            controls._stateAdjustment.connectObject(
                'notify::value', () => this._syncWithOverview(),
                this
            );
            this._hasConnectedAdjustment = true;
        }
    }

    _onOverviewHidden() {
        this.show();
        this._dockPill.remove_all_transitions();
        this._dockPill.opacity = 255;
        this._dockPill.translation_y = 0;
        this._dockPill.reactive = true;
        this._resetWaveMagnification();
    }

    _syncWithOverview() {
        this._connectStateAdjustment();

        if (!Main.overview.visible) {
            this._onOverviewHidden();
            return;
        }

        const controls = Main.overview._overview?._controls;
        const stateAdjustment = controls?._stateAdjustment;
        if (!stateAdjustment) {
            this._hideTooltips();
            this.hide();
            return;
        }

        const val = stateAdjustment.value;
        const { initialState, finalState } = stateAdjustment.getStateTransitionParams();

        let factor;
        // Direct transition between Desktop (0) and App Grid (2): keep fully visible without flickering
        if ((initialState === OverviewControls.ControlsState.HIDDEN && finalState === OverviewControls.ControlsState.APP_GRID) ||
            (initialState === OverviewControls.ControlsState.APP_GRID && finalState === OverviewControls.ControlsState.HIDDEN)) {
            factor = 1.0;
        } else if (val <= 1.0) {
            // Between Desktop (0) and Activities/Window Picker (1): fade out towards Activities
            factor = Math.max(0, Math.min(1, 1.0 - val));
        } else {
            // Between Activities/Window Picker (1) and App Grid (2): fade in towards App Grid
            factor = Math.max(0, Math.min(1, val - 1.0));
        }

        if (factor <= 0.01) {
            this._hideTooltips();
            this._dockPill.opacity = 0;
            this._dockPill.translation_y = 30;
            this._dockPill.reactive = false;
            this.hide();
        } else {
            this.show();
            this._dockPill.opacity = Math.round(255 * factor);
            this._dockPill.translation_y = Math.round((1.0 - factor) * 30);
            this._dockPill.reactive = factor >= 0.8;
        }
    }

    _hideTooltips() {
        for (const icon of this._appIcons.values()) {
            icon._hideTooltip?.();
        }
        this._showAppsButton?._hideTooltip?.();
    }

    _getAllDockItems() {
        const items = [];
        for (const child of this._iconsBox.get_children()) {
            if (child instanceof DockAppIcon)
                items.push(child);
        }
        if (this._showAppsButton)
            items.push(this._showAppsButton);
        return items;
    }

    _applyWaveMagnification(stageX) {
        const items = this._getAllDockItems();
        if (items.length === 0)
            return;

        for (const item of items) {
            item.remove_all_transitions();

            const [itemX] = item.get_transformed_position();
            const [itemW] = item.get_transformed_size();
            const itemBaseWidth = item.width || itemW;
            const itemCenterX = itemX + itemBaseWidth / 2 - (item.translation_x || 0);

            const dx = Math.abs(stageX - itemCenterX);

            if (dx < WAVE_RADIUS) {
                const factor = 0.5 * (1 + Math.cos((Math.PI * dx) / WAVE_RADIUS));
                const scale = 1.0 + (WAVE_MAX_SCALE - 1.0) * factor;

                const direction = itemCenterX >= stageX ? 1 : -1;
                const shiftFactor = Math.sin((Math.PI * dx) / WAVE_RADIUS);
                const shiftX = direction * WAVE_MAX_SHIFT * shiftFactor;

                item.set_pivot_point(0.5, 1.0);
                item.set_scale(scale, scale);
                item.translation_x = Math.round(shiftX);
            } else {
                item.set_scale(1.0, 1.0);
                item.translation_x = 0;
            }

            item.updateTooltipPosition?.();
        }
    }

    _resetWaveMagnification() {
        const items = this._getAllDockItems();
        for (const item of items) {
            item.ease({
                scale_x: 1.0,
                scale_y: 1.0,
                translation_x: 0,
                duration: 220,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            item.updateTooltipPosition?.();
        }
    }

    _queueRedisplay() {
        if (this._workId)
            Main.queueDeferredWork(this._workId);
        else
            this._redisplay();
    }

    bindAppLauncher(launcher) {
        if (!launcher || !this._showAppsButton)
            return;

        launcher.connectObject(
            'opened', () => {
                this._showAppsButton.add_style_pseudo_class('checked');
            },
            'closed', () => {
                this._showAppsButton.remove_style_pseudo_class('checked');
            },
            this
        );
    }

    toggleAppLauncher() {
        this._extension?.toggleAppLauncher?.();
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

        const favoriteIds = new Set(favorites.map(app => app.get_id()));
        const nonFavoriteRunning = running.filter(app => !favoriteIds.has(app.get_id()));

        // The complete set of apps that should currently be in the dock
        const targetApps = [...favorites, ...nonFavoriteRunning];
        const targetIds = new Set(targetApps.map(app => app.get_id()));

        // 1. Destroy and delete icons that are no longer favorites and no longer running
        for (const [id, icon] of this._appIcons.entries()) {
            if (!targetIds.has(id)) {
                if (icon.get_parent() === this._iconsBox)
                    this._iconsBox.remove_child(icon);
                icon.destroy();
                this._appIcons.delete(id);
            }
        }

        // 2. Remove all remaining children from _iconsBox WITHOUT destroying them
        this._iconsBox.remove_all_children();

        // 3. Add favorite icons in order
        for (const app of favorites) {
            const id = app.get_id();
            let icon = this._appIcons.get(id);
            if (!icon) {
                icon = new DockAppIcon(app, this._iconSize);
                this._appIcons.set(id, icon);
            }
            this._iconsBox.add_child(icon);
        }

        // 4. Separator if both favorites and running non-favorites exist
        if (favorites.length > 0 && nonFavoriteRunning.length > 0) {
            if (!this._separator) {
                this._separator = new St.Widget({
                    style_class: 'dock-separator',
                    y_align: Clutter.ActorAlign.CENTER,
                });
            }
            this._iconsBox.add_child(this._separator);
        }

        // 5. Add running non-favorite apps in order
        for (const app of nonFavoriteRunning) {
            const id = app.get_id();
            let icon = this._appIcons.get(id);
            if (!icon) {
                icon = new DockAppIcon(app, this._iconSize);
                this._appIcons.set(id, icon);
            }
            this._iconsBox.add_child(icon);
        }

        this._updateActiveWindow();
    }

    _updateActiveWindow() {
        const focusWindow = global.display.focus_window;
        for (const icon of this._appIcons.values()) {
            icon.updateActiveState(focusWindow);
        }
    }

    // Drag and drop support: accept apps dropped on the dock to add/reorder favorites
    handleDragOver(source, _actor, x, _y, _time) {
        const app = source?.app || (Dash.Dash?.getAppFromSource ? Dash.Dash.getAppFromSource(source) : null);
        if (!app || app.is_window_backed?.())
            return DND.DragMotionResult.NO_DROP;

        if (!global.settings.is_writable('favorite-apps'))
            return DND.DragMotionResult.NO_DROP;

        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source, _actor, x, _y, _time) {
        const app = source?.app || (Dash.Dash?.getAppFromSource ? Dash.Dash.getAppFromSource(source) : null);
        if (!app || app.is_window_backed?.())
            return false;

        if (!global.settings.is_writable('favorite-apps'))
            return false;

        const id = app.get_id();
        const favorites = this._appFavorites.getFavorites();

        let pos = Math.min(
            Math.floor((x / Math.max(1, this._iconsBox.width)) * favorites.length),
            favorites.length
        );

        if (this._appFavorites.isFavorite(id))
            this._appFavorites.moveFavoriteToPos(id, pos);
        else
            this._appFavorites.addFavoriteAtPos(id, pos);

        return true;
    }

    destroy() {
        this._resetWaveMagnification();

        if (this._extension?.appLauncher)
            this._extension.appLauncher.disconnectObject(this);

        Main.overview.disconnectObject(this);
        const controls = Main.overview._overview?._controls;
        if (controls?._stateAdjustment)
            controls._stateAdjustment.disconnectObject(this);

        this._appFavorites.disconnectObject(this);
        this._appSystem.disconnectObject(this);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);

        for (const icon of this._appIcons.values()) {
            icon.destroy();
        }
        this._appIcons.clear();

        if (this._separator) {
            this._separator.destroy();
            this._separator = null;
        }

        super.destroy();
    }
});
