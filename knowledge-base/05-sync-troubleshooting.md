# Desktop and Mobile Sync Troubleshooting

This guide helps when files do not appear on other devices, uploads stall, or the CloudNest app shows a sync error.

## First checks

1. Check the CloudNest status page or ask support whether there is an ongoing incident affecting sync.
2. Confirm the device is online and not on a metered connection; the mobile app pauses large uploads on cellular data by default.
3. Open the desktop app and confirm it says "Up to date" or shows a progress count. A paused icon means sync was paused manually or by battery saver.

## Files stuck uploading

Uploads can stall if a file is open in another program, if the file name contains characters that are not allowed (such as a trailing space or the characters < > : " | ? *), or if a single file is larger than the plan's maximum file size. Close the file, rename it if needed, and select "Retry" in the app's activity list.

## Changes not showing on another device

Sync usually completes within a minute. If changes are missing after 10 minutes, sign out of the desktop app and sign back in, which forces a full rescan. On mobile, pull down on the file list to refresh.

## Conflicted copies

If the same file is edited on two devices while one is offline, CloudNest keeps both versions. The second one is saved as "filename (conflicted copy, device name, date)". Nothing is overwritten; the customer can compare the two and delete the one they do not need.

## Account over quota

When storage use is above the plan limit, uploads and sync from devices to the cloud stop, while downloads continue to work. See Storage Limits and Quotas.

## Collecting logs for support

If the steps above do not help, open the desktop app and choose Help > Export diagnostics. Attach the resulting file to a support ticket so the technical team can investigate.
