import express, { type Request , type Response , type NextFunction } from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('Error: DB_URL is not set in the environment variables. Please add it to the .env file.');
  process.exit(1);
}

// console.log(process.env.DATABASE_URL, '.........')

const { Pool } = pg;

const app = express();
const PORT = 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Create the categories and events tables
(async () => {
  const dropCategoriesTableQuery = 'DROP TABLE IF EXISTS categories CASCADE;';
  const dropEventsTableQuery = 'DROP TABLE IF EXISTS events CASCADE;';

  const createEventsTableQuery = `
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL
    );
  `;

  const createCategoriesTableQuery = `
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      label VARCHAR(255) NOT NULL,
      parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE
    );
  `;

  try {
    await pool.query(dropCategoriesTableQuery);
    await pool.query(dropEventsTableQuery);

    await pool.query(createEventsTableQuery);
    console.log('Events table created successfully.');

    await pool.query(createCategoriesTableQuery);
    console.log('Categories table created successfully.');
  } catch (error) {
    console.error('Error creating tables:', error);
  }
})();

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Event Management API is running!');
});

// Add an event
app.post('/events', async (req: Request, res: Response) => {
  const { name } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO events (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding event:', error);
    res.status(500).json({ error: 'Failed to add event' });
  }
});

// Add a category tied to an event
app.post('/categories', async (req: Request, res: Response) => {
  const { label, parentId, eventId } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO categories (label, parent_id) VALUES ($1, $2) RETURNING *',
      [label, parentId || null]
    );

    // Associate the category with the event
    await pool.query(
      'UPDATE events SET category_id = $1 WHERE id = $2',
      [result.rows[0].id, eventId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding category:', error);
    res.status(500).json({ error: 'Failed to add category' });
  }
});

// Remove a category
app.delete('/categories/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM categories WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    console.error('Error removing category:', error);
    res.status(500).json({ error: 'Failed to remove category' });
  }
});

// Fetch a subtree by parent ID
app.get( "/categories/:id/subtree", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `WITH RECURSIVE subtree AS (
        SELECT * FROM categories WHERE id = $1
        UNION ALL
        SELECT c.* FROM categories c INNER JOIN subtree s ON c.parent_id = s.id
      ) SELECT * FROM subtree`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching subtree:', error);
    res.status(500).json({ error: 'Failed to fetch subtree' });
  }
});

// Move a subtree
app.patch('/categories/:id/move', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newParentId } = req.body;

  try {
    await pool.query('UPDATE categories SET parent_id = $1 WHERE id = $2', [newParentId || null, id]);
    res.status(200).send();
  } catch (error) {
    console.error('Error moving subtree:', error);
    res.status(500).json({ error: 'Failed to move subtree' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

export default pool;