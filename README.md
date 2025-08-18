# Jellyfin Remote PWA

A minimal, installable web app to control a Jellyfin playback session (e.g., Android client) using REST APIs.

## How to use
1. Host these static files on any web server (or run serve.py) on the same network as your Jellyfin server
2. Open the app in Safari, tap the share icon, and choose "Add to Home Screen" to install as a PWA on iPhone.
3. Enter your Jellyfin base URL (e.g., `http://10.0.0.5:8096` or `https://jellyfin.example.com`) and your API token.
   - The app sets the modern `Authorization: MediaBrowser ... Token="<token>"` header.
4. Enter your Android Bridge URL/IP and secret for bridge functionality
   - This requires the ([companion android app](https://github.com/xnstad/android-media-control-bridge))
5. Tap **Save**, and **Test Connection** to verify that you can reach your Jellyfin server. If successful, tap **Refresh** to list active, controllable sessions.
6. Pick your session, then use the controls (play/pause/seek/next/prev/stop, volume).
7. If you use a client that does not expose playback controls through Jellyfin, controls will not work. You could use the [android media control bridge app](https://github.com/xnstad/android-media-control-bridge) to control an android device as a workaround.
- Install the bridge on your Android phone, and enter your IP, shared secret, and toggle "use bridge for this session"

## Notes
- The PWA technically supports websockets, however there are still some bugs so currently it falls back to polling via the REST API.
- Settings are saved locally in the browser (localStorage).
- Service Worker provides basic offline caching of app shell assets.
- Volume, shuffle, etc. rely on the target Jellyfin client's support for those commands, if not using the Android media control bridge.

## Deploy
For a quick test, you can run a simple static server, e.g. with Python:
```
python serve.py
```
Then open `http://<your-computer-ip>:8081`.
