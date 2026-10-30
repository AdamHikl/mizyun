# Mizyun App Store screenshots

Updated 2026-10-26 from the eight iPhone captures in `captured/` (addressing #136; BETA badges removed).

## Upload

App Store Connect supports both **iPhone 6.3-inch** and **iPhone 6.9-inch** display sets:

- **iPhone 6.3" Display** (iPhone 16 Pro): Upload the **eight PNG files inside `iphone-6.3/`** (`1206 × 2622 px`, RGB PNG, no alpha). Transfer zip: `mizyun-app-store-iphone-6.3.zip`.
- **iPhone 6.9" Display** (iPhone 16 Pro Max): Upload the **eight PNG files inside `iphone-6.9/`** (`1320 × 2868 px`, RGB PNG, no alpha). Transfer zip: `mizyun-app-store-iphone-6.9.zip`.

Each final file was checked using `sips -g pixelWidth -g pixelHeight -g format -g space -g hasAlpha`. Output uses sRGB for compatibility. `preview.png` is an overview strip for review, not an upload asset.

## Order and original captures

| Order | File                         | Original       | Headline                                    |
| ----- | ---------------------------- | -------------- | ------------------------------------------- |
| 1     | `01-your-day.png`            | `IMG_4500.PNG` | Your day. In one place.                     |
| 2     | `02-photo-meal-logging.png`  | `IMG_4503.PNG` | Snap your meal. See the details.            |
| 3     | `03-workout-tracking.png`    | `IMG_4506.PNG` | Every set. Every rep.                       |
| 4     | `04-ai-coach.png`            | `IMG_4508.PNG` | Plan your training with AI Coach.           |
| 5     | `05-meal-history.png`        | `IMG_4502.PNG` | Your meals. Made easy to track.             |
| 6     | `06-workout-routines.png`    | `IMG_4501.PNG` | Build a routine. Make it yours.             |
| 7     | `07-review-nutrition.png`    | `IMG_4505.PNG` | Review your macros. Before you log.         |
| 8     | `08-bouldering-progress.png` | `IMG_4507.PNG` | Track your climbs. Every grade. Every send. |

## Content notes

The app UI is inserted directly from the original captures, scaled uniformly, with only the outer corners masked to fit the rounded frame. Text, values, personalisation, badges, status bars, and feature states were not rewritten or generated. Original files are untouched.

These captures do not contain BETA badges, satisfying the replacement requirement noted in #136. Check that this is the public content you intend to show and that the screenshots match the submitted release. Do not treat export validation as approval of a beta app for public distribution. Any required iPad screenshots must be captured separately on iPad; this is an iPhone set.

## Reproduction

`source/export.swift` uses native macOS graphics to draw the shared frame/background, insert the original screenshots, typeset exact headlines, and export opaque PNGs for both 6.3" and 6.9" display sizes.

From the repository root:

```sh
CLANG_MODULE_CACHE_PATH=/tmp/mizyun-screenshot-clang-cache xcrun swift -module-cache-path /tmp/mizyun-screenshot-swift-cache screenshots/app-store/source/export.swift
```

This regenerates both output sets and `preview.png`. No application code, remote services, or store listing was modified. Full application tests were not run for this standalone artwork task.

## Apple sources checked 2026-09-14

- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications): accepted 6.9-inch dimensions, 1–10 PNG/JPEG files, no alpha/transparency. A 6.5-inch set is required when a 6.9-inch set is not supplied.
- [Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots): uploading and device-size management.
- [App Review Guidelines, accurate metadata](https://developer.apple.com/app-store/review/guidelines/#accurate-metadata): show the app in use; text and image overlays are permitted. Match the submitted app and represent features accurately.

A helper agent independently verified the Apple requirements and reviewed the output artwork.
