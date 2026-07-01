// Pings a Discord channel whenever a new row lands in `contact_messages`.
//
// Triggered by a Supabase Database Webhook (Database → Webhooks) on INSERT.
// The Discord webhook URL lives in an Edge Function *secret*, never in this code
// or the repo.
//
// Secret to set (Edge Functions → Manage secrets):
//   DISCORD_WEBHOOK_URL — Discord channel → Edit Channel → Integrations →
//                         Webhooks → New Webhook → Copy Webhook URL

interface ContactRow {
  email: string | null;
  message: string;
  created_at: string;
}

Deno.serve(async (req) => {
  const url = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!url) return new Response("Missing DISCORD_WEBHOOK_URL secret", { status: 500 });

  // Optional shared-secret gate. Edge Functions are publicly invokable, so
  // without this anyone who learns the URL could POST fake rows and spam the
  // Discord channel. Opt-in (backward compatible): only enforced when the
  // CONTACT_WEBHOOK_SECRET function secret is set — then the Database Webhook
  // must send a matching `x-webhook-secret` header (see supabase/README.md).
  const expectedSecret = Deno.env.get("CONTACT_WEBHOOK_SECRET");
  if (expectedSecret && req.headers.get("x-webhook-secret") !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Database Webhook payload: { type, table, record, ... }
  const { record } = (await req.json()) as { record: ContactRow };
  const sender = record.email?.trim() || "anonymous";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "BuzzQuill Contact",
      // Never let a submitted message's @everyone/@here/<@id> actually ping the
      // channel — the text is untrusted visitor input.
      allowed_mentions: { parse: [] },
      embeds: [{
        title: "New contact message",
        description: record.message.slice(0, 4000), // Discord caps embeds at 4096
        color: 0x2196f3, // accent blue
        fields: [{ name: "From", value: sender, inline: true }],
        timestamp: record.created_at,
      }],
    }),
  });

  if (!res.ok) return new Response(`Discord post failed: ${await res.text()}`, { status: 502 });
  return new Response("ok");
});
