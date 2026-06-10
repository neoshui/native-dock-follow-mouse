# Native Dock Follow Mouse

<p align="center">
  <strong>A standalone GNOME Shell dock that follows your mouse across monitors.</strong>
  <br>
  No Dash2Dock Animated, Dash to Dock, or Ubuntu Dock dependency.
  <br>
  Works with GNOME Shell 45–48.
</p>

---

## Features

| Mode | Description |
|------|-------------|
| **Follow Mouse** (mode 0) | Dock moves to whichever monitor the mouse pointer is on |
| **Fixed** (mode 1) | Dock stays on the current monitor, no mouse tracking |
| **Primary Only** (mode 2) | Dock only appears on the primary monitor |

### Intellihide

- Auto-hides when a maximized window overlaps the dock area
- Hover near the dock edge to reveal
- Configurable hover reveal delay and hide-after-leave delay

### Appearance

- **Icon size** — Customizable (default: 42px)
- **Background** — 4 presets: Native dark, Light translucent, Transparent, Custom color
- **Border radius** — Configurable background corner radius
- **Padding** — Configurable spacing inside the background
- **Active dot color** — Customize the running-app indicator color
- **Icon spacing** — Gap between app icons

### Screen Edge

- **Edge margin** — Distance from the screen edge (top/bottom and left/right)
- **Fullscreen reveal** — Move cursor to the screen edge to temporarily reveal the dock
- **Edge reveal timeout** — How long the dock stays visible during fullscreen (configurable)

### Layout

- **Horizontal** — Dock at bottom or top of the screen
- **Vertical** — Dock at left or right edge

---

## Installation

### From a release zip

```bash
# 1. Download the latest release zip
# 2. Extract to GNOME Shell extensions directory
mkdir -p ~/.local/share/gnome-shell/extensions/
unzip native-dock-follow-mouse-v1.0.zip -d ~/.local/share/gnome-shell/extensions/

# 3. Restart GNOME Shell (Alt+F2 → type 'r' → Enter)
# 4. Enable the extension via gnome-extensions-app or:
gnome-extensions enable native-dock-follow-mouse@neoshui
```

### From source

```bash
git clone https://github.com/neoshui/native-dock-follow-mouse.git
cd native-dock-follow-mouse
mkdir -p ~/.local/share/gnome-shell/extensions/native-dock-follow-mouse@neoshui
cp -r * ~/.local/share/gnome-shell/extensions/native-dock-follow-mouse@neoshui/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/native-dock-follow-mouse@neoshui/schemas/
# Restart GNOME Shell (Alt+F2 → r)
```

---

## Configuration

All settings are available through **GNOME Extensions** (`gnome-extensions-app`) or via `gsettings`:

```bash
# List all settings
gsettings list-keys org.gnome.shell.extensions.native-dock-follow-mouse

# Change icon size
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse follow-mouse-icon-size 48

# Change dock mode (0=follow, 1=fixed, 2=primary)
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse dock-mode 0

# Dock location (0=bottom, 1=left, 2=right, 3=top)
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse dock-location 0

# Edge margin from screen edge (pixels)
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse dock-edge-margin 8

# Enable intellihide
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse intellihide-enabled true

# Background preset (0=native dark, 1=light, 2=transparent, 3=custom)
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse background-preset 3

# Custom background color
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse background-custom-color '#38383b'
```

---

## How It Works

This extension directly captures GNOME Shell's native `Dash` actor from the overview and places it on the desktop chrome. Unlike other dock extensions, it does **not** replace, fork, or sidestep the native dash — it reuses the same actors, layouts, and icon logic.

Key technical details:

- The native `dash.js` `_redisplay` and `_queueRedisplay` methods are wrapped to inject custom icon sizes and trigger repositioning
- The built-in `_adjustIconSize` is intercepted so auto-sizing doesn't override the user's configured icon size
- Dock positioning, visibility, intellihide, and monitor-switching are handled by a polling loop (every 200ms by default)
- Vertical (left/right) layout support is implemented by switching the dash's box layout orientation and recalculating dimensions

---

## Known Issues

### 1. App icon appears with a flash (horizontal layout)

When a new app starts in **horizontal** (top/bottom) layout, the icon appears abruptly instead of with a smooth animation. This is because the native `_adjustIconSize` animation logic was disabled to prevent it from overriding the user's configured icon size.

**Workaround:** None at this time. The icon appears at the correct size, just without animation.

### 2. Blank icons and tooltip mispositioning (vertical layout)

In **vertical** (left/right) layout:
- Some app icons may render as blank (icon actor is created but the texture doesn't load)
- The hover tooltip (app name label) appears in the wrong position

These are related to how `DashItemContainer` actors are traversed and resized in vertical orientation.

**Workaround:** Switching to horizontal layout avoids these issues. A fix for the vertical layout is planned for a future release.

---

## Development

```bash
# After making changes to schema XML
glib-compile-schemas schemas/

# Reload extension in GNOME Shell
# Alt+F2 → r → Enter
```

### Debug logging

```bash
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse follow-mouse-debug true
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## License

[MIT](LICENSE)
