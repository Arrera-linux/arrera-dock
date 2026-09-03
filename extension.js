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

export default class ArreraDockExtension extends Extension {
    enable() {
        this._dock = new ArreraDock(this);

        // Position and add dock as top chrome
        // affectsStruts: true ensures desktop windows maximize above the dock
        // trackFullscreen: true ensures dock hides during fullscreen media/games
        Main.layoutManager.addTopChrome(this._dock, {
            affectsStruts: true,
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

    _updateDockPosition() {
        if (this._dock)
            this._dock.updatePosition();
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
            const dockHeight = this._dock ? this._dock.getPreferredHeight() : 68;
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

            if (fromCornerOrButton) {
                // Top-left "Activités" button / hot corner opens WINDOW_PICKER
                Main.overview.show(OverviewControls.ControlsState.WINDOW_PICKER);
            } else {
                // Super key (Windows key) shortcut opens the application grid directly
                Main.overview.show(OverviewControls.ControlsState.APP_GRID);
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

        // Remove dock from chrome and destroy
        if (this._dock) {
            Main.layoutManager.removeChrome(this._dock);
            this._dock.destroy();
            this._dock = null;
        }

        Main.layoutManager.disconnectObject(this);
    }
}