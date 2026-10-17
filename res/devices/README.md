# Device catalogue artwork

This directory contains original, generated model-representative illustrations,
created with the built-in imagegen tool on 2026-10-16/17. They are not manufacturer
photographs or screenshots from connected phones. Wallpapers are illustrative;
the artwork is intended for identifying devices, not measuring their hardware.
The prompts and final background-extraction instructions are in `prompts.json`.
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

The nova 12i identity was confirmed by the owner of the connected device.
Both A55 phones use the same model asset. Regional variants are added explicitly;
the resolver does not guess a nearby model from a partial identifier.
The owner confirmed a gold 13 Pro and black 14 Plus/16 Plus; the new front
illustrations use those representative finishes. Colour is not yet selected
automatically, and these model assets do not assert the finish of every unit.

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

## Paired previews and colour — 2026-10-17

The active v2 illustrations pair the front on the left and the rear on the
right at **all three sizes**, including `icon/x24`, as a trial requested by the
owner. Cards keep their 104 px photo area; table and toolbar icons reserve
36 × 24 CSS pixels so both views remain visible. Transparent alpha is preserved
on both themes. v1 front-only assets remain available for an easy rollback.
The image colours are model defaults, not automatic per-unit detection. The
owner confirmed gold for 13 Pro and black for 14 Plus/16 Plus. The Huawei
colour was observed through its vendor properties; remaining Android finishes
are illustrative. `prompts.json` records each pair and its hardware references.

An actual targeted `DeviceEnclosureColor` lockdown query returned values absent
from the bulk go-ios information. The owner confirmed these exact finishes:

| Product type | DeviceColor | DeviceEnclosureColor | Confirmed body |
| --- | --- | --- | --- |
| iPhone14,2 (13 Pro) | 1 | 3 | Gold |
| iPhone14,8 (14 Plus) | 1 | 1 | Black |
| iPhone17,4 (16 Plus) | 1 | 1 | Black |

Use `(product type, enclosure code)` mappings; do not treat `DeviceColor` or
the enclosure code alone as a universal colour name. Colour queries need no Mac
runtime. Keep raw values/source and an unknown fallback; a manual per-device
override should take precedence over detected metadata. Software cannot identify
an aftermarket replacement housing or a case.

On the connected Android inventory, Huawei nova 12i reports
`ro.config.backcolor=black` and `ro.config.devicecolor=black`. Redmi Note 13 and
Galaxy A55 did not expose a useful body-colour property in the checked values;
Mi A2's `sys.panel.color` is not proof of its housing colour. Do not use display
colour-management properties as body colours. AOSP includes
[`ro.boot.hardware.color`](https://android.googlesource.com/platform/system/sepolicy/+/main/private/property_contexts),
but the checked phones do not supply it. Android therefore needs vendor-specific
readers plus manual selection where no verified value is available.
