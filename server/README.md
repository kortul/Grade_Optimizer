# Grade Optimizer · shared multiplayer relay

This WebSocket relay lets all visitors share one public resort. It does not run terrain, skier or drone physics: each browser keeps its own scene and camera, and sends only its current player transform and (for a skier) the articulated model pose.

There is one fixed Durable Object named `grade-optimizer-public-resort`. There are no rooms, invitation codes, accounts or saved sessions. The connection limit is four clients. Each browser receives a unique starting slot so skiers do not stack at the same automatic summit spawn.

## Deploy once on Cloudflare Free

1. Create a free Cloudflare account and enable the default Workers subdomain (`workers.dev`).
2. In a terminal, open this `server` directory and run:

   ```bash
   npm install
   npx wrangler login
   npx wrangler deploy
   ```

   The Wrangler configuration applies Durable Object code updates immediately. Deploying while players are connected closes their WebSockets; browsers reconnect automatically. Deploy again after changes to `server/src/worker.js` or `server/src/protocol.v2.js`; publishing GitHub Pages does not publish the Worker.

3. Wrangler prints an HTTPS address similar to `https://grade-optimizer-multiplayer.<your-subdomain>.workers.dev`.
4. Change `https://` to `wss://`, append `/ws`, and paste it into `MULTIPLAYER_SERVER_URL` in the repository-root file `multiplayer-config.v1.js`.
5. Commit and push that one-line config change. Every visitor to the GitHub Pages site then joins automatically.

No custom domain, VPS, paid database or Workers Paid subscription is needed for the four-person setup. The Durable Object uses WebSocket Hibernation to sleep while idle without disconnecting clients.

## Local test

```bash
npm test
npm run dev
```

Localhost is allowed by the Worker Origin check.

## Synchronized data

- Skier: ski-rig transform, velocity and 12 articulated joint transforms.
- Drone: drone/camera transform and velocity.
- Overview: each remote visitor is shown as a camera marker with a view-direction ray and name.
- Scene flags: a double-click on visible scene geometry in Overview creates an immediate local flag, even while the relay is reconnecting. Each page session can keep up to ten flags numbered 1–10; number labels update after a removal. Each flag shows only its sequential number (1–10) in a badge above the pole; there is no top-bar flag counter. The server broadcasts an authoritative marker snapshot so removals and renumbering appear in every browser. A stale local cache is never replayed after reconnect. Flags clear when their owner page exits, and orphaned flags from sessions that are no longer connected are pruned on the next join.
- Shared ruler: Overview measurements (one picked endpoint or a completed two-point line) are broadcast to all visitors, included in the welcome snapshot, and cleared when the owner disables the ruler or disconnects. Unacknowledged placements and clears retry after reconnect, with server revisions preventing an old measurement from replacing a newer action.
- Remote player nameplates are displayed at double the previous size. Each browser keeps its own camera and runs its own physics. Remote transforms are eased locally between 30 Hz state updates. Client and server drop stale state frames when the WebSocket send buffer grows, preventing a backlog of old positions; the heartbeat no longer sends redundant presence broadcasts.

Terrain geometry, weather, editor data, camera controls and collision physics are not sent over the network.
