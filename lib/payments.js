import crypto from "node:crypto";

export function toMinorUnits(amount) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Meal price must be a non-negative number.");
  }
  const minorUnits = Math.round(amount * 100);
  if (!Number.isSafeInteger(minorUnits) || Math.abs(amount * 100 - minorUnits) > 1e-7) {
    throw new Error("Meal price must be a valid amount in GHS.");
  }
  return minorUnits;
}

export function buildPaymentLines(cart, getMeal, isTime) {
  if (!Array.isArray(cart) || cart.length === 0 || cart.length > 50) {
    throw new Error("Your cart is empty or contains too many items.");
  }

  let totalMinorUnits = 0;
  const lines = cart.map((cartItem) => {
    const mealId = String(cartItem?.meal?.id || cartItem?.meal_id || "").trim();
    const quantity = Number(cartItem?.quantity);
    if (!mealId || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error("Each cart item must include a meal and positive whole-number quantity.");
    }

    const meal = getMeal(mealId);
    if (!meal) throw new Error("One of the selected meals no longer exists.");

    const unitAmount = toMinorUnits(Number(meal.price));
    const lineAmount = unitAmount * quantity;
    if (!Number.isSafeInteger(lineAmount) || !Number.isSafeInteger(totalMinorUnits + lineAmount)) {
      throw new Error("Order total is too large.");
    }
    totalMinorUnits += lineAmount;

    const pickupTime = cartItem.pickupTime || null;
    if (pickupTime && !isTime(pickupTime)) {
      throw new Error("Pickup time must use HH:MM format.");
    }
    return { meal_id: mealId, quantity, pickup_time: pickupTime, unit_amount: unitAmount };
  });

  if (totalMinorUnits <= 0) throw new Error("Order total must be greater than zero.");
  return { lines, totalMinorUnits };
}

export function verifyPaystackSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== "string" || !/^[a-f\d]{128}$/i.test(signature)) {
    return false;
  }
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest();
  const provided = Buffer.from(signature, "hex");
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

export function isVerifiedPaystackPayment(transaction, payment, userEmail) {
  return transaction?.status === "success" &&
    transaction.reference === payment.reference &&
    Number(transaction.amount) === payment.amount_kobo &&
    transaction.currency === "GHS" &&
    typeof transaction.customer?.email === "string" &&
    transaction.customer.email.toLowerCase() === userEmail.toLowerCase();
}
