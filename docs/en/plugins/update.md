# Plugin updates

Publish updates through `@updateUrl`. The host checks the remote script's `@version` and shows an update on the plugin card. The user chooses when to install it.

## Update metadata

```js
/**
 * @name Example
 * @id you.example
 * @version 1.1.0
 * @updateUrl https://example.com/plugins/example.js
 * @changelog Fix connection issues\nAdd track menu
 */
```

| Field        | Description                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `@updateUrl` | Stable HTTPS URL for the latest raw `.js` file; local testing allows `http://localhost` or `http://127.0.0.1` |
| `@version`   | Numeric dotted version, increased for each release                                                            |
| `@changelog` | New release notes; use literal `\n` for line breaks                                                           |

Updates require no plugin method call or additional permission. These fields describe a plugin's releases; host capability changes are recorded in [Plugin API Levels](/en/plugins/changelog).

## Checking and installing

Checks run at application startup and can be triggered from the plugin card. Plugins without `@updateUrl` are not checked. Release notes come from the remote script.

Installing an update replaces and reloads the plugin while preserving enabled state, permission choices, settings, private storage, and priority. Keep `@id` unchanged; when `@id` is omitted, keep the name unchanged too.

Re-importing a script with the same ID also replaces the installed version.

LX script update alerts are described in [LX Compatibility](/en/plugins/lx#update-alert).
