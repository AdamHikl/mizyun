# Invitation fallback preparation — 2026-10-08

This is review-ready source for #144, not a published page or accepted fallback. Existing mobile sharing still produces custom-scheme links. No website, native association, app configuration, Store URL or remote service changed.

The proposed exact website route is `https://www.phiskel.com/community/invite#<environment>/<token>`. Environments are exactly `dev` and `production`, mapped respectively to the existing `mizyun-dev` and `mizyun` schemes. Tokens match the existing contract: exactly 22 ASCII base64url characters. The pure builder/parser lives in `apps/mobile/src/features/community/invitation-fallback.ts` and is deliberately unconnected to current sharing.

The standalone HTML reads and validates the fragment locally, removes it from the current history entry before creating an explicit app-opening link, and fails closed if removal fails. It does not fetch invitation metadata, identify an inviter, redirect automatically, detect installed apps, log tokens, store tokens, load third-party assets, register trackers, or invent an installation URL. It explains installed-app requirements and reopening the original message after installation. The capability remains temporarily in the page’s app link while that page is open; no promise is made about browser synchronization, previously saved history, extensions, message-provider link handling or OS behavior outside this page.

## Primary sources checked 2026-10-08

- [MDN URI fragments](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment): fragments are handled by the client and are not sent in the resource request. Therefore the bearer token belongs in the fragment rather than a server path/query. This alone does not protect against scripts or browser facilities reading the full URL.
- [MDN History.replaceState](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState): replacing the current entry changes the address without loading a new resource; same-origin constraints and exceptions require a fail-closed path. State is always `null`, never the token.
- [Expo SDK 57 Linking](https://docs.expo.dev/versions/v57.0.0/sdk/linking/): custom schemes must already be included in the native app; the web does not provide reliable installed-handler detection. Therefore show an explicit matching-app link and honest installation guidance.
- [Expo linking into your app](https://docs.expo.dev/linking/into-your-app/): a custom scheme is a separate mechanism from associated Android App Links/iOS Universal Links. This proposal does not establish either website association.

## Integration and acceptance still required

The website owner must first review the exact route and environment naming, copy or adapt this isolated page into `mizyun-website`, and exclude all site-wide analytics, error/session recording, third-party scripts and service-worker processing from this route. Preserve fragment-only token transport and early current-entry clearing. Set response headers including `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, an equivalent restrictive CSP, and `X-Robots-Tag: noindex, nofollow, noarchive`. Review CDN redirect/canonicalization behavior and avoid rewriting away the fragment. If extracting the inline script, use a reviewed local script and CSP hash/nonce; never weaken `connect-src 'none'` to fetch invite data.

After an explicitly authorized website deployment, prove the exact HTTPS path and absence of token requests/logging/persistence. Exercise installed/not-installed, explicit user activation, cold/warm app, signed-out continuation, account switch, both environments, expired/revoked/invalid invitations, keyboard/screen-reader/maximum-text behavior and browser refresh. Clearing the fragment intentionally means a refresh requires reopening the original message. Keep mobile sharing on its existing links until the hosted route and both-platform journeys are accepted; universal links require their own separate association scope.

The new regression suite includes malformed/foreign URL rejection and execution of the actual inline page script against a synthetic browser boundary. All tests are deferred to the coordinator’s final verification, as requested by the user. No browser/device result is claimed by this document.
