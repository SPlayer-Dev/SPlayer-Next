# Plugin Updates

SPlayer-Next uses **host version checks with user-approved installation**. A plugin declares `@updateUrl` pointing to the latest raw JavaScript. The host downloads the script, compares `@version`, and shows an update on the plugin card. Applying it replaces the script in place while preserving enabled state, settings, storage, and priority.

## Workflow

```text
declare @updateUrl + @version (+ @changelog)
  → host fetches the latest script and reads @version
  → newer version shows on the plugin card
  → user chooses Update
  → host replaces the script and restarts the plugin process
```

Checks run silently at application startup and can also be started from each plugin card. Updates are never installed automatically. Plugins without `@updateUrl` are not checked.

## Update metadata

```js
/**
 * @name      ClassIsland Integration
 * @id        imsyy.classisland
 * @version   1.1.0
 * @updateUrl https://raw.githubusercontent.com/you/repo/main/ClassIsland.js
 * @changelog Fix port collision crashes\nShow album names
 */
```

| Field        | Description                                                       |
| ------------ | ----------------------------------------------------------------- |
| `@updateUrl` | Stable HTTPS raw `.js` URL; localhost HTTP is allowed for testing |
| `@version`   | Numeric dotted version compared segment by segment                |
| `@changelog` | Notes shown from the newly fetched script; use literal `\n`       |

Point `@updateUrl` at a stable location such as a file on the repository's main branch. The changelog shown to users comes from the remote new script, not the installed copy.

## LX `updateAlert`

```js
lx.send(lx.EVENT_NAMES.updateAlert, {
  log: "Several issues fixed",
  updateUrl: "https://example.com/lx-source.js",
});
```

LX alerts do not include a version. If the URL is a web page rather than raw JavaScript, the app opens it and the user must download and import manually.

## Applying an update

The host downloads and validates the raw script, replaces the installed plugin, preserves its state and data, and restarts the plugin host.

::: warning Identity and type must remain stable
The new script must keep the same identity (`@id`, or an identity derived from `@name`) and `@type`. Change only `@version`, `@changelog`, and code. If identity or type changes, automatic update is rejected.
:::

On failure, the old plugin remains installed and usable. Re-importing a script with the same identity also replaces the existing plugin in place; update checks simply make new versions discoverable.
