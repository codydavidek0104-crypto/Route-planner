# Instruction translator — local preview only

This Worker is disabled by default (`ENABLED=false`, `workers_dev=false`) and has not been deployed. The browser defaults to `./api/instructions`. The local D7 preview server at port 4188 invokes the same Worker handler. It reads OPENAI_API_KEY only from its server process environment. Without a key, conversion returns `not_configured`; exact clauses and the local review/confirm flow still work.

## Credentials and deployment boundary

Never place an AI key in HTML, browser JavaScript, a URL, localStorage or the release archive. For Wrangler local development, use an ignored `worker/.dev.vars` file or a secret supplied through your environment. For a future reviewed Cloudflare deployment, use a Worker secret named OPENAI_API_KEY. Do not commit secret files. This Worker is not included by scripts/prepare-update.mjs.

The local bridge is not Wrangler: it only reads its inherited OPENAI_API_KEY environment variable, not .dev.vars. Restart that server after configuring its environment. Do not print or send the key in chat.

Before a public release, explicitly approve deployment, configure ALLOWED_ORIGIN to the precise app origin, bind ConversionLimits, enable the Worker and set the page's instruction-endpoint metadata to the reviewed HTTPS endpoint. Origin checking is not authentication. The endpoint is designed to be publicly callable with an atomic global cap of 500 attempts/day and 10/minute/client. Add verified team authentication if private access is required. HTTP errors and provider failures count toward the cap; no automatic retries are performed. Local bridge counters are in memory and reset with the process; Cloudflare counters are persistent Durable Object state.

## Contract

POST /api/instructions with application/json and exactly `{ "text": "..." }`. Up to 512 characters and 4096 request bytes; extra fields are rejected. Only instruction text goes to OpenAI; no spreadsheet contents, route addresses, labels or coordinates are appended. The UI warns against entering addresses/contact details, and the Worker conservatively rejects common address/contact patterns. Pattern detection cannot guarantee that arbitrary free text contains no sensitive information: users must keep customer data out of the instruction field.

Success: `{ "clauses": ["north first"] }`. Only first stops, north first, south first and north cutoff are accepted. The existing parser validates syntax/ranges; the browser additionally checks stop numbers against its actual route. Model-invented numbers not present in the text are rejected. Failure: a fixed error code (unsupported, sensitive_text, invalid_request, forbidden, rate_limited, not_configured, unavailable). No provider messages or free-form model explanations reach the page.

The model is gpt-4.1-mini with strict structured output, store:false, a 300-token output cap and 15-second timeout. Prompt semantics explicitly reject any partially unsupported request, including weather, start/end changes and strict sequencing. Structured output validates syntax, not understanding; review and explicit confirmation remain mandatory. No instruction text is logged by this Worker. store:false does not promise zero retention by the API provider.

## Preview behavior

Exact supported text in the existing instruction field continues through the existing parser with no network. The separate description field also recognizes exact clauses locally and can demonstrate Review/Edit → Confirm rules with no key. Plain English requires the configured backend. It is never secretly replaced by a keyword converter. Pending/unconfirmed descriptions block planning. Cancelling preserves the previously applied supported rules. Editing the existing supported-rule field takes precedence over suggestions. Route/input changes invalidate pending conversion results. Confirming only applies rules; the user still presses Plan Route, and Keep My Order retains its original behavior.

No new planner rules are introduced. North/south use the existing default latitude 40, disclosed in review. First-stop rules create a priority group, not a specified sequence within that group.

## Validation

`node --test --test-isolation=none tests/instruction-worker.test.mjs tests/instruction-assistant.test.cjs`

These tests use controlled provider responses, not a live AI key. They cover payload privacy, unsupported requests, provider failures, rate limits, output validation, local exact rules, confirmation/editing, stale responses, changed routes and cancellation. Live semantic accuracy still requires representative real-provider trials once a key is configured.

References: https://developers.openai.com/api/docs/guides/structured-outputs and https://developers.cloudflare.com/workers/configuration/secrets/
