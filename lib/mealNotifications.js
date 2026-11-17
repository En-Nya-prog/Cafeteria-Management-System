
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

export async function sendMealEmail({
  buyerEmail,
  meal,
  appUrl,
  action = "new",
  env = process.env,
  fetchImpl = fetch,
}) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    throw new Error(
      "RESEND_API_KEY and RESEND_FROM_EMAIL must be configured."
    );
  }

  const mealName = escapeHtml(meal.name);
  const category = escapeHtml(meal.category);
  const price = Number(meal.price).toFixed(2);
  const safeUrl = escapeHtml(appUrl);

  const subjectName = String(meal.name)
    .replace(/[\r\n]/g, " ")
    .slice(0, 120);

  const response = await fetchImpl(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [buyerEmail],
        subject: `${
          action === "updated" ? "Meal updated" : "New on the menu"
        }: ${subjectName}`,
        text: `${
          action === "updated"
            ? "A meal was updated"
            : "A new meal is available"
        } at E³ Cafeteria: ${meal.name} (${meal.category}) for GHS ${price}. Browse the menu: ${appUrl}`,
        html: `
          <p>${
            action === "updated"
              ? "A meal was updated"
              : "A new meal is available"
          } at E³ Cafeteria.</p>
          <h2>${mealName}</h2>
          <p>${category} · GHS ${price}</p>
          <p><a href="${safeUrl}">Browse the menu</a></p>
        `,
      }),
    }
  );

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Resend returned ${response.status}: ${details}`);
  }
}

export async function sendMealSms({
  phone,
  meal,
  appUrl,
  action = "new",
  env = process.env,
  fetchImpl = fetch,
}) {
  if (
    !env.HUBTEL_CLIENT_ID ||
    !env.HUBTEL_CLIENT_SECRET ||
    !env.HUBTEL_SENDER_ID
  ) {
    throw new Error(
      "HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET, and HUBTEL_SENDER_ID must be configured."
    );
  }

  const message = `${
    action === "updated" ? "Updated" : "New"
  } at E³ Cafeteria: ${meal.name}, GHS ${Number(meal.price).toFixed(2)}. Browse: ${appUrl}`;

  const url = new URL(
    "https://smsc.hubtel.com/v1/messages/send"
  );

  url.searchParams.set("From", env.HUBTEL_SENDER_ID);
  url.searchParams.set("To", phone.replace(/^\+/, ""));
  url.searchParams.set("Content", message);

  const credentials = Buffer.from(
    `${env.HUBTEL_CLIENT_ID}:${env.HUBTEL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Hubtel returned ${response.status}: ${details}`);
  }
}


export async function sendSellerOrderEmail({
  sellerEmail,
  sellerName,
  buyerName,
  orderReference,
  items,
  totalAmount,
  appUrl,
  env = process.env,
  fetchImpl = fetch,
}) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    throw new Error("RESEND_API_KEY and RESEND_FROM_EMAIL must be configured.");
  }

  const safeSeller = escapeHtml(sellerName);
  const safeBuyer = escapeHtml(buyerName);
  const safeReference = escapeHtml(orderReference);
  const safeItems = items.map((item) => `
    <li>
      ${escapeHtml(item.name)} -
      ${item.quantity} × GHS ${Number(item.unitPrice).toFixed(2)}
    </li>
  `).join("");

  const subject = `New order received - ${String(orderReference).slice(0, 80)}`;

  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [sellerEmail],
      subject,
      text: `Hello ${sellerName},

You have received a new paid order at E³ Cafeteria.

Order reference: ${orderReference}
Buyer: ${buyerName}

${items.map((item) =>
  `${item.name} - ${item.quantity} x GHS ${Number(item.unitPrice).toFixed(2)}`
).join("\n")}

Your order total: GHS ${Number(totalAmount).toFixed(2)}

Please log in to your seller dashboard to manage this order.

${appUrl}`,
      html: `
        <h2>New Order Received!</h2>
        <p>Hello ${safeSeller},</p>
        <p>You have received a new successfully paid order.</p>

        <p><strong>Order reference:</strong> ${safeReference}</p>
        <p><strong>Buyer:</strong> ${safeBuyer}</p>

        <h3>Order Details</h3>
        <ul>${safeItems}</ul>

        <h3>Total: GHS ${Number(totalAmount).toFixed(2)}</h3>

        <p>Please log in to your seller dashboard to manage this order.</p>
        <p><a href="${escapeHtml(appUrl)}">Open E³ Cafeteria</a></p>
      `,
    }),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Resend returned ${response.status}: ${details}`);
  }
}

export async function sendSellerOrderSms({
  phone,
  sellerName,
  buyerName,
  orderReference,
  items,
  totalAmount,
  env = process.env,
  fetchImpl = fetch,
}) {
  if (
    !env.HUBTEL_CLIENT_ID ||
    !env.HUBTEL_CLIENT_SECRET ||
    !env.HUBTEL_SENDER_ID
  ) {
    throw new Error(
      "HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET, and HUBTEL_SENDER_ID must be configured."
    );
  }

  const mealSummary = items.map((item) =>
    `${item.quantity}x ${item.name}`
  ).join(", ");

  const message =
    `E3 Cafeteria: Hello ${sellerName}, new paid order from ${buyerName}. ` +
    `Items: ${mealSummary}. Total: GHS ${Number(totalAmount).toFixed(2)}. ` +
    `Ref: ${orderReference}`;

  const url = new URL("https://smsc.hubtel.com/v1/messages/send");

  url.searchParams.set("From", env.HUBTEL_SENDER_ID);
  url.searchParams.set("To", phone.replace(/^\+/, ""));
  url.searchParams.set("Content", message);

  const credentials = Buffer.from(
    `${env.HUBTEL_CLIENT_ID}:${env.HUBTEL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Basic ${credentials}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Hubtel returned ${response.status}: ${details}`);
  }
}
