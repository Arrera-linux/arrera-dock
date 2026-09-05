/* dock.js
 *
 * Arrera Dock - Modern desktop dock replacing native GNOME overview dash
 * Distribution Arrera Blue
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
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

export const SIZES = {
    small: {
        iconSize: 28,
        dockHeight: 46,
        waveMaxScale: 2.0,
        waveRadius: 140,
        waveMaxShift: 22,
    },
    medium: {
        iconSize: 36,
        dockHeight: 56,
        waveMaxScale: 2.1,
        waveRadius: 165,
        waveMaxShift: 28,
    },
    large: {
        iconSize: 48,
        dockHeight: 72,
        waveMaxScale: 1.9,
        waveRadius: 200,
        waveMaxShift: 34,
    },
};

const DEFAULT_ICON_SIZE = SIZES.medium.iconSize;
const DOCK_HEIGHT = SIZES.medium.dockHeight;
const WAVE_MAX_SCALE = SIZES.medium.waveMaxScale;
const WAVE_RADIUS = SIZES.medium.waveRadius;
const WAVE_MAX_SHIFT = SIZES.medium.waveMaxShift;

/**
 * DockAppIcon represents an individual application launcher inside Arrera Dock.
 * Inherits from Dash.DashIcon to reuse AppMenu, icon texture, and DND logic.
 */
export const DockAppIcon = GObject.registerClass(
class DockAppIcon extends Dash.DashIcon {
    _init(app, iconSize = DEFAULT_ICON_SIZE, dock = null) {
        super._init(app);

        this._dock = dock;
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

        // Hide tooltip when context menu opens & notify dock for autohide
        this.connect('menu-state-changed', (_actor, opened) => {
            if (opened)
                this._hideTooltip();
            this._dock?._onMenuStateChanged?.(opened);
        });

        this.connect('destroy', () => {
            this._cleanupTooltip();
        });
    }

    setIconSize(size) {
        this._iconSize = size;
        this.icon.setIconSize(size);
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
        this._iconSize = iconSize;
        this._icon = this._createIcon(iconSize);
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

    _createIcon(iconSize) {
        const extPath = this._dock?._extension?.path;
        if (extPath) {
            const candidates = [
                'show-apps-symbolic.svg',
                'show-apps.svg',
                'show-apps.png',
                'logo-symbolic.svg',
                'logo.svg',
                'logo.png',
            ];
            for (const name of candidates) {
                const filePath = `${extPath}/icons/${name}`;
                const file = Gio.File.new_for_path(filePath);
                if (file.query_exists(null)) {
                    return new St.Icon({
                        gicon: new Gio.FileIcon({ file }),
                        icon_size: iconSize,
                        style_class: 'show-apps-icon',
                    });
                }
            }
        }

        return new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: iconSize,
            style_class: 'show-apps-icon',
        });
    }

    setIconSize(size) {
        this._iconSize = size;
        if (this._icon)
            this._icon.icon_size = size;
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
        this._settings = extension.getSettings?.();

        // Icon sizing
        this._sizeName = 'medium';
        this._iconSize = SIZES.medium.iconSize;
        this._dockHeight = SIZES.medium.dockHeight;
        this._waveMaxScale = SIZES.medium.waveMaxScale;
        this._waveRadius = SIZES.medium.waveRadius;
        this._waveMaxShift = SIZES.medium.waveMaxShift;

        // Wave effect
        this._enableWaveEffect = true;

        // Autohide state
        this._autohide = false;
        this._autohideTimeoutId = 0;
        this._openMenusCount = 0;
        this._isDockHidden = false;

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
            if (this._dockPill.hover) {
                this._onEnter();
            } else {
                this._resetWaveMagnification();
                this._onLeave();
            }
        });

        this.connect('notify::hover', () => {
            if (this.hover)
                this._onEnter();
            else
                this._onLeave();
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

        // Synchronize with GNOME accent color settings (Material 3 Expressive)
        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._interfaceSettings.connectObject('changed::accent-color', () => this._syncAccentColor(), this);
        this._syncAccentColor();

        // Connect GSettings for Dock customization
        if (this._settings) {
            this._settings.connectObject(
                'changed::autohide', () => this._syncAutohide(),
                'changed::enable-wave-effect', () => this._syncWaveEffect(),
                'changed::icon-size', () => this._syncIconSize(true),
                'changed::theme-mode', () => this._syncThemeMode(),
                this
            );
        }

        // Initial synchronization of settings
        this._syncIconSize(false);
        this._syncWaveEffect();
        this._syncThemeMode();
        this._syncAutohide();

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

        if (this._autohide && !this.hover && !this._dockPill.hover)
            this._onLeave();
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
        if (!this._enableWaveEffect)
            return;

        const items = this._getAllDockItems();
        if (items.length === 0)
            return;

        const maxScale = this._waveMaxScale || WAVE_MAX_SCALE;
        const radius = this._waveRadius || WAVE_RADIUS;
        const maxShift = this._waveMaxShift || WAVE_MAX_SHIFT;

        for (const item of items) {
            item.remove_all_transitions();

            const [itemX] = item.get_transformed_position();
            const [itemW] = item.get_transformed_size();
            const itemBaseWidth = item.width || itemW;
            const itemCenterX = itemX + itemBaseWidth / 2 - (item.translation_x || 0);

            const dx = Math.abs(stageX - itemCenterX);

            if (dx < radius) {
                const factor = 0.5 * (1 + Math.cos((Math.PI * dx) / radius));
                const scale = 1.0 + (maxScale - 1.0) * factor;

                const direction = itemCenterX >= stageX ? 1 : -1;
                const shiftFactor = Math.sin((Math.PI * dx) / radius);
                const shiftX = direction * maxShift * shiftFactor;

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

    bindAppLauncher(appLauncher) {
        this._appLauncher = appLauncher;
        this._syncAccentColor();

        appLauncher.connectObject(
            'opened', () => {
                this._showAppsButton.add_style_pseudo_class('checked');
                if (this._autohide)
                    this._showDock();
            },
            'closed', () => {
                this._showAppsButton.remove_style_pseudo_class('checked');
                if (this._autohide && !this.hover && !this._dockPill.hover)
                    this._onLeave();
            },
            this
        );
    }

    _onMenuStateChanged(opened) {
        if (opened) {
            this._openMenusCount++;
            if (this._autohide)
                this._showDock();
        } else {
            this._openMenusCount = Math.max(0, this._openMenusCount - 1);
            if (this._autohide && !this.hover && !this._dockPill.hover)
                this._onLeave();
        }
    }

    _onEnter() {
        if (!this._autohide)
            return;

        if (this._autohideTimeoutId) {
            GLib.source_remove(this._autohideTimeoutId);
            this._autohideTimeoutId = 0;
        }

        this._showDock();
    }

    _onLeave() {
        if (!this._autohide)
            return;

        if (Main.overview.visible || this._appLauncher?.isOpen || this._openMenusCount > 0)
            return;

        if (this._autohideTimeoutId)
            GLib.source_remove(this._autohideTimeoutId);

        this._autohideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            this._autohideTimeoutId = 0;
            if (!this.hover && !this._dockPill.hover && !this._openMenusCount && !this._appLauncher?.isOpen && !Main.overview.visible) {
                this._hideDock();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _showDock() {
        this._isDockHidden = false;
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor) {
            const dockHeight = this.getPreferredHeight();
            this.set_position(monitor.x, monitor.y + monitor.height - dockHeight);
            this.set_size(monitor.width, dockHeight);
        }

        this._dockPill.remove_all_transitions();
        this._dockPill.ease({
            translation_y: 0,
            opacity: 255,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideDock() {
        this._isDockHidden = true;
        this._resetWaveMagnification();
        this._hideTooltips();

        const dockHeight = this.getPreferredHeight();
        this._dockPill.remove_all_transitions();
        this._dockPill.ease({
            translation_y: dockHeight + 10,
            opacity: 0,
            duration: 250,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._isDockHidden && this._autohide) {
                    const monitor = Main.layoutManager.primaryMonitor;
                    if (monitor) {
                        // Narrow bottom trigger area so windows remain completely clickable
                        this.set_position(monitor.x, monitor.y + monitor.height - 4);
                        this.set_size(monitor.width, 4);
                    }
                }
            },
        });
    }

    _syncAutohide() {
        this._autohide = this._settings?.get_boolean('autohide') ?? false;
        this.reactive = this._autohide;
        this.track_hover = this._autohide;

        this._extension?.updateChromeStruts?.(!this._autohide);

        if (!this._autohide) {
            if (this._autohideTimeoutId) {
                GLib.source_remove(this._autohideTimeoutId);
                this._autohideTimeoutId = 0;
            }
            this._showDock();
        } else {
            if (!this.hover && !this._dockPill.hover && !Main.overview.visible)
                this._hideDock();
        }
    }

    _syncWaveEffect() {
        this._enableWaveEffect = this._settings?.get_boolean('enable-wave-effect') ?? true;
        if (!this._enableWaveEffect)
            this._resetWaveMagnification();
    }

    _syncIconSize(redisplay = true) {
        const sizeName = this._settings?.get_string('icon-size') || 'medium';
        const config = SIZES[sizeName] || SIZES.medium;

        this._sizeName = sizeName;
        this._iconSize = config.iconSize;
        this._dockHeight = config.dockHeight;
        this._waveMaxScale = config.waveMaxScale;
        this._waveRadius = config.waveRadius;
        this._waveMaxShift = config.waveMaxShift;

        for (const s of ['small', 'medium', 'large']) {
            this.remove_style_class_name(`size-${s}`);
            this._dockPill?.remove_style_class_name(`size-${s}`);
        }
        this.add_style_class_name(`size-${sizeName}`);
        this._dockPill?.add_style_class_name(`size-${sizeName}`);

        for (const icon of this._appIcons.values()) {
            icon.setIconSize(this._iconSize);
        }
        this._showAppsButton?.setIconSize(this._iconSize);

        this.updatePosition();
        this._extension?._updateDockPosition?.();

        const controls = Main.overview._overview?._controls;
        controls?.queue_relayout();

        if (redisplay)
            this._redisplay();
    }

    _syncThemeMode() {
        const mode = this._settings?.get_string('theme-mode') || 'expressive';
        this.remove_style_class_name('theme-expressive');
        this.remove_style_class_name('theme-black-outline');
        this._dockPill?.remove_style_class_name('theme-expressive');
        this._dockPill?.remove_style_class_name('theme-black-outline');

        this.add_style_class_name(`theme-${mode}`);
        this._dockPill?.add_style_class_name(`theme-${mode}`);
    }

    _syncAccentColor() {
        const colorName = this._interfaceSettings?.get_string('accent-color') || 'blue';
        const allColors = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];

        for (const c of allColors) {
            this.remove_style_class_name(`accent-${c}`);
            this._dockPill?.remove_style_class_name(`accent-${c}`);
            if (this._appLauncher)
                this._appLauncher.remove_style_class_name(`accent-${c}`);
        }

        this.add_style_class_name(`accent-${colorName}`);
        this._dockPill?.add_style_class_name(`accent-${colorName}`);
        if (this._appLauncher)
            this._appLauncher.add_style_class_name(`accent-${colorName}`);
    }

    toggleAppLauncher() {
        this._extension?.toggleAppLauncher?.();
    }

    getPreferredHeight() {
        return this._dockHeight || DOCK_HEIGHT;
    }

    updatePosition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const dockHeight = this.getPreferredHeight();
        if (this._autohide && this._isDockHidden) {
            this.set_position(monitor.x, monitor.y + monitor.height - 4);
            this.set_size(monitor.width, 4);
        } else {
            this.set_position(monitor.x, monitor.y + monitor.height - dockHeight);
            this.set_size(monitor.width, dockHeight);
        }
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
                icon = new DockAppIcon(app, this._iconSize, this);
                this._appIcons.set(id, icon);
            } else {
                icon.setIconSize(this._iconSize);
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
                icon = new DockAppIcon(app, this._iconSize, this);
                this._appIcons.set(id, icon);
            } else {
                icon.setIconSize(this._iconSize);
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

    // Drag-and-drop support: reorder favorites inside Arrera Dock
    handleDragOver(source, _actor, x, _y, _step) {
        const app = source.app;
        if (!app)
            return DND.DragMotionResult.NO_DROP;

        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source, _actor, x, _y, _time) {
        const app = source.app;
        if (!app)
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
        if (this._autohideTimeoutId) {
            GLib.source_remove(this._autohideTimeoutId);
            this._autohideTimeoutId = 0;
        }

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

        if (this._settings) {
            this._settings.disconnectObject(this);
            this._settings = null;
        }

        for (const icon of this._appIcons.values()) {
            icon.destroy();
        }
        this._appIcons.clear();

        if (this._separator) {
            this._separator.destroy();
            this._separator = null;
        }

        if (this._interfaceSettings) {
            this._interfaceSettings.disconnectObject(this);
            this._interfaceSettings = null;
        }

        super.destroy();
    }
});
