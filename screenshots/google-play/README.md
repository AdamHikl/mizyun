# Mizyun Google Play screenshots

Updated 2026-10-26 from the eight captures in `captured/` (addressing #136; BETA badges removed).

## Upload

Upload the **eight PNG files inside `phone-9x16/`**, in filename order, to the Google Play Console phone screenshot section. `mizyun-google-play-phone-screenshots.zip` is for transferring the set; unzip it before uploading the PNG files. `preview.png` is an overview for review, not an upload asset.

Each final file is **1440 × 2560 pixels (9:16), RGB PNG, with no alpha channel**. This satisfies Google Play's current phone-screenshot format, dimension, and aspect-ratio requirements and its recommendation for at least four 1080px-or-larger portrait screenshots.

### Feature graphic

Upload `feature-graphic.png` in the Google Play Console feature graphic field. It is an opaque **1024 × 500**, 24-bit sRGB PNG. The centered text and focal treatment stay away from cutoff-prone edges, use Mizyun's complementary blue and macro colors, and avoid device imagery, personal data, app-state claims, ranking language, store badges, and duplicated app-icon artwork.

Suggested alt text: `Mizyun feature graphic reading Nutrition. Training. Progress. Built around your goals on a blue background.`

## Order and captures

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

The app UI is inserted directly from the captures, scaled uniformly, with only the outer corners masked to fit the rounded phone frame. Text, values, personalisation, badges, status bars, and feature states were not rewritten or generated. Original files are untouched.

These captures do not contain BETA badges, satisfying the replacement requirement noted in #136. Confirm that this is the public content intended for the listing and that it matches the submitted Production release before uploading. This export does not prove Play Console acceptance or publication.

## Reproduction

From the repository root:

```sh
CLANG_MODULE_CACHE_PATH=/tmp/mizyun-google-play-clang-cache xcrun swift -module-cache-path /tmp/mizyun-google-play-swift-cache screenshots/google-play/source/export.swift
```

This regenerates the seven output PNGs and `preview.png`. It does not change application code, remote services, or the Play Console listing.

Regenerate the feature graphic separately:

```sh
CLANG_MODULE_CACHE_PATH=/tmp/mizyun-google-play-feature-clang-cache xcrun swift -module-cache-path /tmp/mizyun-google-play-feature-swift-cache screenshots/google-play/source/export-feature-graphic.swift
```

## Google source checked 2026-09-21

- [Add preview assets to showcase your app](https://support.google.com/googleplay/android-developer/answer/9866151): the feature graphic must be JPEG or 24-bit PNG without alpha at exactly 1024 × 500. Google recommends vibrant complementary branding, a centered focal point clear of cutoff zones, minimal detail, and no device imagery. Screenshots must be JPEG or 24-bit PNG without alpha, 320–3840px, with the long dimension no more than twice the short dimension. Google recommends at least four 9:16 portrait screenshots at 1080px or greater for apps, showing the actual in-app experience.
