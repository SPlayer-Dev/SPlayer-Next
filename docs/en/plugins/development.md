# Plugin Development

Plugins are distributed as single JavaScript files that call the injected `splayer` object. No Electron or Vue project setup is required.

## Your first plugin

Save the following as `track-log.js` and install it through **Settings → Plugin Management → Local import**. Switching tracks writes the track title to the application log.

```js
/**
 * @name Track log
 * @id you.track-log
 * @version 1.0.0
 * @description Log the current track
 * @apiLevel 2
 */
splayer.register({ events: ["trackChange"] });
splayer.player.on("trackChange", ({ track }) => {
  if (track) splayer.log.info(track.title);
});
```

Re-import the file after editing to update the plugin. Keep `@id` unchanged and increase `@version` for each release.

## Choosing capabilities

One plugin can provide sources, subscribe to playback events, control playback, declare settings, and add menus. Select APIs by function.

| Guide                                      | Purpose                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| [Overview and Architecture](/en/plugins/)  | Manifest, runtime, lifecycle, permissions, and debugging                |
| [Plugin API Levels](/en/plugins/changelog) | Choose `@apiLevel` and review API evolution                             |
| [Common APIs](/en/plugins/api)             | Search, platform APIs, network, storage, settings, and menus            |
| [Source Resolution](/en/plugins/source)    | Independent catalog search, playback URLs, lyrics, covers, and comments |
| [Playback Control](/en/plugins/control)    | Subscribe to events and control playback, queues, and modes             |
| [Plugin Updates](/en/plugins/update)       | Publish releases and update URLs                                        |
| [LX Compatibility](/en/plugins/lx)         | Integrate existing LX scripts                                           |
| [Type Reference](/en/types)                | Track, artist, lyric, and comment structures                            |

Set `@apiLevel` to the minimum level required by the methods you use. Each method documents its API version and permissions. Declare required permissions through `@grant` in the script header.

## Development workflow

### Writing the script

Declare plugin metadata, then register capabilities and handlers. Keep network requests and search asynchronous. Record results and errors with `splayer.log`. See [Runtime](/en/plugins/#runtime) for the script environment.

### Local verification

Import the script and confirm its state is Ready before triggering its behavior. Switch tracks or pause playback to check events; play a supported source to check resolution; use the plugin card and track menus to check settings and menu actions.

For an independent source, start from the [complete example](/en/plugins/source#quick-start). Verify search and pagination, playback and queue insertion, then queue recovery after restarting the app. Check lyrics and missing-cover resolution. Disabling the plugin should keep queued tracks and report that the source is unavailable.

Logs are stored under `{userData}/app-data/logs/`. Check arguments, permissions, and business responses when a call fails. See [Debugging](/en/plugins/#debugging).

### Publishing updates

Keep the plugin ID stable, provide a script URL with `@updateUrl`, and update the version and release notes. See [Publishing](/en/plugins/#publishing) for submitting to the market.

## Agent assistance

### Providing context

Have your Agent read the documentation before generating or modifying a plugin. Give it these links:

- [Documentation index](/llms.txt): Choose Markdown references by topic.
- [Full documentation](/llms-full.txt): The full Markdown documentation bundle.

These resources are generated from the English Markdown sources on every documentation build.

### Describing requirements

Specify behavior, triggers, settings, and any services the plugin needs. For example:

```text
Read https://splayer-next.imsyy.top/llms.txt and the relevant documentation,
then develop a SPlayer-Next plugin.

Behavior: Log the title on track changes, with a plugin setting to disable logging.
Plugin ID: you.track-log
Deliverables: One importable .js file and local verification steps.

Choose API levels and permissions from the current documentation.
Use the existing Track structure.
```
