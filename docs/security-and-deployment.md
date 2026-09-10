# Keys, browser sessions and deployment

## Ownership and lifecycle

Every browser session owns a `Session` controller and `Connections` store. An opaque 256-bit cookie selects the controller; browsers never choose a server session by a URL or request-body ID. The cookie is HttpOnly and SameSite=Strict, with Secure and the `__Host-` prefix for hosted origins. Local cookie names include the port so independent local servers do not overwrite one another's sessions.

Mutation routes additionally require the current `X-Eighty-CSRF` value. Host and Origin are checked; cross-site Fetch Metadata is rejected. State and SSE responses belong only to the cookie owner. The web server never loads deployment API credentials into player connections. The same browser's tabs share a table; separate browser sessions do not.

Keys exist only in their connection store's memory and in an in-flight provider request. API responses, replay exports, browser storage and checkpoints do not contain keys. Inputs clear after submission and dialog close. Changing a destination discards its previous key; it cannot silently move to another host. Clearing or changing connections pauses the table and cancels current decisions.

Sessions become eligible for cleanup after 30 minutes without activity, checked once per minute. A visible connected page keeps its session active. Cleanup clears keys and pauses the saved game. Restarting the server also clears all keys. Checkpoints retain game state and non-secret connection settings under ignored `data/browser-sessions/`; filenames hash the opaque cookie, and files use mode 0600. Hosted saves not used for seven days are removed. Local saves are retained. Keeping or restoring the browser cookie is necessary to resume its checkpoint.

A person operating the backend can access its memory and private files. This design prevents accidental publication and cross-browser access; it does not hide a submitted key from the chosen server operator. Self-host if that trust is unsuitable.

## Custom connections

A connection chooses Chat Completions, Responses or Messages, a base URL, a key and a discovered or manually entered list of models. New API seats require an explicit model choice; discovery does not automatically choose the first model in a provider list. Up to eight connections and 256 models per connection are supported. Model IDs must support text input and the game's structured action contract: native tools, or the documented JSON route for a supported service. Saving settings is not a paid capability test. Model discovery performs one authenticated GET to the selected base URL's `/models` (or `/v1/models` for Messages), with a 6.5-second bound and the same pinned transport. It does not send game data. Partial lists are labeled; arbitrary provider pagination links are not followed. Unsupported listing endpoints retain the manual-entry path. Models explicitly lacking text output or tool support are omitted; an unannotated listing is not proof of capability.

Only explicit USD token pricing with known units is normalized. OpenRouter's documented prompt/completion fields are USD per token; other services must supply currency and units. Unknown prices remain null. No provider package catalog is shipped to the connection UI. See [Anthropic models](https://platform.claude.com/docs/en/api/models/list) and [OpenRouter model metadata](https://openrouter.ai/docs/guides/overview/models).

Base URLs reject embedded credentials, queries and fragments. Normal destinations require HTTPS and public addresses. IPv4, IPv6, mapped and reserved ranges are classified with ipaddr.js. Every request resolves the host, rejects non-public answers, and pins the validated address in the socket lookup. TLS certificate verification remains enabled. Redirects are never followed, response bodies are bounded to 1 MiB, and the existing decision deadline still applies. Browser JSON mutations are bounded to 128 KiB to accommodate discovered model metadata. The browser cannot provide arbitrary request headers or an arbitrary proxy body.

`EIGHTY_ALLOW_LOCAL_PROVIDERS=1` permits loopback providers for local self-hosting and fixtures. It is ignored in hosted mode; private LAN destinations remain blocked. Custom entries are explicit user configuration, not an automatic claim of provider entitlement or capability.

Usage is normalized even for failed or truncated responses. Provider metadata is sanitized because a response can echo credentials. The browser session retains a bounded private audit of 2,000 entries. `/api/audit` exposes it only after the current deal ends, preventing bidding side channels. Recent 20-table summaries retain previous costs after restart; late responses update the old table's accounting, never the new action. Missing usage and unconfigured prices remain unknown.

## Running behind HTTPS

Local development needs no `.env` or API key:

```sh
npm ci --ignore-scripts
npm start
```

For a small hosted instance, terminate HTTPS at a reverse proxy and set the exact external origin, without a trailing slash:

```dotenv
HOST=127.0.0.1
PORT=5173
EIGHTY_PUBLIC_ORIGIN=https://game.example.com
EIGHTY_MAX_SESSIONS=32
EIGHTY_DATA_DIR=data
```

These are process environment variables; the web server deliberately does not read `.env`. For example, in a POSIX shell:

```sh
HOST=127.0.0.1 PORT=5173 EIGHTY_PUBLIC_ORIGIN=https://game.example.com npm start
```

Forward the original Host, disable proxy buffering for `/api/events`, and allow long-lived SSE connections. Keep the Node port private behind the proxy. A container can use `HOST=0.0.0.0` with the same origin setting, while publishing its port only to the proxy network. The application refuses non-loopback listening without a configured HTTPS origin. Do not log credential request bodies at the proxy or hosting platform.

This is a Node application with private server sessions, not a static GitHub Pages build. Source publication does not create a hosted service. Capacity defaults to 32 active browser sessions (configurable up to 256), with bounded mutation and creation rates. This release does not include accounts, shared online rooms, horizontal session replication or large-scale abuse protection.

## Verification and references

Offline tests cover cookie isolation, CSRF, restart/expiry, credential-free checkpoints, ignored server keys, private and mapped addresses, DNS pinning, redirects, echoed-key redaction, custom pricing and late usage after game restart. Browser checks cover configuration, key clearing, model selection and restart controls. Gitleaks scans the public history in CI.

The isolation follows [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Endpoint checks and redirect handling follow [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html); the transport uses [Node HTTPS](https://nodejs.org/api/https.html). Network restrictions should also be enforced by the hosting environment.

The web entry point does not load `.env` and removes inherited provider API keys from its environment. Supply web-server settings through environment variables. Explicit CLI evaluators may still load an ignored `.env`; their credentials are not browser-session defaults.
