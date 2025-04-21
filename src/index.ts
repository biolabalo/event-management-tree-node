import express from 'express';
import type { Request, Response } from 'express';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL is not set in the environment variables. Please add it to the .env file.');
  process.exit(1); 
}

const { Pool } = pg;

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Initial database setup (create tables)
(async () => {
  const createSchemaQuery = 'CREATE SCHEMA IF NOT EXISTS public;';
  const dropCategoriesTableQuery = 'DROP TABLE IF EXISTS public.categories CASCADE;';
  const dropEventsTableQuery = 'DROP TABLE IF EXISTS public.events CASCADE;';

  const createEventsTableQuery = `
    CREATE TABLE IF NOT EXISTS public.events (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL
    );
  `;

  const createCategoriesTableQuery = `
    CREATE TABLE IF NOT EXISTS public.categories (
      id SERIAL PRIMARY KEY,
      label VARCHAR(255) NOT NULL,
      parent_id INTEGER REFERENCES public.categories(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES public.events(id) ON DELETE CASCADE
    );
  `;

  try {
    // Ensure public schema exists first
    await pool.query(createSchemaQuery);
    console.log('Ensured public schema exists.');
    
    // Drop tables with explicit schema
    await pool.query(dropCategoriesTableQuery);
    await pool.query(dropEventsTableQuery);
    console.log('Dropped existing tables (if any).');

    // Create tables with explicit schema
    await pool.query(createEventsTableQuery);
    console.log('Events table created successfully.');

    await pool.query(createCategoriesTableQuery);
    console.log('Categories table created successfully.');
  } catch (error) {
    console.error('Error during initial database setup:', error);
    // Depending on severity, you might want to exit here
    // process.exit(1);
  }
})();

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Event Management API is running!');
});

// Add an event
app.post('/events', async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Event name is required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO public.events (name) VALUES ($1) RETURNING *',
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
  if (!label) {
     return res.status(400).json({ error: 'Category label is required' });
  }

  if (eventId === undefined || eventId === null) {
      return res.status(400).json({ error: 'eventId is required for a category' });
  }


  try {
 
    const result = await pool.query(
      'INSERT INTO public.categories (label, parent_id, event_id) VALUES ($1, $2, $3) RETURNING *',
      [label, parentId || null, eventId] // Use provided eventId
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) { // Add type annotation for error
      console.error('Error adding category:', error);
      if (error.code === '23503') { // foreign_key_violation
           return res.status(400).json({ error: 'Invalid eventId or parentId' });
      }
      res.status(500).json({ error: 'Failed to add category' });
  }
});

// Remove a category
app.delete('/categories/:id', async (req: Request, res: Response) => {
  const { id } = req.params;


  const categoryId = parseInt(id, 10);
  if (isNaN(categoryId)) {
    return res.status(400).json({ error: 'Invalid category ID' });
  }

  try {
    const result = await pool.query('DELETE FROM public.categories WHERE id = $1 RETURNING id', [categoryId]);
    
    if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Category not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error removing category:', error);
    res.status(500).json({ error: 'Failed to remove category' });
  }
});

// Fetch a subtree by parent ID or root (no parent_id)
app.get("/categories/:id/subtree", async (req: Request, res: Response) => {
  const { id } = req.params;

  const categoryId = parseInt(id, 10);
  if (isNaN(categoryId)) {
     return res.status(400).json({ error: 'Invalid category ID' });
  }

  try {
    const result = await pool.query(
      `WITH RECURSIVE subtree AS (
        SELECT * FROM public.categories WHERE id = $1
        UNION ALL
        SELECT c.* FROM public.categories c INNER JOIN subtree s ON c.parent_id = s.id
      ) SELECT * FROM subtree`,
      [categoryId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching subtree:', error);
    res.status(500).json({ error: 'Failed to fetch subtree' });
  }
});

// Fetch all root categories for a specific event
app.get("/events/:eventId/categories/root", async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const eventIdNum = parseInt(eventId, 10);

    if (isNaN(eventIdNum)) {
        return res.status(400).json({ error: 'Invalid event ID' });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM public.categories WHERE event_id = $1 AND parent_id IS NULL',
            [eventIdNum]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching root categories:', error);
        res.status(500).json({ error: 'Failed to fetch root categories' });
    }
});

// Fetch the entire tree for a specific event
app.get("/events/:eventId/categories/tree", async (req: Request, res: Response) => {
    const { eventId } = req.params;
    const eventIdNum = parseInt(eventId, 10);

    if (isNaN(eventIdNum)) {
        return res.status(400).json({ error: 'Invalid event ID' });
    }

    try {
        // This query fetches all categories for an event and orders them to represent tree structure
        const result = await pool.query(
            `WITH RECURSIVE category_tree AS (
                -- Base case: Select root categories for the event
                SELECT *, 0 as depth
                FROM public.categories
                WHERE event_id = $1 AND parent_id IS NULL

                UNION ALL

                -- Recursive step: Select children
                SELECT c.*, ct.depth + 1
                FROM public.categories c
                INNER JOIN category_tree ct ON c.parent_id = ct.id
            )
            SELECT * FROM category_tree ORDER BY depth, id; -- Ordering helps visualize but doesn't build nested structure
            `,
            [eventIdNum]
        );
        // Note: This query returns a flat list with depth. Building a nested JSON tree
        // would require additional logic in your application code.
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching event tree:', error);
        res.status(500).json({ error: 'Failed to fetch event tree' });
    }
});


// Move a subtree
app.patch('/categories/:id/move', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newParentId } = req.body; // newParentId can be null to make it a root category

  // Fix: Add a check to ensure id is a number
  const categoryId = parseInt(id, 10);
  if (isNaN(categoryId)) {
    return res.status(400).json({ error: 'Invalid category ID' });
  }

  // Optional: Add validation for newParentId if it's provided (should be a number or null)
  if (newParentId !== null && newParentId !== undefined && isNaN(parseInt(newParentId, 10))) {
       return res.status(400).json({ error: 'Invalid newParentId' });
  }

  try {

    if (newParentId !== null && newParentId == categoryId) {
         return res.status(400).json({ error: 'Cannot move a category to be a child of itself' });
    }

    const result = await pool.query('UPDATE public.categories SET parent_id = $1 WHERE id = $2 RETURNING id',
                     [newParentId || null, categoryId]);

    if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Category not found' });
    }

    res.status(200).send(); // Or return the updated category
  } catch (error: any) { // Add type annotation for error
      console.error('Error moving subtree:', error);
      if (error.code === '23503') { 
           return res.status(400).json({ error: 'Invalid category ID or newParentId' });
      }
      res.status(500).json({ error: 'Failed to move subtree' });
  }
});


// Start the server only if this file is executed directly (not imported by tests)
if (require.main === module) {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
}


// Export the app and pool separately for testing purposes
export { app, pool };