import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;
const client = new MongoClient(process.env.MONGO_DB_URI);

// CORS Policy explicit config (IMPORTANT)
app.use(cors({
  origin: "*", // ba "http://localhost:3000"
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

const db = client.db("e_commerce_db"); 
const productsCollection = db.collection("product");

// Connect MongoDB
async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("MongoDB connected successfully!");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

// GET Products
app.get("/products", async (req, res) => {
  try {
    const products = await productsCollection.find().toArray();
    res.send(products);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch products", error });
  }
});

// POST Product
app.post("/products", async (req, res) => {
  try {
    const newProduct = req.body;
    const result = await productsCollection.insertOne(newProduct);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to insert product", error });
  }
});

// DELETE Product
app.delete("/products/:id", async (req, res) => {
  try {
    const id = req.params.id;
    
    // Id check kora hocche valid ObjectId kina
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

// PUT Product (Update)
app.put("/products/:id", async (req, res) => {
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
      },
    };

    const result = await productsCollection.updateOne(filter, updateDoc);
    res.send(result);
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).send({ message: "Failed to update product", error: error.message });
  }
});

app.listen(port, async () => {
  console.log(`Server is running on port ${port}`);
  await connectToMongoDB();
});