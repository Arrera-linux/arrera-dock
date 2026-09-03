/* extension.js
 *
 * Arrera Dock - Extension GNOME Shell
 * Distribution Arrera Blue
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
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
        // reserve the exact dock height at the bottom for Arrera Dock, preventing any
        // overlap with the application grid or workspace thumbnails.
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

    disable() {
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