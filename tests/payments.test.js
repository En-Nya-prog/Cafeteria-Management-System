import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  buildPaymentLines,
  isVerifiedPaystackPayment,
  toMinorUnits,
  verifyPaystackSignature,
} from "../lib/payments.js";

const meals = new Map([
  ["rice", { id: "rice", price: 12.5, stock: 8 }],
  ["juice", { id: "juice", price: 4.25, stock: 20 }],
]);

const isTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

test("builds server-priced GHS payment lines and total", () => {
  const order = buildPaymentLines([
    { meal: { id: "rice", price: 0.01 }, quantity: 2 },
    { meal_id: "juice", quantity: 1, pickupTime: "12:30" },
  ], (id) => meals.get(id), isTime);

  assert.deepEqual(order, {
    lines: [
      { meal_id: "rice", quantity: 2, pickup_time: null, unit_amount: 1250 },
      { meal_id: "juice", quantity: 1, pickup_time: "12:30", unit_amount: 425 },
    ],
    totalMinorUnits: 2925,
  });
});

test("rejects malformed, missing, and zero-value payment lines", () => {
  assert.throws(() => buildPaymentLines([], () => null, isTime), /cart is empty/);
  assert.throws(() => buildPaymentLines([{ meal_id: "rice", quantity: 0 }], (id) => meals.get(id), isTime), /positive whole-number/);
  assert.throws(() => buildPaymentLines([{ meal_id: "missing", quantity: 1 }], (id) => meals.get(id), isTime), /no longer exists/);
  assert.throws(() => toMinorUnits(1.001), /valid amount/);
  assert.throws(() => buildPaymentLines([{ meal_id: "rice", quantity: 1, pickupTime: "25:90" }], (id) => meals.get(id), isTime), /Pickup time/);
});

test("accepts only signed Paystack webhook bodies", () => {
  const secret = "test-paystack-secret";
  const body = Buffer.from('{"event":"charge.success"}');
  const signature = crypto.createHmac("sha512", secret).update(body).digest("hex");

  assert.equal(verifyPaystackSignature(body, signature, secret), true);
  assert.equal(verifyPaystackSignature(body, "0".repeat(128), secret), false);
  assert.equal(verifyPaystackSignature(Buffer.from("{}"), signature, secret), false);
  assert.equal(verifyPaystackSignature(body, signature, "wrong-secret"), false);
});

test("accepts only a matching successful GHS transaction", () => {
  const payment = { reference: "ref_123", amount_kobo: 2500 };
  const transaction = {
    status: "success",
    reference: payment.reference,
    amount: payment.amount_kobo,
    currency: "GHS",
    customer: { email: "buyer@example.com" },
  };

  assert.equal(isVerifiedPaystackPayment(transaction, payment, "buyer@example.com"), true);
  assert.equal(isVerifiedPaystackPayment({ ...transaction, amount: 1 }, payment, "buyer@example.com"), false);
  assert.equal(isVerifiedPaystackPayment({ ...transaction, currency: "USD" }, payment, "buyer@example.com"), false);
  assert.equal(isVerifiedPaystackPayment(transaction, payment, "other@example.com"), false);
});
