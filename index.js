import "@shopify/shopify-api/adapters/node";
import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";
import { shopifyApi } from "@shopify/shopify-api";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES.split(","),
  hostName: process.env.HOST.replace(/https:\/\//, ""),
  apiVersion: "2024-01",
  isEmbeddedApp: true,
});

app.get("/auth", async (req, res) => {
  const { shop } = req.query;
  const authRoute = await shopify.auth.begin({
    shop,
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: req,
    rawResponse: res,
  });
});

app.get("/auth/callback", async (req, res) => {
  const callback = await shopify.auth.callback({
    rawRequest: req,
    rawResponse: res,
  });

  const session = callback.session;

  // Register webhooks after install
  await shopify.webhooks.register({
    session,
    topic: "ORDERS_CREATE",
    path: "/webhooks/orders/create",
  });

  await shopify.webhooks.register({
    session,
    topic: "ORDERS_CANCELLED",
    path: "/webhooks/orders/cancelled",
  });

  res.redirect(`/?shop=${session.shop}`);
});

function verifyWebhook(req) {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(body, "utf8")
    .digest("base64");

  return hash === hmac;
}

app.post("/webhooks/orders/create", async (req, res) => {
  if (!verifyWebhook(req)) return res.sendStatus(401);

  const order = req.body;

  await prisma.order.create({
    data: {
      shop: req.headers["x-shopify-shop-domain"],
      orderId: order.id.toString(),
      totalPrice: order.total_price,
    },
  });

  res.sendStatus(200);
});

app.post("/webhooks/orders/cancelled", async (req, res) => {
  if (!verifyWebhook(req)) return res.sendStatus(401);

  const order = req.body;

  await prisma.order.deleteMany({
    where: {
      orderId: order.id.toString(),
    },
  });

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});