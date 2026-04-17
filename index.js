require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();
    
    const db = client.db("fakeGamers");
    const gamesCollection = db.collection("games");
    const newsCollection = db.collection("news");
    const usersCollection = db.collection("users");
    const paymentsCollection = db.collection("payments");

    console.log("Connected to MongoDB!");

    // --- Users & Admin ---
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: "user",
        createdAt: new Date(),
      });
      res.send(result);
    });

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      // Hardcoded super admin for Innovatrix agency
      if (email === "admin@innovatrix.com") {
        return res.send({ admin: true });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // Make admin (Super Admin only)
    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // --- Games ---
    app.post("/games", async (req, res) => {
      const gameData = req.body;
      const result = await gamesCollection.insertOne(gameData);
      res.send(result);
    });

    app.get("/games", async (req, res) => {
      const result = await gamesCollection.find().toArray();
      res.send(result);
    });

    app.get("/game/:id", async (req, res) => {
      const id = req.params.id;
      const result = await gamesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.delete("/game/:id", async (req, res) => {
      const id = req.params.id;
      const result = await gamesCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/my-games/:email", async (req, res) => {
      const email = req.params.email;
      const result = await gamesCollection
        .find({ "owner.email": email })
        .toArray();
      res.send(result);
    });

    // --- News ---
    app.get("/news", async (req, res) => {
      const result = await newsCollection.find().sort({ date: -1 }).toArray();
      res.send(result);
    });

    app.post("/news", async (req, res) => {
      const news = req.body;
      const result = await newsCollection.insertOne({
        ...news,
        date: new Date(),
      });
      res.send(result);
    });

    app.delete("/news/:id", async (req, res) => {
      const id = req.params.id;
      const result = await newsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // --- Stripe Checkout Session ---
    app.post("/create-checkout-session", async (req, res) => {
      const { gameId, title, price, image, customerEmail } = req.body;

      if (!price || price < 1) {
        return res.status(400).send({ error: "Invalid price" });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: title,
                images: [image],
              },
              unit_amount: Math.round(price * 100),
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: customerEmail,
        success_url: `${process.env.CLIENT_URL}/payment/success?gameId=${gameId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/details/${gameId}`,
        metadata: {
          gameId,
          customerEmail,
        },
      });

      res.send({ id: session.id, url: session.url });
    });

    // Webhook or success verify endpoint
    app.get("/verify-payment/:sessionId", async (req, res) => {
      const { sessionId } = req.params;
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === "paid") {
          const { gameId, customerEmail } = session.metadata;

          // Check if already recorded
          const existing = await paymentsCollection.findOne({ transactionId: sessionId });
          if (!existing) {
            const payment = {
              email: customerEmail,
              price: session.amount_total / 100,
              transactionId: sessionId,
              date: new Date(),
              gameId: gameId,
              title: session.line_items?.data[0]?.description || "Game Purchase",
            };
            await paymentsCollection.insertOne(payment);
          }
          res.send({ success: true });
        } else {
          res.send({ success: false });
        }
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      res.send(result);
    });

    app.get("/payments/:email", async (req, res) => {
      const email = req.params.email;
      const result = await paymentsCollection.find({ email }).toArray();
      res.send(result);
    });

    // Check if user has purchased a specific game
    app.get("/purchased/:email/:gameId", async (req, res) => {
      const { email, gameId } = req.params;
      const result = await paymentsCollection.findOne({
        email,
        gameId,
      });
      res.send({ purchased: !!result });
    });

    // DB Status Check
    app.get("/db-status", async (req, res) => {
      try {
        await client.db("admin").command({ ping: 1 });
        res.send({ status: "connected" });
      } catch (error) {
        res.status(500).send({ status: "error", message: error.message });
      }
    });

  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}
run();

app.get("/", (req, res) => {
  res.send("Fake Gamers Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
