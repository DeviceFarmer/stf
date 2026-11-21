# Regenerating the DeviceFarmer logo

The master in `devicefarmer.svg` comes from the [DeviceFarmer website repository](https://github.com/DeviceFarmer/devicefarmer.github.io/blob/70236f766cb9eb528cf450736573d17f39e882d5/assets/logo_devicefarmer.svg).
The local copy normalizes line endings and trailing whitespace. See the accompanying [MIT license](DEVICEFARMER-LICENSE).

The generator keeps the complete logo for the 88 px sign-in image. It removes the two outlined wordmark paths for the 28 px header image, the SVG favicon, the 16/32 px ICO, and the 180 px Apple Touch Icon. The symbol stays centered on the original square plate. The 2× images render at 56 and 176 px directly from their SVG.

From the repository root, use the project's supported Node.js version and install the pinned renderer in a temporary directory.

```sh
stf_logo_tools=$(mktemp -d)
npm install --prefix "$stf_logo_tools" --no-package-lock --no-save sharp@0.35.5
node tools/generate-stf-logo.mts --sharp "$stf_logo_tools/node_modules/sharp"
```

Pass `--output /path/to/directory` to write the generated SVG and `exports/` outside the working tree.
