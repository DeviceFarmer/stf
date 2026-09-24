## Unit Frontend

The web UI lives in `res/app/src` (React + TypeScript). Its specs sit next to the
code as `*.test.ts(x)` and run with Vitest in jsdom, no browser needed:

```
npm run test:component
```

Type checking and linting of the UI are part of `npm run lint` (`gulp lint` runs
eslint and `tsc -p res/app/tsconfig.json`).

## E2E Frontend

The end-to-end suite is Playwright, in `test/playwright`. It drives a running
`stf local` through a real Chromium.

- Run RethinkDB
  ```
    rethinkdb
  ```
- Run stf with mock auth
  ```
    ./bin/stf local --auth-type mock
  ```
  Wait till STF is fully functional and devices are discovered
- Install and run the suite
  ```
    cd test/playwright
    npm install && npx playwright install chromium
    npx playwright test ui.spec.js
    STF_DEVICE_SERIAL=emulator-5554 npx playwright test
  ```

`ui.spec.js` needs no device. `device.spec.js` skips itself unless
`STF_DEVICE_SERIAL` names a connected device.

Results land in `test-results/playwright` (an HTML report under `html/`, traces
and videos under `artifacts/`).

## Remote STF

- `export STF_URL='http://stf-url/'`
- `export STF_USERNAME='user'`
- `export STF_EMAIL='user@example.com'`
- `cd test/playwright && npx playwright test`
