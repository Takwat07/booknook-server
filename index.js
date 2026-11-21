const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
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

app.get('/', async (req, res) => {
  await connectDB();
  res.json({ message: 'BookNook server is running' });
});

app.listen(port, () => {
  console.log(`BookNook server running on port ${port}`);
});