import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";

const app = express();
const PORT = Number(process.env.PORT) || 5000;

const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && allowedOrigins.length === 0) {
  throw new Error("CLIENT_URL must contain the deployed client origin.");
}

app.use(
  cors({
    origin: [
      "https://book-nook-client-fawn.vercel.app",
      "http://localhost:3000",
    ],
  }),
);
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

let JWKS;

const verifyJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  try {
    // jose is loaded this way because your server uses require()
    const { jwtVerify, createRemoteJWKSet } = await import("jose");

    // public keys come from your Next.js app
    JWKS =
      JWKS ||
      createRemoteJWKSet(new URL(`${process.env.AUTH_URL}/api/auth/jwks`));

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.AUTH_URL,
      audience: process.env.AUTH_URL,
    });

    req.user = payload; // payload.email, payload.name
    next();
  } catch {
    res.status(401).send({ message: "Invalid or expired token" });
  }
};

const existingLoans = await browseCollection
  .aggregate([
    { $match: { bookId: { $exists: true } } },
    { $group: { _id: { $toString: "$bookId" }, count: { $sum: 1 } } },
  ])
  .toArray();
const loanCounts = new Map(existingLoans.map(({ _id, count }) => [_id, count]));
const booksWithoutCopyCounts = await bookCollection
  .find({
    $or: [
      { totalCopies: { $exists: false } },
      { availableCopies: { $exists: false } },
    ],
  })
  .toArray();
if (booksWithoutCopyCounts.length > 0) {
  await bookCollection.bulkWrite(
    booksWithoutCopyCounts.map((book) => {
      const borrowedCount = loanCounts.get(String(book._id)) || 0;
      const availableCopies =
        Number.isInteger(book.availableCopies) && book.availableCopies >= 0
          ? book.availableCopies
          : null;
      const totalCopies =
        Number.isInteger(book.totalCopies) && book.totalCopies > 0
          ? book.totalCopies
          : Math.max(1, borrowedCount + (availableCopies ?? 0));

      return {
        updateOne: {
          filter: { _id: book._id },
          update: {
            $set: {
              totalCopies,
              availableCopies:
                availableCopies === null
                  ? Math.max(0, totalCopies - borrowedCount)
                  : Math.min(availableCopies, totalCopies),
            },
          },
        },
      };
    }),
  );
}

//for add new books from client side // start
app.post("/Add-Books", verifyJWT, async (req, res) => {
  const totalCopies = Number(req.body?.totalCopies);
  if (!Number.isInteger(totalCopies) || totalCopies < 1) {
    return res.status(400).json({
      message: "Total copies must be a positive whole number.",
    });
  }

  const result = await bookCollection.insertOne({
    ...req.body,
    addedByName: req.user.name,
    addedBy: req.user.email,
    email: req.user.email,
    totalCopies,
    availableCopies: totalCopies,
  });
  return res.send(result);
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
app.post("/Books", verifyJWT, async (req, res) => {
  const data = req.body;
  const bookId = String(data?.bookId || "");
  const email = req.user.email;
  if (!ObjectId.isValid(bookId) || typeof email !== "string" || !email) {
    return res
      .status(400)
      .json({ message: "Book ID and user email are required." });
  }

  const bookObjectId = new ObjectId(bookId);
  const bookIdValues = { $in: [bookId, bookObjectId] };
  const existingBorrow = await browseCollection.findOne({
    bookId: bookIdValues,
    email,
  });
  if (existingBorrow) {
    return res.status(409).json({
      code: "DUPLICATE_BORROW",
      message:
        "You have already borrowed this book. Return it before borrowing it again.",
    });
  }

  const reservation = await bookCollection.updateOne(
    {
      _id: bookObjectId,
      availableCopies: { $gt: 0 },
      borrowedBy: { $ne: email },
    },
    {
      $inc: { availableCopies: -1 },
      $addToSet: { borrowedBy: email },
    },
  );

  if (reservation.matchedCount === 0) {
    const duplicateBorrow = await browseCollection.findOne({
      bookId: bookIdValues,
      email,
    });
    const alreadyReserved = await bookCollection.findOne(
      { _id: bookObjectId, borrowedBy: email },
      { projection: { _id: 1 } },
    );
    if (duplicateBorrow || alreadyReserved) {
      return res.status(409).json({
        code: "DUPLICATE_BORROW",
        message:
          "You have already borrowed this book. Return it before borrowing it again.",
      });
    }

    const bookExists = await bookCollection.findOne(
      { _id: bookObjectId },
      { projection: { _id: 1 } },
    );
    if (!bookExists) {
      return res.status(404).json({ message: "Book not found." });
    }
    return res.status(409).json({
      code: "BOOK_UNAVAILABLE",
      message: "This book is not available right now.",
    });
  }

  try {
    const result = await browseCollection.insertOne({
      ...data,
      bookId,
      email,
      user: req.user.name,
    });
    return res.send(result);
  } catch (error) {
    await bookCollection.updateOne(
      { _id: bookObjectId },
      {
        $inc: { availableCopies: 1 },
        $pull: { borrowedBy: email },
      },
    );
    throw error;
  }
});

//end...

//find user borrowing books using email // start

app.get("/My-Borrows/:email", verifyJWT, async (req, res) => {
  if (req.params.email !== req.user.email) {
    return res
      .status(403)
      .json({ message: "You can only view your own borrows." });
  }
  const result = await browseCollection
    .find({ email: req.user.email })
    .toArray();
  return res.send(result);
});

//end....

//return books from my borrow //start
app.delete("/Borrows/:id", verifyJWT, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid borrow record ID." });
  }

  const borrowId = new ObjectId(id);
  const borrow = await browseCollection.findOne({
    _id: borrowId,
    email: req.user.email,
  });
  if (!borrow) {
    return res.status(404).json({ message: "Borrow record not found." });
  }

  const deleted = await browseCollection.deleteOne({
    _id: borrowId,
    email: req.user.email,
  });
  if (deleted.deletedCount === 0) {
    return res.status(404).json({ message: "Borrow record not found." });
  }

  const restoreBorrowRecord = async () => {
    await browseCollection.insertOne(borrow);
  };

  if (!ObjectId.isValid(String(borrow.bookId))) {
    await restoreBorrowRecord();
    return res
      .status(409)
      .json({ message: "The borrowed book could not be found." });
  }

  try {
    const returned = await bookCollection.updateOne(
      {
        _id: new ObjectId(String(borrow.bookId)),
        $expr: { $lt: ["$availableCopies", "$totalCopies"] },
      },
      {
        $inc: { availableCopies: 1 },
        $pull: { borrowedBy: borrow.email },
      },
    );
    if (returned.matchedCount === 0) {
      await restoreBorrowRecord();
      return res.status(409).json({
        message: "Could not update the available copy count for this book.",
      });
    }
  } catch (error) {
    await restoreBorrowRecord();
    throw error;
  }

  return res.send(deleted);
});

//end.....

//show only 6 books //start
app.get("/new-arrival", async (req, res) => {
  const result = await bookCollection
    .find()
    .sort({ _id: -1 })
    .limit(6)
    .toArray();
  res.send(result);
});

//end...

app.get("/My-Books/:email", verifyJWT, async (req, res) => {
  if (req.params.email !== req.user.email) {
    return res
      .status(403)
      .json({ message: "You can only view your own books." });
  }
  const result = await bookCollection.find({ email: req.user.email }).toArray();
  return res.send(result);
});

app.delete("/Books/:id", verifyJWT, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid book ID." });
  }
  const activeBorrow = await browseCollection.findOne({
    bookId: { $in: [id, new ObjectId(id)] },
  });
  if (activeBorrow) {
    return res.status(409).json({
      message: "This book cannot be deleted while it is borrowed.",
    });
  }
  const result = await bookCollection.deleteOne({
    _id: new ObjectId(id),
    email: req.user.email,
  });
  if (result.deletedCount === 0) {
    return res
      .status(404)
      .json({ message: "Book not found or not owned by you." });
  }
  return res.send(result);
});

app.patch("/Books/:id", verifyJWT, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid book ID." });
  }
  const { title, author, category, description } = req.body;
  const updatedData = { title, author, category, description };
  const result = await bookCollection.updateOne(
    { _id: new ObjectId(id), email: req.user.email },
    { $set: updatedData },
  );
  if (result.matchedCount === 0) {
    return res
      .status(404)
      .json({ message: "Book not found or not owned by you." });
  }
  return res.json(result);
});

app.get("/", (req, res) => {
  res.send({ msg: "Server is running" });
});

app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});

export default app;
