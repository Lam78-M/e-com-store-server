import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";

const app = express();

const port = process.env.PORT || 5000;
const client = new MongoClient(process.env.MONGO_DB_URI);

// Middleware
app.use(cors());
app.use(express.json());

// Database and Collection reference
// Replace "your_database_name" with your actual database name or let MongoDB create it
const db = client.db("ecommerce_db"); 
const productsCollection = db.collection("product");

// MongoDB connection
async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("MongoDB connected successfully!");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

// Test route
app.get("/", (req, res) => {
  res.send("E-commerce server is running!");
});

// Example route to get all products
app.get("/products", async (req, res) => {
  try {
    const products = await productsCollection.find().toArray();
    res.send(products);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch products", error });
  }
});

// Example route to add a product
app.post("/products", async (req, res) => {
  try {
    const newProduct = req.body;
    const result = await productsCollection.insertOne(newProduct);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to insert product", error });
  }
});

// Start server
app.listen(port, async () => {
  console.log(`Server is running on port, yeah It's works ${port}`);
  await connectToMongoDB();
});