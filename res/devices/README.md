# Device catalogue artwork

This directory contains original, generated model-representative illustrations,
created with the built-in imagegen tool on 2026-10-16/17. They are not manufacturer
photographs or screenshots from connected phones. Wallpapers are illustrative;
the artwork is intended for identifying devices, not measuring their hardware.
The prompts and final background-extraction instructions are in `prompts.json`.
It retains the original front-reference prompts used to create the active pairs.
These project assets are supplied under the repository's Apache-2.0 license.
The separate legacy device-db assets retain their existing license and notices.

| Model | Hardware identifiers | Asset |
| --- | --- | --- |
| iPhone 16 Plus | Apple / iOS / iPhone17,4 | iphone-16-plus-v2.webp |
| iPhone 13 Pro | Apple / iOS / iPhone14,2 | iphone-13-pro-v2.webp |
| iPhone 14 Plus | Apple / iOS / iPhone14,8 | iphone-14-plus-v2.webp |
| Galaxy A55 5G | Samsung / Android / SM-A556E | galaxy-a55-v2.webp |
| Galaxy Z Fold4 (closed) | Samsung / Android / SM-F936B | galaxy-z-fold4-v2.webp |
| Mi A2 | Xiaomi / Android / Mi A2 | mi-a2-v2.webp |
| Redmi Note 13 | Xiaomi or Redmi / Android / 23124RA7EO; product sapphiren | redmi-note-13-v2.webp |
| Huawei nova 12i | Huawei / Android / CTR-L81; product HWCTRN-Q | huawei-nova-12i-v2.webp |

Regional variants are added explicitly; the resolver does not guess a nearby
model from a partial identifier. Both A55 variants use the same artwork.
Finishes are representative model defaults (gold 13 Pro, black 14 Plus/16 Plus),
not automatic per-unit color detection.

Each illustration pairs the front on the left with the rear on the right at
all three sizes. Cards use a 104 px photo area; table/toolbar icons reserve
36 × 24 CSS pixels. The transparent background supports light and dark themes.

## Serving and maintenance

`lib/util/device-catalog.ts` resolves these entries before the legacy device-db.
It sets the presentation name and image without replacing hardware identifiers,
measured CPU/RAM or display dimensions. Unknown devices use the transparent
`generic-phone-v1.svg`; existing legacy/custom images are retained.

The app serves this directory first at `/static/app/devices`, then falls through
to the legacy package. The API and WebSocket services must run the catalogue
revision as well as the app so initial lists and live updates agree. No remote
image host is contacted at runtime.

Each WebP preserves alpha and is stored at three resolutions: `icon/x24` (48 px
canvas height), `icon/x120` (240 px) and `photo/x800` (800 px). The smaller two
support high-density screens. The SVG generic is shared at all three paths.
The filenames are versioned because static responses are cached for 30 days.
On artwork changes, increment the filename version and update the catalogue.

For a new model, add exact manufacturer/platform/model or explicit product
aliases, all three image sizes and provenance/prompt information. Run the unit
and component suites, check the packed npm artifact includes the assets, and
inspect the image on both light and dark backgrounds. A failed image request
falls back through the shared `DeviceImage` component.
