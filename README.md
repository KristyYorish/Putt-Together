# Putt Together

Find people to golf with across BC.

## What's here

| File | What it does |
| --- | --- |
| `src/putt-together.jsx` | The app |
| `src/courses.js` | Every BC golf course and pitch & putt, tagged by area. Edit this file to add or remove a course |
| `src/storage.js` | Saves your profile in your browser and posted games on Netlify, so everyone sees the same games |
| `src/main.jsx`, `index.html` | Starts the app |
| `netlify/functions/storage.mjs` | Shared storage for posted games and the hide list (uses Netlify Blobs, no setup needed) |
| `netlify/functions/subscribe.mjs` | Sends newsletter sign-ups to Beehiiv |
| `netlify.toml`, `package.json`, `vite.config.js` | Tell Netlify how to build the site |

## Deploying on Netlify

1. In Netlify, choose **Add new project → Import an existing project → GitHub**, and pick this repo.
2. Netlify reads the settings from `netlify.toml`, so just click **Deploy**.

Every change you commit to GitHub goes live automatically.

## Pictures and hiding

- **Pictures.** Everyone starts with their initial. Under My games → Your details (or the one-time "Add a picture?" panel) they can pick an emoji or add a photo. Photos are shrunk to a 120-pixel square in the browser before they're saved, and travel with the person's name into the games they post or join.
- **Would you play with them again?** Once a game's tee time is well past, Find a game asks each person in it about the others, privately. "Rather not" hides the two people from each other: neither sees games the other is in, and nobody is told. The shared hide list holds only a short fingerprint of each pair, never names or ids. Hidden golfers can be unhidden under My games.

## Turning on the newsletter

In Netlify, go to **Project configuration → Environment variables** and add:

- `BEEHIIV_API_KEY`: your Beehiiv API key
- `BEEHIIV_PUBLICATION_ID`: your publication ID (starts with `pub_`)

Then redeploy. Until these are added, sign-ups are kept in each person's app and sent the next time they open it.
