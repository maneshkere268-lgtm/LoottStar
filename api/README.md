# LootStar API

The browser application and API do not use Firebase. A new PostgreSQL database starts empty: the first authenticated Telegram request creates a zero-balance account. Existing Firebase data is intentionally not imported.

## Requirements and local setup

- Node.js 20 or newer
- PostgreSQL 14 or newer
- A Telegram bot token, stored only in the server environment

From this directory, install dependencies, copy `.env.example` to `.env`, set the values, create the PostgreSQL database/user, then run:

```sh
npm run db:migrate
npm start
```

The server binds to `127.0.0.1`; put Nginx or another TLS reverse proxy in front of it. Configure `CORS_ORIGINS` with the exact web-app origin(s). Keep `TRUST_PROXY=false` unless the API is behind a trusted reverse proxy.

`GET /health/live` is a process check; `GET /health/ready` also checks PostgreSQL. Authenticated endpoints require `Authorization: tma <Telegram.WebApp.initData>`. The server validates Telegram's signature and timestamp itself. The API registers a zero-balance PostgreSQL profile when an authenticated Telegram user makes their first API request.

Opening the site in a regular browser outside Telegram is a read-only preview: it does not create or persist a guest profile, and server-backed account and game operations require Telegram WebApp authentication. Use the Telegram WebApp to load and save player progress.

## Current API surface

- `GET /api/v1/me` returns the authenticated account state.
- `GET /api/v1/balance/ledger?limit=100` returns the authenticated user's recent server-recorded balance operations.
- `POST /api/v1/shop/buy` purchases a catalog item using a server-owned price and a unique UUID `Idempotency-Key`.
- `GET /api/v1/app-config/:key` serves only the allowlisted `rates`, `rtp`, and `tech` settings from PostgreSQL.
- `POST /api/v1/profile/ropeko/settle` settles eligible Ropeko earnings using server time and a unique UUID `Idempotency-Key`.
- `GET /api/v1/leaderboard?sort=stars` returns the top 50 users by stars; `sort=silver` selects silver. Once the configured prize deadline passes, the first eligible stars winner is stored in PostgreSQL so later balance changes do not change the result.
- `GET /api/v1/live-wins?limit=20` returns recent case wins recorded in PostgreSQL.
- `POST /api/v1/promos/redeem` accepts `{"code":"RELEASE"}` and a unique UUID `Idempotency-Key`. Built-in promos use server-owned definitions; custom promo records are read from PostgreSQL `app_records` (`promo_codes` namespace). Currency and item rewards, activation limits, and per-account redemption are checked server-side.
- `GET /api/v1/tasks/daily` returns today's task progress from server-recorded game operations and the account's server-held Halloween XP.
- `POST /api/v1/tasks/daily/claim` accepts `{"taskId":"star_bets_5"}` and a unique UUID `Idempotency-Key`. The server verifies operation-derived progress and atomically records the claim, credits the fixed reward, and adds XP.
- `POST /api/v1/balance/spend` atomically spends an existing balance. Send JSON `{"currency":"star","amount":10}` and a unique UUID `Idempotency-Key` header.
- `POST /api/v1/withdrawals` accepts `{"amount":50000000}` and a unique UUID `Idempotency-Key`. Rates and minimum/maximum limits are enforced server-side; the balance debit, ledger entry, and request creation are one transaction.
- `POST /api/v1/staking/operate` accepts a server-validated `action` (`activate`, `stop`, `top_up`, or `claim`) and owned `itemId`; top-up also accepts `amount`. The server controls stake duration, earnings, expiry, balance changes, and inventory persistence. Each operation requires a unique UUID `Idempotency-Key`.
- `POST /api/v1/profile/phone/operate` accepts `roll`, `resolve`, `sell`, or `install`; the server generates phone numbers, charges the roll cost, computes all sale payouts, and updates owned phone items atomically. Each request uses a unique UUID `Idempotency-Key`; phone state is returned by `GET /api/v1/me`.
- `GET /api/v1/trades/users?q=prefix` searches registered, non-banned users; `POST /api/v1/trades/prepare` assigns stable IDs to inventory items before trading.
- `GET /api/v1/trades/me` lists the authenticated user's pending trades; `GET /api/v1/trades/:tradeId` loads a trade only for one of its participants.
- `POST /api/v1/trades` accepts `{"targetUserId":"12345","itemIds":["item-1"],"stars":100}` and a unique UUID `Idempotency-Key`. Offered assets are reserved atomically for 24 hours. `POST /api/v1/trades/:tradeId/operate` supports sender acceptance, counter-offers, completion, rejection, and expiry; settlement and refunds update both accounts atomically.
- `GET /api/v1/referrals/me` returns the authenticated account's referral code, server-side join count, and referrer. `POST /api/v1/referrals/join` accepts a numeric `referrerId` and a unique UUID `Idempotency-Key`; an account can be attached to only one non-self existing account.
- `GET /api/v1/app-config/events` returns the `events` and `halloween` JSON settings from PostgreSQL for client display.
- `GET /api/v1/halloween/state` returns server-held pumpkins, Halloween XP/pass claims, wheel cooldown and Trick-or-Treat progress.
- `POST /api/v1/halloween/operate` accepts a server-validated action (`case_open`, `wheel_spin`, `pass_claim`, `treat_start`, `treat_stop`, `treat_claim`, or `brew_buy`) and a unique UUID `Idempotency-Key`. The server chooses all outcomes, checks event dates, cooldowns, XP/pro-pass access and pumpkin balances, then stores the reward and state atomically.
- `POST /api/v1/cases/open` accepts `{"caseId":42,"quantity":1}` and a unique UUID `Idempotency-Key`. The server chooses outcomes, enforces the daily free-case limit, and atomically updates the balance ledger and inventory. The authoritative case catalog is checked against the frontend catalog by tests.
- `POST /api/v1/inventory/sell` accepts server-owned item IDs and a unique UUID `Idempotency-Key`. The server validates ownership and sellability, calculates proceeds from stored item values, and atomically updates balances, inventory and ledger.
- `POST /api/v1/inventory/save` accepts `{"itemId":"owned-item-id","saved":true}` and a unique UUID `Idempotency-Key`. The server updates the saved flag only on an item in the authenticated user's PostgreSQL inventory. Saved or actively staked items cannot be sold.
- `POST /api/v1/inventory/upgrade` accepts `{"itemId":"owned-item-id","targetName":"Mirage Lamp (Iron Hearth)"}` and a unique UUID `Idempotency-Key`. The API validates ownership and target values from its catalog, calculates the actual success chance (displayed chance × 0.8), and atomically consumes the source item or awards the target. Replays return the original result.
- `POST /api/v1/inventory/craft` accepts `{"itemIds":["item-1","item-2","item-3"],"currency":"star"}` and a unique UUID `Idempotency-Key`. The server validates and consumes 3–9 owned items of the same currency, chooses the weighted multiplier, and atomically updates the balance, inventory, ledger and operation record.
- `POST /api/v1/games/bags/open` accepts `{"amount":100,"currency":"star"}` and a unique UUID `Idempotency-Key`. The server chooses the weighted multiplier, converts eligible payouts into catalog-owned items, and atomically settles the bet, balance, inventory, silver turnover and ledger.
- `GET /api/v1/games/fishing/current` restores the authenticated user's active round without disclosing future outcomes.
- `POST /api/v1/games/fishing/start` accepts `{"amount":100,"currency":"star"}` and a unique UUID `Idempotency-Key`; the server debits the stake and creates a per-user session.
- `POST /api/v1/games/fishing/continue` accepts `{"gameId":"..."}` and a unique UUID `Idempotency-Key`. The server selects the catch/bust outcome and advances the session; `/cashout` accepts `{"gameId":"..."}` and pays only the server-recorded catch multiplier. Both operations are replay-safe.
- `GET /api/v1/games/mines/current` restores the authenticated user's active Mines round without disclosing mine locations.
- `POST /api/v1/games/mines/start` accepts `{"amount":50,"currency":"star","minesCount":2}` and a unique UUID `Idempotency-Key`. The server debits the stake and generates the hidden mine positions in one transaction.
- `POST /api/v1/games/mines/reveal` accepts `{"gameId":"...","cell":0}`; `/cashout` accepts `{"gameId":"..."}`. Both require unique UUID `Idempotency-Key` values and compute outcomes, payout and balance changes server-side. An active round can be resumed after reloading the page.
- `POST /api/v1/games/slots/spin` accepts `{"amount":100,"currency":"star"}` and a unique UUID `Idempotency-Key`. The server chooses the outcome using the existing bet-tier probability tables, applies the payout cap, and updates the balance, ledger and silver turnover in one transaction.
- `POST /api/v1/games/plinko/drop` accepts `{"amount":100,"currency":"star","difficulty":"easy"}` and a unique UUID `Idempotency-Key`. The server chooses the winning bin from the existing difficulty probability table and atomically updates the balance, ledger and silver turnover.
- `GET /api/v1/games/crash/current` restores the authenticated user's active round. `POST /api/v1/games/crash/start` accepts `{"amount":100,"currency":"star"}` and starts a server-timed round after the betting countdown; the crash point is never sent while the game is active. `POST /api/v1/games/crash/cashout` accepts `{"gameId":"..."}` and the server computes the multiplier from its own clock and only credits if the request beat the crash time.
- `/api/v1/admin/*` exposes user search/editing, settings and app-record management, withdrawal listing and processing, an audit log, PostgreSQL statistics, process/system resource metrics, and a bounded in-memory HTTP request log. Rejecting a pending withdrawal refunds its LootStar balance in the same transaction and records a ledger entry; marking it paid does not execute the Telegram payout itself.

Admin endpoints require the authenticated Telegram ID to be listed in `ADMIN_TELEGRAM_IDS`; an empty list denies access. The admin interface is a local HTML file in `admin/`, not a Vercel deployment. When opened from disk, it uses a server-verified password to obtain an in-memory bearer session that expires after 15 minutes. Generate or change its password on the VPS with `sudo node /opt/lootstar-api/scripts/set-local-admin-password.js`, then restart the API. The password itself is never put in the HTML or sent in chat. The API permits browser requests only from origins listed in `CORS_ORIGINS`; `null` is needed for a local `file://` page. Request metrics retain method, route template, status, and latency only; they exclude IP addresses, query strings, headers, and request bodies and are cleared on API restart.

The local admin's Settings section can store the `events` and `halloween` JSON objects in `app_settings`. Configure these settings in PostgreSQL after the fresh deployment; old Firestore settings are intentionally not copied.

There is deliberately no public balance-credit endpoint. Wins and rewards must be computed and credited by trusted server-side game/reward operations; accepting a client-supplied win or credit would let users mint currency. Case opening, shop purchases, item sales/saving/upgrades/crafting, promo redemption, daily-task rewards, withdrawals, staking, phone roulette, trading, Halloween rewards, Bags, Fishing, Mines, Slots, Plinko, Crash and Ropeko enforce server-side validation and the applicable balance-pool and season limits. Settings and the balance checker also read from PostgreSQL. Daily task progress is derived from completed PostgreSQL game operations; claims atomically credit the fixed reward and add Halloween XP. Promo redemptions, including custom rewards, and referral joins are stored in PostgreSQL. Staking earnings are settled using server time and persisted in PostgreSQL; an administrator must execute Telegram withdrawal payouts manually and then mark them paid in the local admin panel. Rejection refunds the user automatically. The leaderboard reads rankings and its season winner from PostgreSQL. Upgrade no longer honors client-side Drain or Blessing state; the server decides every outcome and currently applies the configured 0.8 multiplier to the displayed base chance. Bags' two unchosen display bags remain cosmetic and are not credited. Mines, Slots and Plinko winnings are credited directly to the selected balance; their former client-side conversion of large wins into gift inventory items is no longer used. Crash rounds are per-user server sessions rather than the old client-simulated shared-looking round; demo player rows remain presentation only. Fishing sessions persist on the server and can be resumed after a reload; the displayed catch illustration is cosmetic. Firebase Admin SDK and Firestore transfer scripts are not included.

The API origin used by the local admin file is `https://api.immortals-market.ru`. Keep `null` in `CORS_ORIGINS` for the local HTML file. Do not expose port 3000 directly. All game/economy pages now use authenticated API operations; cached browser balances are presentation only and are not authoritative.

For production, edit `/etc/lootstar-api/api.env` on the VPS with `sudoedit` and set `DATABASE_URL=postgresql://lootstar@/lootstar?host=/var/run/postgresql`, `TELEGRAM_BOT_TOKEN` from BotFather, `ADMIN_TELEGRAM_IDS` to the administrator's numeric Telegram ID, and `CORS_ORIGINS` to a comma-separated list of exact frontend origins (for example `https://beamish-kleicha-cff127.netlify.app,https://lootstar.vercel.app,null`). Keep `null` only if you use the local `file://` admin page. Set `TRUST_PROXY=true` only after configuring a trusted proxy. Set the local admin password using the interactive script above. Restart with `sudo systemctl restart lootstar-api`. Do not send bot tokens or passwords through chat, commit them, or put them in static frontend files.

## Fresh database deployment

The Ubuntu bootstrap creates a new local PostgreSQL role/database and runs every checked-in migration. It deliberately refuses to overwrite an existing API installation or database. The database is empty; users start with zero balances, inventories, referrals, and event progress.

Before opening the site to users, set `TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_IDS`, and the actual frontend origins in `/etc/lootstar-api/api.env`, configure HTTPS and a trusted reverse proxy, then restart the API and verify `/health/ready` and authenticated application flows. Do not send tokens/passwords in chat or commit them. No Firebase export/import or Firebase project change is required for this fresh start.

Migrations `020_phone_operations.sql`, `021_trades.sql`, `022_halloween_event.sql`, and `024_ropeko_operations.sql` add phone, trade, Halloween, and Ropeko state. Run `npm run db:migrate` before deploying API code that uses a new migration. Generic client-provided balance updates and client-generated game results must never be accepted as authoritative.
