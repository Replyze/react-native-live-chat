# Push notifications for chat replies

What works today, and how to notify users whose app is closed.

## While the app is open

The chat keeps running while it is hidden, so you can react to replies yourself:

- `Replyze.onUnreadCountChange(count => ...)` for a badge on your Help button
- `Replyze.onMessage(message => ...)` for an in-app banner or a local notification (`message.text`, `message.senderName`, `message.sender` is `'bot'` or `'agent'`)

In the background the operating system pauses the WebView; the unread count catches up when the app comes back to the foreground.

## While the app is closed: from your server, with a webhook

Replyze does not send push notifications to your app's users itself yet. You can send them from your own server, with your own FCM or APNs setup, when Replyze tells you about a new reply:

1. In the Replyze dashboard, **Settings → Integrations → Developer → Webhooks**, add your endpoint for the `message.created` event. Copy the signing secret: it is shown only once.
2. Check every request: `X-Replyze-Signature` is `sha256=` followed by the hex HMAC-SHA256 of the raw request body, keyed with the signing secret. Only the body is signed, so take the time (`created_at`) and the `id` from the body to refuse old, replayed requests and retries, not from the `X-Replyze-Timestamp` and `X-Replyze-Event-Id` headers, which are unsigned copies.
3. Only notify for replies: `data.message.sender_type` is `agent` (your team) or `bot` (the AI). `visitor` is the user's own message.
4. Find your user: `data.conversation.contact` has the contact's `id`, `email`, `name` and `phone`. If you call `Replyze.identify({ email, ... })`, the email is enough to match. For your own user id, set it with `Replyze.setData({ app_user_id: '...' })` and read it with `GET /api/v1/contacts/{id}`.
5. Send the push, and open the chat with `Replyze.show()` when it is tapped.

```js
// Node.js + Express: the endpoint from step 1.
const crypto = require('crypto');
const express = require('express');

const app = express();
const SECRET = process.env.REPLYZE_WEBHOOK_SECRET;

function verify(rawBody, header) {
  if (typeof header !== 'string') return false;
  const expected = Buffer.from('sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex'));
  const given = Buffer.from(header); // compare bytes: a non-ASCII header has more bytes than characters
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const handled = new Set(); // event ids you have handled: keep them in your database

app.post('/webhooks/replyze', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verify(req.body, req.headers['x-replyze-signature'])) return res.sendStatus(401);

  // The time and the id come from the signed body; the headers are unsigned copies.
  const event = JSON.parse(req.body.toString('utf8'));
  const sent = Date.parse(event.created_at);
  if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > 5 * 60 * 1000) return res.sendStatus(400);
  if (handled.has(event.id)) return res.sendStatus(200); // a retry you already handled
  handled.add(event.id);
  res.sendStatus(200); // answer fast; Replyze retries network errors and 5xx

  if (event.event !== 'message.created') return;

  const { message, conversation } = event.data;
  if (message.sender_type !== 'agent' && message.sender_type !== 'bot') return;

  const email = conversation.contact && conversation.contact.email;
  if (!email) return;

  // Your code: look the user up by email and push with FCM / APNs.
  await sendPushToUser(email, {
    title: message.sender_type === 'agent' && message.sender ? message.sender.name : 'Support',
    body: message.content,
  });
});

app.listen(3000);
```

Every delivery has the same envelope: `{ id, event, created_at, workspace_id, data }`. A network error or a `5xx` answer is retried twice (after 30 seconds, then 3 minutes) with the same body, so drop duplicates by the body's `id` (the `X-Replyze-Event-Id` header is an unsigned copy of it). The 5-minute window above lets both retries in.
