/* extension.js
 *
 * Arrera Dock - Extension GNOME Shell
 * Distribution Arrera Blue
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
import * as Workspace from 'resource:///org/gnome/shell/ui/workspace.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import Graphene from 'gi://Graphene';
import { ArreraDock } from './dock.js';
import { AppLaucher } from './appLauncher.js';

export default class ArreraDockExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        const autohide = this._settings?.get_boolean('autohide') ?? false;

        if (this._settings) {
            this._settings.connectObject(
                'changed::super-key-opens-launcher', () => this._syncSuperKey(),
                this
            );
        }
        this._syncSuperKey();

        this._appLauncher = new AppLaucher(this);
        this._dock = new ArreraDock(this);
        this._dock.bindAppLauncher(this._appLauncher);

        // Position and add dock as top chrome
        // affectsStruts: true ensures desktop windows maximize above the dock (when autohide is off)
        // trackFullscreen: true ensures dock hides during fullscreen media/games
        Main.layoutManager.addTopChrome(this._dock, {
            affectsStruts: !autohide,
            trackFullscreen: true,
        });

        // Update position when monitors or resolution change
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._updateDockPosition(),
            this
        );
        this._updateDockPosition();

        // Totally replace the native dash in the overview / application menu
        this._replaceNativeDash();

        // Ensure the wallpaper is displayed in its entirety in the Activities overview
        this._patchWorkspaceBackground();

        // Configure Super key shortcut to open the application grid directly
        this._patchOverviewToggle();

        // Always display workspace switcher / thumbnails bar in Activities (even with <= 2 workspaces)
        this._patchThumbnailsBox();
    }

    get appLauncher() {
        return this._appLauncher;
    }

    get dock() {
        return this._dock;
    }

    toggleAppLauncher() {
        if (Main.overview.visible)
            Main.overview.hide();

        if (this._appLauncher)
            this._appLauncher.toggle();
    }

    _updateDockPosition() {
        if (this._dock)
            this._dock.updatePosition();
    }

    updateChromeStruts(affectsStruts) {
        if (!this._dock)
            return;

        Main.layoutManager.removeChrome(this._dock);
        Main.layoutManager.addTopChrome(this._dock, {
            affectsStruts,
            trackFullscreen: true,
        });
        this._updateDockPosition();
    }

    _replaceNativeDash() {
        const nativeDash = Main.overview.dash;
        if (!nativeDash)
            return;

        // Backup original state
        this._origDashVisible = nativeDash.visible;
        this._origDashOpacity = nativeDash.opacity;
        this._origGetPreferredHeight = nativeDash.get_preferred_height;
        this._origGetPreferredWidth = nativeDash.get_preferred_width;

        // Make native dash completely invisible and inactive
        nativeDash.visible = false;
        nativeDash.opacity = 0;

        // Override preferred height so GNOME Shell's overview controls (ControlsManagerLayout)
        // reserve the exact dock height at the bottom, perfectly preserving the default GNOME
        // workspace card size, centered positioning, and comfortable bottom margin.
        nativeDash.get_preferred_height = (_forWidth) => {
            const dockHeight = this._dock ? this._dock.getPreferredHeight() : 72;
            return [dockHeight, dockHeight];
        };

        nativeDash.get_preferred_width = (_forHeight) => {
            return [0, 0];
        };

        // Relayout overview controls
        const controls = Main.overview._overview?._controls;
        if (controls)
            controls.queue_relayout();
    }

    _restoreNativeDash() {
        const nativeDash = Main.overview.dash;
        if (!nativeDash)
            return;

        if (this._origGetPreferredHeight)
            nativeDash.get_preferred_height = this._origGetPreferredHeight;
        if (this._origGetPreferredWidth)
            nativeDash.get_preferred_width = this._origGetPreferredWidth;

        nativeDash.visible = this._origDashVisible ?? true;
        nativeDash.opacity = this._origDashOpacity ?? 255;

        const controls = Main.overview._overview?._controls;
        if (controls)
            controls.queue_relayout();
    }

    _patchWorkspaceBackground() {
        if (!Workspace?.WorkspaceBackground)
            return;

        // Ensure full un-cropped wallpaper in the workspace thumbnail card
        // by clipping to the full monitor dimensions instead of the reduced dock workarea
        const origUpdateRoundedClipBounds = Workspace.WorkspaceBackground.prototype._updateRoundedClipBounds;
        this._origUpdateRoundedClipBounds = origUpdateRoundedClipBounds;
        Workspace.WorkspaceBackground.prototype._updateRoundedClipBounds = function () {
            const monitor = Main.layoutManager.monitors[this._monitorIndex];
            if (!monitor || !this._bgManager?.backgroundActor?.content) {
                origUpdateRoundedClipBounds.call(this);
                return;
            }

            const rect = new Graphene.Rect();
            rect.origin.x = 0;
            rect.origin.y = 0;
            rect.size.width = monitor.width;
            rect.size.height = monitor.height;

            this._bgManager.backgroundActor.content.set_rounded_clip_bounds(rect);
        };

        const controls = Main.overview._overview?._controls;
        if (controls)
            controls.queue_relayout();
    }

    _restoreWorkspaceBackground() {
        if (this._origUpdateRoundedClipBounds) {
            Workspace.WorkspaceBackground.prototype._updateRoundedClipBounds = this._origUpdateRoundedClipBounds;
            this._origUpdateRoundedClipBounds = null;
        }

        const controls = Main.overview._overview?._controls;
        if (controls)
            controls.queue_relayout();
    }

    _syncSuperKey() {
        this._superKeyOpensLauncher = this._settings?.get_boolean('super-key-opens-launcher') ?? true;
    }

    _patchOverviewToggle() {
        let cornerOrButtonClicked = false;
        const origShouldToggle = Main.overview.shouldToggleByCornerOrButton.bind(Main.overview);
        this._origShouldToggle = origShouldToggle;
        Main.overview.shouldToggleByCornerOrButton = () => {
            const allowed = origShouldToggle();
            if (allowed)
                cornerOrButtonClicked = true;
            return allowed;
        };

        const origToggle = Main.overview.toggle.bind(Main.overview);
        this._origOverviewToggle = origToggle;

        Main.overview.toggle = () => {
            if (Main.overview.isDummy)
                return;

            const fromCornerOrButton = cornerOrButtonClicked;
            cornerOrButtonClicked = false;

            if (Main.overview.visible) {
                Main.overview.hide();
                return;
            }

            if (!fromCornerOrButton && this._superKeyOpensLauncher) {
                // Super key (Windows key) shortcut opens the macOS Applications launcher
                this.toggleAppLauncher();
            } else {
                // Top-left "Activités" button or Super key restored to GNOME default opens WINDOW_PICKER
                Main.overview.show(OverviewControls.ControlsState.WINDOW_PICKER);
            }
        };
    }

    _restoreOverviewToggle() {
        if (this._origShouldToggle) {
            Main.overview.shouldToggleByCornerOrButton = this._origShouldToggle;
            this._origShouldToggle = null;
        }

        if (this._origOverviewToggle) {
            Main.overview.toggle = this._origOverviewToggle;
            this._origOverviewToggle = null;
        }
    }

    _patchThumbnailsBox() {
        if (!WorkspaceThumbnail?.ThumbnailsBox)
            return;

        const origUpdateShouldShow = WorkspaceThumbnail.ThumbnailsBox.prototype._updateShouldShow;
        this._origUpdateShouldShow = origUpdateShouldShow;

        // Force workspace thumbnails to always be visible in Activities ("h24")
        WorkspaceThumbnail.ThumbnailsBox.prototype._updateShouldShow = function () {
            const shouldShow = true;
            if (this._shouldShow === shouldShow)
                return;

            this._shouldShow = shouldShow;
            this.notify('should-show');
        };

        const controls = Main.overview._overview?._controls;
        const thumbnailsBox = controls?._thumbnailsBox;
        if (thumbnailsBox) {
            thumbnailsBox._updateShouldShow();
            controls._updateThumbnailsBox?.();
            controls.layout_manager?.layout_changed();
        }
    }

    _restoreThumbnailsBox() {
        if (this._origUpdateShouldShow) {
            WorkspaceThumbnail.ThumbnailsBox.prototype._updateShouldShow = this._origUpdateShouldShow;
            this._origUpdateShouldShow = null;
        }

        const controls = Main.overview._overview?._controls;
        const thumbnailsBox = controls?._thumbnailsBox;
        if (thumbnailsBox) {
            thumbnailsBox._updateShouldShow();
            controls._updateThumbnailsBox?.();
            controls.layout_manager?.layout_changed();
        }
    }

    disable() {
        // Restore workspace thumbnails visibility logic
        this._restoreThumbnailsBox();

        // Restore overview toggle shortcut
        this._restoreOverviewToggle();

        // Restore workspace background and layout patches
        this._restoreWorkspaceBackground();

        // Restore native dash
        this._restoreNativeDash();

        // Destroy macOS app launcher
        if (this._appLauncher) {
            this._appLauncher.destroy();
            this._appLauncher = null;
        }

        // Remove dock from chrome and destroy
        if (this._dock) {
            Main.layoutManager.removeChrome(this._dock);
            this._dock.destroy();
            this._dock = null;
        }

        if (this._settings) {
            this._settings.disconnectObject(this);
            this._settings = null;
        }

        Main.layoutManager.disconnectObject(this);
    }
}