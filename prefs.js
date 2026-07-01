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

// ---- i18n: auto-detect system language ----
const _IS_ZH = (GLib.get_language_names()[0] || '').startsWith('zh');

const _ = (en, zh) => _IS_ZH ? zh : en;

const SPIN_CONFIG = {
    pollMs: {
        key: 'follow-mouse-poll-ms',
        title: _('Poll interval', '轮询间隔'),
        subtitle: _('How often the pointer position is checked. Lower is more responsive but uses more CPU.', '检查鼠标位置的频率。值越低响应越快但 CPU 占用更高。'),
        min: 50,
        max: 2000,
        step: 50,
        unit: ' ms',
    },
    debounceMs: {
        key: 'follow-mouse-debounce-ms',
        title: _('Edge dwell delay', '边缘驻留延迟'),
        subtitle: _('How long the pointer must stay on the dock edge before switching monitors.', '鼠标在 Dock 边缘停留多久后切换显示器。'),
        min: 0,
        max: 5000,
        step: 50,
        unit: ' ms',
    },
    edgePx: {
        key: 'follow-mouse-edge-px',
        title: _('Trigger edge size', '触发边缘宽度'),
        subtitle: _('Width of the active screen-edge trigger zone.', '屏幕边缘触发区域的宽度。'),
        min: 1,
        max: 100,
        step: 1,
        unit: ' px',
    },
    fastSpeed: {
        key: 'follow-mouse-fast-speed',
        title: _('Fast edge push speed', '快速边缘推动速度'),
        subtitle: _('Pointer speed threshold for immediate monitor switching when hitting the dock edge.', '鼠标移动到 Dock 边缘时触发立即切换显示器的速度阈值。'),
        min: 200,
        max: 20000,
        step: 100,
        unit: ' px/s',
    },
    iconSize: {
        key: 'follow-mouse-icon-size',
        title: _('Icon size', '图标大小'),
        subtitle: _('Native Dock icon size.', 'Dock 图标大小。'),
        min: 24,
        max: 96,
        step: 2,
        unit: ' px',
    },
};

const COLOR_CONFIG = {
    key: 'active-dot-color',
    title: _('Active dot color', '运行中高亮点颜色'),
    subtitle: _('Highlight color for the active application indicator dot.', '正在运行的应用指示点的颜色。'),
    default: '#6ee7ff',
};

export default class NativeDockFollowMousePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_title(_('Native Dock Follow Mouse Configuration', 'Native Dock Follow Mouse 配置'));
        window.set_default_size(720, 600);

        this._settings = this.getSettings(SCHEMA_ID);

        const page = new Adw.PreferencesPage({
            title: _('Configuration', '配置'),
            icon_name: 'input-mouse-symbolic',
        });
        window.add(page);

        const statusGroup = new Adw.PreferencesGroup({
            title: _('Status', '状态'),
            description: _('Standalone GNOME Shell dock. No Dash2Dock Animated, Dash to Dock, or Ubuntu Dock dependency.', '独立 GNOME Shell Dock。无需 Dash2Dock Animated、Dash to Dock 或 Ubuntu Dock 依赖。'),
        });
        page.add(statusGroup);
        statusGroup.add(this._createInfoRow(_('Backend', '后端'), _('Pure GNOME Shell St actors + Shell.App favorites.', '纯 GNOME Shell St actor + Shell.App 收藏。')));
        statusGroup.add(this._createDockModeRow());
        statusGroup.add(this._createDockLocationRow());
        statusGroup.add(this._createPreferredMonitorRow());

        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance', '外观'),
            description: _('Basic Native Dock appearance.', 'Dock 基本外观。'),
        });
        page.add(appearanceGroup);
        appearanceGroup.add(this._createSpinRow(SPIN_CONFIG.iconSize));
        appearanceGroup.add(this._createSpinRow({
            key: 'dock-edge-margin',
            title: _('Edge margin (top/bottom)', '边缘间距（上/下）'),
            subtitle: _('Distance from the screen edge when dock is at top or bottom, in pixels.', 'Dock 在屏幕顶部或底部时离边缘的距离（像素）。'),
            min: -100,
            max: 100,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createSpinRow({
            key: 'dock-edge-margin-vertical',
            title: _('Edge margin (left/right)', '边缘间距（左/右）'),
            subtitle: _('Distance from the screen edge when dock is at left or right, in pixels.', 'Dock 在屏幕左侧或右侧时离边缘的距离（像素）。'),
            min: -100,
            max: 100,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createSpinRow({
            key: 'dock-icon-spacing',
            title: _('Icon spacing', '图标间距'),
            subtitle: _('Gap between app icon containers in pixels. 0 = no extra gap.', '应用图标容器之间的间距（像素）。0 = 无额外间距。'),
            min: 0,
            max: 50,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createStringRow(COLOR_CONFIG));
        appearanceGroup.add(this._createBackgroundPresetRow());
        appearanceGroup.add(this._createStringRow({
            key: 'background-custom-color',
            title: _('Custom background color', '自定义背景色'),
            subtitle: _('Hex color code — only used when background preset is "Custom color".', '十六进制颜色代码——仅当背景预设为"自定义颜色"时使用。'),
            default: '#38383b',
        }));
        appearanceGroup.add(this._createOpacityRow());
        appearanceGroup.add(this._createSpinRow({
            key: 'background-padding',
            title: _('Background vertical padding', '背景垂直内边距'),
            subtitle: _('Space between dock background edge and app icons (top/bottom). Total added height = 2x this value.', 'Dock 背景边缘与应用图标之间的间距（上/下）。总增加高度 = 该值 x 2。'),
            min: 0,
            max: 60,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createSpinRow({
            key: 'background-border-radius',
            title: _('Background border radius', '背景圆角半径'),
            subtitle: _('Roundness of the dock background corners.', 'Dock 背景角的圆度。'),
            min: 0,
            max: 60,
            step: 1,
            unit: ' px',
        }));
        appearanceGroup.add(this._createStringRow({
            key: 'label-background',
            title: _('Label tooltip background', '悬停标签背景色'),
            subtitle: _('CSS color for hover tooltip. Supports hex (#000), rgba, or any valid CSS color.', '悬停提示的 CSS 颜色。支持十六进制 (#000)、rgba 或任何有效的 CSS 颜色。'),
            default: 'rgba(0,0,0,0.9)',
        }));
        appearanceGroup.add(this._createSpinRow({
            key: 'label-border-radius',
            title: _('Label tooltip border radius', '悬停标签圆角'),
            subtitle: _('Roundness of the app-name tooltip corners. 999 = pill shape.', '应用名称提示的圆角。999 = 胶囊形状。'),
            min: 0,
            max: 999,
            step: 1,
            unit: ' px',
        }));

        const tuningGroup = new Adw.PreferencesGroup({
            title: _('Follow Mouse Tuning', '跟随鼠标调优'),
            description: _('Used when Dock mode is "Single dock follows mouse".', '当 Dock 模式为"跟随鼠标"时生效。'),
        });
        page.add(tuningGroup);
        tuningGroup.add(this._createSpinRow(SPIN_CONFIG.pollMs));
        tuningGroup.add(this._createSpinRow(SPIN_CONFIG.debounceMs));
        tuningGroup.add(this._createSpinRow(SPIN_CONFIG.edgePx));
        tuningGroup.add(this._createSpinRow(SPIN_CONFIG.fastSpeed));

        const intellihideGroup = new Adw.PreferencesGroup({
            title: _('Intellihide', '智能隐藏'),
            description: _('Automatically hide the dock when a maximized window overlaps it. Hover over the dock area to reveal it.', '当最大化窗口覆盖 Dock 区域时自动隐藏 Dock。鼠标悬停 Dock 边缘重新显示。'),
        });
        page.add(intellihideGroup);
        intellihideGroup.add(this._createSwitchRow({
            key: 'intellihide-enabled',
            title: _('Enable intellihide', '启用智能隐藏'),
            subtitle: _('Hide the dock when a maximized window is on the same monitor.', '同一显示器上有最大化窗口时隐藏 Dock。'),
        }));
        intellihideGroup.add(this._createSpinRow({
            key: 'intellihide-hover-delay-ms',
            title: _('Hover reveal delay', '悬停显示延迟'),
            subtitle: _('Delay before the dock appears when hovering over the dock area.', '鼠标悬停 Dock 区域后 Dock 显示出来的延迟时间。'),
            min: 0,
            max: 2000,
            step: 50,
            unit: ' ms',
        }));
        intellihideGroup.add(this._createSpinRow({
            key: 'intellihide-hide-delay-ms',
            title: _('Leave hide delay', '离开隐藏延迟'),
            subtitle: _('Delay before the dock hides after the mouse leaves the dock area.', '鼠标离开 Dock 区域后 Dock 隐藏的延迟时间。'),
            min: 0,
            max: 5000,
            step: 100,
            unit: ' ms',
        }));

        const debugGroup = new Adw.PreferencesGroup({
            title: _('Debug', '调试'),
            description: _('Enable logs only while troubleshooting.', '仅在故障排查时启用日志。'),
        });
        page.add(debugGroup);
        debugGroup.add(this._createSwitchRow({
            key: 'follow-mouse-debug',
            title: _('Debug logs', '调试日志'),
            subtitle: _('Write verbose Native Dock Follow Mouse logs to the GNOME Shell journal.', '向 GNOME Shell 日志输出详细的 Native Dock Follow Mouse 日志。'),
        }));

        const actionsGroup = new Adw.PreferencesGroup({title: _('Actions', '操作')});
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
        model.append(_('Native dark', '原生深色'));
        model.append(_('Light translucent', '浅色半透明'));
        model.append(_('Transparent (no background)', '透明（无背景）'));
        model.append(_('Custom color', '自定义颜色'));

        const row = new Adw.ComboRow({
            title: _('Background style', '背景样式'),
            subtitle: _('Dock background appearance. Custom color uses hex + opacity from below.', 'Dock 背景外观。自定义颜色使用下方的十六进制值和透明度。'),
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
            title: _('Custom opacity', '自定义透明度'),
            subtitle: _('Opacity 0.0–1.0 — only used when background preset is "Custom color".', '透明度 0.0–1.0——仅当背景预设为"自定义颜色"时使用。'),
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
        model.append(_('Single dock follows mouse', '单个 Dock 跟随鼠标'));
        model.append(_('Primary monitor only', '仅主显示器'));

        const row = new Adw.ComboRow({
            title: _('Dock mode', 'Dock 模式'),
            subtitle: _('Controls dock quantity and follow behavior.', '控制 Dock 数量和跟随行为。'),
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
        model.append(_('Bottom', '底部'));
        model.append(_('Left', '左侧'));
        model.append(_('Right', '右侧'));
        model.append(_('Top', '顶部'));

        const row = new Adw.ComboRow({
            title: _('Dock location', 'Dock 位置'),
            subtitle: _('Screen edge used for dock placement and mouse trigger.', 'Dock 放置和鼠标触发的屏幕边缘。'),
            model,
        });

        this._bindComboRow(row, 'dock-location', 0, model.get_n_items() - 1);
        return row;
    }

    _createPreferredMonitorRow() {
        const count = this._getPreferredMonitorOptionCount();
        const model = new Gtk.StringList();

        for (let i = 0; i < count; i++)
            model.append(_('Monitor', '显示器') + ` ${i}`);

        const row = new Adw.ComboRow({
            title: _('Preferred monitor', '首选显示器'),
            subtitle: _('Initial monitor for the single follow-mouse dock.', '单个跟随鼠标 Dock 的初始显示器。'),
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
            title: _('Reset Native Dock settings', '重置 Dock 设置'),
            subtitle: _('Restore Native Dock Follow Mouse settings to defaults.', '将 Native Dock Follow Mouse 设置恢复为默认值。'),
        });

        const button = new Gtk.Button({
            label: _('Reset', '重置'),
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
