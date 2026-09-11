# Putt Together

Find people to golf with across BC.

## What's here

| File | What it does |
| --- | --- |
| `src/putt-together.jsx` | The app |
| `src/storage.js` | Saves your profile in your browser and posted games on Netlify, so everyone sees the same games |
| `src/main.jsx`, `index.html` | Starts the app |
| `netlify/functions/storage.mjs` | Shared storage for posted games (uses Netlify Blobs, no setup needed) |
| `netlify/functions/subscribe.mjs` | Sends newsletter sign-ups to Beehiiv |
| `netlify.toml`, `package.json`, `vite.config.js` | Tell Netlify how to build the site |

## Deploying on Netlify

1. In Netlify, choose **Add new project → Import an existing project → GitHub**, and pick this repo.
2. Netlify reads the settings from `netlify.toml`, so just click **Deploy**.

Every change you commit to GitHub goes live automatically.

## Turning on the newsletter

In Netlify, go to **Project configuration → Environment variables** and add:

- `BEEHIIV_API_KEY`: your Beehiiv API key
- `BEEHIIV_PUBLICATION_ID`: your publication ID (starts with `pub_`)

Then redeploy. Until these are added, sign-ups are kept in each person's app and sent the next time they open it.
