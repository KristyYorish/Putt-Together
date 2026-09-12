# Putt Together

Find people to golf with across BC.

## What's here

| File | What it does |
| --- | --- |
| `src/putt-together.jsx` | The app |
| `src/courses.js` | Every BC golf course and pitch & putt, tagged by area. Edit this file to add or remove a course |
| `src/storage.js` | Talks to the server (sign-in, your details, games) and keeps text size in the browser |
| `src/main.jsx`, `index.html` | Starts the app |
| `netlify/functions/api.mjs` | The server: email sign-in, members, games, and who can see what (uses Netlify Blobs, no setup needed) |
| `netlify/functions/subscribe.mjs` | Sends newsletter sign-ups to Beehiiv |
| `netlify.toml`, `package.json`, `vite.config.js` | Tell Netlify how to build the site |

## Deploying on Netlify

1. In Netlify, choose **Add new project → Import an existing project → GitHub**, and pick this repo.
2. Netlify reads the settings from `netlify.toml`, so just click **Deploy**.

Every change you commit to GitHub goes live automatically.

## Signing in

Members sign in with their email address, no password. They type their email, we send a link and a 6-digit code, and tapping the link (or typing the code) signs them in for a year on that device. The same person can sign in on a phone and an iPad and see the same games. Under My games there's a Sign out button.

For the emails to go out, the site needs a Resend account (resend.com, the free tier is plenty):

1. In Resend, add and verify a domain you own (a subdomain like `mail.merchantsofplay.com` is ideal: three DNS records at your domain registrar).
2. Create an API key.
3. In Netlify, go to **Project configuration → Environment variables** and add:
   - `RESEND_API_KEY`: the key
   - `MAIL_FROM`: the sender, for example `Putt Together <hello@mail.merchantsofplay.com>`
4. Redeploy (Deploys → Trigger deploy).

Until those are added, the sign-in screen says the email isn't set up yet.

## Pictures and hiding

- **Pictures.** Everyone starts with their initial. Under My games → Your details (or the one-time "Add a picture?" panel) they can pick an emoji or add a photo. Photos are shrunk to a 120-pixel square in the browser before they're saved, and travel with the person's name into the games they post or join.
- **Would you play with them again?** Once a game's tee time is well past, Find a game asks each person in it about the others, privately. "Rather not" hides the two people from each other: neither sees games the other is in (games they're already in together stay), and nobody is told. The hide list lives only on the server. Hidden golfers can be unhidden under My games.

## Turning on the newsletter

In Netlify, go to **Project configuration → Environment variables** and add:

- `BEEHIIV_API_KEY`: your Beehiiv API key
- `BEEHIIV_PUBLICATION_ID`: your publication ID (starts with `pub_`)

Then redeploy. Until these are added, sign-ups are kept in each person's app and sent the next time they open it.
