/* extension.js
 *
 * Native Dock Follow Mouse — pins GNOME native Dash to the desktop.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

log('NativeDock: extension.js top-level code executed');

const SCHEMA_ID = 'org.gnome.shell.extensions.native-dock-follow-mouse';

const DEFAULT_POLL_MS = 200;
const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_EDGE_PX = 5;
const DEFAULT_FAST_SPEED = 1800;
const DEFAULT_DOCK_LOCATION = 0;
const DEFAULT_ICON_SIZE = 42;
const DEFAULT_DOCK_MODE = 0;
const DEFAULT_EDGE_REVEAL_MS = 1500;

const MIN_POLL_MS = 50;
const MAX_POLL_MS = 2000;
const MIN_DEBOUNCE_MS = 0;
const MAX_DEBOUNCE_MS = 5000;
const MIN_EDGE_PX = 1;
const MAX_EDGE_PX = 100;
const MIN_FAST_SPEED = 200;
const MAX_FAST_SPEED = 20000;
const MIN_DOCK_LOCATION = 0;
const MAX_DOCK_LOCATION = 3;
const MIN_ICON_SIZE = 24;
const MAX_ICON_SIZE = 96;
const MIN_DOCK_MODE = 0;
const MAX_DOCK_MODE = 2;

const MAX_RETRY_ATTEMPTS = 50;

class NativeDashWrapper {
    constructor(extension, monitorIndex) {
        log(`[NFDM] NativeDashWrapper CONSTRUCTOR monitor=${monitorIndex}`);
        this._extension = extension;
        this._monitorIndex = monitorIndex;
        this._originalDash = null;
        this._originalDashParent = null;
        this._originalDashShow = null;
        this._originalDashHide = null;
        this._originalDashRedisplay = null;
        this._originalDashQueueRedisplay = null;
        this._originalDashAdjustIconSize = null;
        this._hadOriginalFixSeparators = false;
        this._originalDashFixSeparators = null;
        this._patchedSeparators = new Map();
        this._sourceIds = new Set();
        this._repositionLaterId = 0;
        this._retryId = 0;
        this._showAppsClickId = 0;
        this._lastConfig = null;
        this._firstLayoutReady = false;
        this._redisplayCalled = false;
        this._pendingAnimate = false;
        this._animating = false;
        this.actor = null;
        this._hBarHeight = null;
        this._retryCount = 0;


        this._captureNativeDash();
    }

    // --- Meta.later API 兼容层 ---
    // GNOME 48+: global.compositor.get_laters().add/remove
    // GNOME 3.x~47: Meta.later_add / Meta.later_remove
    _laterAdd(type, callback) {
        try {
            // GNOME 48+
            if (global.compositor?.get_laters) {
                const laters = global.compositor.get_laters();
                return laters.add(type, callback);
            }
            // GNOME 3.x ~ 47
            if (Meta.later_add)
                return Meta.later_add(type, callback);
        } catch (e) {
            this._extension._warn('Meta.later API unavailable:', e.message);
        }
        return 0;
    }

    _laterRemove(id) {
        if (!id)
            return;
        try {
            if (global.compositor?.get_laters) {
                const laters = global.compositor.get_laters();
                laters.remove(id);
                return;
            }
            if (Meta.later_remove)
                Meta.later_remove(id);
        } catch (e) {
            this._extension._warn('Meta.later remove failed:', e.message);
        }
    }

    _captureNativeDash() {
        const dash = Main.overview?.dash;
        if (!dash) {
            this._extension._warn('native dash not found');
            return;
        }

        this._originalDash = dash;
        this._originalDashParent = dash.get_parent();

        // Override show/hide so overview can't hide our pinned dock
        this._originalDashShow = dash.show.bind(dash);
        this._originalDashHide = dash.hide.bind(dash);
        dash.show = () => {};
        dash.hide = () => {};

        // Remove from overview
        if (this._originalDashParent)
            this._originalDashParent.remove_child(dash);

        // The dash itself is our actor — no wrapper, no clipping.
        this.actor = dash;
        this.actor.add_style_class_name('native-dock-follow-mouse-dock');

        // Hidden until first reposition after layout is ready.
        this.actor.opacity = 0;

        // GNOME Shell dash stores icon size as `this.iconSize` (no underscore,
        // default 64).  Override it persistently here and intercept the built-in
        // _adjustIconSize so native _redisplay binds and signal paths all read
        // our configured size — their .bind(this) captures prevent us from
        // intercepting _redisplay/_queueRedisplay directly.
        dash.iconSize = this._extension._iconSize || DEFAULT_ICON_SIZE;

        // Wrap _redisplay + _queueRedisplay so ALL icon creation paths use our size.
        this._originalDashRedisplay = dash._redisplay;
        this._originalDashQueueRedisplay = dash._queueRedisplay;
        this._originalDashAdjustIconSize = dash._adjustIconSize;
        this._hadOriginalFixSeparators = Object.prototype.hasOwnProperty.call(dash, '_fixSeparators');
        this._originalDashFixSeparators = dash._fixSeparators;

        const _origRedisplay = this._originalDashRedisplay.bind(dash);
        const _origQueueRedisplay = this._originalDashQueueRedisplay.bind(dash);
        const _origAdjustIconSize = this._originalDashAdjustIconSize.bind(dash);
        const self = this._extension;
        const wrapper = this;

        const _resizeDashIcons = () => {
            const size = self._iconSize || DEFAULT_ICON_SIZE;
            // Resize regular app icons
            const box = dash._box;
            if (box) {
                const n = box.get_n_children?.() ?? 0;
                for (let i = 0; i < n; i++) {
                    const child = box.get_child_at_index(i);
                    if (!child || !child.child || child === dash._showAppsIcon)
                        continue;
                    if (child.has_style_class_name?.('dash-separator'))
                        continue;
                    const baseIcon = child.child?.icon;
                    if (baseIcon)
                        baseIcon.setIconSize(size);
                }
            }
            // Resize ShowApps icon — use BaseIcon.setIconSize() so its internal
            // _iconSize cache is updated (tree walk with set_icon_size misses it).
            if (dash._showAppsIcon?.icon?.setIconSize)
                dash._showAppsIcon.icon.setIconSize(size);
        };

        // Intercept _adjustIconSize: let the original run for its side effects
        // (ensure_style, theme spacing hints needed by vertical layout), then
        // reapply our icon size and resize all icons so the native auto-sizing
        // never overrides our configured size.
        dash._adjustIconSize = () => {
            _origAdjustIconSize();
            const size = self._iconSize || DEFAULT_ICON_SIZE;
            dash.iconSize = size;
            _resizeDashIcons();
            if (dash._box) dash._box.queue_relayout();
        };

        dash._redisplay = () => {
            // Inject our icon size before icon creation so GNOME Shell's native
            // _redisplay creates new icon actors at the configured size directly.
            // GNOME Shell reads `this.iconSize` (no underscore, default 64) at
            // line 527 of its dash.js: appIcon.icon.setIconSize(this.iconSize).
            dash.iconSize = self._iconSize || DEFAULT_ICON_SIZE;
            _origRedisplay();
            // _adjustIconSize() is a noop (we replaced it above), but its
            // essential side effect — ensure_style() on the first icon — is
            // needed for correct theme spacing calculations.  Call it here
            // manually for the first (non-ShowApps) icon child.
            const firstChild = dash._box?.get_child_at_index?.(0);
            const firstIcon = firstChild?.child?._delegate?.icon?.icon;
            if (firstIcon?.ensure_style)
                firstIcon.ensure_style();

            // Restore our configured size so the next _redisplay cycle also
            // creates icons at the right dimensions.
            dash.iconSize = self._iconSize || DEFAULT_ICON_SIZE;
            self._iconSizeDirty = true;
            _resizeDashIcons();
            // Deferred resize with frame-interval retry: newly created icons
            // (e.g. non-favorite apps appearing for the first time) have their
            // `icon` property populated asynchronously during the layout cycle,
            // which may be several frames after _origRedisplay.  Retry every
            // frame until the icon is found (up to 5 attempts / ~80ms).
            let _retries = 0;
            const MAX_ICON_RETRIES = 5;
            const _deferredResize = () => {
                _resizeDashIcons();
                if (++_retries < MAX_ICON_RETRIES && dash._box) {
                    // Keep relayouting so _positionVertical reads the correct
                    // post-resize dimensions once the icon eventually shows up.
                    dash._box.queue_relayout();
                    return GLib.SOURCE_CONTINUE;
                }
                return GLib.SOURCE_REMOVE;
            };
            let sourceId = 0;
            sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                const result = _deferredResize();
                if (result === GLib.SOURCE_REMOVE)
                    this._sourceIds.delete(sourceId);
                return result;
            });
            this._sourceIds.add(sourceId);
            if (dash._box) dash._box.queue_relayout();
            dash.queue_relayout();
            dash._fixSeparators();
            // For vertical layout: full reposition (recalculates size + position).
            // For horizontal layout: reset to natural so the next reposition
            // has clean layout state; animation is handled by _tryDoPosition
            // using _lastPositionedW.
            if (wrapper._lastConfig) {
                const loc = wrapper._lastConfig.dockLocation;
                if (loc === 1 || loc === 2) {
                    wrapper._scheduleReposition();
                } else {
                    dash.set_size(-1, -1);
                    if (dash._background)
                        dash._background.set_size(-1, -1);
                    wrapper._scheduleReposition();
                }
            }
        };

        dash._queueRedisplay = () => {
            dash.iconSize = self._iconSize || DEFAULT_ICON_SIZE;
            _origQueueRedisplay();
            // New separators may have been created; patch them immediately.
            if (dash._fixSeparators) dash._fixSeparators();
            // Always schedule reposition so _tryDoPosition re-measures both
            // width and height from the updated children.
            wrapper._scheduleReposition();
        };

        // Patch separator: intercept set_size + fix expand so layout manager
        // can never enlarge it. GNOME Shell creates the separator with
        // y_expand:true — in a vertical StBoxLayout this distributes extra
        // space along the main axis, making the separator grow.
        // Vertical:   x_expand=true (full width),  y_expand=false (1px height)
        // Horizontal: x_expand=false (1px width), y_expand=true (full height)
        const _patchSeparator = (child) => {
            if (!child || child._nfdmPatched) return false;
            if (!child.style_class?.includes?.('dash-separator')) return false;
            child._nfdmPatched = true;
            const _origSetSize = child.set_size.bind(child);
            const _origGPH = child.get_preferred_height;
            const _origGPW = child.get_preferred_width;
            this._patchedSeparators.set(child, {
                set_size: child.set_size,
                get_preferred_height: _origGPH,
                get_preferred_width: _origGPW,
            });
            child.set_size = (w, h) => {
                if (dash.has_style_class_name?.('native-dock-vertical'))
                    _origSetSize(w, 1);
                else
                    _origSetSize(1, h);
            };
            if (_origGPH)
                child.get_preferred_height = (forWidth) => [1, 1];
            if (_origGPW)
                child.get_preferred_width = (forHeight) => [1, 1];
            _configureSeparatorExpand(child);
            return true;
        };

        const _configureSeparatorExpand = (child) => {
            if (!child || !child.style_class?.includes?.('dash-separator')) return;
            if (dash.has_style_class_name?.('native-dock-vertical')) {
                child.x_expand = true;
                child.y_expand = false;
            } else {
                child.x_expand = false;
                child.y_expand = true;
            }
        };

        dash._fixSeparators = () => {
            const box = dash._box;
            if (!box) return;
            const n = box.get_n_children?.() ?? 0;
            for (let i = 0; i < n; i++) {
                const child = box.get_child_at_index(i);
                const patched = _patchSeparator(child);
                // Even if already patched, re-apply expand (orientation may have changed)
                _configureSeparatorExpand(child);
            }
        };

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        // Initial redisplay at our icon size — must happen AFTER addChrome
        // so the dash is in the stage tree for proper theme node operations.
        const size = self._iconSize || DEFAULT_ICON_SIZE;
        dash._redisplay();

        // Show-apps button's built-in handler only toggles between
        // window-picker / app-grid within the overview. When the overview
        // is hidden, show it in app-grid mode instead.
        // St.Button connects button-press-event in init() — our handler
        // connected later never sees left-click (internal returns EVENT_STOP).
        // Use captured-event (capture phase, before target phase) to intercept.
        const showAppsIcon = dash._showAppsIcon;
        if (showAppsIcon) {
            showAppsIcon.reactive = true;
            this._showAppsClickId = showAppsIcon.connect('captured-event',
                (_actor, event) => {
                    if (event.type() !== Clutter.EventType.BUTTON_PRESS)
                        return Clutter.EVENT_PROPAGATE;
                    if (event.get_button() !== 1)
                        return Clutter.EVENT_PROPAGATE;
                    if (!Main.overview || Main.overview.visible)
                        return Clutter.EVENT_PROPAGATE;
                    Main.overview.showApps();
                    return Clutter.EVENT_STOP;
                });
        }
    }

    setVisible(visible) {
        if (!this.actor || this.actor.is_destroyed?.())
            return;
        // Use opacity instead of visibility so layout still computes when hidden.
        this.actor.opacity = visible ? 255 : 0;
        this._setRecurseReactive(this.actor, visible);
    }

    _setRecurseReactive(actor, reactive) {
        actor.reactive = reactive;
        const n = actor.get_n_children?.() ?? 0;
        for (let i = 0; i < n; i++) {
            const child = actor.get_child_at_index(i);
            if (child)
                this._setRecurseReactive(child, reactive);
        }
    }

    // Called from _redisplay wrapper when dash contents change (apps start/stop).
    // Defers to the next idle so all layout updates from GNOME Shell settle first.
    _scheduleReposition() {
        if (this._repositionQueued) return;
        const config = this._lastConfig;
        if (!config) return;
        this._repositionQueued = true;
        const id = this._laterAdd(Meta.LaterType.IDLE, () => {
            this._repositionLaterId = 0;
            this._repositionQueued = false;
            if (this.actor && !this.actor.is_destroyed?.())
                this.reposition(config);
            return GLib.SOURCE_REMOVE;
        });
        // Fallback: if _laterAdd returned 0 (API unavailable), use after-paint
        if (!id) {
            this._repositionQueued = false;
            if (this.actor && !this.actor.is_destroyed?.())
                this.reposition(config);
        } else {
            this._repositionLaterId = id;
        }
    }

    reposition(config) {
        if (!this.actor || this.actor.is_destroyed?.())
            return;

        if (!this._extension._isValidMonitor(this._monitorIndex))
            return;

        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        if (!this._extension._isMonitorUsable(monitor)) {
            this.actor.hide();
            return;
        }

        const dash = this.actor;
        const location = config.dockLocation;
        const iconSize = config.iconSize || DEFAULT_ICON_SIZE;
        const margin = config.edgeMargin ?? 8;
        const marginVertical = config.edgeMarginVertical ?? 8;

        const isFirst = !this._lastConfig;
        const configChanged = !isFirst && (
            this._lastConfig.iconSize !== iconSize ||
            this._lastConfig.dockLocation !== location ||
            this._lastConfig.showAppsIcon !== config.showAppsIcon ||
            this._lastConfig.activeDotColor !== config.activeDotColor);
        this._lastConfig = config;

        if (config.activeDotColor)
            this._applyDotColor(dash, config.activeDotColor);

        this._pendingConfig = config;

        this._tryDoPosition();

        this._scheduleRetry();
        this._retryCount = 0;
    }

    _scheduleRetry() {
        if (this._retryId)
            return;

        // Prefer Meta.later BEFORE_REDRAW (runs after layout, before paint).
        // Fallback to after-paint signal if Meta.later unavailable.
        if (Meta.LaterType && typeof Meta.LaterType.BEFORE_REDRAW === 'number') {
            this._retryId = this._laterAdd(Meta.LaterType.BEFORE_REDRAW,
                this._onRetryTick.bind(this));
        }

        if (!this._retryId) {
            // Fallback: after-paint signal (Clutter, all versions)
            this._retryId = global.stage.connect('after-paint',
                this._onAfterPaint.bind(this));
            this._retryIsSignal = true;
        }
    }

    _onRetryTick() {
        this._retryId = 0;

        if (!this.actor || this.actor.is_destroyed?.())
            return GLib.SOURCE_REMOVE;

        if (++this._retryCount > MAX_RETRY_ATTEMPTS) {
            this._extension._warn(`retry: giving up after ${MAX_RETRY_ATTEMPTS} attempts for monitor ${this._monitorIndex}`);
            return GLib.SOURCE_REMOVE;
        }

        if (!this._pendingConfig)
            return GLib.SOURCE_REMOVE;

        if (this._tryDoPosition())
            return GLib.SOURCE_REMOVE;

        this._scheduleRetry();
        return GLib.SOURCE_REMOVE;
    }

    _onAfterPaint() {
        if (!this.actor || this.actor.is_destroyed?.()) {
            this._cancelRetry();
            return;
        }

        if (!this._pendingConfig) {
            this._cancelRetry();
            return;
        }

        if (this._tryDoPosition()) {
            this._cancelRetry();
            this._retryCount = 0;
            return;
        }

        if (++this._retryCount > MAX_RETRY_ATTEMPTS) {
            this._extension._warn(`after-paint: giving up after ${MAX_RETRY_ATTEMPTS} attempts for monitor ${this._monitorIndex}`);
            this._cancelRetry();
            return;
        }

        // Still not ready — continue waiting for next paint
        // The signal stays connected, so this will be called again next frame
    }

    _tryDoPosition() {
        const config = this._pendingConfig;
        if (!config)
            return false;

        const dash = this.actor;
        const location = config.dockLocation;
        const iconSize = config.iconSize || DEFAULT_ICON_SIZE;
        const margin = config.edgeMargin ?? 8;
        const marginVertical = config.edgeMarginVertical ?? 8;

        // Apply orientation based on dock location before measuring allocation.
        // Called on every attempt (incl. retries) so the layout always reflects
        // the correct orientation when we read dimensions.
        this._applyOrientation(location);

        // On first positioning, force _redisplay once to rebuild icons at the configured size.
        // The captured native dash has default-sized icons; _redisplay applies our iconSize.
        if (!this._redisplayCalled && typeof dash._redisplay === 'function') {
            this._redisplayCalled = true;
            dash._redisplay();
            return false; // wait for layout to settle
        }

        const allocW = dash.width;
        const allocH = dash.height;

        if (allocW < iconSize || allocH < iconSize)
            return false;

        if (!this._firstLayoutReady) {
            const makeChildrenReactive = (actor) => {
                if (!actor)
                    return;
                const n = actor.get_n_children?.() ?? 0;
                for (let i = 0; i < n; i++) {
                    const child = actor.get_child_at_index(i);
                    if (!child)
                        continue;
                    child.reactive = true;
                    makeChildrenReactive(child);
                }
            };
            makeChildrenReactive(dash);
        }

        this._firstLayoutReady = true;

        let w = Math.ceil(allocW);
        let h = Math.ceil(allocH);
        let x, y;

        if (location === 1 || location === 2) {
            const result = this._positionVertical(dash, allocW, allocH, iconSize, location, marginVertical);
            if (!result)
                return false;
            ({ w, h, x, y } = result);
        } else {
            if (h > w && h > iconSize * 3)
                return false;

            // Measure dock width from children's natural widths.
            let targetW = 0;
            const measW = (c) => {
                if (!c || !c.visible) return;
                const [nw] = c.get_preferred_width(-1);
                targetW += Math.ceil(nw || 0);
            };
            if (dash._box) {
                for (const child of dash._box.get_children()) {
                    if (child && child.visible) measW(child);
                }
            }
            measW(dash._showAppsIcon);
            targetW += config.backgroundPadding * 2;

            // Measure dock height from children + background padding
            let dockH = 0;
            const measH = (c) => {
                if (!c || !c.visible) return;
                const [, nh] = c.get_preferred_height(-1);
                dockH = Math.max(dockH, Math.ceil(nh || 0));
            };
            if (dash._box)
                dash._box.get_children().forEach(measH);
            measH(dash._showAppsIcon);
            dockH += config.backgroundPadding * 2;

            const monitor = Main.layoutManager.monitors[this._monitorIndex];
            if (!monitor)
                return false;

            // Clamp to available monitor space
            const maxW = monitor.width - margin * 2;
            targetW = Math.min(targetW, maxW);

            dash.set_size(targetW, dockH);
            if (dash._background)
                dash._background.set_size(targetW, dockH);
            this._hBarHeight = dockH;
            w = targetW;
            h = dockH;

            if (location === 3) {
                x = monitor.x + Math.floor((monitor.width - targetW) / 2);
                y = monitor.y + margin;
                console.log(`[NFDM-DEBUG] TOP: margin=${margin} y=${y} monitorY=${monitor.y}`);
            } else {
                x = monitor.x + Math.floor((monitor.width - targetW) / 2);
                y = monitor.y + monitor.height - dockH - margin;
            }
        }

        if (this._pendingAnimate || this._animating) {
            this._pendingAnimate = false;
            this._animating = true;
            dash.remove_all_transitions();
            this._extension._log(`animating dock to (${x}, ${y}) size=${w}x${h} margin=${margin} marginV=${marginVertical}`);
            dash.ease({
                x, y,
                duration: 350,
                mode: Clutter.AnimationMode.EASE_OUT_QUART,
                onComplete: () => {
                    this._animating = false;
                },
            });
        } else {
            dash.set_position(x, y);
        }
        dash.visible = true;
        this._lastPositionedW = w;
        this._lastPositionedH = h;
        this._lastPositionedX = dash.x;
        this._lastPositionedY = dash.y;

        if (config.activeDotColor)
            this._applyDotColor(dash, config.activeDotColor);

        this._applyShowAppsIconSize(dash, iconSize);
        this._applyBackgroundStyle(config);
        this._applyLabelStyle(config);

        this._extension._log(`_tryDoPosition done: w=${w} h=${h} x=${x} y=${y} nChildren=${dash._box?.get_children?.()?.length ?? '?'} showApps=${!!dash._showAppsIcon}`);

        this._pendingConfig = null;
        return true;
    }

    _positionVertical(dash, allocW, allocH, iconSize, location, marginVertical) {
        const box = dash._box;
        const n = box?.get_n_children?.() ?? 0;
        const spacing = box?.layout_manager?.spacing ?? 0;

        let dockW = iconSize + 40;
        let dockH = 0;
        let firstChildH = 0;
        let firstSeen = false;
        for (let i = 0; i < n; i++) {
            const child = box.get_child_at_index(i);
            if (!child) continue;
            if (child.has_style_class_name?.('dash-separator')) {
                dockH += (firstSeen ? spacing : 0) + 1;
                firstSeen = true;
                continue;
            }
            const [natW] = child.get_preferred_width?.(-1) ?? [0, 0];
            const [, natH] = child.get_preferred_height?.(-1) ?? [0, 0];
            if (!firstSeen) firstChildH = natH || 0;
            dockW = Math.max(dockW, natW || 0);
            dockH += (firstSeen ? spacing : 0) + (natH || 0);
            firstSeen = true;
        }
        dockW += 12;
        dockH = Math.max(dockW, dockH);
        const showApps = dash._showAppsIcon;
        const dashContainer = dash._dashContainer;
        let h;
        if (showApps && dashContainer && showApps.get_parent() === dashContainer) {
            const [, natSH] = showApps.get_preferred_height?.(-1) ?? [0, 0];
            const showAppsH = natSH || firstChildH || iconSize;
            const dclSpacing = dashContainer?.layout_manager?.spacing ?? 0;
            h = dockH + dclSpacing + showAppsH;
        } else {
            h = dockH;
        }
        const w = dockW;
        dash.set_size(dockW, h);
        if (dash._background)
            dash._background.set_size(dockW, h);
        // Guard: if the newly computed height differs significantly from the
        // current allocation, wait for the next layout pass before positioning.
        // The set_size calls above still take effect so the background is
        // always up-to-date; only the (x, y) placement is deferred.
        if (allocH > 0 && Math.abs(allocH - h) > iconSize * 0.5)
            return null;

        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        if (!monitor)
            return null;

        const x = location === 1
            ? monitor.x + marginVertical
            : monitor.x + monitor.width - w - marginVertical;
        const y = monitor.y + Math.floor((monitor.height - h) / 2);

        this._extension._log(`vertical pos: loc=${location} w=${w} h=${h} x=${x} y=${y} marginV=${marginVertical}`);
        return { w, h, x, y };
    }

    _applyOrientation(location) {
        try {
            const dash = this.actor;
            if (!dash) return;
            const box = dash._box;
            const dashContainer = dash._dashContainer;
            if (!box || !dashContainer) return;
            const showApps = dash._showAppsIcon;

        const isVertical = location === 1 || location === 2;

        // Toggle CSS class for orientation-specific styling
        if (isVertical)
            dash.add_style_class_name?.('native-dock-vertical');
        else
            dash.remove_style_class_name?.('native-dock-vertical');

        // Hide separators in vertical layout — they don't make sense
        // when icons are stacked vertically.
        const n = box.get_n_children?.() ?? 0;
        for (let i = 0; i < n; i++) {
            const child = box.get_child_at_index(i);
            if (child?.has_style_class_name?.('dash-separator'))
                child.visible = !isVertical;
        }

        const boxLayout = box.layout_manager;
        if (boxLayout) {
                boxLayout.orientation = isVertical
                    ? Clutter.Orientation.VERTICAL
                    : Clutter.Orientation.HORIZONTAL;
            }

            const dashContainerLayout = dashContainer.layout_manager;
            if (dashContainerLayout) {
                dashContainerLayout.orientation = isVertical
                    ? Clutter.Orientation.VERTICAL
                    : Clutter.Orientation.HORIZONTAL;
            }

            // Patch separator set_size interceptors so layout can't override our size.
            if (dash._fixSeparators) dash._fixSeparators();

            if (dash.queue_relayout) dash.queue_relayout();
            if (box.queue_relayout) box.queue_relayout();
            if (dashContainer.queue_relayout) dashContainer.queue_relayout();
        } catch (e) {
            console.error('[NFDM] _applyOrientation error:', e.message, e.stack);
        }
    }

    _hexToRgba(hex, opacity) {
        hex = hex.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b))
            return `rgba(56, 56, 59, ${opacity})`;
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }

    _applyBackgroundStyle(config) {
        const dash = this.actor;
        if (!dash || dash.is_destroyed?.() || !dash._background)
            return;

        const preset = config.backgroundPreset ?? 0;
        const pad = config.backgroundPadding ?? 12;
        const radius = config.backgroundBorderRadius ?? 28;
        const padStyle = `padding: ${pad}px 10px; border-radius: ${radius}px;`;
        let cssStyle = '';

        switch (preset) {
        case 0: // Native dark
            cssStyle = `background-color: rgba(56, 56, 59, 0.95); ${padStyle}`;
            break;
        case 1: // Light translucent
            cssStyle = `background-color: rgba(255, 255, 255, 0.15); ${padStyle}`;
            break;
        case 2: // Transparent (no background)
            cssStyle = `background-color: transparent; ${padStyle}`;
            break;
        case 3: { // Custom color
            const hex = config.backgroundColor || '#38383b';
            const opacity = config.backgroundOpacity ?? 0.85;
            cssStyle = `background-color: ${this._hexToRgba(hex, opacity)}; ${padStyle}`;
            break;
        }
        default:
            dash._background.style = '';
            return;
        }

        if (dash._background.style !== cssStyle)
            dash._background.style = cssStyle;
    }

    _cancelRetry() {
        if (!this._retryId)
            return;

        if (this._retryIsSignal) {
            global.stage.disconnect(this._retryId);
            this._retryIsSignal = false;
        } else {
            this._laterRemove(this._retryId);
        }
        this._retryId = 0;
    }

    _applyDotColor(dash, color) {
        if (!dash?._box) return;
        const children = dash._box.get_children?.() ?? [];
        for (const item of children) {
            const dot = item._dot;
            if (dot)
                dot.style = `background-color: ${color}; width: ${dot.width || 6}px; border-radius: ${Math.floor((dot.width || 6) / 2)}px;`;
        }
    }

    _applyShowAppsIconSize(dash, size) {
        const showApps = dash._showAppsIcon;
        if (!showApps) return;
        // Use BaseIcon.setIconSize (not StIcon.set_icon_size) so the icon
        // container's internal layout is updated as well — just setting the
        // StIcon's _icon_size leaves the container's preferred size stale.
        if (showApps.icon?.setIconSize)
            showApps.icon.setIconSize(size);
        // Additionally walk the tree for any nested St.Icon actors as a
        // safety net.
        const setSize = (actor) => {
            if (!actor) return;
            if (actor.set_icon_size)
                actor.set_icon_size(size);
            const n = actor.get_n_children?.() ?? 0;
            for (let i = 0; i < n; i++)
                setSize(actor.get_child_at_index(i));
        };
        setSize(showApps);
        if (showApps.queue_relayout)
            showApps.queue_relayout();
    }

    _applyLabelStyle(config) {
        const dash = this.actor;
        if (!dash || dash.is_destroyed?.())
            return;
        const bg = config.labelBackground ?? 'rgba(0,0,0,0.9)';
        const radius = config.labelBorderRadius ?? 999;
        const labelStyle = `background-color: ${bg}; border-radius: ${radius}px;`;
        // Labels are DashItemContainer.label — St.Label added to chrome,
        // not children of the dash actor.  Access them directly via each
        // item's .label property instead of walking the actor tree.
        const box = dash._box;
        if (box) {
            const n = box.get_n_children?.() ?? 0;
            for (let i = 0; i < n; i++) {
                const child = box.get_child_at_index(i);
                if (child?.label && child.label.style !== labelStyle)
                    child.label.style = labelStyle;
            }
        }
        if (dash._showAppsIcon?.label && dash._showAppsIcon.label.style !== labelStyle)
            dash._showAppsIcon.label.style = labelStyle;
    }

    reapplyIconSize() {
        const dash = this.actor;
        if (!dash || dash.is_destroyed?.() || !dash._box) return;
        const ext = this._extension;
        const size = ext._iconSize || DEFAULT_ICON_SIZE;

        const spacing = ext._settings?.get_int?.('dock-icon-spacing') ?? 0;
        if (dash._box.layout_manager)
            dash._box.layout_manager.spacing = spacing;

        const n = dash._box.get_n_children?.() ?? 0;
        for (let i = 0; i < n; i++) {
            const child = dash._box.get_child_at_index(i);
            if (!child || !child.child || child === dash._showAppsIcon)
                continue;
            if (child.has_style_class_name?.('dash-separator'))
                continue;
            const baseIcon = child.child?.icon;
            if (baseIcon)
                baseIcon.setIconSize(size);
        }

        // Also resize ShowApps icon
        if (dash._showAppsIcon?.icon?.setIconSize)
            dash._showAppsIcon.icon.setIconSize(size);

        if (dash._box.queue_relayout) dash._box.queue_relayout();
        if (dash._showAppsIcon?.queue_relayout) dash._showAppsIcon.queue_relayout();
        if (dash.queue_relayout) dash.queue_relayout();
    }

    destroy() {
        log(`[NFDM] NativeDashWrapper DESTROY monitor=${this._monitorIndex}`);
        this._cancelRetry();
        if (this._repositionLaterId) {
            this._laterRemove(this._repositionLaterId);
            this._repositionLaterId = 0;
            this._repositionQueued = false;
        }
        for (const id of this._sourceIds)
            GLib.source_remove(id);
        this._sourceIds.clear();
        if (this._relayoutTimeoutId) {
            GLib.source_remove(this._relayoutTimeoutId);
            this._relayoutTimeoutId = 0;
        }

        const dash = this._originalDash;
        if (dash) {
            if (this._showAppsClickId && dash._showAppsIcon) {
                dash._showAppsIcon.disconnect(this._showAppsClickId);
                this._showAppsClickId = 0;
            }

            // Remove from chrome
            Main.layoutManager.removeChrome(dash);
            dash.remove_style_class_name('native-dock-follow-mouse-dock');
            dash.remove_style_class_name('native-dock-vertical');

            // Restore patched private Dash methods before returning it to overview.
            if (this._originalDashRedisplay)
                dash._redisplay = this._originalDashRedisplay;
            if (this._originalDashQueueRedisplay)
                dash._queueRedisplay = this._originalDashQueueRedisplay;
            if (this._originalDashAdjustIconSize)
                dash._adjustIconSize = this._originalDashAdjustIconSize;
            if (this._hadOriginalFixSeparators)
                dash._fixSeparators = this._originalDashFixSeparators;
            else
                delete dash._fixSeparators;

            for (const [child, original] of this._patchedSeparators) {
                child.set_size = original.set_size;
                if (original.get_preferred_height)
                    child.get_preferred_height = original.get_preferred_height;
                else
                    delete child.get_preferred_height;
                if (original.get_preferred_width)
                    child.get_preferred_width = original.get_preferred_width;
                else
                    delete child.get_preferred_width;
                delete child._nfdmPatched;
            }
            this._patchedSeparators.clear();

            // Restore original parent
            if (this._originalDashParent && dash.get_parent() !== this._originalDashParent)
                this._originalDashParent.add_child(dash);

            // Restore original show/hide
            if (this._originalDashShow)
                dash.show = this._originalDashShow;
            if (this._originalDashHide)
                dash.hide = this._originalDashHide;
        }

        this.actor = null;
        this._originalDash = null;
    }
}

export default class NativeDockFollowMouseExtension extends Extension {
    enable() {
        this._settings = null;
        this._settingsSignals = [];
        this._appSignals = [];
        this._overviewSignals = [];
        this._layoutSignals = [];
        this._windowSignals = [];
        this._timeoutId = null;
        this._intellihideTimeoutId = null;
        this._intellihideHoverTimeoutId = null;
        this._intellihideHideTimeoutId = null;
        this._sourceIds = new Set();
        this._intellihideHidden = false;
        this._intellihideHiddenByMonitor = new Map();
        this._docks = new Map();
        this._currentMonitor = -1;
        this._pendingMonitor = -1;
        this._pendingSince = 0;
        this._lastX = null;
        this._lastY = null;
        this._lastSampleUs = 0;
        this._lastSwitchUs = 0;
        this._lastDocksVisible = null;
        this._intellihideHoverActive = false;
        this._edgeRevealUntilUs = 0;
        this._loginManagerSignalId = 0;
        this._iconSizeDirty = true;

        try {
            this._settings = this.getSettings(SCHEMA_ID);
        } catch (e) {
            this._warn(`cannot load settings: ${e.message}`);
            return;
        }

        this._loadConfig();
        this._favoriteAppIds = this._getFavoriteAppIds();

        this._currentMonitor = this._initialMonitor();
        this._pendingMonitor = this._currentMonitor;
        this._pendingSince = GLib.get_monotonic_time();
        [this._lastX, this._lastY] = global.get_pointer();
        this._lastSampleUs = this._pendingSince;

        this._connectSignals();
        this._rebuildDocks();
        this._reevalIntellihide();
        this._syncDockVisibility();
        this._restartPolling();
        this._log(`enabled: mode=${this._dockMode} current=${this._currentMonitor} poll=${this._pollMs}ms edge=${this._edgePx}px`);
    }

    disable() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._intellihideTimeoutId) {
            GLib.source_remove(this._intellihideTimeoutId);
            this._intellihideTimeoutId = null;
        }

        if (this._intellihideHoverTimeoutId) {
            GLib.source_remove(this._intellihideHoverTimeoutId);
            this._intellihideHoverTimeoutId = null;
        }

        if (this._intellihideHideTimeoutId) {
            GLib.source_remove(this._intellihideHideTimeoutId);
            this._intellihideHideTimeoutId = null;
        }

        for (const id of this._sourceIds)
            GLib.source_remove(id);
        this._sourceIds.clear();

        for (const id of this._settingsSignals)
            this._settings?.disconnect(id);
        this._settingsSignals = [];

        for (const [object, id] of this._appSignals)
            object?.disconnect?.(id);
        this._appSignals = [];

        for (const id of this._overviewSignals)
            Main.overview?.disconnect(id);
        this._overviewSignals = [];

        for (const id of this._layoutSignals)
            Main.layoutManager?.disconnect(id);
        this._layoutSignals = [];

        if (this._loginManagerSignalId) {
            const loginManager = global.backend?.get_login_manager?.();
            loginManager?.disconnect(this._loginManagerSignalId);
            this._loginManagerSignalId = 0;
        }

        this._disconnectWindowSignals();
        this._destroyDocks();
        this._settings = null;
        this._log('disabled');
    }

    _connectSignals() {
        const reloadKeys = [
            'dock-location',
            'dock-mode',
            'preferred-monitor',
            'follow-mouse-debounce-ms',
            'follow-mouse-edge-px',
            'follow-mouse-fast-speed',
            'follow-mouse-icon-size',
            'follow-mouse-debug',
            'intellihide-enabled',
            'intellihide-hover-delay-ms',
            'intellihide-hide-delay-ms',
            'background-padding',
            'background-border-radius',
            'label-background',
            'label-border-radius',
            'edge-reveal-timeout-ms',
        ];

        for (const key of reloadKeys)
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => this._onSettingsChanged(key)));

        this._settingsSignals.push(this._settings.connect('changed::follow-mouse-poll-ms', () => this._restartPolling()));
        this._settingsSignals.push(this._settings.connect('changed::show-apps-icon', () => this._rebuildDocks()));
        this._settingsSignals.push(this._settings.connect('changed::dock-icon-spacing', () => {
            this._loadConfig();
            this._iconSizeDirty = true;
            this._reapplyIconSize();
        }));
        this._settingsSignals.push(this._settings.connect('changed::dock-edge-margin', () => {
            this._loadConfig();
            this._rebuildDocks();
        }));
        this._settingsSignals.push(this._settings.connect('changed::dock-edge-margin-vertical', () => {
            this._loadConfig();
            this._rebuildDocks();
        }));
        this._settingsSignals.push(this._settings.connect('changed::background-preset', () => this._onSettingsChanged('background-preset')));
        this._settingsSignals.push(this._settings.connect('changed::background-custom-color', () => this._onSettingsChanged('background-custom-color')));
        this._settingsSignals.push(this._settings.connect('changed::background-custom-opacity', () => this._onSettingsChanged('background-custom-opacity')));

        if (Main.overview) {
            this._overviewSignals.push(Main.overview.connect('showing', () => this._setDocksVisible(false)));
            this._overviewSignals.push(Main.overview.connect('hidden', () => {
                this._setDocksVisible(true);
                // Overview resets icon sizes internally; reapply after it settles.
                this._iconSizeDirty = true;
                let sourceId = 0;
                sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._reapplyIconSize();
                    this._sourceIds.delete(sourceId);
                    return GLib.SOURCE_REMOVE;
                });
                this._sourceIds.add(sourceId);
            }));
        }

        if (Main.layoutManager)
            this._layoutSignals.push(Main.layoutManager.connect('monitors-changed', () => this._onMonitorsChanged()));

        const loginManager = global.backend?.get_login_manager?.();
        if (loginManager) {
            this._loginManagerSignalId = loginManager.connect('prepare-for-sleep', (lm, sleeping) => {
                if (!sleeping)
                    this._onSystemResumed();
            });
        }

        // Listen for app state changes so dock resizes when apps open/close,
        // even when GNOME Shell's Dash._queueRedisplay bypasses our wrapper.
        const appSystem = Shell.AppSystem?.get_default?.();
        if (appSystem) {
            const appStateId = appSystem.connect('app-state-changed', () => {
                for (const dock of this._docks.values())
                    dock._scheduleReposition();
            });
            this._appSignals.push([appSystem, appStateId]);
        }

        this._connectWindowSignals();
    }

    _connectWindowSignals() {
        this._disconnectWindowSignals();
        if (!this._intellihideEnabled || !global.display) {
            this._log(`_connectWindowSignals: skipped (enabled=${this._intellihideEnabled})`);
            return;
        }

        this._log(`_connectWindowSignals: connecting signals`);
        const display = global.display;
        const _push = (obj, id) => { this._windowSignals.push({obj, id}); };

        _push(display, display.connect('window-created', (_d, win) => {
            this._onWindowStateChanged();
            if (win) {
                _push(win, win.connect('notify::maximized-horizontally', () => this._onWindowStateChanged()));
                _push(win, win.connect('notify::maximized-vertically', () => this._onWindowStateChanged()));
            }
        }));
        _push(display, display.connect('notify::focus-window', () => this._onWindowStateChanged()));

        if (global.workspace_manager) {
            _push(global.workspace_manager, global.workspace_manager.connect('active-workspace-changed', () => {
                this._connectWindowSignals();
                this._onWindowStateChanged();
            }));
        }

        const ws = global.workspace_manager?.get_active_workspace?.();
        if (ws) {
            _push(ws, ws.connect('window-added', () => this._onWindowStateChanged()));
            _push(ws, ws.connect('window-removed', () => this._onWindowStateChanged()));
        }

        // GNOME 48: ws.get_windows() may return empty; use display.get_tab_list as primary.
        const tabList = global.display?.get_tab_list?.(Meta.TabList.NORMAL_ALL, null) ?? [];
        for (const win of tabList) {
            if (!win)
                continue;
            _push(win, win.connect('notify::maximized-horizontally', () => this._onWindowStateChanged()));
            _push(win, win.connect('notify::maximized-vertically', () => this._onWindowStateChanged()));
        }
    }

    _disconnectWindowSignals() {
        for (const conn of this._windowSignals) {
            try {
                conn.obj.disconnect(conn.id);
            } catch (_e) {}
        }
        this._windowSignals = [];
    }

    _onWindowStateChanged() {
        if (!this._intellihideEnabled)
            return;
        if (this._intellihideTimeoutId)
            GLib.source_remove(this._intellihideTimeoutId);
        this._intellihideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._intellihideTimeoutId = null;

            if (this._dockMode === 1) {
                // Mode 1: per-monitor intellihide
                for (const monitorIdx of this._docks.keys()) {
                    const maximized = this._isAnyMaximizedOnDockMonitor(monitorIdx);
                    this._log(`windowStateChanged[${monitorIdx}]: maximized=${maximized}`);
                    this._intellihideHiddenByMonitor.set(monitorIdx, maximized);
                }
            } else {
                const maximized = this._isAnyMaximizedOnDockMonitor();
                this._log(`windowStateChanged: maximized=${maximized} monitor=${this._currentMonitor}`);
                // Don't hide if pointer is on dock area (hover reveal active)
                if (maximized && this._intellihideHoverActive)
                    return GLib.SOURCE_REMOVE;
                this._intellihideHidden = maximized;
            }

            this._syncDockVisibility();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onSettingsChanged(key) {
        this._loadConfig();

        if (key === 'intellihide-enabled') {
            this._connectWindowSignals();
            if (this._dockMode === 1) {
                for (const monitorIdx of this._docks.keys()) {
                    const maximized = this._isAnyMaximizedOnDockMonitor(monitorIdx);
                    this._intellihideHiddenByMonitor.set(monitorIdx, maximized);
                }
            } else {
                this._intellihideHidden = this._isAnyMaximizedOnDockMonitor();
            }
        }

        if (key === 'preferred-monitor' && this._dockMode === 0)
            this._currentMonitor = this._monitorFromPreferredSetting();

        if (key === 'dock-mode') {
            this._currentMonitor = this._initialMonitor();
            this._pendingMonitor = this._currentMonitor;
            this._pendingSince = GLib.get_monotonic_time();
            this._intellihideHiddenByMonitor = new Map();
            this._intellihideHidden = false;
            this._rebuildDocks();
            return;
        }

        // Background changes: just reapply style, no full rebuild needed.
        // background-padding and background-border-radius are in reloadKeys, so they
        // fall through to _rebuildDocks to recalculate size/position.
        if (key === 'background-preset' || key === 'background-custom-color' ||
            key === 'background-custom-opacity') {
            const config = this._configSnapshot();
            for (const dock of this._docks.values()) {
                if (dock.actor && !dock.actor.is_destroyed?.())
                    dock._applyBackgroundStyle(config);
            }
            return;
        }

        if (!this._isValidMonitor(this._currentMonitor))
            this._currentMonitor = this._getMonitorAt(...global.get_pointer());
        if (!this._isValidMonitor(this._currentMonitor))
            this._currentMonitor = Main.layoutManager.primaryIndex ?? 0;

        this._pendingMonitor = this._currentMonitor;
        this._pendingSince = GLib.get_monotonic_time();
        this._rebuildDocks();
    }

    _onMonitorsChanged() {
        this._loadConfig();
        if (this._dockMode === 2) {
            this._currentMonitor = Main.layoutManager.primaryIndex ?? 0;
        } else if (!this._isValidMonitor(this._currentMonitor)) {
            this._currentMonitor = this._initialMonitor();
        }
        this._pendingMonitor = this._currentMonitor;
        this._rebuildDocks();
    }

    _onSystemResumed() {
        this._loadConfig();
        this._rebuildDocks();
    }

    _loadConfig() {
        this._debug = this._getBoolean('follow-mouse-debug', false);
        this._pollMs = this._clampInt(this._getInt('follow-mouse-poll-ms', DEFAULT_POLL_MS), MIN_POLL_MS, MAX_POLL_MS);
        this._debounceMs = this._clampInt(this._getInt('follow-mouse-debounce-ms', DEFAULT_DEBOUNCE_MS), MIN_DEBOUNCE_MS, MAX_DEBOUNCE_MS);
        this._edgePx = this._clampInt(this._getInt('follow-mouse-edge-px', DEFAULT_EDGE_PX), MIN_EDGE_PX, MAX_EDGE_PX);
        this._fastSpeedThreshold = this._clampInt(this._getInt('follow-mouse-fast-speed', DEFAULT_FAST_SPEED), MIN_FAST_SPEED, MAX_FAST_SPEED);
        this._dockLocation = this._clampInt(this._getInt('dock-location', DEFAULT_DOCK_LOCATION), MIN_DOCK_LOCATION, MAX_DOCK_LOCATION);
        this._dockMode = this._clampInt(this._getInt('dock-mode', DEFAULT_DOCK_MODE), MIN_DOCK_MODE, MAX_DOCK_MODE);
        if (this._dockMode === 1) {
            this._warn('dock-mode=1 is disabled because GNOME native Dash cannot be cloned; falling back to follow-mouse mode');
            this._dockMode = 0;
        }
        this._iconSize = this._clampInt(this._getInt('follow-mouse-icon-size', DEFAULT_ICON_SIZE), MIN_ICON_SIZE, MAX_ICON_SIZE);
        this._edgeMargin = this._clampInt(this._getInt('dock-edge-margin', 8), -100, 100);
        this._edgeMarginVertical = this._clampInt(this._getInt('dock-edge-margin-vertical', 8), -100, 100);
        this._iconSpacing = this._clampInt(this._getInt('dock-icon-spacing', 0), 0, 50);
        this._showAppsIcon = this._getBoolean('show-apps-icon', true);
        this._activeDotColor = this._getString('active-dot-color', '#6ee7ff');
        this._intellihideEnabled = this._getBoolean('intellihide-enabled', false);
        this._intellihideHoverDelayMs = this._clampInt(this._getInt('intellihide-hover-delay-ms', 300), 0, 2000);
        this._intellihideHideDelayMs = this._clampInt(this._getInt('intellihide-hide-delay-ms', 500), 0, 5000);
        this._backgroundPreset = this._clampInt(this._getInt('background-preset', 0), 0, 3);
        this._backgroundColor = this._getString('background-custom-color', '#38383b');
        this._backgroundOpacity = this._getDouble('background-custom-opacity', 0.85);
        this._backgroundPadding = this._clampInt(this._getInt('background-padding', 12), 0, 60);
        this._backgroundBorderRadius = this._clampInt(this._getInt('background-border-radius', 28), 0, 60);
        this._labelBackground = this._getString('label-background', 'rgba(0,0,0,0.9)');
        this._labelBorderRadius = this._clampInt(this._getInt('label-border-radius', 999), 0, 999);
        this._edgeRevealTimeoutUs = this._clampInt(this._getInt('edge-reveal-timeout-ms', DEFAULT_EDGE_REVEAL_MS), 100, 30000) * 1000;
    }

    _restartPolling() {
        this._loadConfig();

        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._pollMs, () => {
            try {
                this._poll();
                return GLib.SOURCE_CONTINUE;
            } catch (e) {
                this._warn(`poll failed: ${e.message}`);
                return GLib.SOURCE_CONTINUE;
            }
        });
    }

    _poll() {
        // --- Follow-mouse: always update _currentMonitor, even when hidden ---
        // Mode 1 (fixed on current) and mode 2 (primary only) — no mouse tracking.
        if (this._dockMode === 0) {
            const blockedByFullscreen = this._maybeRevealDockOnEdge();
            if (!blockedByFullscreen) {
                const [x, y] = global.get_pointer();
                const now = GLib.get_monotonic_time();
                const monitorIdx = this._getMonitorAt(x, y);
                const fastPush = this._isFastEdgePush(x, y, monitorIdx, now);

                this._lastX = x;
                this._lastY = y;
                this._lastSampleUs = now;

                if (fastPush) {
                    this._log(`follow-mouse: fastPush → monitor ${monitorIdx}`);
                    this._switchMonitor(monitorIdx, true);
                } else if (this._isValidMonitor(monitorIdx) && monitorIdx !== this._currentMonitor) {
                    const targetMon = Main.layoutManager.monitors[monitorIdx];
                    const atEdge = targetMon && this._isTriggerEdge(x, y, targetMon);
                    if (atEdge) {
                        if (monitorIdx !== this._pendingMonitor) {
                            this._pendingMonitor = monitorIdx;
                            this._pendingSince = now;
                            this._log(`follow-mouse: ptr@${x},${y} pending mon=${monitorIdx} (at edge)`);
                        }
                    } else {
                        this._resetPending();
                    }
                } else {
                    this._resetPending();
                }
            }
        }

        // Check pending monitor switch (debounce)
        if (this._dockMode === 0 && this._pendingMonitor !== null && this._pendingMonitor !== this._currentMonitor) {
            const now = GLib.get_monotonic_time();
            const elapsed = (now - this._pendingSince) / 1000;
            this._log(`debounce: pending=${this._pendingMonitor} elapsed=${elapsed.toFixed(0)}ms need=${this._debounceMs}ms`);
            if (elapsed >= this._debounceMs) {
                this._log(`debounce: switching to monitor ${this._pendingMonitor}`);
                this._switchMonitor(this._pendingMonitor, false);
            }
        }

        // --- Intellihide ---
        // Maximized-window state is managed by _onWindowStateChanged signal.
        // Poll only handles hover-to-reveal and hide-after-leave timers.
        if (this._intellihideEnabled) {
            this._handleIntellihideHover();
        }

        // --- Visibility ---
        this._syncDockVisibility();

        // Keep repositioning the dock until icons finish loading asynchronously,
        // and also if the dock's dimensions changed since last position.
        if (this._isValidMonitor(this._currentMonitor)) {
            const dock = this._docks.get(this._currentMonitor);
            if (dock && dock.actor && !dock.actor.is_destroyed?.() && !dock._animating) {
                const needsReposition = !dock._firstLayoutReady ||
                    dock.actor.width !== (dock._lastPositionedW || 0) ||
                    dock.actor.height !== (dock._lastPositionedH || 0);
                // Also reposition if the dock's actual position drifted from
                // the last known desired position (GNOME 50 may shift actors).
                const posDrift = dock._lastPositionedX !== undefined &&
                    (Math.abs(dock.actor.x - dock._lastPositionedX) > 5 ||
                     Math.abs(dock.actor.y - dock._lastPositionedY) > 5);
                if (needsReposition || posDrift) {
                    dock.reposition(this._configSnapshot());
                }
            }
        }

        // Poll-time safety net: only reapply icon size when something actually changed.
        if (this._iconSizeDirty) {
            this._reapplyIconSize();
            this._iconSizeDirty = false;
        }
    }

    _reapplyIconSize() {
        const iconSize = this._iconSize || DEFAULT_ICON_SIZE;
        for (const dock of this._docks.values()) {
            if (!dock.actor || dock.actor.is_destroyed?.())
                continue;
            if (!dock.actor.get_stage?.())
                continue;
            dock.reapplyIconSize();
            dock._applyShowAppsIconSize(dock.actor, iconSize);
        }
    }

    _rebuildDocks() {
        this._log(`_rebuildDocks called`);
        this._destroyDocks();
        this._lastDocksVisible = null;

        const config = this._configSnapshot();

        if (this._dockMode === 1) {
            // Mode 1: dock on every monitor
            for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
                if (this._isValidMonitor(i)) {
                    const dock = new NativeDashWrapper(this, i);
                    this._docks.set(i, dock);
                    dock.reposition(config);
                }
            }
        } else {
            const target = this._resolveTargetMonitor();
            if (this._isValidMonitor(target)) {
                const dock = new NativeDashWrapper(this, target);
                this._docks.set(target, dock);
                dock.reposition(config);
            }
        }

        this._syncDockVisibility();
        this._log(`docks on ${[...this._docks.keys()].join(', ')}`);
    }

    _resolveTargetMonitor() {
        if (this._dockMode === 2) {
            const primary = Main.layoutManager.primaryIndex;
            return this._isValidMonitor(primary) ? primary : this._currentMonitor;
        }
        return this._currentMonitor;
    }

    _destroyDocks() {
        for (const dock of this._docks.values())
            dock.destroy();
        this._docks.clear();
    }

    _setDocksVisible(visible) {
        if (visible === this._lastDocksVisible)
            return;
        this._lastDocksVisible = visible;
        for (const dock of this._docks.values())
            dock.setVisible(visible);
    }

    _syncDockVisibility() {
        if (this._dockMode === 1) {
            for (const [monitorIdx, dock] of this._docks) {
                const visible = this._shouldShowDock(monitorIdx);
                dock.setVisible(visible);
            }
        } else {
            const visible = this._shouldShowDock();
            this._setDocksVisible(visible);
        }
    }

    _shouldShowDock(monitorIdx = null) {
        if (Main.overview?.visible)
            return false;

        if (this._isAnyFullscreenWindowActive()) {
            const [x, y] = global.get_pointer();
            if (this._isPointerOnDockEdge(x, y)) {
                this._edgeRevealUntilUs = GLib.get_monotonic_time() + this._edgeRevealTimeoutUs;
                return true;
            }
            return GLib.get_monotonic_time() < this._edgeRevealUntilUs;
        }

        // Intellihide: hide when a maximized window overlaps the dock
        if (this._intellihideEnabled) {
            const hidden = monitorIdx !== null
                ? (this._intellihideHiddenByMonitor.get(monitorIdx) ?? false)
                : this._intellihideHidden;
            if (hidden) {
                this._log(`shouldShow[${monitorIdx ?? 'global'}]: false (intellihide hidden)`);
                return false;
            }
        }

        this._edgeRevealUntilUs = 0;
        return true;
    }

    _maybeRevealDockOnEdge() {
        if (!this._isAnyFullscreenWindowActive())
            return false;

        const [x, y] = global.get_pointer();
        if (!this._isPointerOnDockEdge(x, y))
            return false;

        this._edgeRevealUntilUs = GLib.get_monotonic_time() + this._edgeRevealTimeoutUs;
        this._setDocksVisible(true);
        return true;
    }

    _isPointerOnDockEdge(x, y) {
        const monitorIndex = this._getMonitorAt(x, y);
        const index = this._isValidMonitor(this._currentMonitor) ? this._currentMonitor : monitorIndex;
        const monitor = this._isValidMonitor(index) ? Main.layoutManager.monitors[index] : null;
        return !!monitor && this._isTriggerEdge(x, y, monitor);
    }

    _isWindowFullscreen(window) {
        if (!window)
            return false;

        try {
            if (typeof window.is_fullscreen === 'function' && window.is_fullscreen())
                return true;
        } catch (_e) {}

        try {
            if (typeof window.get_window_type === 'function' &&
                window.get_window_type() === Meta.WindowType.FULLSCREEN)
                return true;
        } catch (_e) {}

        try {
            if (window.fullscreen === true)
                return true;
        } catch (_e) {}

        return false;
    }

    _isAnyFullscreenWindowActive() {
        try {
            if (typeof global.display?.get_monitor_in_fullscreen === 'function') {
                const monitor = global.display.get_monitor_in_fullscreen();
                if (Number.isInteger(monitor) && monitor >= 0)
                    return true;
            }
        } catch (_e) {}

        const focus = global.display?.get_focus_window?.();
        return this._isWindowFullscreen(focus);
    }

    _isWindowMaximized(window) {
        if (!window)
            return false;
        try {
            if (typeof window.get_maximized === 'function') {
                // Meta.MaximizeFlags: BOTH = 3, VERTICAL = 2, HORIZONTAL = 1
                return window.get_maximized() === 3;
            }
        } catch (_e) {}
        try {
            if (window.maximized_horizontally && window.maximized_vertically)
                return true;
        } catch (_e) {}
        return false;
    }

    _isAnyMaximizedOnDockMonitor(monitorIdx = null) {
        if (!this._intellihideEnabled)
            return false;

        const dockMonitorIdx = monitorIdx !== null ? monitorIdx : this._currentMonitor;
        if (!this._isValidMonitor(dockMonitorIdx)) {
            this._log(`_isAnyMaximized: invalid monitor ${dockMonitorIdx}`);
            return false;
        }

        const dockMonitor = Main.layoutManager.monitors[dockMonitorIdx];
        if (!dockMonitor)
            return false;

        try {
            // GNOME 48: ws.get_windows() returns empty; use display.get_tab_list directly.
            const windows = global.display?.get_tab_list?.(Meta.TabList.NORMAL_ALL, null) ?? [];
            this._log(`_isAnyMaximized: checking ${windows.length} windows on dock monitor ${dockMonitorIdx}`);
            for (const win of windows) {
                if (!win || win.is_hidden?.())
                    continue;
                const winMonitor = win.get_monitor?.();
                if (winMonitor !== dockMonitorIdx)
                    continue;
                // Skip non-normal window types
                try {
                    const wtype = win.get_window_type?.();
                    if (wtype !== undefined && wtype !== Meta.WindowType.NORMAL)
                        continue;
                } catch (_e) {}
                // Skip desktop icon extensions and similar background windows
                try {
                    const wmClass = win.get_wm_class?.() ?? '';
                    if (/desktop.?icon|ding|nautilus-desktop/i.test(wmClass))
                        continue;
                } catch (_e) {}
                // Skip taskbar-hidden windows (background utilities)
                try {
                    if (win.is_skip_taskbar?.() || win.get_skip_taskbar?.())
                        continue;
                } catch (_e) {}
                if (this._isWindowMaximized(win)) {
                    const title = win.get_title?.() ?? '(unknown)';
                    const maxState = win.get_maximized?.();
                    this._log(`_isAnyMaximized: found maximized: "${title}" max=${maxState} on mon ${dockMonitorIdx}`);
                    return true;
                }
            }
        } catch (e) {
            this._log(`_isAnyMaximized: error: ${e.message}`);
        }

        return false;
    }

    _isPointerOnDockArea(x, y, monitorIdx = null) {
        const index = monitorIdx !== null
            ? monitorIdx
            : (this._isValidMonitor(this._currentMonitor) ? this._currentMonitor : this._getMonitorAt(x, y));
        if (!this._isValidMonitor(index))
            return false;
        const monitor = Main.layoutManager.monitors[index];
        if (!monitor)
            return false;

        if (x < monitor.x || x >= monitor.x + monitor.width ||
            y < monitor.y || y >= monitor.y + monitor.height)
            return false;

        // When dock visible: use actual dock height for hit test.
        // When hidden: use edgePx only (screen edge trigger).
        let zone;
        const hidden = monitorIdx !== null
            ? (this._intellihideHiddenByMonitor.get(monitorIdx) ?? false)
            : this._intellihideHidden;
        if (!hidden) {
            const dock = this._docks.get(index);
            zone = (dock?.actor && !dock.actor.is_destroyed?.()) ? dock.actor.height : 80;
        } else {
            zone = this._edgePx;
        }

        switch (this._dockLocation) {
        case 1: return x < monitor.x + zone;
        case 2: return x >= monitor.x + monitor.width - zone;
        case 3: return y < monitor.y + zone;
        default: return y >= monitor.y + monitor.height - zone;
        }
    }

    _handleIntellihideHover() {
        const [x, y] = global.get_pointer();

        if (this._dockMode === 1) {
            this._handleIntellihideHoverMode1(x, y);
            return;
        }

        const isOnDockArea = this._isPointerOnDockArea(x, y);

        if (isOnDockArea) {
            if (this._intellihideHideTimeoutId) {
                GLib.source_remove(this._intellihideHideTimeoutId);
                this._intellihideHideTimeoutId = null;
                this._log('intellihide: cancelled hide timer (mouse on dock)');
            }

            if (this._intellihideHidden && !this._intellihideHoverTimeoutId) {
                this._intellihideHoverTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._intellihideHoverDelayMs, () => {
                    this._intellihideHoverTimeoutId = null;
                    this._intellihideHidden = false;
                    this._intellihideHoverActive = true;
                    this._syncDockVisibility();
                    this._log('intellihide: revealed by hover');
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else {
            if (this._intellihideHoverTimeoutId) {
                GLib.source_remove(this._intellihideHoverTimeoutId);
                this._intellihideHoverTimeoutId = null;
            }

            if (this._intellihideHoverActive && !this._intellihideHideTimeoutId) {
                this._log(`intellihide: starting hide timer (mouse left dock area at ${x},${y})`);
                this._intellihideHideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._intellihideHideDelayMs, () => {
                    this._intellihideHideTimeoutId = null;
                    this._intellihideHoverActive = false;
                    if (!this._isAnyMaximizedOnDockMonitor())
                        return GLib.SOURCE_REMOVE;
                    this._intellihideHidden = true;
                    this._syncDockVisibility();
                    this._log('intellihide: hidden after leave delay');
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }

    _handleIntellihideHoverMode1(x, y) {
        for (const [monitorIdx] of this._docks) {
            const isOnDock = this._isPointerOnDockArea(x, y, monitorIdx);
            const hidden = this._intellihideHiddenByMonitor.get(monitorIdx) ?? false;

            if (isOnDock && hidden) {
                this._log(`intellihide mode1: revealing dock on monitor ${monitorIdx}`);
                this._intellihideHiddenByMonitor.set(monitorIdx, false);
            } else if (!isOnDock && !hidden) {
                if (this._isAnyMaximizedOnDockMonitor(monitorIdx)) {
                    this._log(`intellihide mode1: hiding dock on monitor ${monitorIdx}`);
                    this._intellihideHiddenByMonitor.set(monitorIdx, true);
                }
            }
        }
        this._syncDockVisibility();
    }

    _switchMonitor(monitorIdx, immediate = false) {
        if (this._dockMode !== 0)
            return;
        if (!this._isValidMonitor(monitorIdx) || monitorIdx === this._currentMonitor)
            return;

        const prevMonitor = this._currentMonitor;
        this._currentMonitor = monitorIdx;
        this._pendingMonitor = monitorIdx;
        this._pendingSince = GLib.get_monotonic_time();
        this._lastSwitchUs = this._pendingSince;
        this._setPreferredMonitor(monitorIdx);

        const dock = this._docks.get(prevMonitor);
        if (dock) {
            this._docks.delete(prevMonitor);
            this._docks.set(monitorIdx, dock);
            dock._monitorIndex = monitorIdx;
            dock._pendingAnimate = !immediate;
            dock.reposition(this._configSnapshot());
        } else {
            this._rebuildDocks();
        }

        this._reevalIntellihide();
        this._log(`dock → monitor ${monitorIdx}${immediate ? ' [fast]' : ''}`);
    }

    _reevalIntellihide() {
        if (!this._intellihideEnabled)
            return;
        const maximized = this._isAnyMaximizedOnDockMonitor();
        if (maximized && !this._intellihideHidden && !this._intellihideHoverActive) {
            this._intellihideHidden = true;
            this._syncDockVisibility();
            this._log('intellihide: hidden (switched to monitor with maximized)');
        } else if (!maximized && this._intellihideHidden) {
            this._intellihideHidden = false;
            this._intellihideHiddenByMonitor = new Map();
            this._intellihideHoverActive = false;
            this._syncDockVisibility();
            this._log('intellihide: shown (switched to monitor without maximized)');
        }
    }

    _initialMonitor() {
        if (this._dockMode === 2) {
            const primary = Main.layoutManager.primaryIndex;
            return this._isValidMonitor(primary) ? primary : 0;
        }

        const fromSettings = this._monitorFromPreferredSetting();
        if (this._isValidMonitor(fromSettings))
            return fromSettings;

        const pointerMonitor = this._getMonitorAt(...global.get_pointer());
        if (this._isValidMonitor(pointerMonitor))
            return pointerMonitor;

        const primary = Main.layoutManager.primaryIndex;
        if (this._isValidMonitor(primary))
            return primary;

        return 0;
    }

    _monitorFromPreferredSetting() {
        return this._clampInt(this._getInt('preferred-monitor', 0), 0, Math.max(0, (Main.layoutManager.monitors?.length ?? 1) - 1));
    }

    _setPreferredMonitor(monitorIdx) {
        try {
            if (this._settings.get_int('preferred-monitor') !== monitorIdx)
                this._settings.set_int('preferred-monitor', monitorIdx);
        } catch (e) {
            this._warn(`failed to persist preferred monitor: ${e.message}`);
        }
    }

    _getMonitorAt(x, y) {
        const monitors = Main.layoutManager.monitors ?? [];

        for (let i = 0; i < monitors.length; i++) {
            const m = monitors[i];
            if (!this._isMonitorUsable(m))
                continue;

            if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
                return i;
        }
        return -1;
    }

    _resetPending() {
        this._pendingMonitor = this._currentMonitor;
        this._pendingSince = GLib.get_monotonic_time();
    }

    _isFastEdgePush(x, y, monitorIdx, nowUs) {
        if (!this._isValidMonitor(monitorIdx) || monitorIdx === this._currentMonitor)
            return false;

        const mon = Main.layoutManager.monitors[monitorIdx];
        if (!mon || !this._isTriggerEdge(x, y, mon))
            return false;

        if (!Number.isFinite(this._lastX) || !Number.isFinite(this._lastY) || !this._lastSampleUs)
            return false;

        const dtMs = (nowUs - this._lastSampleUs) / 1000;
        if (dtMs <= 0)
            return false;

        const speed = Math.hypot(x - this._lastX, y - this._lastY) / dtMs;
        return speed >= this._fastSpeedThreshold;
    }

    _isTriggerEdge(x, y, monitor) {
        if (!this._isMonitorUsable(monitor))
            return false;

        const onBottom = y >= monitor.y + monitor.height - this._edgePx && y < monitor.y + monitor.height;
        const onLeft = x >= monitor.x && x < monitor.x + this._edgePx;
        const onRight = x >= monitor.x + monitor.width - this._edgePx && x < monitor.x + monitor.width;
        const onTop = y >= monitor.y && y < monitor.y + this._edgePx;

        switch (this._dockLocation) {
        case 1: return onLeft;
        case 2: return onRight;
        case 3: return onTop;
        default: return onBottom;
        }
    }

    _isNearMonitorBoundary(fromIdx, toIdx, x, y) {
        const monitors = Main.layoutManager.monitors ?? [];
        const from = monitors[fromIdx];
        const to = monitors[toIdx];
        if (!from || !to)
            return false;

        const zone = this._edgePx;
        const fromRight = from.x + from.width;
        const fromBottom = from.y + from.height;
        const toRight = to.x + to.width;
        const toBottom = to.y + to.height;

        // Only check the shared edge between the two monitors
        if (Math.abs(fromRight - to.x) <= 2)
            return Math.abs(x - fromRight) <= zone || Math.abs(x - to.x) <= zone;
        if (Math.abs(toRight - from.x) <= 2)
            return Math.abs(x - from.x) <= zone || Math.abs(x - toRight) <= zone;
        if (Math.abs(fromBottom - to.y) <= 2)
            return Math.abs(y - fromBottom) <= zone || Math.abs(y - to.y) <= zone;
        if (Math.abs(toBottom - from.y) <= 2)
            return Math.abs(y - from.y) <= zone || Math.abs(y - toBottom) <= zone;

        return false;
    }

    _isValidMonitor(index) {
        const monitors = Main.layoutManager.monitors ?? [];
        return Number.isInteger(index) && index >= 0 && index < monitors.length && this._isMonitorUsable(monitors[index]);
    }

    _isMonitorUsable(monitor) {
        return monitor && Number.isFinite(monitor.x) && Number.isFinite(monitor.y) &&
            Number.isFinite(monitor.width) && Number.isFinite(monitor.height) &&
            monitor.width > 0 && monitor.height > 0;
    }

    _configSnapshot() {
        return {
            dockLocation: this._dockLocation,
            dockMode: this._dockMode,
            iconSize: this._iconSize,
            showAppsIcon: this._showAppsIcon,
            activeDotColor: this._activeDotColor,
            edgeMargin: this._edgeMargin,
            edgeMarginVertical: this._edgeMarginVertical,
            backgroundPreset: this._backgroundPreset,
            backgroundColor: this._backgroundColor,
            backgroundOpacity: this._backgroundOpacity,
            backgroundPadding: this._backgroundPadding,
            backgroundBorderRadius: this._backgroundBorderRadius,
            labelBackground: this._labelBackground,
            labelBorderRadius: this._labelBorderRadius,
        };
    }

    _getFavoriteAppIds() {
        try {
            const shellSettings = new Gio.Settings({ schema_id: 'org.gnome.shell' });
            return shellSettings.get_strv('favorite-apps') ?? [];
        } catch (_e) {
            return [];
        }
    }

    _getString(key, fallback) {
        try {
            const value = this._settings.get_string(key);
            return value || fallback;
        } catch (_e) {
            return fallback;
        }
    }

    _getBoolean(key, fallback) {
        try {
            return this._settings.get_boolean(key);
        } catch (_e) {
            return fallback;
        }
    }

    _getDouble(key, fallback) {
        try {
            return this._settings.get_double(key);
        } catch (_e) {
            return fallback;
        }
    }

    _getInt(key, fallback) {
        try {
            return this._settings.get_int(key);
        } catch (_e) {
            return fallback;
        }
    }

    _clampInt(value, min, max) {
        if (!Number.isInteger(value))
            return min;
        return Math.max(min, Math.min(max, value));
    }

    _log(message) {
        if (this._debug)
            console.log(`[NativeDockFollowMouse] ${message}`);
    }

    _warn(message) {
        console.warn(`[NativeDockFollowMouse] ${message}`);
    }
}
