# Launch day

The `launch` branch swaps every "COMING SOON" for Apple's black "Download on the Mac App
Store" badge (`img/mac-app-store-badge.svg`), linking to
https://apps.apple.com/app/id6825285412. That's the header badge on every page and the
button at End of the Line.

Merge it only once Moonrail is live on the Mac App Store. Until then the link leads nowhere.

## On release day

1. Check that https://apps.apple.com/app/id6825285412 opens Moonrail's App Store page.
2. Merge and push:

   ```sh
   git switch main
   git pull
   git merge launch
   git push origin main
   ```

   If main has changed since the branch was made and the merge stops on a conflict, keep
   main's wording and the branch's badge markup, then `git add` the files and
   `git commit`.
3. GitHub Pages deploys in a minute or two. Open https://moonrailapp.github.io/ (do a hard
   reload), and check that the header badge and the End of the Line badge both open the
   App Store page. Then check privacy, terms, support and a missing page (the 404).

## Good to know

- The badge is Apple's own artwork, unaltered. Keep it at least 40px tall on screen (Apple's
  minimum). On phones up to 440px wide, the ride clock in the header is hidden so the badge
  can stay that size.
