const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("fakeGamers");
    const gamesCollection = db.collection("games");

    app.post("/games", async (req, res) => {
      const gameData = req.body;
      console.log(gameData);
      const result = await gamesCollection.insertOne(gameData);
      res.send(result);
    });

    app.get('/games',async(req,res)=>{
        const result =await gamesCollection.find().toArray();
        res.send(result);
    })

    // await client.connect();

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("server is  working");
});

app.listen(port, () => {
  console.log(`port is running on ${port}`);
});
