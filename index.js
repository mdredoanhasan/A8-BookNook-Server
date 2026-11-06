import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

//mongodb connection //start

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

//end...

const db = mongoClient.db("BookNook"); //create database
const bookCollection = db.collection("Books"); // create books collection
const browseCollection = db.collection("Browse");

//for add new books from client side // start
app.post("/Add-Books", async (req, res) => {
  const data = req.body;
  const result = await bookCollection.insertOne(data);
  res.send(result);
});

//end...

//for get all books api to show on all books section //start

app.get("/All-Books", async (req, res) => {
  const result = await bookCollection.find().toArray();
  res.send(result);
});

//end...

//for getting individual books using id //start

app.get("/All-Books/:id", async (req, res) => {
  const { id } = req.params;
  const result = await bookCollection.findOne({ _id: new ObjectId(id) });
  res.send(result);
});

//end...

//add books to borrow section //start
app.post("/Books", async (req, res) => {
  const data = req.body;
  const result = await browseCollection.insertOne(data);
  res.send(result);
});

//end...

//find user borrowing books using email // start

app.get('/My-Borrows/:email', async (req, res) => {
  const { email } = req.params
  const result = await browseCollection.find({ email: email })
  res.send(result)
})

//end....

app.get("/", (req, res) => {
  res.send({ msg: "Server is running" });
});

app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
