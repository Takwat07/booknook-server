const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
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

app.get('/', async (req, res) => {
  await connectDB();
  res.json({ message: 'BookNook server is running' });
});

app.listen(port, () => {
  console.log(`BookNook server running on port ${port}`);
});