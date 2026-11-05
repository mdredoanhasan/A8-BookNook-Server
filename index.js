import express from "express";
import { MongoClient } from "mongodb";
import cors from "cors";
import "dotenv/config";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URL);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("BookNook");
const bookCollection = db.collection("Books");
// const browseCollection = db.collection("Browse");

app.post("/Add-Books", async (req, res) => {
  const data = req.body;

  const result = await bookCollection.insertOne(data);
  console.log(result);
  res.send(result);
});

app.get("/", (req, res) => {
  res.send({ msg: "Server is running" });
});

app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
