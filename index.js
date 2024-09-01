// challenges: make sure that all multiple choice answers are unique

const express = require('express');
const { Pool } = require('pg');
const { MongoClient, ServerApiVersion } = require('mongodb');
const bcrypt = require('bcrypt');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();

require("dotenv").config();


app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: 'postgresql://LatinRootsModule_owner:Y5OFJKV3xjnr@ep-soft-limit-a5i6em4x.us-east-2.aws.neon.tech/LatinRootsModule?sslmode=require',
});

const uri = "mongodb+srv://mchuangyc:p10U1cicI1VpoYTN@cluster0.basxm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });

let database;

async function connectToMongoDB() {
  try {
    await client.connect();
    database = client.db("myDatabase");
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
  }
}

connectToMongoDB();

async function createUser(email, password, points = 0) {
  const users = database.collection("users");
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = { email, password: hashedPassword, points, wrongList: {}, correctList: [] };
  const result = await users.insertOne(user);
  console.log(`New user created with ID: ${result.insertedId}`);
  return result.insertedId;
}

async function findUserByEmail(email) {
  const users = database.collection("users");
  return await users.findOne({ email });
}

async function updateUserPoints(email, points, word, isCorrect) {
  const users = database.collection("users");
  const user = await users.findOne({ email });
  
  if (user) {
    let newPoints = user.points + points;
    if (newPoints < 0) newPoints = 0;

    if (isCorrect) {
      user.correctList = updateCorrectList(user.correctList, word);
      if (user.wrongList[word]) delete user.wrongList[word];
    } else {
      user.wrongList = updateWrongList(user.wrongList, word);
    }

    await users.updateOne(
      { email },
      { $set: { points: newPoints, wrongList: user.wrongList, correctList: user.correctList } }
    );
    
    return newPoints;
  }
  return null;
}

function updateCorrectList(correctList, word) {
  if (correctList.includes(word)) {
    return correctList;
  }

  const wordEntry = correctList.find(entry => entry.word === word);
  if (wordEntry) {
    wordEntry.count++;
    if (wordEntry.count === 3) {
      correctList = correctList.filter(entry => entry.word !== word);
      correctList.push(word);
    }
  } else {
    correctList.push({ word, count: 1 });
  }

  return correctList;
}

function updateWrongList(wrongList, word) {
  wrongList[word] = (wrongList[word] || 0) + 1;
  return wrongList;
}

app.post('/correctWords', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await findUserByEmail(email);
    if (user) {
      res.status(200).send({ correctList: user.correctList });
    } else {
      res.status(404).send('User not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send('Email and password are required');
  }

  try {
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).send('User already exists');
    }

    const userId = await createUser(email, password);
    res.status(201).send({ message: 'User created successfully', userId });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send('Email and password are required');
  }

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).send('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).send('Invalid credentials');
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, 'your_jwt_secret', { expiresIn: '1h' });

    res.status(200).send({ message: 'Login successful', token, points: user.points });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/correct', async (req, res) => {
  const { email, word } = req.body;

  try {
    const newPoints = await updateUserPoints(email, 5, word, true);
    if (newPoints !== null) {
      res.status(200).send({ message: 'Points updated successfully', points: newPoints });
    } else {
      res.status(404).send('User not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/incorrect', async (req, res) => {
  const { email, word } = req.body;

  try {
    const newPoints = await updateUserPoints(email, -2, word, false);
    if (newPoints !== null) {
      res.status(200).send({ message: 'Points updated successfully', points: newPoints });
    } else {
      res.status(404).send('User not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/quiz', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH random_question AS (
        SELECT root AS question, definition AS correct_answer
        FROM latin_roots
        OFFSET floor(random() * (SELECT COUNT(*) FROM latin_roots)) LIMIT 1
      ),
      wrong_answers AS (
        SELECT DISTINCT definition AS wrong_answer
        FROM latin_roots
        WHERE definition <> (SELECT correct_answer FROM random_question)
        ORDER BY random()
        LIMIT 3
      )
      SELECT question, correct_answer, array_agg(wrong_answer) AS wrong_answers
      FROM random_question, wrong_answers
      GROUP BY question, correct_answer;
    `);

    if (result.rows.length === 0) {
      throw new Error('No quiz question found');
    }

    const quiz = result.rows[0];
    const allAnswers = [quiz.correct_answer, ...quiz.wrong_answers];

    const uniqueAnswers = [...new Set(allAnswers)];

    while (uniqueAnswers.length < 4) {
      const additionalAnswers = await pool.query(`
        SELECT DISTINCT definition AS wrong_answer
        FROM latin_roots
        WHERE definition <> $1
        AND definition NOT IN (${uniqueAnswers.map((_, i) => `$${i + 2}`).join(', ')})
        ORDER BY random()
        LIMIT ${4 - uniqueAnswers.length};
      `, [quiz.correct_answer, ...uniqueAnswers]);

      uniqueAnswers.push(...additionalAnswers.rows.map(row => row.wrong_answer));
    }

    res.json({
      question: quiz.question,
      correct_answer: quiz.correct_answer,
      answers: uniqueAnswers.sort(() => Math.random() - 0.5),
    });
  } catch (err) {
    console.error('Error executing query', err.stack);
    res.status(500).send(`Error retrieving data: ${err.message}`);
  }
});

app.get('/correctWords', async (req, res) => {
  const { email } = req.query;

  try {
    const user = await findUserByEmail(email);
    if (user) {
      res.status(200).send({ correctList: user.correctList });
    } else {
      res.status(404).send('User not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/wrongWords', async (req, res) => {
  const { email } = req.query;

  try {
    const user = await findUserByEmail(email);
    if (user) {
      res.status(200).send({ wrongList: user.wrongList });
    } else {
      res.status(404).send('User not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/points', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).send('Email is required');
  }

  try {
    const user = await findUserByEmail(email);
    if (user) {
      res.status(200).send({ points: user.points });
    } else {
      res.status(404).send('User not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/hello', (req, res) => {
  res.send('Hello World!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
