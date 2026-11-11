const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

initializeApp({
  databaseURL: "https://sf-gallery-ec41d-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const REGION = "asia-southeast1";
const ALLOWED_PAYMENTS = new Set(["COD", "bKash", "Nagad", "Rocket", "Upay"]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

exports.createCustomerOrder = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "অর্ডার করতে Login করুন।");
  }

  const uid = request.auth.uid;
  const input = request.data || {};
  const customerName = cleanText(input.customerName, 100);
  const phone = cleanText(input.phone, 20).replaceAll(" ", "").replaceAll("-", "");
  const address = cleanText(input.address, 500);
  const note = cleanText(input.note, 500);
  const area = input.deliveryArea;
  const paymentMethod = input.paymentMethod;
  const transactionId = cleanText(input.transactionId, 120);
  const rawItems = input.items;

  if (!customerName || !phone || phone.length < 10 || phone.length > 16 || !address) {
    throw new HttpsError("invalid-argument", "সঠিক নাম, মোবাইল নম্বর ও ঠিকানা দিন।");
  }
  if (area !== "inside" && area !== "outside") {
    throw new HttpsError("invalid-argument", "সঠিক Delivery Area নির্বাচন করুন।");
  }
  if (!ALLOWED_PAYMENTS.has(paymentMethod)) {
    throw new HttpsError("invalid-argument", "পেমেন্ট পদ্ধতি সঠিক নয়।");
  }
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 20) {
    throw new HttpsError("invalid-argument", "Cart-এ ১ থেকে ২০টি পণ্য থাকতে হবে।");
  }

  const db = getDatabase();
  const [productsSnap, settingsSnap] = await Promise.all([
    db.ref("products").get(),
    db.ref("siteSettings").get()
  ]);
  const products = productsSnap.val() || {};
  const settings = settingsSnap.val() || {};

  const seen = new Set();
  const items = rawItems.map((raw) => {
    const productId = cleanText(raw && raw.productId, 128);
    const qty = Number(raw && raw.qty);
    if (!productId || seen.has(productId) || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new HttpsError("invalid-argument", "Cart-এর পণ্যের তথ্য সঠিক নয়।");
    }
    seen.add(productId);

    const product = products[productId];
    if (!product || product.stock === "Out of Stock") {
      throw new HttpsError("failed-precondition", "একটি পণ্য বর্তমানে Stock-এ নেই।");
    }

    const regularPrice = Number(product.price);
    const offerPrice = Number(product.offer);
    const unitPrice = Number.isFinite(offerPrice) && offerPrice > 0
      ? offerPrice
      : regularPrice;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new HttpsError("failed-precondition", "একটি পণ্যের মূল্য সঠিক নয়।");
    }

    const productName = (cleanText(product.brand, 60) + " " + cleanText(product.name, 120)).trim();
    if (!productName) {
      throw new HttpsError("failed-precondition", "একটি পণ্যের নাম পাওয়া যায়নি।");
    }
    return {
      productId,
      productName,
      qty,
      unitPrice,
      lineTotal: unitPrice * qty
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const deliveryCharge = Number(
    area === "inside" ? (settings.deliveryInsideFee ?? 80) : (settings.deliveryOutsideFee ?? 150)
  );
  if (!Number.isFinite(deliveryCharge) || deliveryCharge < 0) {
    throw new HttpsError("failed-precondition", "Delivery Charge সঠিকভাবে সেট করা নেই।");
  }

  if (paymentMethod !== "COD") {
    const walletKey = {
      bKash: "bkashNumber",
      Nagad: "nagadNumber",
      Rocket: "rocketNumber",
      Upay: "upayNumber"
    }[paymentMethod];
    if (!cleanText(settings[walletKey], 40) || !transactionId) {
      throw new HttpsError("failed-precondition", "Wallet নম্বর অথবা Transaction ID পাওয়া যায়নি।");
    }
  }

  const totalPrice = subtotal + deliveryCharge;
  const ordersRef = db.ref("orders").child(uid);
  const orderRef = ordersRef.push();
  const createdAt = Date.now();
  const orderNumber = "SFG-" + orderRef.key.slice(-7).toUpperCase();
  const order = {
    uid,
    customerName,
    phone,
    address,
    note,
    items,
    productName: items.map((item) => item.productName + " × " + item.qty).join(", "),
    price: subtotal,
    deliveryArea: area === "inside" ? "দিনাজপুর জেলার ভিতরে" : "দিনাজপুর জেলার বাইরে",
    deliveryCharge,
    totalPrice,
    paymentMethod: paymentMethod === "COD" ? "Cash on Delivery" : paymentMethod,
    paymentStatus: paymentMethod === "COD" ? "Pay on Delivery" : "Verification Pending",
    transactionId: paymentMethod === "COD" ? "" : transactionId,
    status: "Pending",
    createdAt,
    orderNumber,
    statusHistory: { Pending: createdAt }
  };

  await orderRef.set(order);
  await db.ref("customers").child(uid).update({
    name: customerName,
    phone,
    email: request.auth.token.email || ""
  });

  return { success: true, orderId: orderRef.key, orderNumber, subtotal, deliveryCharge, totalPrice };
});
