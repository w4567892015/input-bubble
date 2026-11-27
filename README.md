# Input Bubble

A tiny, macOS-style bubble that pops up next to your mouse pointer whenever you
switch input source, toggle Chewing (新酷音) 中/英 mode, or press Caps Lock.

| Event | Bubble |
| --- | --- |
| Switch to English (`us`) / Chewing English mode | `A` |
| Switch to Chewing / Chewing Chinese mode | `注` |
| Caps Lock on | ⇪ (drawn icon) |
| Caps Lock off | current input mode |
| Other input sources | their short name (e.g. `JA`, `FR`) |

## Features

- Small rounded bubble with a soft "pop" fade-in animation
- Stays visible while you hold the switching keys (Shift / Ctrl / Alt / Super),
  then fades out shortly after release
- Hides as soon as you start typing
- Follows the system light / dark color scheme (`org.gnome.desktop.interface color-scheme`)
- Stays on screen near monitor edges, multi-monitor aware

## Requirements

- GNOME Shell 42
- IBus (for Chewing 中/英 mode detection)

## Install

### From a release zip

Download `input-bubble@w4567892015.shell-extension.zip` from the
[Releases](https://github.com/w4567892015/input-bubble/releases) page, then:

```sh
gnome-extensions install --force input-bubble@w4567892015.shell-extension.zip
```

Restart GNOME Shell (see below), then enable it:

```sh
gnome-extensions enable input-bubble@w4567892015
```

### From source

```sh
git clone https://github.com/w4567892015/input-bubble.git \
  ~/.local/share/gnome-shell/extensions/input-bubble@w4567892015
gnome-extensions enable input-bubble@w4567892015
```

Then restart GNOME Shell (X11: <kbd>Alt</kbd>+<kbd>F2</kbd>, `r`, <kbd>Enter</kbd>;
Wayland: log out and back in).

## Customize

Tweak the constants at the top of `extension.js`:

| Constant | Default | Meaning |
| --- | --- | --- |
| `DISPLAY_DURATION_MS` | `450` | How long the bubble lingers after keys are released |
| `FADE_IN_MS` / `FADE_OUT_MS` | `240` / `200` | Animation durations |
| `POINTER_OFFSET_X` / `POINTER_OFFSET_Y` | `10` / `14` | Offset from the mouse pointer |
| `LABEL_MAP` | — | Text shown for each input source / mode |

Colors, size and fonts live in `stylesheet.css`.

## Build the release zip

```sh
./pack.sh
```

Produces `input-bubble@w4567892015.shell-extension.zip`.

## Releasing

Bump `version` in `metadata.json`, commit, then push a matching tag:

```sh
git tag v2 && git push origin v2
```

The [Release workflow](.github/workflows/release.yml) builds the zip and
publishes a GitHub release with it attached. The tag must equal
`v<version>` or the workflow fails.

This extension is not published on extensions.gnome.org; it is distributed
only through this repository.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
