# robolance demo site

The replay page: a run shared from OpenLance's Hardware tab ("Share this run" in the Runs view) opens here and replays with the same Circuit, Arena and Runs views as the IDE. The link carries the run itself, deflated into its fragment, so nothing is uploaded and no account is needed. The page also opens a `?run=<url>` to a recorded run file and takes a dropped `.robolance/runs/<time>.json`.

```sh
npm run build            # from the repository root: builds every package, then this site into demo/site/
npx serve demo/site      # http://localhost:3000/replay/
```

`.github/workflows/pages.yml` builds and publishes `demo/site/` to GitHub Pages on every push to `main` (Settings → Pages → Source: GitHub Actions), served at https://robolance.openlance.ai (a `CNAME` record for `robolance` pointing at `shaikh-amer.github.io`, DNS only, and the custom domain set in the Pages settings). The replay URL the IDE links to is `REPLAY_PAGE_URL` in `packages/openlance-hardware/src/browser/share-run.ts`.
