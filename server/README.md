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

   The Wrangler configuration applies Durable Object code updates immediately. Deploying while players are connected closes their WebSockets; browsers reconnect automatically.

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
- Scene flags: a click on visible scene geometry in Overview creates a shared flag. The Durable Object stores the latest 50 flags and includes them in the welcome snapshot for new visitors.
- Each browser keeps its own camera and runs its own physics. Remote transforms are eased locally between 20 Hz state updates; a heartbeat watchdog reconnects a stale WebSocket.

Terrain geometry, weather, editor data, camera controls and collision physics are not sent over the network.
