# Bet Flow Capture

Captures all network traffic from a sportsbook while you place a bet. One run per book gives us everything needed to build the automated bet placement system.

## Setup (one time)

**1. Install Node.js**

Download and install from https://nodejs.org — use the LTS version. Run the installer with all defaults.

**2. Clone this repo and install**

Open a terminal (Command Prompt, PowerShell, or Terminal) and run:

```bash
git clone https://github.com/timmyscooter/poller_betPlacement.git
cd poller_betPlacement
npm install
npx playwright install chromium
```

That's it. You're ready.

## Running a Capture

Run one command per sportsbook:

```bash
npm run capture:dk     # DraftKings
npm run capture:fd     # FanDuel
npm run capture:mgm    # BetMGM
npm run capture:czr    # Caesars
npm run capture:365    # Bet365
```

Or directly:
```bash
node capture-bet-flow.mjs draftkings
```

## What to Do in the Browser

A Chrome window opens automatically. Then:

1. **Log into your account**
2. **Browse around the site a bit** — check your account page, balance, bet history
3. **Navigate to a live or upcoming game**
4. **Add a moneyline selection to your bet slip** (pick a heavy favorite for low risk)
5. **Enter the minimum stake** ($1, $5, whatever the minimum is)
6. **Place the bet**
7. **Wait for the confirmation screen** — don't close anything
8. **Check your bet history page** — navigate to it so we capture that API too
9. **Press Ctrl+C in the terminal** to save everything

## What Gets Captured

Everything:
- All HTTP requests and responses (URLs, headers, cookies, request/response bodies)
- All WebSocket frames (text and binary)
- Browser cookies, localStorage, and sessionStorage
- Console messages
- Screenshots every 15 seconds
- Auto-saves every 30 seconds in case of crash

## Output

Each run creates a folder like `capture-draftkings-1743319200000/` containing:
- `capture.json` — all network traffic, storage, cookies
- `screenshot-0001.png` through `screenshot-XXXX.png` — periodic screenshots

**Send the entire folder** for each book.

## Tips

- **Use a real Chrome-like browsing pattern** — don't rush. Click around naturally.
- **Do NOT close the browser window** — press Ctrl+C in the terminal instead.
- **If the browser crashes**, the auto-save has your data — check for `capture-autosave.json` in the output folder.
- **Place only one bet per run** — keeps the capture clean and easy to analyze.
- **A minimum stake moneyline bet on a heavy favorite** is ideal — low risk, guaranteed liquidity, simplest bet type.
