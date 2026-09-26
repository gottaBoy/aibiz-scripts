// Launch a Chromium that exists on this machine.
//
// Playwright pins a browser build by revision, so a Playwright version that is
// older or newer than the one whose browsers were installed fails with
// "Executable doesn't exist" rather than falling back. The browser gates here
// assert on real page behaviour, so an unusable download is their only failure
// mode; a system Chrome is an equivalent target for them.

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

export async function launchChromium(chromium, options = {}) {
  try {
    return await chromium.launch({ headless: true, ...options });
  } catch (error) {
    if (!/Executable doesn't exist/.test(String(error?.message))) throw error;
    let last = error;
    for (const executablePath of CANDIDATES) {
      try {
        return await chromium.launch({
          headless: true,
          ...options,
          executablePath,
        });
      } catch (retry) {
        last = retry;
      }
    }
    throw new Error(
      `no usable Chromium: ${last?.message?.split('\n')[0] ?? String(last)}`,
    );
  }
}
