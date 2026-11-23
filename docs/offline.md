# Offline and the installed app

cfnotes installs as an app, from the browser's install button or "Add to Home Screen" on iOS. It keeps working without a connection: pages can be read, and what's typed into them is saved when the connection is back.

## What works offline

- **Reading.** A page can be read offline if it was opened on this device, or if it's in the sidebar.
  - The sidebar's pages are fetched again in the background, at most every 6 hours.
  - Database rows can be read offline only if they've been opened.
  - Pages that weren't saved show an offline page, listing the ones that were. `/` opens the last page opened.
- **Writing text.** A page's text and its title can be changed offline.
  - The latest version of each is kept in IndexedDB, and the page says "Saved offline".
  - The edits are sent when the browser comes back online, gets focus or opens any page.
  - The page you have open re-sends its own edits, so text typed since isn't overwritten by the older queued copy.
- **Everything else needs a connection:** databases, comments, files, icons, moving and deleting pages. It fails with a "You're offline" notice.

When a queued edit reaches the server, it replaces what's there: last write wins. If the same page was changed on another device in the meantime, those changes are lost. There's no merging.

## Signing out

Sign-out first sends any queued edits. If they can't be sent yet, it refuses and asks you to connect first. Then it deletes every page saved on the device.

## Code

- `public/sw.js`: the service worker.
  - Pages are fetched from the network first, and the copy is used only when that fails, so nobody edits an old copy while online.
  - Uploaded images and hashed assets come from the cache first. Other scripts and styles come from the network first.
  - Writes aren't intercepted.
  - Bump `VERSION` to drop old caches.
- `public/manifest.webmanifest` and the icons in `public/`.
- `modules/offline/client/queue.ts`: wraps `fetch`. A save or title post that fails for want of a network is queued, and answered with `_offline: true`.
- `modules/offline/client/offline.ts`: registers the worker, shows the online and offline notices, asks for the sidebar's pages, and clears everything on sign-out.
- `modules/offline/queue.ts`: which requests are queued (pure, tested).
- `modules/pages/client/notes-editor.ts`: starts from the queued text when there is some.
