## [3.3.2](https://github.com/Blake-DK/unifi-captiveportal/compare/v3.3.1...v3.3.2) (2026-07-20)


### Bug Fixes

* use RELEASE_TOKEN for semantic-release's GitHub API calls too ([e279da2](https://github.com/Blake-DK/unifi-captiveportal/commit/e279da2071c82322fec8587fcd0b277c9abfa734))

## [3.3.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v3.3.0...v3.3.1) (2026-07-20)


### Bug Fixes

* revert typescript 6->7 bump, breaks next build ([#14](https://github.com/Blake-DK/unifi-captiveportal/issues/14)) ([c01b55d](https://github.com/Blake-DK/unifi-captiveportal/commit/c01b55d766b24ea94d688e004770da1991dd0390)), closes [#11](https://github.com/Blake-DK/unifi-captiveportal/issues/11)
* sync lockfile drift, drop bot-approval gate ([#13](https://github.com/Blake-DK/unifi-captiveportal/issues/13)) ([9453613](https://github.com/Blake-DK/unifi-captiveportal/commit/9453613023b708f866ecdb0af662980acafc2067))
* use an admin PAT for the release commit push ([#16](https://github.com/Blake-DK/unifi-captiveportal/issues/16)) ([203f419](https://github.com/Blake-DK/unifi-captiveportal/commit/203f419202439077e21e19c9e062a23522e98fd2))
* use buildx --push to avoid GHCR unknown blob on push ([#15](https://github.com/Blake-DK/unifi-captiveportal/issues/15)) ([cbbb075](https://github.com/Blake-DK/unifi-captiveportal/commit/cbbb0758e4de4147bda6e111e34520d274bb5679)), closes [#190](https://github.com/Blake-DK/unifi-captiveportal/issues/190)

# [3.3.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v3.2.0...v3.3.0) (2026-07-14)


### Features

* Traefik log dashboard with portal sign-in, pcap fix + port picker, update-badge fix, locations popup + 2026-07-14 batch ([#186](https://github.com/Blake-DK/unifi-captiveportal/issues/186)) ([6de99d8](https://github.com/Blake-DK/unifi-captiveportal/commit/6de99d847e369a4eab0f2b2eef8d285b0ea583fc))

# [3.2.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v3.1.0...v3.2.0) (2026-07-13)


### Bug Fixes

* setup/update auto-fill a blank IMAGE_TAG from the checked-out branch ([#174](https://github.com/Blake-DK/unifi-captiveportal/issues/174)) ([a737a61](https://github.com/Blake-DK/unifi-captiveportal/commit/a737a616786e9e386abb2a74c7a425157e25da40))
* **split:** portal preview opens on the guest-serving host under a split ([#181](https://github.com/Blake-DK/unifi-captiveportal/issues/181)) ([65be6e3](https://github.com/Blake-DK/unifi-captiveportal/commit/65be6e3da24bd2d5a5f390e40119df6262690684))


### Features

* guest/admin process split, System Health panel, load-test runner + 2026-07-12 batch ([#180](https://github.com/Blake-DK/unifi-captiveportal/issues/180)) ([a60bca0](https://github.com/Blake-DK/unifi-captiveportal/commit/a60bca0a0157b56a9694b2b1f786ba67e6d4e5eb))
* network security suite, admin hardening, M365 mail, map/timeline UX ([#176](https://github.com/Blake-DK/unifi-captiveportal/issues/176)) ([93c5894](https://github.com/Blake-DK/unifi-captiveportal/commit/93c589439183bf2c61c091e210ecf56110ed861e))
* nightly channel — ungated build-only branch wired into the updater ([#173](https://github.com/Blake-DK/unifi-captiveportal/issues/173)) ([b93e9d6](https://github.com/Blake-DK/unifi-captiveportal/commit/b93e9d6cc91f4de74f6cdd3ffce532ac75615908))
* sponsored guest access, DoD compliance, and the NOC/analytics suite ([#178](https://github.com/Blake-DK/unifi-captiveportal/issues/178)) ([d4589a0](https://github.com/Blake-DK/unifi-captiveportal/commit/d4589a06aa0195843f69dbfb75d03c7930232bda))
* test foundation, security hardening, ops robustness, and the device-ignore batch ([#177](https://github.com/Blake-DK/unifi-captiveportal/issues/177)) ([443bb5b](https://github.com/Blake-DK/unifi-captiveportal/commit/443bb5bccaf181f6ef4fe6c34d6fea1e70506048))

# [3.1.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v3.0.0...v3.1.0) (2026-07-08)


### Bug Fixes

* setup asks for the admin URL and seeds the bundled proxy on first boot ([#171](https://github.com/Blake-DK/unifi-captiveportal/issues/171)) ([4b4b607](https://github.com/Blake-DK/unifi-captiveportal/commit/4b4b6071f28a849fce4f899f7530d7c0c9f22afb))
* setup.sh detects and repairs a .env/DB password mismatch ([#170](https://github.com/Blake-DK/unifi-captiveportal/issues/170)) ([592e815](https://github.com/Blake-DK/unifi-captiveportal/commit/592e815de19a2b4721a748d3cf1185af6eb5c396))


### Features

* what's-new dialog renders markdown; changelog links use the public host ([#169](https://github.com/Blake-DK/unifi-captiveportal/issues/169)) ([2a5f081](https://github.com/Blake-DK/unifi-captiveportal/commit/2a5f08108175da33af1f00e28843c8851cca39ea))

# [3.0.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v2.0.1...v3.0.0) (2026-07-08)


* feat!: portal container runs as non-root (node, port 3000) ([f0bcb2c](https://github.com/Blake-DK/unifi-captiveportal/commit/f0bcb2c0ff422a78d0d7355f47079a34328704ad))


### Bug Fixes

* drop npm from the runtime image; allow-list ssh2 fixture key (weekly scan green) ([#158](https://github.com/Blake-DK/unifi-captiveportal/issues/158)) ([79a2fa7](https://github.com/Blake-DK/unifi-captiveportal/commit/79a2fa7fdb5ae4c5a5302a0c4ebf0447e2fec021))
* let CHANGELOG.md into the build context — the image COPY needs it ([#162](https://github.com/Blake-DK/unifi-captiveportal/issues/162)) ([5d1eb5e](https://github.com/Blake-DK/unifi-captiveportal/commit/5d1eb5e924c638153ed0d6b3e346b79a32ca4e81))
* pin public resolvers for the ACME DNS-01 propagation check ([2884558](https://github.com/Blake-DK/unifi-captiveportal/commit/28845584925429b272746bc4b6a3f9d6e5ce8417))
* stop the admin sidebar sliding on scroll (footer drag + dev banner offset) ([#157](https://github.com/Blake-DK/unifi-captiveportal/issues/157)) ([367ef68](https://github.com/Blake-DK/unifi-captiveportal/commit/367ef6876734939a391cc1dd5ed05c03cfbc0c43))


### Features

* CI bakes the update-check token into the image, encrypted ([#164](https://github.com/Blake-DK/unifi-captiveportal/issues/164)) ([1d8d9c6](https://github.com/Blake-DK/unifi-captiveportal/commit/1d8d9c6873c8c48b1aca6551f3e4a84fe85f1b4f))
* dual-auth connection test, pre-auth allowances, sign-in connects device ([#163](https://github.com/Blake-DK/unifi-captiveportal/issues/163)) ([46e787d](https://github.com/Blake-DK/unifi-captiveportal/commit/46e787d82674f9a9f9281da6f5c450c6ba2466bc))
* Restart-Traefik button (reauth-gated) via socket-free ops sidecar ([14ed5a1](https://github.com/Blake-DK/unifi-captiveportal/commit/14ed5a14fa8bf779c88589a30e061b5eca75912c))
* settings UX batch, admin account lifecycle, hotspot + test-connection fixes ([#160](https://github.com/Blake-DK/unifi-captiveportal/issues/160)) ([8ebf64f](https://github.com/Blake-DK/unifi-captiveportal/commit/8ebf64f4c7ebceeb6fd96d3dbbe8e077107800eb))
* Test-proxy button — live end-to-end Traefik checks in the GUI ([cc51f37](https://github.com/Blake-DK/unifi-captiveportal/commit/cc51f373ace926642eb4ffb0ade32a2d5353f0c3))
* what's-new popup, update-check channel, Traefik config preview, UI cleanups ([#161](https://github.com/Blake-DK/unifi-captiveportal/issues/161)) ([427559d](https://github.com/Blake-DK/unifi-captiveportal/commit/427559dd3583eaf3885b57ea861233cf11a81223))
* yellow development-build banner on every page ([a059772](https://github.com/Blake-DK/unifi-captiveportal/commit/a059772ffcd85ea2fc44cbc12f68afa62057caae))


### BREAKING CHANGES

* the portal listens on 3000 in-container; direct-mode
installs must republish as "80:3000" and chown ./traefik to 1000:1000
(setup.sh handles both on re-run).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

## [2.0.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v2.0.0...v2.0.1) (2026-07-07)


### Bug Fixes

* ship the /api/traefik/config route + IPv4 healthcheck ([11d9d19](https://github.com/Blake-DK/unifi-captiveportal/commit/11d9d19964ae8c330b01c41d6a1894fd031a05ec))

# [2.0.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.29.0...v2.0.0) (2026-07-07)


* feat!: portal-managed Traefik replaces Pangolin; bridge networking replaces macvlan ([ebfc282](https://github.com/Blake-DK/unifi-captiveportal/commit/ebfc282a5d363f17f7529598fe4a2e8041829bed))


### BREAKING CHANGES

* the Pangolin integration is gone (pangolinUrl/
pangolinOrgId/pangolinApiKey are dropped by migration) and the compose
stack no longer uses macvlan — existing installs must choose a reverse
proxy via setup.sh (bundled Traefik profile or a direct port mapping),
re-point DNS and the UniFi hotspot custom_ip from the old container IP
(10.90.0.232) to the Docker host, and configure certificates in
Settings -> URLs -> Reverse Proxy.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

# [1.29.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.28.0...v1.29.0) (2026-07-07)


### Features

* auto-update on host reboot — [@reboot](https://git.example.com/reboot) cron + docker-ready wait ([29b3fa1](https://github.com/Blake-DK/unifi-captiveportal/commit/29b3fa18f39c366489820189f78de7a9687c422a))
* standalone image — 1.55 GB → 620 MB ([5478f3f](https://github.com/Blake-DK/unifi-captiveportal/commit/5478f3f870937fd1c76167f86e3766c14f6d30c4))


### Performance Improvements

* micro-cache the dashboard live snapshot + monitor cache headers ([3d93690](https://github.com/Blake-DK/unifi-captiveportal/commit/3d93690126f1e690c65db5138e7b18fa5980ca64))

# [1.28.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.27.0...v1.28.0) (2026-07-07)


### Features

* setup/update .env reconcile + deploy migration verification ([4487299](https://github.com/Blake-DK/unifi-captiveportal/commit/44872995896d28d61b782dbc746dbfa07c13e370))

# [1.27.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.26.0...v1.27.0) (2026-07-07)


### Bug Fixes

* hotspot Apply — verify the write stuck + clear unneeded portal settings ([2d68c73](https://github.com/Blake-DK/unifi-captiveportal/commit/2d68c739fe1cea1ca841b0738588bd6fa6250b73))
* usage bars invisible in dark mode — use the chart palette, not the brand color ([910a4c0](https://github.com/Blake-DK/unifi-captiveportal/commit/910a4c0871a5b78a7aa1d15e63d87865140938bc)), closes [#171717](https://github.com/Blake-DK/unifi-captiveportal/issues/171717) [#2563eb](https://github.com/Blake-DK/unifi-captiveportal/issues/2563eb) [#3b82f6](https://github.com/Blake-DK/unifi-captiveportal/issues/3b82f6)


### Features

* update check — /api/version + admin-sidebar badge (latest vs running) ([28a31c4](https://github.com/Blake-DK/unifi-captiveportal/commit/28a31c4fecc016b367d74af75ca870f929f04c29))
* UPDATE_CHECK_TOKEN env fallback for the update check (zero-UI setup) ([9975099](https://github.com/Blake-DK/unifi-captiveportal/commit/9975099f12699c18c9eda7bb417a68817704ef10))

# [1.26.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.25.0...v1.26.0) (2026-07-07)


### Features

* Network Review tab — advisory firewall rule builder + stability recs ([5cdb9dc](https://github.com/Blake-DK/unifi-captiveportal/commit/5cdb9dccdf90053e5a9206ba06561922606d8078))

# [1.25.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.24.3...v1.25.0) (2026-07-07)


### Features

* multi-WAN support — per-link visibility + wan_link alerts ([50102f3](https://github.com/Blake-DK/unifi-captiveportal/commit/50102f39f475156b123005dacf8a04a00312d5d2))

## [1.24.3](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.24.2...v1.24.3) (2026-07-07)


### Bug Fixes

* security hardening — CSV/XSS injection fixes, tests in CI, architecture & ops docs ([27bfe87](https://github.com/Blake-DK/unifi-captiveportal/commit/27bfe879c2b504f9e8b82ac655b9fc596cddd278))

## [1.24.2](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.24.1...v1.24.2) (2026-07-07)


### Bug Fixes

* UniFi settings page crashed after save + Test Connection ([5e3cdf1](https://github.com/Blake-DK/unifi-captiveportal/commit/5e3cdf167a59660d7965197749404d6e9ab11294))

## [1.24.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.24.0...v1.24.1) (2026-07-07)


### Bug Fixes

* first admin account gets the Traffic-data grant automatically ([f376696](https://github.com/Blake-DK/unifi-captiveportal/commit/f376696d1256cc6dd223793095eb99fabd04f6e6))

# [1.24.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.23.1...v1.24.0) (2026-07-07)


### Features

* update.sh — one-command host update (checkout + image, restart only on change) ([646140f](https://github.com/Blake-DK/unifi-captiveportal/commit/646140f35b1c73db1b84b883c49345a8674bd7b5))

## [1.23.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.23.0...v1.23.1) (2026-07-07)


### Bug Fixes

* setup.sh asks for the portal IP when the compose default is off-LAN ([ad07358](https://github.com/Blake-DK/unifi-captiveportal/commit/ad07358edff4b956ec0794cd81a722f6caa36ca5))

# [1.23.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.22.0...v1.23.0) (2026-07-07)


### Features

* duplicate-IP false-positive suppression (alarm gate + audit log) ([619e237](https://github.com/Blake-DK/unifi-captiveportal/commit/619e237fd028ca0472bad5d3bc7bb54d017c39b2))
* optional UniFi Integration-API key (supplements local account) ([d6d1e62](https://github.com/Blake-DK/unifi-captiveportal/commit/d6d1e62a1ba6dab7412b32ef47868b3f7a030b6e))

# [1.22.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.21.0...v1.22.0) (2026-07-06)


### Bug Fixes

* DHCP usage bar — make low (non-zero) usage visible ([804b5b7](https://github.com/Blake-DK/unifi-captiveportal/commit/804b5b727352a3e7816ee47c3e4a6c6e35cf37c3))


### Features

* stamp UniFi client note with guest name + last-5 phone on registration ([f7699c9](https://github.com/Blake-DK/unifi-captiveportal/commit/f7699c9e3f172023f639e9f064a1ddf00d2eb6fe))

# [1.21.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.20.1...v1.21.0) (2026-07-06)


### Features

* configurable live-view refresh interval (Phase 7, migration) ([68f1651](https://github.com/Blake-DK/unifi-captiveportal/commit/68f165188aa555a8ce59697cdb8a039db4b5d47b))
* GDPR SAR export filename = subject name + export timestamp ([29ac3e6](https://github.com/Blake-DK/unifi-captiveportal/commit/29ac3e63320e7178ff3daed30e69f1066e45fcb7))
* standalone login page — no admin sidebar when logged out ([35a0001](https://github.com/Blake-DK/unifi-captiveportal/commit/35a00014913ad28a70a6321f24efad3991cc2dcc))

## [1.20.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.20.0...v1.20.1) (2026-07-06)


### Bug Fixes

* /admin/status crash — move device-type filter const to a server-safe lib ([c90beaf](https://github.com/Blake-DK/unifi-captiveportal/commit/c90beafe048a49472b9c07cb450b87cf03c0988a)), closes [#99](https://github.com/Blake-DK/unifi-captiveportal/issues/99)

# [1.20.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.19.0...v1.20.0) (2026-07-06)


### Features

* guest-portal preview from admin settings ([aaac9ae](https://github.com/Blake-DK/unifi-captiveportal/commit/aaac9aeec64be3326a20a3ee969ad4184e11ebf5))

# [1.19.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.18.0...v1.19.0) (2026-07-06)


### Features

* DHCP-pool exhaustion check + alert (Phase 6) ([ef22062](https://github.com/Blake-DK/unifi-captiveportal/commit/ef2206217d0b6c74e51d49c28e44e872782d50ea))
* per-AP client-load breakdown on the dashboard (Phase 5) ([5950a3c](https://github.com/Blake-DK/unifi-captiveportal/commit/5950a3cff2bbf7d1ee34bc78266051165576690b))
* speedtest history chart on the metrics page (Phase 6) ([65384d6](https://github.com/Blake-DK/unifi-captiveportal/commit/65384d678541ac7fed87a91ad6e2f4008c7344c2))

# [1.18.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.17.0...v1.18.0) (2026-07-06)


### Features

* bulk delete on the Users directory (Phase 7 QoL) ([42308b5](https://github.com/Blake-DK/unifi-captiveportal/commit/42308b5e6ebd6f7e9af5e06fe1eccb3c03d656cb))
* network health score on the dashboard (Phase 6) ([3d573f8](https://github.com/Blake-DK/unifi-captiveportal/commit/3d573f838693e788bfb73403e597f485b95c9adb))
* timeline drill-down to alert/event detail (Phase 7 QoL) ([d4ebb17](https://github.com/Blake-DK/unifi-captiveportal/commit/d4ebb1714195a159d0067fe308015372b65e7d22))

# [1.17.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.16.0...v1.17.0) (2026-07-06)


### Bug Fixes

* CI builds the current main tip, not the triggering commit ([f6f0e2b](https://github.com/Blake-DK/unifi-captiveportal/commit/f6f0e2bec01794147e4c6be1a75fce896b021991)), closes [#105](https://github.com/Blake-DK/unifi-captiveportal/issues/105)


### Features

* block dialog + CSV export for Clients/Ports (Phase 7 QoL) ([6dc5c29](https://github.com/Blake-DK/unifi-captiveportal/commit/6dc5c29b46f16ee73c212bfe1b68a08c695e33e8))
* persistent table filters for Users/Logs/Audit (Phase 7 QoL) ([64e1cff](https://github.com/Blake-DK/unifi-captiveportal/commit/64e1cff2483d86615ae900c95559fdcc62737fc7))
* production retention nudge on the dashboard (Phase 7 QoL) ([b8226b8](https://github.com/Blake-DK/unifi-captiveportal/commit/b8226b84f3158540ef54300aaa2f7c59f5780d01))

# [1.16.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.15.0...v1.16.0) (2026-07-06)


### Features

* per-client bandwidth throttle (Phase 6, migration) ([64bf67c](https://github.com/Blake-DK/unifi-captiveportal/commit/64bf67c747034ee970177fe80e3604beec4d133d))

# [1.15.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.14.0...v1.15.0) (2026-07-06)


### Features

* first-seen device alert (Phase 8, migration) ([075a25a](https://github.com/Blake-DK/unifi-captiveportal/commit/075a25a99c07a70873b9628a6841ef6b9c0cc5e0))

# [1.14.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.13.0...v1.14.0) (2026-07-06)


### Features

* rogue-AP (evil-twin) detection (Phase 8) ([2a328cb](https://github.com/Blake-DK/unifi-captiveportal/commit/2a328cb034b241420ff426f2c2f9484eba9b9277))

# [1.13.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.12.0...v1.13.0) (2026-07-06)


### Features

* AP/DN/AN device-type filter across device views ([ae8e970](https://github.com/Blake-DK/unifi-captiveportal/commit/ae8e9707d162c81f6d83b5d0be23a54891a97416))

# [1.12.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.11.0...v1.12.0) (2026-07-06)


### Features

* failed-admin-login alerting (Phase 8) ([90dcaba](https://github.com/Blake-DK/unifi-captiveportal/commit/90dcabab12bc187b0e1f57abfa2dc067f5c448d2))
* security response headers (CSP/HSTS/frame-ancestors, Phase 8) ([dd736d1](https://github.com/Blake-DK/unifi-captiveportal/commit/dd736d189991b6b99a941708a84900a4e7289af5))

# [1.11.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.10.0...v1.11.0) (2026-07-06)


### Features

* npm audit in CI + fix stale workflow docs (Phase 8) ([f7b1d09](https://github.com/Blake-DK/unifi-captiveportal/commit/f7b1d090042eaec97ddd490e68ea2b965f3931d5))
* scheduler single-run guard via advisory lock (Phase 7) ([3a62e6b](https://github.com/Blake-DK/unifi-captiveportal/commit/3a62e6b8b6602290b75cab50aa0007d016230689))

# [1.10.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.9.2...v1.10.0) (2026-07-06)


### Features

* DB restore script + hardened backup (Phase 8) ([79217f3](https://github.com/Blake-DK/unifi-captiveportal/commit/79217f354621ef29cbff6ecd9fab842adebf13d0))
* separation of duties — no self role/traffic escalation (Phase 7) ([6817f23](https://github.com/Blake-DK/unifi-captiveportal/commit/6817f231df67de6f311c57396f7933fbb8c01cb7))

## [1.9.2](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.9.1...v1.9.2) (2026-07-06)


### Bug Fixes

* add .dockerignore so the image build is hermetic (unblocks CI build) ([a6577df](https://github.com/Blake-DK/unifi-captiveportal/commit/a6577dff12a7668a2de819eb75bffbbc2504031b))

## [1.9.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.9.0...v1.9.1) (2026-07-06)


### Bug Fixes

* deployed image now carries the released version (single CI pipeline) ([897836f](https://github.com/Blake-DK/unifi-captiveportal/commit/897836f90e04f3b2d39e4d9a1f0dc821e9670c4d))

# [1.9.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.8.0...v1.9.0) (2026-07-06)


### Features

* GDPR erasure also blocks the subject's device MACs ([e344c21](https://github.com/Blake-DK/unifi-captiveportal/commit/e344c21ae0892b489c36ac9eae2d47557d1d03be))

# [1.8.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.7.1...v1.8.0) (2026-07-06)


### Features

* map device controls — locate toggle, per-device pcap, PoE by capability ([69cf23e](https://github.com/Blake-DK/unifi-captiveportal/commit/69cf23ebda331c83763b52ec232d27bba43b0823))

## [1.7.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.7.0...v1.7.1) (2026-07-06)


### Bug Fixes

* setup.sh macvlan preflight + resumable, clear errors on partial runs ([4814a6e](https://github.com/Blake-DK/unifi-captiveportal/commit/4814a6e2d38c74707e2ac9ca0303ffb36eab3904))

# [1.7.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.6.0...v1.7.0) (2026-07-06)


### Features

* client-insight toolkit — detail windows, extender tool, port devices, pcap ([3c4b076](https://github.com/Blake-DK/unifi-captiveportal/commit/3c4b076e29b8d263126064bff64b8be0cbed96a4))

# [1.6.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.5.0...v1.6.0) (2026-07-06)


### Bug Fixes

* SSH terminal sizing in the map dialog ([ec31783](https://github.com/Blake-DK/unifi-captiveportal/commit/ec31783a0a75786fd4828ac196ce2a0349bf4662))


### Features

* NOC toolkit — issues board, live map overlay, AP tab, filters ([b650e8f](https://github.com/Blake-DK/unifi-captiveportal/commit/b650e8fd97075ae8bfcb2b692282e2602320cd52))
* unified branding — favicon, title template, builder credit ([2164871](https://github.com/Blake-DK/unifi-captiveportal/commit/216487145909ba7ff02c26af04d13b78dd8c37ac))

# [1.5.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.4.2...v1.5.0) (2026-07-06)


### Bug Fixes

* countdown hydration warning + broken renew link in expiry email ([cd4240a](https://github.com/Blake-DK/unifi-captiveportal/commit/cd4240aab873f8f83969c28caa42cc3729c74146))
* list blocked devices on /admin/clients so they can be unblocked ([e8565fa](https://github.com/Blake-DK/unifi-captiveportal/commit/e8565fa43b6b684e53b1999302510093473174ec))


### Features

* block a client from the network, with who/why/when recorded ([a9ee956](https://github.com/Blake-DK/unifi-captiveportal/commit/a9ee95611d78240c58d74bfa70665e33e06756ad))
* professional UI pass — theme-aware charts + real icons ([a920bba](https://github.com/Blake-DK/unifi-captiveportal/commit/a920bbac44aba924d72f849f59778916b8c41a04))

## [1.4.2](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.4.1...v1.4.2) (2026-07-06)


### Bug Fixes

* remove the traffic usage bar, keep plain text ([792ba3a](https://github.com/Blake-DK/unifi-captiveportal/commit/792ba3a23a1dfb9c5f781e09036eefac606c922c))

## [1.4.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.4.0...v1.4.1) (2026-07-06)


### Bug Fixes

* scale traffic usage bars to the list's max, not its sum ([ec2a8cb](https://github.com/Blake-DK/unifi-captiveportal/commit/ec2a8cb0106c31c461590001ee75800f7b9f7ab3))

# [1.4.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.3.0...v1.4.0) (2026-07-06)


### Features

* correlated assurance timeline (alerts + health + events) ([f706c63](https://github.com/Blake-DK/unifi-captiveportal/commit/f706c6343e91175d87ba349ffa75e9be66fd15aa))

# [1.3.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.2.1...v1.3.0) (2026-07-06)


### Features

* flat switch-port inventory admin page ([715a407](https://github.com/Blake-DK/unifi-captiveportal/commit/715a407f9fe0f740756323ffca7767d88a2a9f87))
* live-ticking countdown on the guest devices page ([9753468](https://github.com/Blake-DK/unifi-captiveportal/commit/97534686fb2eec482edc5f3e1cd9f06ba9a51788))

## [1.2.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.2.0...v1.2.1) (2026-07-06)


### Bug Fixes

* resolve switch names too on the Clients page, not just APs ([d4bc4a6](https://github.com/Blake-DK/unifi-captiveportal/commit/d4bc4a6140fbe47db9ffdb78f4ca1d4fbe1992ab))

# [1.2.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.1.2...v1.2.0) (2026-07-06)


### Bug Fixes

* support a non-interactive registry pull token in setup/deploy ([f00ed74](https://github.com/Blake-DK/unifi-captiveportal/commit/f00ed7482adba1832c2ea98afce17d693890ef95))


### Features

* detect suspected consumer WiFi extenders/mesh nodes ([d714d14](https://github.com/Blake-DK/unifi-captiveportal/commit/d714d14dddc51b11ebc59565b0cfd19d0474a5c8)), closes [Hi#confidence](https://git.example.com/Hi/issues/confidence)
* hotel accommodation locations require a room number ([64aac83](https://github.com/Blake-DK/unifi-captiveportal/commit/64aac83ca17f01a40d520f1e2ee811ca459a7c64))


### Reverts

* move guest session secret back to .env-only ([a4a0995](https://github.com/Blake-DK/unifi-captiveportal/commit/a4a0995edf6dd35e23ece32a7450fa89a87a291d)), closes [#57](https://github.com/Blake-DK/unifi-captiveportal/issues/57)

## [1.1.2](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.1.1...v1.1.2) (2026-07-04)


### Bug Fixes

* build the release image in the semantic-release job itself ([9880bec](https://github.com/Blake-DK/unifi-captiveportal/commit/9880becebb455d20dfe100e80254b54910eedeac))

## [1.1.1](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.1.0...v1.1.1) (2026-07-04)


### Bug Fixes

* drop [skip ci] from release commits so docker-publish runs ([25f5ae7](https://github.com/Blake-DK/unifi-captiveportal/commit/25f5ae71593e6c5f688311dbf9b6d25a615168f8))
* log in to the registry when a pull is unauthorized ([dc36d38](https://github.com/Blake-DK/unifi-captiveportal/commit/dc36d38eac5c9210ceef07ca1869c48498772caf))

# [1.1.0](https://github.com/Blake-DK/unifi-captiveportal/compare/v1.0.0...v1.1.0) (2026-07-04)


### Bug Fixes

* move Traffic under the Network sidebar group ([cbd675c](https://github.com/Blake-DK/unifi-captiveportal/commit/cbd675cd116fa6d4e579f96592497e1549c79783))
* restore executable bit on setup.sh ([d29d9db](https://github.com/Blake-DK/unifi-captiveportal/commit/d29d9dbfb507ccd90b51f387aabfaf1e1ddc19e8))
* use public git.example.com hostname for the container registry ([06ef856](https://github.com/Blake-DK/unifi-captiveportal/commit/06ef85669ce451e721ae1bc1cc84c43a157cee96))


### Features

* add cookieSecure/guestSessionSecret columns to SystemSettings ([2c92326](https://github.com/Blake-DK/unifi-captiveportal/commit/2c92326c4c4d7e322140c4bd493e3fa8ca84d01f))
* add semantic-release for automated Conventional Commits versioning ([8c43297](https://github.com/Blake-DK/unifi-captiveportal/commit/8c43297783ba0ff5d8ee4735ccc429c1517a1f91))
* encrypt secrets at rest (AES-256-GCM) ([3da33aa](https://github.com/Blake-DK/unifi-captiveportal/commit/3da33aa5d433f3678fdef4a773a67536037810c4))
* make .env infra-only, GUI-only for app settings ([5a7c1a1](https://github.com/Blake-DK/unifi-captiveportal/commit/5a7c1a1acfd4d634f8fd66113b495814b1308cc5))
* read cookieSecure/guestSessionSecret from DB, not env ([3dfc60b](https://github.com/Blake-DK/unifi-captiveportal/commit/3dfc60b12495568c311b07032b418d455bdf2cf5))
* run semantic-release on push to main ([7aab192](https://github.com/Blake-DK/unifi-captiveportal/commit/7aab192d94aa7e9edc8e1ad3c03fddbccc4c22e6))
* seed cookieSecure/guestSessionSecret from env once at boot ([3ed421f](https://github.com/Blake-DK/unifi-captiveportal/commit/3ed421f296f6dd0a6ecb1629eaafc42fc41ea0b3))
* Session Security settings in the URLs tab ([25719c0](https://github.com/Blake-DK/unifi-captiveportal/commit/25719c0b5cba62ab9e245584224ad84f811cbeca))
* setup.sh generates and prints the admin password + login URL ([35521fa](https://github.com/Blake-DK/unifi-captiveportal/commit/35521fa08737b9ef4fefe59640f597b3c935a962))

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`): breaking
changes bump MAJOR, backwards-compatible features bump MINOR, and fixes bump
PATCH. The version lives in `package.json`, each release is git-tagged
`vX.Y.Z`, and the running build reports it at `GET /api/health` and in the
admin sidebar. See [Versioning & releases](README.md#versioning--releases).

## [Unreleased]

> **One-time transition note:** starting with this entry, versioning and new
> CHANGELOG entries are generated automatically by semantic-release from
> commit messages (see [Versioning & releases](README.md#versioning--releases)).
> Because this change is itself a `feat:` commit, merging it triggers
> semantic-release's first run, which will analyze every commit since `v1.0.0`
> — including the ones already summarized by hand below — and prepend its own
> generated entry above this section. That first-run duplication is expected
> and one-time; every release after it only covers what's new.

### Added
- **Automated versioning (semantic-release)** — commits since `v1.0.0` are
  analyzed on every push to `main` (`feat:` → minor, `fix:`/`perf:` → patch,
  a `BREAKING CHANGE:` footer → major); a release bumps `package.json`,
  prepends a generated CHANGELOG entry, tags `vX.Y.Z`, and creates a Gitea
  release. See README "Versioning & releases" for the full commit-message
  convention this now depends on.
- **Session Security settings** (Settings → URLs): "Require HTTPS for session
  cookies" and a guest session signing secret move from `.env`
  (`COOKIE_SECURE`/`GUEST_SESSION_SECRET`) into the GUI, completing the
  `.env`-is-infra-only work below. Existing deployments that had either set
  get them migrated into the database automatically, once, on next boot — not
  a standing env fallback, and neither var needs to stay in `.env` afterward.
  A wrong "Require HTTPS" value breaks every login instantly with no in-app
  recovery path, so the save handler warns before enabling it (see GO-LIVE.md
  for the manual database fix if it happens anyway).

### Ops
- **`setup.sh` generates the admin password** — the one remaining manual
  `.env` edit in first-time setup. `ADMIN_PASSWORD` is now generated the same
  way as `POSTGRES_PASSWORD`/`ADMIN_SECRET`, and printed (with the login URL,
  extracted from `docker-compose.yml`) once the health check passes on a
  fresh run.

### Changed
- **`.env` is infra-only now** — removed the `process.env` fallback for every
  app-level setting (UniFi controller, guest session defaults, portal/guest/
  admin URLs, Pangolin, device caps). These were already DB-first with env as
  a fallback (`src/lib/config.ts`), which meant `.env` could silently keep
  overriding a value an admin thought they'd already changed in Settings; now
  the GUI is the only source once the container is up. `.env.example` and
  `setup.sh`'s post-generate message updated to match — they now only ask for
  the true infra values (`DATABASE_URL`, `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`,
  `ADMIN_SECRET`, `GUEST_SESSION_SECRET`, `COOKIE_SECURE`, `BACKUP_PATH`).

### Fixed
- **Registry hostname** — `docker-compose.yml`, `deploy.sh`, and the CI publish
  workflow pointed at `git.example.com`, an internal-only hostname that
  doesn't resolve from deployment hosts outside that network. Switched to the
  public `git.example.com` (same registry, confirmed identical) so `docker
  compose pull` works from any host running the compose file.

### Ops
- **setup.sh** — first-time host bootstrap: creates `.env` (generating
  `POSTGRES_PASSWORD`/`ADMIN_SECRET`), pulls images, brings up `db` + `portal`,
  waits for both healthchecks. README now documents it as a single-command
  quick setup, distinct from `deploy.sh` (routine redeploy after CI publishes).

### Docs
- **GO-LIVE.md** — production go-live runbook (readiness scorecard, pre-cutover
  checklist, cutover + verification steps, day-2 operations, accepted risks).

### Security
- **Secrets encrypted at rest** — UniFi/SMTP/Pangolin/SSH passwords and TOTP
  secrets are now stored AES-256-GCM encrypted in the database (key derived
  from `ADMIN_SECRET`), instead of plaintext. Decryption is transparent, so
  existing values keep working and are encrypted on next write and by a
  one-time boot sweep. Note: `ADMIN_SECRET` must stay stable — changing it
  makes stored secrets unreadable (re-enter them).

### Added
- **Backups & container health** (ops): `backup.sh` runs a nightly gzip `pg_dump`
  into the db container's `/backups` (a Compose mount — set `BACKUP_PATH`
  to a second location; 14-day retention) plus a disk-usage warning; add one cron line to
  enable it. The `portal` Compose service gains a `/api/health` healthcheck so
  `docker ps` reports healthy/unhealthy. See the README "Backups & health".

## [1.0.0] - 2026-07-04

First tagged release. Everything below shipped to production via continuous
deployment from `main` ahead of adopting semantic versioning; it is captured
here as the 1.0.0 baseline.

### Docs
- **Screenshots** added to the README and the wiki (dashboard, network map,
  health, alerts, metrics, users, settings, guest portal, privacy notice).

### Changed
- **Dashboard rebuilt with live network stats** — a new top **Live network**
  row polls the controller every 15 s and shows Internet/WAN status (with
  latency + WAN IP), live WAN throughput (↓/↑ Mbps), clients online (with guest
  count), devices up/total (APs · switches), and open alerts (colour-accented,
  links to Alerts). Controller-unreachable degrades gracefully. The guest
  analytics (totals + charts) move below under a "Guests" heading.
- **Settings: Portal merged into Branding** — the Branding tab now also holds
  the welcome text, success redirect, terms of use, and privacy notice (they
  were effectively the same area). The old `/admin/settings/portal` URL
  redirects to Branding.
- **Metric history is easier to find** — the Metrics page pointed at the old
  UniFi tab; it now points at Settings → Monitoring, and its empty state has a
  one-click "Enable in Settings → Monitoring" button.

### Added
- **UniFi factory default SSH** — the device SSH tools now always try
  `ubnt`/`ubnt` last, so a blank/unadopted device is reachable out of the box.
  It shows as a non-removable entry under Settings → Monitoring → Device SSH.

### Added
- **Multiple device SSH credentials** — the Network Map debugging tools now
  accept several device logins (a large network may push different SSH
  credentials to different gear). Manage them under Settings → Monitoring →
  Device SSH (add/remove, up to 10, each with an optional label, username,
  password, port); the SSH client tries each in order until a device
  authenticates. Passwords are write-only and stored like the other secrets;
  add/remove is audited. Migration adds `DeviceSshCredential` and carries the
  existing single credential over as "Default".

### Changed
- **Sidebar grouped** — the admin nav is organized into labelled sections
  (Guests, Network, System) with Dashboard on top, instead of one long flat
  list; the phone top-bar keeps the same grouped order.
- **Colour logo library** — the built-in location logos are now full-colour and
  expanded to 22, including deployment-oriented ones (On Base, Dorms, Deployed,
  Barracks, HQ) plus building/office/home/lodging/school/medical/dining/gym/
  chapel/event/flag/star/anchor/globe/plane/wifi/pin.

### Changed
- **Settings reorganized** — the overloaded UniFi tab is split: **Network
  Alerts**, **Metric history**, and **Device SSH** move to a new **Monitoring**
  tab, leaving UniFi as controller connection + portal/hotspot setup. Tabs are
  reordered into logical groups (guest-facing → network → email → admins).
- **Built-in logo library** — the location logo picker now offers a set of
  stock logos (building, home, lodging, office, school, medical, dining, event,
  WiFi, pin, flag, anchor) to select from, alongside the existing uploaded-image
  library and upload option.

### Added
- **2FA recovery codes** — when an admin enables two-factor auth they now get a
  set of 10 one-time backup codes (shown once, with copy / download), usable at
  login in place of the authenticator code if they lose access to it. Codes are
  stored hashed (scrypt) and single-use; My Account shows how many remain and
  can **regenerate** the set (requires a current code, invalidates the old
  ones). Disabling or admin-resetting 2FA clears them. Recovery-code logins are
  audited (`stage: recovery-code`). Migration adds the `TotpRecoveryCode` table.

### Added
- **GDPR data-subject tooling** — closes three compliance gaps from GDPR.md:
  - **Guest privacy notice** at `/portal/privacy`, linked from the sign-in
    form. Renders a controller-authored notice (Settings → Portal → Privacy
    notice, Markdown) or a built-in template grounded in the data the portal
    actually collects, with a configurable rights-request contact.
  - **Right-to-erasure** action on a guest's page (**Erase & forget**,
    full-admin only): kicks their active devices, deletes all their
    registrations, and **pseudonymises their identifier in the audit log**
    (the action history survives without the personal identifier), then
    surfaces a reminder to complete the manual controller-side MAC/session/DPI
    scrub. Audited `guest.erase`.
  - **SAR export** (**Export data (SAR)**): downloads a machine-readable JSON
    bundle of everything the app holds about a subject — all registrations
    plus the audit entries that reference them. Audited `guest.export`.

  Migration adds `privacyNotice` + `privacyContact` SystemSettings columns.

### Docs
- **GDPR.md** - a data-protection plan for the portal: processing inventory
  (ROPA) built from the schema, lawful-basis table, retention & erasure
  posture, data-subject-rights handling with the current gaps, security
  measures, sub-processors & transfers, a DPIA screening note, a breach
  procedure, and a prioritised compliance backlog. Framed as an
  engineering-maintained plan requiring DPO/legal review, not legal advice.
  Linked from the README privacy section.

### Changed
- **Retention presets** — the Data Retention card now offers guest-data
  retention as selectable presets (Keep forever / 30 / 90 / 180 days) and
  audit-log retention as presets (Keep forever / 90 / 180 / 365 days), each
  with a **Custom…** fallback that reveals the raw day count. Makes the GDPR
  retention decision a clear pick rather than free-form typing; the underlying
  `defaultRetentionMode/Days` + `auditRetentionDays` storage is unchanged.

### Added
- **Metric history** (new **Metrics** page + Settings → UniFi → Metric
  history): a background sampler takes one controller snapshot on a coarse,
  configurable interval and records a site-level row (WAN up/down throughput,
  connected clients, WAN latency, device up/down counts) plus, optionally, one
  row per online device (CPU, memory, client count) into a new `MetricSample`
  time-series table, pruning rows past a retention window. The Metrics page
  charts the trends with a 6h/24h/7d/30d range selector and a per-device
  picker (CPU/memory/clients over time) — answering "throughput over the
  week" and "what was this AP doing at 2am". Built to scale like the other
  schedulers: one snapshot + one bulk insert + one prune per cycle, coarse
  interval, retention-bounded volume; the API bucket-averages long windows so
  the chart payload stays small. Migration adds `MetricSample` + four
  SystemSettings columns.
- **Switch-port alerts** — two new alerting rules extend the network monitor
  to interface health, the biggest remaining gap vs. SolarWinds. **Link
  saturation** opens a per-port alert when a switch port's live throughput
  crosses a configurable % of its negotiated link speed (e.g. an uplink
  running hot at 90% of 1G). **Interface errors** opens a per-port alert when
  a port's cumulative error+discard ratio crosses a threshold (a bad cable/
  SFP indicator), ignoring near-idle ports so the ratio stays meaningful.
  Both read port data already fetched for the map, are per-port targets (one
  bad port doesn't mask another and each recovers independently), and reuse
  the existing scale-safe transition-only/batched-notify machinery. Configure
  the two thresholds under Settings → UniFi → Network Alerts (0 = off).
  Migration adds two SystemSettings columns.
- **Network alerting** (new **Alerts** page + Settings → UniFi → Network
  Alerts): a background monitor polls the controller on a configurable
  interval and opens/resolves alerts on **device offline/unhealthy**,
  **site subsystem degraded** (WAN/LAN/WiFi/Internet, incl. disconnected
  members), **CPU/memory over a threshold**, and optionally **firmware
  updates**. It notifies on transitions by **email** (via the existing
  SMTP settings) and/or a generic **webhook** (JSON POST, Slack/Discord/
  ntfy-compatible). Built to scale: one controller snapshot per cycle,
  alerts stored one-row-per-open-condition with writes only on
  transitions (steady state is near-zero I/O on a large fleet), and a
  **single batched digest per cycle** so an outage taking many devices
  down is one notification, not a storm. The Alerts page shows active
  alerts (with duration) and resolved history, auto-refreshes, and has a
  "Check now" button; controller-unreachable cycles are skipped so
  devices don't falsely flap to resolved. Audited `alert.transition` /
  `alert.run`. Migration adds the `Alert` table + nine SystemSettings
  columns.

### Operational
- **`deploy.sh`**: one-command host deploy (pull `:latest` -> restart ->
  health-check -> prune). The prune reclaims disk that CI&apos;s per-commit
  images (~1.4 GB each) and build cache would otherwise accumulate until
  the host fills and the on-boot migration fails; it keeps the newest few
  per-commit tags as rollbacks and never removes the running image.

### Added
- **Event mode** (new admin **Events** page): create an event with a name and
  a start/end window (plus an optional note and its own access-plan
  overrides). While an event is live, every new guest registration is
  auto-tagged to it (`GuestRegistration.eventId`), so a one-night event&apos;s
  guests and devices are all traceable together - the Events list shows live
  per-event guest / device / registration counts and a per-event CSV export,
  and an event can be closed early to stop tagging. An active event&apos;s plan
  overrides sit in the precedence chain **voucher &gt; event &gt; location &gt;
  site default**. Audited `event.create` / `event.close`; migration adds the
  `Event` table + `GuestRegistration.eventId`.
- **Device SSH debugging tools** on the Network Map (full admins only, all
  audited): a **diagnostics** button that runs a read-only allowlist
  (uptime/load, memory, top processes, interfaces, routes, AP association
  list) over SSH and shows the output; an **interactive terminal**
  (xterm.js over an HTTP long-poll transport) into the device; and an
  advanced **command box** that runs one arbitrary command (recorded
  verbatim in the audit log). Device SSH credentials (the controller-pushed
  device login) are configured in Settings → UniFi as a blank-keeps secret
  + migration. The target host is always resolved from the controller&apos;s
  device list by MAC - never from the caller - so the tools can&apos;t be
  aimed off the fleet. Audited as `device.diag` / `device.exec` /
  `device.terminal`.
- **Device remote controls** on the Network Map (full admins only): from a
  device's detail dialog, **Restart** the device, **Locate** (blink its
  LEDs), and **power-cycle a specific PoE port** to reset whatever hangs off
  it - all via the UniFi `cmd/devmgr` API, so they work even when a device
  is wedged. The MAC must resolve to a real adopted device; every action is
  audited (`device.restart` / `device.power_cycle` / `device.locate`).
  Monitors and operators can view the map but the action route 403s them.
- **Network Map** (`/admin/map`, all admin roles): a physical topology view
  of the UniFi site - every device nested under the switch or gateway it
  uplinks through (gateway -> switches -> APs), which doubles as grouping
  devices by their uplink. Nodes are status-colored, show IP / client
  count / ports-up / firmware-update flags and the uplink port + speed +
  PoE draw; click one for a detail dialog (model, uptime, CPU/mem, radios).
  Built from `listDevices()` + `listStations()` (wired clients counted via
  `sw_mac`, wireless via `ap_mac`); pure inline SVG/flex, no external libs.
  First slice of the network-visualization work; device actions (restart,
  SSH) land in follow-ups.
- **Tiered plans** (roadmap Phase 4, completing the phase): every location
  can override the site-wide guest defaults - duration, download/upload
  limits, data quota, and device cap (Settings -> Locations -> "Access
  Plan", blank = default). All grant points resolve through one shared
  helper so they can't drift: registration, self-service add device,
  renew, the post-email-verification upgrade (each device upgrades to
  ITS location's duration), and the grace window (plan bandwidth/quota,
  grace duration). Precedence: voucher > location plan > site default.
- **Vouchers** (roadmap Phase 4): pre-generated codes guests can enter on
  the registration form ("Have a voucher code?"). A voucher carries its
  own duration, optional bandwidth limits and data quota (blank = site
  defaults), a per-code use count (1..n or unlimited), an optional
  redemption deadline, and stands in for email verification. New admin
  page **Vouchers** (batch create up to 200 codes, list with status,
  revoke, CSV export; codes use an unambiguous A-Z/2-9 alphabet shown as
  XXXX-XXXX). Redemptions are claimed atomically (no double-spend on the
  last use), recorded on the registration row (`voucherId`), and audited
  (`voucher.create` / `voucher.revoke`; `guest.register` gains the
  voucher id). Vouchers are portal-native - UniFi's internal voucher
  store is not used, since the external-portal auth never consults it.
- **Expiry notifications** (roadmap Phase 4, Settings -> Email): when
  enabled, a background job (every 5 minutes) emails guests a branded
  warning with a renew link before their access window runs out
  (configurable lead time, default 60 min). One email per registration
  (`expiryNotifiedAt`), only for the row that currently governs the
  device (a re-registered device gets a fresh warning for its new
  window), never for never-expiring access, and guests without an email
  address are skipped. Runs that send (or fail to send) anything are
  audited as `expiry.notify`. New settings `expiryNotifyEnabled` /
  `expiryNotifyLeadMin` + migration.
- **Port/VLAN visibility and trunk tracing** (roadmap Phase 5 follow-up):
  - Network page: an Uplink column on every device (which switch/gateway
    port it hangs off, mesh flagged) and a collapsible per-device Ports
    table (link state/speed, PoE draw, and each port's VLAN behavior -
    native network, tagged policy, exclusions).
  - New troubleshooting runbook **Guest VLAN / trunking check**: traces
    every AP's wired uplink path hop-by-hop to the gateway and verifies
    each guest SSID's VLAN is carried on every port along the way -
    flags excluded VLANs, access-port/block-all misconfigurations, and
    reports each AP's management (native) network.
  - The *device offline* runbook now also inspects the offline device's
    last-known uplink port: link down -> cable/PoE guidance; link up ->
    "device hung" guidance plus that port's VLAN config (native-VLAN
    changes that strand a device from the controller).
- **Guided troubleshooting runbooks** (`/admin/troubleshoot`, all admin
  roles): four Cisco DNA Center-style assurance guides that check live
  data and walk the operator through the fix - read-only, never change
  anything, audited as `troubleshoot.run` (outcome counts only, no guest
  identifiers). (1) *A guest can't get online* (by phone or MAC): finds
  the registration, checks revocation/expiry, email-verification lapse,
  device cap, live association (SSID/IP/signal, weak-RSSI and no-DHCP
  warnings), and whether the controller actually authorizes the MAC.
  (2) *A network device is offline or unhealthy*: per-state recovery
  guidance (offline/adoption/heartbeat/isolated...), recent-reboot and
  CPU/memory pressure warnings. (3) *The captive portal doesn't pop up*:
  captive-URL sanity + live reachability probe, hotspot settings diff,
  guest-SSID policy, plus the client-side checklist (MAC randomization,
  VPN/private-DNS, walled garden). (4) *The UniFi controller is
  unreachable*: classifies the failure as network/DNS, TLS trust,
  credentials, or permissions with the matching fix.
- **Dark mode**: the whole app (admin panel and guest portal) now follows
  the OS color scheme by default, with a Light / Dark / System toggle in
  the admin sidebar (and the phone top bar), persisted per browser in
  localStorage. The theme is applied by an inline script before first
  paint (no flash); the existing shadcn dark token set was activated via
  a Tailwind v4 class-based `dark` variant, hardcoded light-only colors
  were moved onto theme tokens, and green/amber status accents gained
  dark-mode variants. The configured brand color stays identical in both
  themes.
- **Network Status page** (`/admin/status`, all admin roles): live UniFi
  device health - every adopted AP/switch/gateway with state, IP, client
  count, CPU/memory, uptime, firmware (+ "update available" tag), per-radio
  channel/utilization/clients for APs and ports-up for switches - plus
  per-subsystem site health cards (WiFi/LAN/WAN/Internet: adopted vs
  disconnected counts, client totals, WAN IP, latency, last speedtest,
  live throughput). An issues list up top surfaces anything needing
  attention: offline/adopting devices, disconnected subsystem members,
  pending firmware updates, CPU/memory >= 90%, radio channels >= 80%
  utilized. First slice of roadmap Phase 5.

## 2026-07-03 - Pangolin hardening: full resource coverage, apply dialog, IP targets, admin-path rules (PRs #12-#17, `9628057`...`3164521`)

### Added
- **Guest-facing Pangolin resources now block the admin paths.** Check
  verifies (and Apply enforces) `applyRules` plus two `DROP` `PATH` rules
  - `/admin/*` and `/api/admin/*` - on the Captive Portal and Guest
  resources, so guests cannot reach the admin UI or admin API through
  those hostnames (a `*` segment in Pangolin's matcher spans any depth,
  including the bare path). The Admin URL resource is untouched. New API
  key permissions listed in the checklist: List/Create/Update Resource
  Rules.

### Fixed
- **Pangolin targets are now truly IP-only and self-healing.** A blank
  Proxy Target IP auto-detects the container's own LAN address (Docker
  bridge 172.16/12 interfaces skipped) instead of falling back to the
  captive hostname, whose public DNS points at Pangolin itself and loops.
  The "Forwards to this portal" check now fails when *any* extra target
  with a wrong ip:port exists on a managed resource, and Apply deletes
  those wrong targets (new `deleteTarget` client call + permission listed
  in the checklist) instead of only adding the right one.
- Creating a Pangolin resource on current Pangolin versions failed with
  `400: mode is required when deprecated fields are not provided` - the
  create call now sends `mode: "http"`, with a retry without it for older
  servers that reject the unknown key.
- Entering the password in the Apply dialog no longer triggers a spurious
  "Settings saved!" - the dialog's submit bubbled up React's component
  tree into the surrounding settings form. Apply now only runs after the
  final dialog step (2FA code when enrolled).
- **Pangolin targets now point at the portal's LAN IP, not the captive
  hostname.** New Settings -> URLs field **Proxy Target IP**
  (`portalTargetIp`, `PORTAL_TARGET_IP` env fallback, new migration):
  Check/Apply build the resource target from it, falling back to the
  Captive Portal URL's host when blank. Needed because the captive
  hostname's public DNS points at the Pangolin VPS itself - a hostname
  target would loop the proxy back into Pangolin instead of reaching the
  portal container.

### Changed
- **Pangolin Apply is now a stepped confirmation dialog**: pressing "Apply
  Selected" opens a popup that first lists the exact changes about to be
  made (each failing check as `current -> desired` per resource), then -
  when the Admin URL resource is included - asks for the account password
  (username shown read-only), and finally the one-time 2FA code on its own
  step (only when the account has TOTP enrolled). Wrong password returns
  to the password step, wrong/missing code to the code step. Replaces the
  browser `confirm()` plus always-visible inline password/2FA fields.

### Added
- **Pangolin Check/Apply now covers the Captive Portal URL** as a third
  resource (alongside Guest and Admin) whenever it is hostname-based
  (e.g. `http://portal.example.com`); bare-IP captive URLs still get no
  resource. For plain-HTTP URLs the check verifies SSL is **off** on the
  Pangolin resource and Apply disables it, so the captive host is served
  HTTP-only (captive redirects must not bounce to HTTPS); previously the
  SSL state was only checked/enforced for `https://` URLs.

## 2026-07-03 - URLs tab with Pangolin one-click apply

### Added
- **Settings -> URLs**: one tab consolidating the Captive Portal URL (moved
  from Settings -> UniFi "Server Base URL"), the Guest Self-Service URL
  (moved from Settings -> Portal), the new **Admin URL**, and the Pangolin
  connection (URL + API key; the key is a secret - GET returns it blank and
  a blank save keeps the stored value, like the UniFi/SMTP passwords).
  `ADMIN_BASE_URL` / `PANGOLIN_URL` / `PANGOLIN_API_KEY` env fallbacks.
  The tab lists the exact Pangolin API-key permissions the integration
  needs (read set for Check, write set for Apply). An optional
  **Organization ID** field (`PANGOLIN_ORG_ID` fallback) lets an
  org-scoped API key be used - the least-privilege setup; blank falls
  back to auto-discovery via `listOrgs`, which requires a server-admin
  key.
- **Pangolin one-click apply**: "Check Configuration" reads the Pangolin
  org/sites/domains/resources over its integration API (`/api/v1`, Bearer
  API key) and shows a per-resource diff (resource exists, enabled, SSO off,
  host-header passthrough, HTTPS, forwards to the captive-portal target)
  for the Guest and Admin URLs without changing anything; "Apply Selected"
  creates or updates only what mismatches. The captive-portal URL itself
  deliberately gets no Pangolin resource (it must stay plain LAN HTTP for
  the UniFi redirect). Applying changes to the **admin** resource requires
  re-entering the account password (+ TOTP when enrolled) at apply time -
  a live session cookie alone cannot break admin access. Everything is
  audited (`pangolin.check` / `pangolin.apply`, including denied re-auth).

### Fixed
- The Pangolin client now targets the integration API's real path prefix
  (`/v1`); it previously appended `/api/v1`, which on the dashboard domain
  is Pangolin's cookie-authenticated core API and rejects every API key
  with 401. Admins enter just their Pangolin URL - the portal
  auto-discovers where the integration API answers (`api.<host>/v1`,
  then `<host>/v1`, via its health endpoint; a URL ending in `/v1` is
  used verbatim) and caches the winner for five minutes.

### Changed
- Settings -> UniFi no longer has the "Server Base URL" field; the derived
  External Portal URL now reads the Captive Portal URL from Settings -> URLs.
  Settings -> Portal no longer has the Guest Self-Service URL field.

## 2026-07-03 - Build version indicator

### Added
- **Version ticker**: CI bakes the git commit SHA + commit timestamp into
  the image; the admin sidebar shows `build <short-sha> - <date>` (full SHA
  on hover) and a new unauthenticated `GET /api/health` returns
  `{ ok, commit, builtAt }` so "is the container running the latest build?"
  is answerable at a glance or with one curl. Local/dev builds show `dev`.

## 2026-07-03 - Portable branding (no network-specific strings in code)

### Changed
- The portal is deployable on any network/domain: the hardcoded
  "GUEST-NET" mentions (captive-portal fallback text, UniFi setup
  instructions) and the "501st Portal" admin header are gone - the admin
  header now shows the configured Brand Name, and the guest/setup texts are
  generic. Fresh-install defaults (brand name, welcome text, terms) are
  neutral; existing installs keep their configured values. Example
  placeholders now use example.com.

## 2026-07-03 - Configurable guest self-service URL (two-hostname setup)

### Added
- **Guest Self-Service URL** (Settings -> Portal, blank = single-host as
  before): dedicates the captive host (e.g. portal.example.com) to first-connect
  registration and moves guest account management (login, my-devices,
  my-info, email confirmation) to a second URL (e.g. https://wifi.example.com,
  HTTPS via the reverse proxy). Self-service pages reached on the wrong host
  redirect there (verify tokens and query strings preserved); the magic
  link, "Manage your devices" links, and verification emails point at it;
  its root goes straight to the login page. Host-only session cookies mean
  guest sessions live entirely on the self-service host. `GUEST_BASE_URL`
  env fallback supported.

## 2026-07-03 - Guest email verification

### Added
- **Email verification** (Settings -> Email, off by default): when enabled,
  registration requires an email address and grants a short **free window**
  (default 60 min) plus a branded confirmation email. The link opens
  `/portal/verify`, signs the guest in automatically, and one click confirms
  the address, upgrades every active device to the configured full duration,
  and lands them on their device list. A guest who lets the window lapse
  unverified gets a "you didn't confirm your email - check your inbox"
  screen on reconnection with a **grace window** (default 30 min) and a
  resend button; my-devices shows the same nudge as a banner. Unverified
  guests cannot add devices, and renewing only re-grants the grace window.
  Changing the profile email resets verification.
- **SMTP + email design in the GUI**: host/port/security/credentials/from
  (password blank-keeps like the UniFi one), template subject/heading/body/
  button text, free/grace window minutes, enable toggle, and a
  **send-test-email** button. The email is rendered with the Branding
  logo and primary colour. New audit actions: `guest.email_verified`,
  `guest.verify_grace`, `guest.verify_resend`, `settings.email_test`.
- Admin user page shows an email verified/unverified badge.

## 2026-07-03 - Editable locations, data retention, troubleshooting columns

### Added
- **Editable locations** (`Location` table + Settings -> Locations): up to 12
  registration locations, each with a name, an optional logo (picked from an
  upload **library** dialog or a new upload), its own building list, and its
  own data-retention policy. The guest portal renders them as clickable
  tiles; with exactly one location it is auto-selected, with none the
  location step is skipped entirely. The previous hardcoded On Base /
  Deployed choice is migrated into the first two rows (building lists
  copied). Location create/update/delete is audited.
- **Data-retention policy** (roadmap Phase 2 item): hourly in-process job
  (`instrumentation.ts` -> `src/lib/retention.ts`) anonymizes registrations
  (name, contact details, IP, user agent, label scrubbed; phone replaced by
  a non-reversible `anon-<id>` placeholder) once they are N days past
  expiry/revocation, per the owning location's policy - *keep forever* for
  permanent-staff locations, *anonymize after N days* for temporary-staff
  locations. A global default covers registrations without a location, and
  an audit-log retention window (0 = keep forever) prunes old `AuditLog`
  rows. Settings -> Locations has the defaults, a **Run retention now**
  button, and last-run stats; every run (scheduled or manual) writes a
  `retention.run` audit entry. Active and never-expiring registrations are
  never touched.
- **Troubleshooting columns**: Active Sessions now shows each client's IP,
  VLAN, and network name (merged from `/stat/sta` + `rest/networkconf`), and
  the guest name links to the user profile. The user page's device table
  gained an IP / Network column from the same live data.

### Changed
- **Users table device count fixed**: now counts distinct currently-active
  devices (same semantics as the user page's "Devices (N)") instead of every
  non-revoked registration row, which inflated the number with expired
  authorizations and per-device re-registration history.
- **Traffic report bars** show each row's share of the list's total with a
  percentage label, instead of scaling to the largest row (which pinned the
  top bar at 100% and made the bars look frozen).
- **"New User" button** moved from the Users page header into the table
  toolbar next to search, renamed **Register Guest**.
- Settings -> Portal no longer hosts the building lists (moved to Settings ->
  Locations); `SystemSettings.baseBuildings`/`deployedBuildings` are retained
  in the schema but no longer written.

## 2026-07-03 - Audit trail (`f15ab98`)

### Added
- **Audit trail** (`AuditLog` table + `/admin/audit`, full admins only):
  append-only record of admin actions (account management, settings, uploads,
  hotspot apply, guest create/edit/revoke/delete), guest self-service
  mutations (registration, login, device add/remove/renew/label, profile),
  admin login successes/failures, permission denials (logged centrally in
  `requireAdmin`), and **every traffic-data lookup** (site-wide and
  per-guest). Viewer filters by actor/target, action group, and date range;
  CSV export. Audit writes are fire-and-forget so a logging failure never
  breaks the operation being logged.

## 2026-07-03 - Traffic visibility & least-privilege permissions (`3b33715`...`b9ae67e`)

### Added
- **Traffic reports** (`/admin/traffic` + per-guest section on the user page):
  app/category breakdown and top clients from the UniFi OS v2 traffic API,
  with a bundled DPI id->name catalog (`src/lib/dpiCatalog.ts`).
- **Traffic-data grant**: per-account `canViewTraffic` toggle (Settings ->
  Admins), off by default, independent of role.
- **Operator role**: manages guests and devices but has no access to system
  settings, UniFi configuration, uploads, or account management.
- **Delete User**: removes all records for a guest and revokes their devices
  on the controller.
- Access-point **names** (instead of MACs) on the sessions, connection-history,
  and roaming-history tables.

### Changed
- Privileged admin API requests now re-check the account in the database
  (existence, current role, grants) - demotion, deletion, and grant revocation
  apply immediately instead of at session expiry.
- Settings API no longer returns the UniFi controller password to the browser
  (blank on save = keep).

## 2026-07-02 - Admin accounts, 2FA, setup flow, hotspot one-click (`0fba480`...`0413924`)

### Added
- **Admin accounts** (`AdminUser` table): per-person usernames, scrypt-hashed
  passwords, roles; management UI at Settings -> Admins with last-admin
  delete/demote protection.
- **TOTP 2FA** per account (RFC 6238, QR enrolment at `/admin/account`),
  admin-side reset for lost authenticators.
- **First-time setup flow**: blank username + `ADMIN_PASSWORD` env var works
  only while no admin-role account exists and forces creation of a personal
  admin account; doubles as the recovery path.
- **One-click UniFi hotspot configuration** (Settings -> UniFi): checks the
  controller's `guest_access` settings against what the portal needs, lists
  SSID guest policies, and applies everything in one action.
- Guest session duration `0` = **never expires** (UI, expiry displays, UniFi
  authorization window).

### Changed
- Responsive layouts for phones: guest device list becomes stacked cards, the
  admin panel gains a mobile top bar with navigation, form grids collapse.

### Removed
- The **shared admin password** (DB-stored `adminPassword` setting, Security
  settings tab, and any live shared-password sessions). `ADMIN_PASSWORD` in
  the environment remains only as the setup/recovery credential.

### Security
- Zero-admin lockout fixed (bootstrap keyed to admin-role account count);
  reserved sentinel usernames; login rate limit adjusted for 2FA's two-step
  flow; timing-equalized username probing.

## 2026-07-02 - Usage stats, renew, quotas, site charts (`49f0687`...`e239197`)

### Added
- Per-device usage sparklines/totals (controller report store), time-remaining
  and one-click renew on guest and admin device lists, optional guest data
  quota, dashboard site traffic/client charts, per-guest connection session
  history.

### Fixed
- Hardened portal registration and device management (validation, cross-phone
  duplicate guard, UniFi-failure rollback); relative redirects for
  logout/magic links; expiry-aware admin device views.

## 2026-07-01 - Guest self-service & admin Users (`d706bc3`...`29275fd`, PR #1)

### Added
- Guest profile editing (`/portal/my-info`), live per-device UniFi status,
  device labels, MAC-finding instructions; admin **Users** directory with
  per-guest detail (profile, devices, history, add/revoke on behalf, create
  guest); shared device-operation helpers; canonical-host redirect.

## Earlier (project bootstrap -> 2026-06)

- Captive portal registration flow against the UniFi controller
  (classic + UniFi OS), branding customisation (logo/background/colours/terms),
  admin dashboard/logs/sessions, DB-backed settings with env fallback,
  Postgres in Docker with automatic migrations, Gitea Actions CI publishing
  the image to the Gitea registry, self-hosted runner.
