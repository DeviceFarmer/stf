# ADB Keys

By providing to STF your **Public ADB Key**, you will be able to use the any device at any time from `adb connect`, even without needing to open STF at all.

This is very useful for **automation tasks** (like running *functional tests over multiple Android devices*).

## Before starting

To be able to use the device locally you need to have installed the [Android SDK Tools](https://developer.android.com/sdk/index.html).


## Step 1: Check your ADB Key

```shell
ls ~/.android/adbkey.pub
```

It should list your **Public ADB Key**.

**Note:** If you have never runned `adb` on your computer, you may not have a `.android` directory. It will be created when you run any ADB command like `adb devices`.

## Step 2: Copy your ADB Key to the clipboard

Run this command to copy the key to your clipboard:

```shell
pbcopy < ~/.android/adbkey.pub
```

It should copy the contents of the `adbkey.pub` file to your clipboard.

**Note:** You can also use your text editor, by opening the `~/.android/adbkey.pub` file and copying the contents of the file.


## Step 3: Add your ADB Key to STF

Now that the key is in the clipboard, add it into STF:

1. Go to **Settings**.
2. Click the **Keys** tab.
3. In **ADB Keys**, Press the `+ (Add)` button.
4. In **Key**, paste the key and press **Enter**.

Now you should be able to use any device more freely in STF.
