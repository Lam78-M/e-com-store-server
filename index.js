import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;
const client = new MongoClient(process.env.MONGO_DB_URI);

// CORS Policy explicit configuration
app.use(
  cors({
    origin: [
      process.env.CLIENT_URL,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ].filter(Boolean),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

const db = client.db("e_commerce_db");
const productsCollection = db.collection("product");
const usersCollection = db.collection("user");
const sessionsCollection = db.collection("session");
const ordersCollection = db.collection("orders");
const cartsCollection = db.collection("carts");

// Connect MongoDB
async function connectToMongoDB() {
  try {
    // await client.connect()
    console.log("MongoDB connected successfully!");

    // Ensure indexes for fast queries
    await ordersCollection.createIndex({ customerId: 1 });
    await ordersCollection.createIndex({ orderId: 1 }, { unique: true });
    await cartsCollection.createIndex({ userId: 1 }, { unique: true });
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

// -------------------------------------------------------------
// Authentication & Role Authorization Middleware
// -------------------------------------------------------------
async function getAuthenticatedUser(req) {
  let token = req.headers.authorization?.replace(/^Bearer\s+/i, "")?.trim();
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:better-auth\.session_token|__Secure-better-auth\.session_token)=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]).trim();
  }
  if (!token) return null;

  // Better-Auth signed cookies format can be "<token>.<signature>" or just "<token>"
  const tokenRaw = token.split(".")[0];

  const sessionDoc = await sessionsCollection.findOne({
    $or: [
      { token: token },
      { token: tokenRaw },
    ],
    expiresAt: { $gt: new Date() },
  });

  if (!sessionDoc || !sessionDoc.userId) return null;

  const userIdStr = String(sessionDoc.userId);
  const user = await usersCollection.findOne({
    $or: [
      { _id: sessionDoc.userId },
      { _id: userIdStr },
      ...(ObjectId.isValid(userIdStr) ? [{ _id: new ObjectId(userIdStr) }] : []),
    ],
  });

  return user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ message: "Authentication required. Please sign in." });
    }
    req.user = user;
    req.userId = String(user._id);
    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error);
    res.status(500).json({ message: "Internal server error during authentication" });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Admin privileges required" });
    }
    req.user = user;
    req.userId = String(user._id);
    next();
  } catch (error) {
    console.error("Admin Middleware Error:", error);
    res.status(500).json({ message: "Internal server error during admin verification" });
  }
}

// -------------------------------------------------------------
// Public Product Routes
// -------------------------------------------------------------

// GET Products
app.get("/products", async (req, res) => {
  try {
    const products = await productsCollection.find().toArray();
    res.send(products);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch products", error });
  }
});

// POST Product (Admin protected)
app.post("/products", requireAdmin, async (req, res) => {
  try {
    const newProduct = req.body;
    const productDoc = {
      productName: newProduct.productName,
      price: parseFloat(newProduct.price),
      category: newProduct.category,
      stock: parseInt(newProduct.stock, 10),
      image: newProduct.image || "",
      description: newProduct.description || "",
      createdAt: new Date(),
    };
    const result = await productsCollection.insertOne(productDoc);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to insert product", error });
  }
});

// DELETE Product (Admin protected)
app.delete("/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid product ID format" });
    }

    const query = { _id: new ObjectId(id) };
    const result = await productsCollection.deleteOne(query);

    if (result.deletedCount === 1) {
      res.send({ success: true, message: "Product deleted successfully" });
    } else {
      res.status(404).send({ message: "Product not found" });
    }
  } catch (error) {
    console.error("Delete Error:", error);
    res.status(500).send({ message: "Failed to delete product", error: error.message });
  }
});

// PUT Product (Admin protected)
app.put("/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid product ID format" });
    }

    const updatedData = req.body;
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        productName: updatedData.productName,
        price: parseFloat(updatedData.price),
        category: updatedData.category,
        stock: parseInt(updatedData.stock, 10),
        ...(updatedData.image ? { image: updatedData.image } : {}),
      },
    };

    const result = await productsCollection.updateOne(filter, updateDoc);
    res.send(result);
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).send({ message: "Failed to update product", error: error.message });
  }
});

// -------------------------------------------------------------
// Cart Routes (Authenticated Customer)
// -------------------------------------------------------------

// GET /cart: Get authenticated customer's cart
app.get("/cart", requireAuth, async (req, res) => {
  try {
    const cart = await cartsCollection.findOne({ userId: req.userId });
    res.json({ items: cart?.items || [] });
  } catch (error) {
    console.error("Error fetching cart:", error);
    res.status(500).json({ message: "Failed to fetch cart", error: error.message });
  }
});

// POST /cart: Save or update customer's cart items
app.post("/cart", requireAuth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: "Items must be an array" });
    }

    const cleanItems = items.map((item) => ({
      id: String(item.id || item._id),
      name: item.name || item.productName || "Unnamed item",
      price: Number(item.price) || 0,
      quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
      image: item.image || "",
      category: item.category || "General",
    }));

    await cartsCollection.updateOne(
      { userId: req.userId },
      { $set: { userId: req.userId, items: cleanItems, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ success: true, items: cleanItems });
  } catch (error) {
    console.error("Error updating cart:", error);
    res.status(500).json({ message: "Failed to update cart", error: error.message });
  }
});

// DELETE /cart: Clear customer's cart
app.delete("/cart", requireAuth, async (req, res) => {
  try {
    await cartsCollection.deleteOne({ userId: req.userId });
    res.json({ success: true, message: "Cart cleared" });
  } catch (error) {
    console.error("Error clearing cart:", error);
    res.status(500).json({ message: "Failed to clear cart", error: error.message });
  }
});

// -------------------------------------------------------------
// Customer Order Routes (Checkout, My Orders, Cancellation)
// -------------------------------------------------------------

// POST /orders: Place Cash on Delivery order
app.post("/orders", requireAuth, async (req, res) => {
  try {
    const { fullName, phone, deliveryAddress, deliveryInstructions, items } = req.body;

    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ message: "Full name is required" });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ message: "Contact phone number is required" });
    }
    if (!deliveryAddress || !deliveryAddress.trim()) {
      return res.status(400).json({ message: "Delivery address is required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Your cart is empty. Please add items to order." });
    }

    // Server-side validation against product database
    const verifiedItems = [];
    let serverTotal = 0;

    for (const item of items) {
      const productId = String(item.id || item.productId || item._id);
      if (!ObjectId.isValid(productId)) {
        return res.status(400).json({ message: `Invalid product ID: ${productId}` });
      }

      const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
      if (!product) {
        return res.status(404).json({ message: `Product "${item.name || productId}" is no longer available.` });
      }

      const requestedQty = Math.max(1, parseInt(item.quantity, 10) || 1);
      const availableStock = typeof product.stock === "number" ? product.stock : 999;

      if (availableStock < requestedQty) {
        return res.status(400).json({
          message: `Insufficient stock for "${product.productName}". Available: ${availableStock}, requested: ${requestedQty}`,
        });
      }

      const trustedPrice = parseFloat(product.price) || 0;
      const subtotal = Math.round(trustedPrice * requestedQty * 100) / 100;
      serverTotal += subtotal;

      verifiedItems.push({
        productId: String(product._id),
        productName: product.productName,
        price: trustedPrice,
        quantity: requestedQty,
        subtotal,
        category: product.category || "General",
        image: product.image || item.image || "",
      });
    }

    // Atomic stock reduction
    for (const item of verifiedItems) {
      await productsCollection.updateOne(
        { _id: new ObjectId(item.productId), stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } }
      );
    }

    // Generate unique order ID: #SC-XXXXXX
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const orderId = `#SC-${randomSuffix}`;

    const newOrder = {
      orderId,
      customerId: req.userId,
      customerName: fullName.trim(),
      customerEmail: req.user.email,
      phone: phone.trim(),
      deliveryAddress: deliveryAddress.trim(),
      deliveryInstructions: (deliveryInstructions || "").trim(),
      items: verifiedItems,
      totalAmount: Math.round(serverTotal * 100) / 100,
      paymentMethod: "Cash on Delivery",
      paymentStatus: "unpaid", // Initial state for COD
      orderStatus: "Pending", // Initial order status
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertResult = await ordersCollection.insertOne(newOrder);

    // Clear customer's saved cart in database
    await cartsCollection.deleteOne({ userId: req.userId });

    res.status(201).json({
      success: true,
      message: "Order placed successfully! Please pay cash upon delivery.",
      order: { ...newOrder, _id: insertResult.insertedId },
    });
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ message: "Failed to place order", error: error.message });
  }
});

// GET /orders/my-orders: Fetch orders for authenticated customer
app.get("/orders/my-orders", requireAuth, async (req, res) => {
  try {
    const orders = await ordersCollection
      .find({ customerId: req.userId })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(orders);
  } catch (error) {
    console.error("Error fetching my orders:", error);
    res.status(500).json({ message: "Failed to fetch orders", error: error.message });
  }
});

// PATCH /orders/:id/cancel: Customer cancels pending order
app.patch("/orders/:id/cancel", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const query = ObjectId.isValid(id)
      ? { $or: [{ _id: new ObjectId(id) }, { orderId: id }] }
      : { orderId: id };

    const order = await ordersCollection.findOne(query);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Verify ownership
    if (order.customerId !== req.userId) {
      return res.status(403).json({ message: "You are not authorized to cancel this order" });
    }

    // Check cancellation eligibility: only "Pending" can be cancelled
    if (order.orderStatus !== "Pending") {
      return res.status(400).json({
        message: `Order cannot be cancelled because it is already "${order.orderStatus}". Orders can only be cancelled while pending preparation.`,
      });
    }

    // Restore product stock
    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        if (ObjectId.isValid(item.productId)) {
          await productsCollection.updateOne(
            { _id: new ObjectId(item.productId) },
            { $inc: { stock: item.quantity } }
          );
        }
      }
    }

    // Update status to Cancelled (preserve order history)
    await ordersCollection.updateOne(
      { _id: order._id },
      { $set: { orderStatus: "Cancelled", updatedAt: new Date() } }
    );

    res.json({ success: true, message: "Order has been cancelled successfully and stock restored." });
  } catch (error) {
    console.error("Order cancellation error:", error);
    res.status(500).json({ message: "Failed to cancel order", error: error.message });
  }
});

// -------------------------------------------------------------
// Admin Dashboard Routes (Strict Server-Side Role Verification)
// -------------------------------------------------------------

// GET /admin/stats: Real database stats for overview
app.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    const [totalOrders, totalProducts, totalCustomers, allOrders] = await Promise.all([
      ordersCollection.countDocuments(),
      productsCollection.countDocuments(),
      usersCollection.countDocuments({ role: { $ne: "admin" } }),
      ordersCollection.find().toArray(),
    ]);

    // Active orders exclude cancelled orders
    const activeOrders = allOrders.filter((o) => o.orderStatus !== "Cancelled");
    const totalOrderValue = activeOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

    // Collected revenue for COD: only delivered orders marked as paid
    const collectedRevenue = allOrders
      .filter((o) => o.paymentStatus === "paid" && o.orderStatus !== "Cancelled")
      .reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

    const cancelledCount = allOrders.filter((o) => o.orderStatus === "Cancelled").length;
    const pendingCount = allOrders.filter((o) => o.orderStatus === "Pending").length;
    const preparingCount = allOrders.filter((o) => o.orderStatus === "Preparing").length;
    const readyCount = allOrders.filter((o) => o.orderStatus === "Ready").length;
    const deliveredCount = allOrders.filter((o) => o.orderStatus === "Delivered").length;

    // Sales data grouped by day of past 7 days for charts
    const now = new Date();
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const past7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayName = days[d.getDay()];
      const dateStr = d.toISOString().split("T")[0];
      past7Days.push({ day: dayName, date: dateStr, amount: 0, orders: 0 });
    }

    activeOrders.forEach((order) => {
      if (!order.createdAt) return;
      const orderDate = new Date(order.createdAt).toISOString().split("T")[0];
      const slot = past7Days.find((s) => s.date === orderDate);
      if (slot) {
        slot.amount += Number(order.totalAmount) || 0;
        slot.orders += 1;
      }
    });

    const maxAmount = Math.max(...past7Days.map((d) => d.amount), 100);
    const chartBars = past7Days.map((d) => ({
      day: d.day,
      amount: Math.round(d.amount),
      orders: d.orders,
      height: Math.min(100, Math.max(15, Math.round((d.amount / maxAmount) * 100))),
    }));

    res.json({
      totalOrders,
      totalProducts,
      totalCustomers,
      totalOrderValue: Math.round(totalOrderValue * 100) / 100,
      collectedRevenue: Math.round(collectedRevenue * 100) / 100,
      unpaidRevenue: Math.round((totalOrderValue - collectedRevenue) * 100) / 100,
      counts: {
        pending: pendingCount,
        preparing: preparingCount,
        ready: readyCount,
        delivered: deliveredCount,
        cancelled: cancelledCount,
      },
      chartBars,
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    res.status(500).json({ message: "Failed to calculate admin stats", error: error.message });
  }
});

// GET /admin/orders: Fetch all orders with search and status filtering
app.get("/admin/orders", requireAdmin, async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status && status !== "All orders" && status !== "All") {
      filter.orderStatus = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      filter.$or = [
        { orderId: regex },
        { customerName: regex },
        { customerEmail: regex },
        { phone: regex },
      ];
    }

    const orders = await ordersCollection.find(filter).sort({ createdAt: -1 }).toArray();
    res.json(orders);
  } catch (error) {
    console.error("Admin orders error:", error);
    res.status(500).json({ message: "Failed to fetch admin orders", error: error.message });
  }
});

// PATCH /admin/orders/:id/status: Update order status or payment status
app.patch("/admin/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { orderStatus, paymentStatus } = req.body;

    const query = ObjectId.isValid(id)
      ? { $or: [{ _id: new ObjectId(id) }, { orderId: id }] }
      : { orderId: id };

    const order = await ordersCollection.findOne(query);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const updateDoc = { updatedAt: new Date() };

    // Valid statuses
    const validOrderStatuses = ["Pending", "Preparing", "Ready", "Delivered", "Cancelled"];
    if (orderStatus && validOrderStatuses.includes(orderStatus)) {
      // If moving to Cancelled from non-cancelled, restore stock
      if (orderStatus === "Cancelled" && order.orderStatus !== "Cancelled") {
        for (const item of order.items || []) {
          if (ObjectId.isValid(item.productId)) {
            await productsCollection.updateOne(
              { _id: new ObjectId(item.productId) },
              { $inc: { stock: item.quantity } }
            );
          }
        }
      }
      // If order is delivered, COD payment is marked as paid
      if (orderStatus === "Delivered" && !paymentStatus) {
        updateDoc.paymentStatus = "paid";
      }
      updateDoc.orderStatus = orderStatus;
    }

    if (paymentStatus && ["unpaid", "paid"].includes(paymentStatus)) {
      updateDoc.paymentStatus = paymentStatus;
    }

    await ordersCollection.updateOne({ _id: order._id }, { $set: updateDoc });
    const updated = await ordersCollection.findOne({ _id: order._id });

    res.json({ success: true, order: updated });
  } catch (error) {
    console.error("Admin update order status error:", error);
    res.status(500).json({ message: "Failed to update order status", error: error.message });
  }
});

// GET /admin/customers: Fetch customers list with aggregated stats
app.get("/admin/customers", requireAdmin, async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    const orders = await ordersCollection.find().toArray();

    const customerList = users.map((u) => {
      const uId = String(u._id);
      const userOrders = orders.filter((o) => o.customerId === uId);
      const activeUserOrders = userOrders.filter((o) => o.orderStatus !== "Cancelled");
      const totalSpent = activeUserOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);

      return {
        _id: uId,
        name: u.name || "Customer",
        email: u.email,
        role: u.role || "user",
        createdAt: u.createdAt,
        orderCount: userOrders.length,
        totalSpent: Math.round(totalSpent * 100) / 100,
      };
    });

    res.json(customerList);
  } catch (error) {
    console.error("Admin customers error:", error);
    res.status(500).json({ message: "Failed to fetch customers", error: error.message });
  }
});

// DELETE /admin/customers/:id: Safe customer deletion
app.delete("/admin/customers/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const userToDelete = await usersCollection.findOne({
      $or: [
        { _id: id },
        ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
      ],
    });

    if (!userToDelete) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // Safety: Cannot delete administrator accounts
    if (userToDelete.role === "admin") {
      return res.status(403).json({ message: "Administrator accounts cannot be deleted." });
    }

    // Safety: Cannot delete self
    if (String(userToDelete._id) === req.userId) {
      return res.status(403).json({ message: "You cannot delete your own account." });
    }

    // Delete user and associated cart, but PRESERVE order history
    await usersCollection.deleteOne({ _id: userToDelete._id });
    await cartsCollection.deleteOne({ userId: String(userToDelete._id) });

    // Mark orders as belonging to deleted customer without losing record
    await ordersCollection.updateMany(
      { customerId: String(userToDelete._id) },
      { $set: { customerDeleted: true, updatedAt: new Date() } }
    );

    res.json({ success: true, message: `Customer "${userToDelete.name || userToDelete.email}" deleted successfully.` });
  } catch (error) {
    console.error("Customer deletion error:", error);
    res.status(500).json({ message: "Failed to delete customer", error: error.message });
  }
});

// -------------------------------------------------------------
// Start Server
// -------------------------------------------------------------
app.listen(port, async () => {
  console.log(`Server is running on port ${port}`);
  await connectToMongoDB();
});