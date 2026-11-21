const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let booksCollection;
let borrowsCollection;

async function connectDB() {
  if (!booksCollection || !borrowsCollection) {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'booknookDB');
    booksCollection = db.collection('books');
    borrowsCollection = db.collection('borrows');
  }
}

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized access: token missing' });
  }

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Forbidden: invalid or expired token' });
    }
    req.decoded = decoded;
    next();
  });
};

app.post('/jwt', (req, res) => {
  const { email, name } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Email is required for token' });
  }
  const token = jwt.sign({ email, name }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
  res.json({ token });
});

app.get('/books', async (req, res) => {
  try {
    await connectDB();
    const { search, category } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { author: { $regex: search, $options: 'i' } },
      ];
    }

    if (category && category !== 'All') {
      query.category = category;
    }

    const books = await booksCollection.find(query).toArray();
    res.json(books);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch books', error: err.message });
  }
});

app.get('/books/:id', async (req, res) => {
  try {
    await connectDB();
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid book ID' });
    }

    const book = await booksCollection.findOne({ _id: new ObjectId(id) });
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    res.json(book);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch book details', error: err.message });
  }
});

app.post('/books', verifyJWT, async (req, res) => {
  try {
    await connectDB();
    const bookData = req.body;
    const newBook = {
      ...bookData,
      availableCopies: Number(bookData.availableCopies) || 1,
      addedByEmail: req.decoded.email,
      createdAt: new Date(),
    };

    const result = await booksCollection.insertOne(newBook);
    res.status(201).json({ insertedId: result.insertedId, book: newBook });
  } catch (err) {
    res.status(500).json({ message: 'Failed to add book', error: err.message });
  }
});

app.patch('/books/:id', verifyJWT, async (req, res) => {
  try {
    await connectDB();
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid book ID' });
    }

    const updateFields = { ...req.body };
    delete updateFields._id;
    if (updateFields.availableCopies !== undefined) {
      updateFields.availableCopies = Number(updateFields.availableCopies);
    }

    const result = await booksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updateFields, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Book not found' });
    }

    res.json({ message: 'Book updated successfully', modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update book', error: err.message });
  }
});

app.delete('/books/:id', verifyJWT, async (req, res) => {
  try {
    await connectDB();
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid book ID' });
    }

    const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Book not found' });
    }

    res.json({ message: 'Book deleted successfully', deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete book', error: err.message });
  }
});

app.post('/borrows', verifyJWT, async (req, res) => {
  try {
    await connectDB();
    const { bookId, returnDate } = req.body;
    const userEmail = req.decoded.email;

    if (!bookId || !ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: 'Valid bookId is required' });
    }

    const bookObjectId = new ObjectId(bookId);
    const book = await booksCollection.findOne({ _id: bookObjectId });
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }

    if ((book.availableCopies ?? 0) <= 0) {
      return res.status(400).json({ message: 'No available copies left to borrow' });
    }

    // No Double Borrow: prevent borrowing the same book again if already active
    const existingBorrow = await borrowsCollection.findOne({
      bookId: bookObjectId,
      userEmail,
      status: 'borrowed',
    });

    if (existingBorrow) {
      return res.status(409).json({ message: 'You have already borrowed this book' });
    }

    const borrowRecord = {
      bookId: bookObjectId,
      bookTitle: book.title,
      bookImage: book.image || book.coverImage || '',
      author: book.author || '',
      category: book.category || '',
      userEmail,
      borrowDate: new Date(),
      returnDate: returnDate ? new Date(returnDate) : null,
      status: 'borrowed',
    };

    const borrowResult = await borrowsCollection.insertOne(borrowRecord);

    await booksCollection.updateOne(
      { _id: bookObjectId },
      { $inc: { availableCopies: -1 } }
    );

    res.status(201).json({
      message: 'Book borrowed successfully',
      insertedId: borrowResult.insertedId,
      borrow: borrowRecord,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to borrow book', error: err.message });
  }
});

app.get('/borrows', verifyJWT, async (req, res) => {
  try {
    await connectDB();
    const query = { userEmail: req.decoded.email };
    const borrows = await borrowsCollection.find(query).sort({ borrowDate: -1 }).toArray();
    res.json(borrows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch borrowed books', error: err.message });
  }
});

app.patch('/borrows/:id/return', verifyJWT, async (req, res) => {
  try {
    await connectDB();
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid borrow ID' });
    }

    const borrowRecord = await borrowsCollection.findOne({
      _id: new ObjectId(id),
      userEmail: req.decoded.email,
    });

    if (!borrowRecord) {
      return res.status(404).json({ message: 'Borrow record not found' });
    }

    if (borrowRecord.status === 'returned') {
      return res.status(400).json({ message: 'Book has already been returned' });
    }

    await borrowsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'returned', actualReturnDate: new Date() } }
    );

    await booksCollection.updateOne(
      { _id: borrowRecord.bookId },
      { $inc: { availableCopies: 1 } }
    );

    res.json({ message: 'Book returned successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to return book', error: err.message });
  }
});

app.get('/', async (req, res) => {
  await connectDB();
  res.json({ message: 'BookNook server is running' });
});

app.listen(port, () => {
  console.log(`BookNook server running on port ${port}`);
});