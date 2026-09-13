# Putt Together

Find people to golf with across BC.

## What's here

| File | What it does |
| --- | --- |
| `src/putt-together.jsx` | The app |
| `src/courses.js` | Every BC golf course and pitch & putt, tagged by area. Edit this file to add or remove a course |
| `src/storage.js` | Talks to the server (sign-in, your details, games) and keeps text size in the browser |
| `src/main.jsx`, `index.html` | Starts the app. `index.html` also loads the two fonts |
| `public/fonts/` | Sora and Space Grotesk, the app's typefaces (open source, see the README in there) |
| `public/favicon.svg` | The green flag icon browsers show in the tab |
| `netlify/functions/api.mjs` | The server: email sign-in, members, games, who can see what, and the Contact us form (uses Netlify Blobs, no setup needed) |
| `netlify/functions/subscribe.mjs` | Sends newsletter sign-ups to Beehiiv |
| `netlify.toml`, `package.json`, `vite.config.js` | Tell Netlify how to build the site |

## Deploying on Netlify

1. In Netlify, choose **Add new project → Import an existing project → GitHub**, and pick this repo.
2. Netlify reads the settings from `netlify.toml`, so just click **Deploy**.

Every change you commit to GitHub goes live automatically.

## Signing in

Members sign in with their email address, no password. They type their email, we send a link and a 6-digit code, and tapping the link (or typing the code) signs them in for a year on that device. The same person can sign in on a phone and an iPad and see the same games. Under My games there's a Sign out button.

For the emails to go out, the site needs a Resend account (resend.com, the free tier is plenty):

1. In Resend, add and verify a domain you own (for example `putttogether.ca`, or a subdomain of a domain you already have). It's three DNS records at your domain registrar. Without a verified domain, Resend only delivers to the email address on the Resend account itself, which is fine for trying it out but not for real members.
2. Create an API key. Keep it private: anyone with the key can send email as you.
3. In Netlify, go to **Project configuration → Environment variables** and add:
   - `RESEND_API_KEY`: the key
   - `MAIL_FROM`: the sender, for example `Putt Together <hello@putttogether.ca>` (while testing without a domain, `onboarding@resend.dev` works)
   - `CONTACT_TO` (optional): where Contact us notes go. Default is savyorish@gmail.com
4. Redeploy (Deploys → Trigger deploy).

Until those are added, the sign-in screen says the email isn't set up yet, and the Contact us form offers a plain email link instead.

## Contact us

The small **Contact us** link at the bottom of every screen opens Syavash's note and a short form (name, email, message). Notes are emailed to `CONTACT_TO` with the sender's address as reply-to, so replying in Gmail goes straight back to them. Three notes per email address per hour.

## The look

Black background (`#0F0F0F`), card grey (`#202020`), neon green (`#5DD62C`) for anything you can tap, cream text (`#F8F8F8`). Sora for text and Space Grotesk for headings, both served from `public/fonts`. The **Larger text** button in the header (Aa on phones) scales the whole app up; it's remembered on that device. All of the styling is in one place, the `css` block near the top of `src/putt-together.jsx`.

## Pictures and hiding

- **Pictures.** Everyone starts with their initial. Under My games → Your details (or the one-time "Add a picture?" panel) they can pick an emoji or add a photo. Photos are shrunk to a 120-pixel square in the browser before they're saved, and travel with the person's name into the games they post or join.
- **Tee time passed.** A game leaves Find a game the moment its tee time passes, and nobody new can join it. People who are in it still see it under My games for three hours, so they can find the group or message that they're running late.
- **Would you play with them again?** Once a game's tee time is well past, Find a game asks each person in it about the others, privately. "Rather not" hides the two people from each other: neither sees games the other is in (games they're already in together stay), and nobody is told. The hide list lives only on the server. Hidden golfers can be unhidden under My games.

## Turning on the newsletter

In Netlify, go to **Project configuration → Environment variables** and add:

- `BEEHIIV_API_KEY`: your Beehiiv API key
- `BEEHIIV_PUBLICATION_ID`: your publication ID (starts with `pub_`)

Then redeploy. Until these are added, sign-ups are kept in each person's app and sent the next time they open it.
