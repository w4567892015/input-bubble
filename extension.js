/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Input Bubble — macOS-style input source indicator for GNOME Shell.
 *
 * - Appears next to the mouse pointer.
 * - Compact rounded bubble showing A / 注, or a drawn Caps Lock icon.
 * - Follows the system light/dark color scheme.
 * - Disappears when you start typing (caret moves) or after a short delay.
 */
const { Clutter, Gio, GLib, St } = imports.gi;
const Main = imports.ui.main;
const Keyboard = imports.ui.status.keyboard;
const IBusManager = imports.misc.ibusManager;

const DISPLAY_DURATION_MS = 450;  // how long it lingers after keys are released
const HOLD_POLL_MS = 40;          // while a modifier is held the bubble stays
const HOLD_MASK = Clutter.ModifierType.SHIFT_MASK |
    Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.MOD1_MASK |
    Clutter.ModifierType.MOD4_MASK |
    Clutter.ModifierType.SUPER_MASK;
const FADE_IN_MS = 240;
const FADE_OUT_MS = 200;
const POINTER_OFFSET_X = 10;
const POINTER_OFFSET_Y = 14;
const TYPING_GRACE_US = 250000; // ignore caret moves right after showing
const CAPS_GUARD_US = 300000;

const LABEL_MAP = {
    'us': 'A',
    'xkb:us::eng': 'A',
    'chewing': '注',
    'chewing:chi': '注',
    'chewing:eng': 'A',
};

class Extension {
    constructor() {
        this._bubble = null;
        this._capsIcon = null;
        this._label = null;
        this._hideTimeoutId = 0;
        this._signals = [];
        this._keymap = null;
        this._ifaceSettings = null;
        this._lastLangKey = null;
        this._currentText = 'A';
        this._lastCapsLock = false;
        this._lastCapsTimeUs = 0;
        this._caret = null;
        this._shownAtUs = 0;
    }

    _connect(obj, signal, handler) {
        const id = obj.connect(signal, handler);
        this._signals.push([obj, id]);
    }

    enable() {
        this._label = new St.Label({
            style_class: 'lcp-glyph',
            text: '',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        // Caps Lock icon is drawn with cairo so it doesn't depend on fonts
        this._capsIcon = new St.DrawingArea({
            style_class: 'lcp-caps-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            visible: false,
        });
        this._capsIcon.connect('repaint', this._drawCapsIcon.bind(this));
        this._bubble = new St.BoxLayout({
            style_class: 'lcp-bubble',
            reactive: false,
            visible: false,
        });
        this._bubble.add_child(this._label);
        this._bubble.add_child(this._capsIcon);
        this._bubble.set_pivot_point(0.5, 0.0);
        Main.uiGroup.add_child(this._bubble);

        // Light / dark theme
        this._ifaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._connect(this._ifaceSettings, 'changed::color-scheme', () => this._syncTheme());
        this._syncTheme();

        // IBus: Chewing chi/eng mode + caret location
        const ibus = IBusManager.getIBusManager();
        this._connect(ibus, 'property-updated', this._onPropertyUpdated.bind(this));
        this._connect(ibus, 'set-cursor-location', (_m, loc) => this._onCaretMoved(loc));
        this._connect(ibus, 'focus-out', () => {
            this._caret = null;
        });

        // Input source switching
        this._inputSourceManager = Keyboard.getInputSourceManager();
        this._connect(this._inputSourceManager, 'current-source-changed',
            this._onCurrentSourceChanged.bind(this));

        // Caps Lock
        const seat = Clutter.get_default_backend().get_default_seat();
        this._keymap = seat.get_keymap();
        this._lastCapsLock = this._keymap.get_caps_lock_state();
        this._connect(this._keymap, 'state-changed', this._onKeymapStateChanged.bind(this));

        const cur = this._inputSourceManager.currentSource;
        if (cur) {
            this._lastLangKey = `src:${cur.id}`;
            this._currentText = this._textForSource(cur);
        }
    }

    disable() {
        this._clearHideTimer();
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        if (this._bubble) {
            this._bubble.destroy();
            this._bubble = null;
        }
        this._capsIcon = null;
        this._label = null;
        this._keymap = null;
        this._ifaceSettings = null;
        this._inputSourceManager = null;
        this._lastLangKey = null;
        this._caret = null;
    }

    _syncTheme() {
        if (!this._bubble)
            return;
        const scheme = this._ifaceSettings.get_string('color-scheme');
        if (scheme === 'prefer-dark')
            this._bubble.add_style_class_name('lcp-dark');
        else
            this._bubble.remove_style_class_name('lcp-dark');
    }

    _clearHideTimer() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
    }

    _textForSource(src) {
        const id = src.id || '';
        return LABEL_MAP[id] ||
            (src.shortName ? src.shortName.toUpperCase() : id.toUpperCase());
    }

    // ---- caret tracking -------------------------------------------------

    _onCaretMoved(loc) {
        if (!loc)
            return;
        const prev = this._caret;
        this._caret = {
            x: loc.x, y: loc.y, w: loc.width, h: loc.height,
            window: global.display.focus_window,
        };

        // Like macOS: the indicator goes away once you start typing.
        if (this._bubble && this._bubble.visible && prev &&
            GLib.get_monotonic_time() - this._shownAtUs > TYPING_GRACE_US &&
            (Math.abs(prev.x - loc.x) > 1 || Math.abs(prev.y - loc.y) > 1))
            this._hide();
    }

    // ---- event handlers -------------------------------------------------

    _onKeymapStateChanged() {
        if (!this._keymap)
            return;
        const caps = this._keymap.get_caps_lock_state();
        if (caps === this._lastCapsLock)
            return;
        this._lastCapsLock = caps;
        this._lastCapsTimeUs = GLib.get_monotonic_time();

        if (caps)
            this._show('⇪', 'caps');
        else
            this._show(this._currentText, 'lang');
    }

    _onPropertyUpdated(_im, _engineName, prop) {
        if (!prop)
            return;
        if (GLib.get_monotonic_time() - this._lastCapsTimeUs < CAPS_GUARD_US)
            return;

        const propKey = prop.get_key ? prop.get_key() : '';
        const symbol = prop.get_symbol ? prop.get_symbol()?.get_text() : '';
        const label = prop.get_label ? prop.get_label()?.get_text() : '';
        const text = (symbol || label || '').trim();

        let nextKey = null;
        if (propKey === 'InputMode' ||
            propKey === 'chewing_chieng_prop' ||
            propKey.toLowerCase().includes('chieng')) {
            if (text.startsWith('中') || text.toLowerCase().includes('chi'))
                nextKey = 'chewing:chi';
            else if (text.startsWith('英') || text.toLowerCase().includes('eng'))
                nextKey = 'chewing:eng';
        }

        if (nextKey && nextKey !== this._lastLangKey) {
            this._lastLangKey = nextKey;
            this._currentText = LABEL_MAP[nextKey];
            this._show(this._currentText, 'lang');
        }
    }

    _onCurrentSourceChanged(_manager, oldSource) {
        const cur = this._inputSourceManager.currentSource;
        if (!cur || !oldSource)
            return;

        const nextKey = `src:${cur.id || ''}`;
        if (nextKey === this._lastLangKey)
            return;
        this._lastLangKey = nextKey;
        this._currentText = this._textForSource(cur);
        this._show(this._currentText, 'lang');
    }

    // ---- presentation ---------------------------------------------------

    _updatePosition() {
        const [, natW] = this._bubble.get_preferred_width(-1);
        const [, natH] = this._bubble.get_preferred_height(natW);

        const [ax, ay] = global.get_pointer();
        let posX = ax + POINTER_OFFSET_X;
        let posY = ay + POINTER_OFFSET_Y;
        const aboveY = ay - natH - 8;

        const monitor = Main.layoutManager.monitors.find(
            m => ax >= m.x && ax < m.x + m.width && ay >= m.y && ay < m.y + m.height
        ) || Main.layoutManager.primaryMonitor;

        let flippedUp = false;
        if (monitor) {
            const margin = 6;
            if (posY + natH > monitor.y + monitor.height - margin) {
                posY = aboveY;
                flippedUp = true;
            }
            posX = Math.max(monitor.x + margin,
                Math.min(posX, monitor.x + monitor.width - natW - margin));
        }
        this._bubble.set_pivot_point(0.5, flippedUp ? 1.0 : 0.0);
        this._bubble.set_position(Math.round(posX), Math.round(posY));
    }

    _show(text, kind) {
        if (!this._bubble || !text)
            return;

        this._clearHideTimer();
        this._bubble.remove_all_transitions();

        const isCaps = kind === 'caps';
        this._label.visible = !isCaps;
        this._capsIcon.visible = isCaps;
        if (isCaps)
            this._capsIcon.queue_repaint();
        else
            this._label.set_text(text);

        const wasVisible = this._bubble.visible && this._bubble.opacity > 0;
        if (!wasVisible) {
            // Set the start state *before* showing so no full-opacity frame slips out
            this._bubble.opacity = 0;
            this._bubble.scale_x = 0.6;
            this._bubble.scale_y = 0.6;
            this._bubble.translation_y = 4;
        }
        this._bubble.show();
        Main.uiGroup.set_child_above_sibling(this._bubble, null);
        this._updatePosition();
        this._shownAtUs = GLib.get_monotonic_time();

        // Smooth fade, with a small springy "pop" on the scale
        this._bubble.ease({
            opacity: 255,
            translation_y: 0,
            duration: FADE_IN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        this._bubble.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            duration: FADE_IN_MS + 60,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });

        // Stay while the switching keys (Shift / Ctrl / Alt / Super) are held,
        // then linger briefly after release.
        let releasedAtUs = 0;
        this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOLD_POLL_MS, () => {
            const [, , mods] = global.get_pointer();
            const now = GLib.get_monotonic_time();
            if (mods & HOLD_MASK) {
                releasedAtUs = 0;
                return GLib.SOURCE_CONTINUE;
            }
            if (!releasedAtUs)
                releasedAtUs = now;
            if (now - releasedAtUs < DISPLAY_DURATION_MS * 1000)
                return GLib.SOURCE_CONTINUE;
            this._hideTimeoutId = 0;
            this._hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _drawCapsIcon(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const color = area.get_theme_node().get_foreground_color();
        Clutter.cairo_set_source_color(cr, color);

        // Outlined up-arrow with a bar underneath (caps lock glyph)
        const s = Math.min(w, h);
        const ox = (w - s) / 2, oy = (h - s) / 2;
        const X = v => ox + v * s, Y = v => oy + v * s;
        cr.setLineWidth(Math.max(1.5, s * 0.09));
        cr.setLineJoin(1); // ROUND
        cr.moveTo(X(0.50), Y(0.06));
        cr.lineTo(X(0.92), Y(0.50));
        cr.lineTo(X(0.70), Y(0.50));
        cr.lineTo(X(0.70), Y(0.70));
        cr.lineTo(X(0.30), Y(0.70));
        cr.lineTo(X(0.30), Y(0.50));
        cr.lineTo(X(0.08), Y(0.50));
        cr.closePath();
        cr.stroke();
        cr.rectangle(X(0.30), Y(0.82), s * 0.40, s * 0.11);
        cr.fill();
        cr.$dispose();
    }

    _hide() {
        this._clearHideTimer();
        if (!this._bubble || !this._bubble.visible)
            return;
        this._bubble.ease({
            opacity: 0,
            scale_x: 0.96,
            scale_y: 0.96,
            translation_y: 3,
            duration: FADE_OUT_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this._bubble && this._bubble.opacity === 0)
                    this._bubble.hide();
            },
        });
    }
}

function init() {
    return new Extension();
}
