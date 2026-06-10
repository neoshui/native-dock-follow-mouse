/* prefs.js
 *
 * Preferences UI for Native Dock Follow Mouse.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.native-dock-follow-mouse';

const SPIN_CONFIG = {
    pollMs: {
        key: 'follow-mouse-poll-ms',
        title: 'Poll interval',
        subtitle: 'How often the pointer position is checked. Lower is more responsive but uses more CPU.',
        min: 50,
        max: 2000,
        step: 50,
        unit: ' ms',
    },
    debounceMs: {
        key: 'follow-mouse-debounce-ms',
        title: 'Edge dwell delay',
        subtitle: 'How long the pointer must stay on the dock edge before switching monitors.',
        min: 0,
        max: 5000,
        step: 50,
        unit: ' ms',
    },
    edgePx: {
        key: 'follow-mouse-edge-px',
        title: 'Trigger edge size',
        subtitle: 'Width of the active screen-edge trigger zone.',
        min: 1,
        max: 100,
        step: 1,
        unit: ' px',
    },
    fastSpeed: {
        key: 'follow-mouse-fast-speed',
        title: 'Fast edge push speed',
        subtitle: 'Pointer speed threshold for immediate monitor switching when hitting the dock edge.',
        min: 200,
        max: 20000,
        step: 100,
        unit: ' px/s',
    },
    iconSize: {
        key: 'follow-mouse-icon-size',
        title: 'Icon size',
        subtitle: 'Native Dock icon size.',
        min: 24,
        max: 96,
        step: 2,
        unit: ' px',
    },
};

const COLOR_CONFIG = {
    key: 'active-dot-color',
    title: 'Active dot color',
    subtitle: 'Highlight color for the active application indicator dot.',
    default: '#6ee7ff',
};

export default class NativeDockFollowMousePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_title('Native Dock Follow Mouse Configuration');
        window.set_default_size(720, 600);

        this._settings = this.getSettings(SCHEMA_ID);

        const page = new Adw.PreferencesPage({
            title: 'Configuration',
            icon_name: 'input-mouse-symbolic',
        });
        window.add(page);

        const statusGroup = new Adw.PreferencesGroup({
            title: 'Status',
            description: 'Standalone GNOME Shell dock. No Dash2Dock Animated, Dash to Dock, or Ubuntu Dock dependency.',
        });
        page.add(statusGroup);
        statusGroup.add(this._createInfoRow('Backend', 'Pure GNOME Shell St actors + Shell.App favorites.'));
        statusGroup.add(this._createDockModeRow());
        statusGroup.add(this._createDockLocationRow());
        statusGroup.add(this._createPreferredMonitorRow());

        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Basic Native Dock appearance.',
        });
        page.add(appearanceGroup);
        appearanceGroup.add(this._createSpinRow(SPIN_CONFIG.iconSize));
        appearanceGroup.add(this._createSpinRow({
            key: 'dock-edge-margin',
            title: 'Edge margin (top/bottom)',
            subtitle: 'Distance from the screen edge when dock is at top or bottom, in pixels.',
            min: -100,
            max: 100,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createSpinRow({
            key: 'dock-edge-margin-vertical',
            title: 'Edge margin (left/right)',
            subtitle: 'Distance from the screen edge when dock is at left or right, in pixels.',
            min: -100,
            max: 100,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createSpinRow({
            key: 'dock-icon-spacing',
            title: 'Icon spacing',
            subtitle: 'Gap between app icon containers in pixels. 0 = no extra gap.',
            min: 0,
            max: 50,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createStringRow(COLOR_CONFIG));
        appearanceGroup.add(this._createBackgroundPresetRow());
        appearanceGroup.add(this._createStringRow({
            key: 'background-custom-color',
            title: 'Custom background color',
            subtitle: 'Hex color code — only used when background preset is "Custom color".',
            default: '#38383b',
        }));
        appearanceGroup.add(this._createOpacityRow());
        appearanceGroup.add(this._createSpinRow({
            key: 'background-padding',
            title: 'Background vertical padding',
            subtitle: 'Space between dock background edge and app icons (top/bottom). Total added height = 2x this value.',
            min: 0,
            max: 60,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createSpinRow({
            key: 'background-border-radius',
            title: 'Background border radius',
            subtitle: 'Roundness of the dock background corners.',
            min: 0,
            max: 60,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createStringRow({
            key: 'label-background',
            title: 'Label tooltip background',
            subtitle: 'CSS color for hover tooltip. Supports hex (#000), rgba, or any valid CSS color.',
            default: 'rgba(0,0,0,0.9)',
        }));
        appearanceGroup.add(this._createSpinRow({
            key: 'label-border-radius',
            title: 'Label tooltip border radius',
            subtitle: 'Roundness of the app-name tooltip corners. 999 = pill shape.',
            min: 0,
            max: 999,
            step: 1,
            unit: ' px',
        }));

        const tuningGroup = new Adw.PreferencesGroup({
            title: 'Follow Mouse Tuning',
            description: 'Used when Dock mode is “Single dock follows mouse”.',
        });
        page.add(tuningGroup);
        tuningGroup.add(this._createSpinRow(SPIN_CONFIG.pollMs));
        tuningGroup.add(this._createSpinRow(SPIN_CONFIG.debounceMs));
        tuningGroup.add(this._createSpinRow(SPIN_CONFIG.edgePx));
        tuningGroup.add(this._createSpinRow(SPIN_CONFIG.fastSpeed));

        const intellihideGroup = new Adw.PreferencesGroup({
            title: 'Intellihide',
            description: 'Automatically hide the dock when a maximized window overlaps it. Hover over the dock area to reveal it.',
        });
        page.add(intellihideGroup);
        intellihideGroup.add(this._createSwitchRow({
            key: 'intellihide-enabled',
            title: 'Enable intellihide',
            subtitle: 'Hide the dock when a maximized window is on the same monitor.',
        }));
        intellihideGroup.add(this._createSpinRow({
            key: 'intellihide-hover-delay-ms',
            title: 'Hover reveal delay',
            subtitle: 'Delay before the dock appears when hovering over the dock area.',
            min: 0,
            max: 2000,
            step: 50,
            unit: ' ms',
        }));
        intellihideGroup.add(this._createSpinRow({
            key: 'intellihide-hide-delay-ms',
            title: 'Leave hide delay',
            subtitle: 'Delay before the dock hides after the mouse leaves the dock area.',
            min: 0,
            max: 5000,
            step: 100,
            unit: ' ms',
        }));

        const debugGroup = new Adw.PreferencesGroup({
            title: 'Debug',
            description: 'Enable logs only while troubleshooting.',
        });
        page.add(debugGroup);
        debugGroup.add(this._createSwitchRow({
            key: 'follow-mouse-debug',
            title: 'Debug logs',
            subtitle: 'Write verbose Native Dock Follow Mouse logs to the GNOME Shell journal.',
        }));

        const actionsGroup = new Adw.PreferencesGroup({title: 'Actions'});
        page.add(actionsGroup);
        actionsGroup.add(this._createResetRow());
    }

    _createInfoRow(title, subtitle) {
        return new Adw.ActionRow({title, subtitle});
    }

    _createSpinRow(config) {
        const adjustment = new Gtk.Adjustment({
            lower: config.min,
            upper: config.max,
            step_increment: config.step,
            page_increment: config.step * 5,
            value: this._settings.get_int(config.key),
        });

        const row = new Adw.SpinRow({
            title: config.title,
            subtitle: config.subtitle,
            adjustment,
            climb_rate: 1,
            digits: 0,
            numeric: true,
        });

        row.set_value(this._settings.get_int(config.key));

        row.connect('notify::value', () => {
            const value = Math.round(row.get_value());
            if (this._settings.get_int(config.key) !== value)
                this._settings.set_int(config.key, value);
        });

        this._settings.connect(`changed::${config.key}`, () => {
            const value = this._settings.get_int(config.key);
            if (Math.round(row.get_value()) !== value)
                row.set_value(value);
        });

        if (config.unit) {
            const suffix = new Gtk.Label({
                label: config.unit,
                valign: Gtk.Align.CENTER,
                css_classes: ['dim-label'],
            });
            row.add_suffix(suffix);
        }

        return row;
    }

    _createStringRow(config) {
        const row = new Adw.ActionRow({
            title: config.title,
            subtitle: config.subtitle,
        });

        const entry = new Gtk.Entry({
            text: this._settings.get_string(config.key) || config.default || '',
            valign: Gtk.Align.CENTER,
            width_chars: 12,
        });

        entry.connect('changed', () => {
            const value = entry.get_text().trim();
            if (value && this._settings.get_string(config.key) !== value)
                this._settings.set_string(config.key, value);
        });

        this._settings.connect(`changed::${config.key}`, () => {
            const value = this._settings.get_string(config.key) || config.default || '';
            if (entry.get_text() !== value)
                entry.set_text(value);
        });

        row.add_suffix(entry);
        row.activatable_widget = entry;
        return row;
    }

    _createSwitchRow({key, title, subtitle}) {
        const row = new Adw.SwitchRow({title, subtitle});
        this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _createBackgroundPresetRow() {
        const model = new Gtk.StringList();
        model.append('Native dark');
        model.append('Light translucent');
        model.append('Transparent (no background)');
        model.append('Custom color');

        const row = new Adw.ComboRow({
            title: 'Background style',
            subtitle: 'Dock background appearance. Custom color uses hex + opacity from below.',
            model,
        });

        this._bindComboRow(row, 'background-preset', 0, model.get_n_items() - 1);
        return row;
    }

    _createOpacityRow() {
        const adjustment = new Gtk.Adjustment({
            lower: 0.0,
            upper: 1.0,
            step_increment: 0.05,
            page_increment: 0.1,
            value: this._settings.get_double('background-custom-opacity'),
        });

        const row = new Adw.SpinRow({
            title: 'Custom opacity',
            subtitle: 'Opacity 0.0–1.0 — only used when background preset is "Custom color".',
            adjustment,
            climb_rate: 0.05,
            digits: 2,
            numeric: true,
        });

        row.set_value(this._settings.get_double('background-custom-opacity'));

        row.connect('notify::value', () => {
            const value = Math.round(row.get_value() * 100) / 100;
            const current = this._settings.get_double('background-custom-opacity');
            if (Math.abs(current - value) > 0.001)
                this._settings.set_double('background-custom-opacity', value);
        });

        this._settings.connect('changed::background-custom-opacity', () => {
            const value = this._settings.get_double('background-custom-opacity');
            if (Math.abs(row.get_value() - value) > 0.001)
                row.set_value(value);
        });

        const suffix = new Gtk.Label({
            label: ' %',
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label'],
        });
        row.add_suffix(suffix);
        return row;
    }

    _createDockModeRow() {
        const model = new Gtk.StringList();
        model.append('Single dock follows mouse');
        model.append('Primary monitor only');

        const row = new Adw.ComboRow({
            title: 'Dock mode',
            subtitle: 'Controls dock quantity and follow behavior.',
            model,
        });

        const settingToRow = value => value === 2 ? 1 : 0;
        const rowToSetting = selected => selected === 1 ? 2 : 0;

        row.set_selected(settingToRow(this._settings.get_int('dock-mode')));

        row.connect('notify::selected', () => {
            const value = rowToSetting(row.get_selected());
            if (this._settings.get_int('dock-mode') !== value)
                this._settings.set_int('dock-mode', value);
        });

        this._settings.connect('changed::dock-mode', () => {
            const value = settingToRow(this._settings.get_int('dock-mode'));
            if (row.get_selected() !== value)
                row.set_selected(value);
        });
        return row;
    }

    _createDockLocationRow() {
        const model = new Gtk.StringList();
        model.append('Bottom');
        model.append('Left');
        model.append('Right');
        model.append('Top');

        const row = new Adw.ComboRow({
            title: 'Dock location',
            subtitle: 'Screen edge used for dock placement and mouse trigger.',
            model,
        });

        this._bindComboRow(row, 'dock-location', 0, model.get_n_items() - 1);
        return row;
    }

    _createPreferredMonitorRow() {
        const count = this._getPreferredMonitorOptionCount();
        const model = new Gtk.StringList();

        for (let i = 0; i < count; i++)
            model.append(`Monitor ${i}`);

        const row = new Adw.ComboRow({
            title: 'Preferred monitor',
            subtitle: 'Initial monitor for the single follow-mouse dock.',
            model,
        });

        this._bindComboRow(row, 'preferred-monitor', 0, model.get_n_items() - 1);
        return row;
    }

    _getPreferredMonitorOptionCount() {
        const detectedCount = this._getDisplayMonitorCount();
        const storedCount = this._safeGetInt('monitor-count', 1);
        const preferredMonitor = this._safeGetInt('preferred-monitor', 0);

        if (detectedCount > 0 && this._settings.get_int('monitor-count') !== detectedCount)
            this._settings.set_int('monitor-count', detectedCount);

        return Math.max(detectedCount, storedCount, preferredMonitor + 1, 2);
    }

    _getDisplayMonitorCount() {
        try {
            const display = Gdk.Display.get_default();
            const monitors = display?.get_monitors?.();
            const count = monitors?.get_n_items?.() ?? 0;
            return Math.max(0, Math.min(count, 16));
        } catch (_e) {
            return 0;
        }
    }

    _bindComboRow(row, key, min, max) {
        const clamp = value => Math.max(min, Math.min(value, max));

        row.set_selected(clamp(this._settings.get_int(key)));

        row.connect('notify::selected', () => {
            const value = row.get_selected();
            if (value >= min && value <= max && this._settings.get_int(key) !== value)
                this._settings.set_int(key, value);
        });

        this._settings.connect(`changed::${key}`, () => {
            const value = clamp(this._settings.get_int(key));
            if (row.get_selected() !== value)
                row.set_selected(value);
        });
    }

    _createResetRow() {
        const row = new Adw.ActionRow({
            title: 'Reset Native Dock settings',
            subtitle: 'Restore Native Dock Follow Mouse settings to defaults.',
        });

        const button = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        button.connect('clicked', () => this._resetSettings());
        row.add_suffix(button);
        row.activatable_widget = button;
        return row;
    }

    _resetSettings() {
        const keys = [
            'dock-mode',
            'dock-location',
            'preferred-monitor',
            'monitor-count',
            'follow-mouse-poll-ms',
            'follow-mouse-debounce-ms',
            'follow-mouse-edge-px',
            'follow-mouse-fast-speed',
            'follow-mouse-icon-size',
            'show-apps-icon',
            'active-dot-color',
            'follow-mouse-debug',
            'intellihide-enabled',
            'intellihide-hover-delay-ms',
            'intellihide-hide-delay-ms',
            'dock-edge-margin',
            'dock-edge-margin-vertical',
            'dock-icon-spacing',
            'background-preset',
            'background-custom-color',
            'background-custom-opacity',
            'background-padding',
            'background-border-radius',
            'label-background',
            'label-border-radius',
        ];

        for (const key of keys)
            this._settings.reset(key);
    }

    _safeGetInt(key, fallback) {
        try {
            return this._settings.get_int(key);
        } catch (_e) {
            return fallback;
        }
    }
}
