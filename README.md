# Native Dock Follow Mouse

<p align="center">
  <strong>Standalone GNOME Shell dock that follows your mouse across monitors.</strong>
  <br>
  <strong>跟随鼠标跨显示器移动的独立 GNOME Shell Dock。</strong>
  <br>
  No Dash2Dock Animated, Dash to Dock, or Ubuntu Dock dependency.
  <br>
  Works with GNOME Shell 45–48.
</p>

---

## Features / 功能

| Mode / 模式 | Description / 说明 |
|------|-------------|
| **Follow Mouse** (0) | Dock moves to whichever monitor the mouse is on / Dock 跟随鼠标所在显示器 |
| **Fixed** (1) | Dock stays on current monitor, no mouse tracking / Dock 固定不动，不跟踪鼠标 |
| **Primary Only** (2) | Dock only on primary monitor / Dock 只显示在主显示器 |

### Intellihide / 智能隐藏

- Auto-hides when a maximized window overlaps the dock area / 最大化窗口覆盖 Dock 时自动隐藏
- Hover near the dock edge to reveal / 鼠标悬停 Dock 边缘重新显现
- Configurable reveal/hide delay / 可配置显现/隐藏延迟

### Appearance / 外观

- **Icon size** / 图标大小 — Customizable (default 42px) / 可自定义
- **Background** / 背景 — 4 presets: Native dark, Light translucent, Transparent, Custom color / 4 种预设
- **Border radius** / 圆角 — Configurable corner radius / 可配置
- **Padding** / 内边距 — Configurable spacing inside background / 可配置
- **Active dot color** / 运行中高亮点颜色 — Customizable indicator color / 可自定义
- **Icon spacing** / 图标间距 — Gap between icons / 图标间的间距

### Screen Edge / 屏幕边缘

- **Edge margin** / 边缘间距 — Distance from screen edge (top/bottom and left/right) / Dock 离屏幕边缘的距离
- **Fullscreen reveal** / 全屏显现 — Move cursor to screen edge to reveal dock / 鼠标移到屏幕边缘临时显现 Dock
- **Edge reveal timeout** / 显现超时 — Configurable duration / 可配置保留时间

### Layout / 布局方向

- **Horizontal** / 横向 — Dock at bottom or top / 屏幕底部或顶部
- **Vertical** / 纵向 — Dock at left or right edge / 屏幕左侧或右侧

---

## Installation / 安装

### From a release zip / 从发布包安装

```bash
# Download the latest zip from Releases page
# 从 Release 页面下载最新 zip

mkdir -p ~/.local/share/gnome-shell/extensions/
unzip native-dock-follow-mouse-v1.0.zip -d ~/.local/share/gnome-shell/extensions/

# Restart GNOME Shell (X11: Alt+F2 → r → Enter; Wayland: log out and log back in)
# 重启 Shell（X11: Alt+F2 → r → Enter；Wayland: 注销重新登录）

# Enable the extension / 启用扩展
gnome-extensions enable native-dock-follow-mouse@neoshui
```

### From source / 从源码安装

```bash
git clone https://github.com/neoshui/native-dock-follow-mouse.git
cd native-dock-follow-mouse
mkdir -p ~/.local/share/gnome-shell/extensions/native-dock-follow-mouse@neoshui
cp -r * ~/.local/share/gnome-shell/extensions/native-dock-follow-mouse@neoshui/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/native-dock-follow-mouse@neoshui/schemas/
# Restart GNOME Shell (X11: Alt+F2 → r → Enter; Wayland: log out and log back in)
# 重启 Shell（X11: Alt+F2 → r → Enter；Wayland: 注销重新登录）
```

---

## Configuration / 配置

Open **GNOME Extensions** app (`gnome-extensions-app`) or use `gsettings`:

```bash
# List all settings / 查看所有设置
gsettings list-keys org.gnome.shell.extensions.native-dock-follow-mouse

# Icon size / 图标大小
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse follow-mouse-icon-size 48

# Dock mode / Dock 模式 (0=follow, 1=fixed, 2=primary)
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse dock-mode 0

# Dock location / Dock 位置 (0=bottom/底部, 1=left/左侧, 2=right/右侧, 3=top/顶部)
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse dock-location 0

# Edge margin from screen edge (pixels) / 屏幕边缘间距（像素）
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse dock-edge-margin 8

# Enable intellihide / 启用智能隐藏
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse intellihide-enabled true

# Background preset / 背景预设 (0=native dark, 1=light, 2=transparent, 3=custom)
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse background-preset 3

# Custom background color / 自定义背景色
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse background-custom-color '#38383b'

# Debug logging / 调试日志
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse follow-mouse-debug true
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## How It Works / 工作原理

This extension directly captures GNOME Shell's native `Dash` actor from the overview and places it on the desktop chrome. Unlike other dock extensions, it does **not** replace or sidestep the native dash — it reuses the same actors, layouts, and icon logic.

本扩展直接从概览中捕获 GNOME Shell 的原生 `Dash` actor，将其放置到桌面 chrome 层。与其他 Dock 扩展不同，它**不替换**原生 Dash，而是复用其所有 actor、布局和图标逻辑。

Key technical details / 关键技术细节：

- The native `dash.js` `_redisplay` and `_queueRedisplay` methods are wrapped / 包装原生 `_redisplay` 和 `_queueRedisplay` 方法
- The built-in `_adjustIconSize` is intercepted to prevent auto-sizing override / 拦截 `_adjustIconSize` 防止自动缩放覆盖
- Dock positioning, visibility, intellihide, and monitor-switching are handled by a polling loop (every 200ms by default) / 轮询循环处理定位、可见性、智能隐藏和显示器切换
- Vertical (left/right) layout is implemented by switching the box layout orientation / 纵向布局通过切换盒布局方向实现

---

## Known Issues / 已知问题

### 1. App icon appears with a flash (horizontal layout) / 横向布局出现图标闪烁

When a new app starts in **horizontal** (top/bottom) layout, the icon appears abruptly without smooth animation. Caused by disabling the native `_adjustIconSize` animation to preserve the user's configured icon size.

横向布局中新 App 启动时图标无动画直接闪烁。原因是禁用了原生 `_adjustIconSize` 动画以防止覆盖用户配置的图标大小。

### 2. Blank icons and tooltip mispositioning (vertical layout) / 纵向布局空白图标和提示错位

In **vertical** (left/right) layout, some icons may render blank and the hover tooltip appears in the wrong position. A fix is planned for a future release.

纵向布局中部分图标渲染为空白，悬停提示位置错误。计划后续版本修复。

---

## Development / 开发

```bash
# Compile schemas after editing XML / 修改 schema 后编译
glib-compile-schemas schemas/

# Reload extension / 重载扩展
# Restart GNOME Shell (X11: Alt+F2 → r → Enter; Wayland: log out and log back in)
# 重启 Shell（X11: Alt+F2 → r → Enter；Wayland: 注销重新登录）

# Debug log / 调试日志
gsettings set org.gnome.shell.extensions.native-dock-follow-mouse follow-mouse-debug true
journalctl -f -o cat /usr/bin/gnome-shell
```

---

## License / 许可证

[MIT](LICENSE)
