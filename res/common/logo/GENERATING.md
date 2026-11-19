# Regenerating the STF logo

The restored logo uses the original STF letter outlines from `STF-lettering.svg`.
The generator defines the layout, palette, and the light sweep. It builds the editable light
master `STF-restored.svg`, the 16 px favicons, and the 28 and 88 px static and animated marks
for both themes. The 2× marks use the same logical layout and are rendered directly from the
vector at 56 and 176 px.

From the repository root, use the project's supported Node.js version and install the pinned
renderer in a temporary directory.

```sh
stf_logo_tools=$(mktemp -d)
npm install --prefix "$stf_logo_tools" --no-package-lock --no-save sharp@0.35.5
node tools/generate-stf-logo.mts --sharp "$stf_logo_tools/node_modules/sharp"
```

Pass `--output /path/to/directory` to write the SVG and `exports/restored/` outside the working tree.
