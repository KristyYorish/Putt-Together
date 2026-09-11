// netlify/functions/subscribe.mjs — Putt Together newsletter sign-up
//
// Keeps your Beehiiv API key secret on the server. The app posts
// { email, firstName, area } to /api/subscribe and this passes it on to Beehiiv.
//
// Setup:
// 1. In Beehiiv, create an API key and copy your publication ID (starts with "pub_").
// 2. In Netlify > Site configuration > Environment variables, add:
//      BEEHIIV_API_KEY         your key
//      BEEHIIV_PUBLICATION_ID  pub_xxxxxxxx
//    then redeploy (Deploys > Trigger deploy).
// 3. Optional: in Beehiiv, create custom fields named "First Name" and "Region"
//    so you can personalise newsletters and send regional ones. If you skip
//    this, delete the custom_fields block below.
//
// Until the keys are added, sign-ups are kept in each person's app and sent
// the next time they open it.

const reply = (body, status = 200) => Response.json(body, { status });

export default async (req) => {
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);

  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUBLICATION_ID;
  if (!apiKey || !pubId) {
    console.error("Beehiiv isn't connected: add BEEHIIV_API_KEY and BEEHIIV_PUBLICATION_ID in Netlify.");
    return reply({ error: "Newsletter sign-up isn't connected yet." }, 503);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    /* handled below */
  }
  const { email, firstName, area } = body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim())) {
    return reply({ error: "Enter a valid email address." }, 400);
  }

  try {
    const r = await fetch(`https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: String(email).trim(),
        reactivate_existing: false, // don't re-add people who unsubscribed
        send_welcome_email: true,
        utm_source: "putt-together-app",
        utm_medium: "in-app-signup",
        custom_fields: [
          { name: "First Name", value: String(firstName || "").slice(0, 50) },
          { name: "Region", value: String(area || "").slice(0, 60) },
        ],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("Beehiiv error", r.status, detail);
      return reply({ error: "Newsletter sign-up failed. Try again later." }, 502);
    }
    return reply({ ok: true });
  } catch (err) {
    console.error(err);
    return reply({ error: "Newsletter sign-up failed. Try again later." }, 500);
  }
};

export const config = { path: "/api/subscribe" };
