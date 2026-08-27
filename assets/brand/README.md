# Brand assets

The Ego mark is a white ring with a filled center dot. Source files came from the icon set in
`files.zip`; the numbered PNGs below were resampled from the 1024 masters with Lanczos.

The desktop app uses the dark variant: white ring and dot on black.

## Source files

| File | Use |
| --- | --- |
| `ego-mark.svg` | Ring and dot only, no background. Uses `currentColor`, so it inherits the surrounding text color. Best for inline UI. |
| `ego-icon-dark.svg` | White on black, square. What the desktop app ships. |
| `ego-icon-light.svg` | Black on white, square. |
| `ego-icon-rounded.svg` | Black on white with a 229px corner radius (22.4%, matching the iOS squircle ratio). |
| `ego-favicon.svg` | Rounded square that flips with `prefers-color-scheme`. Drop-in favicon for web. |
| `ego-maskable-512.png` | PWA maskable icon. Has the safe-zone padding Android needs before it crops. |
| `ego-apple-touch-180.png` | iOS home screen. Reference as `apple-touch-icon`. |

## Generated sizes

`ego-icon-dark-{16,32,48,64,128,192,256,512,1024}.png` and `ego-icon-light-{192,512,1024}.png`.

192 and 512 are the two sizes a web app manifest wants. 16 through 256 cover Windows and favicons.

## Desktop app icons

`resources/app-icon.png` (512px) and `resources/app-icon.ico` (16 through 256 in one file) are
generated from `ego-icon-dark-1024.png`. `src/renderer/app-icon.png` (256px) is the same image, imported
by the title bar. Regenerate them if the mark ever changes.
