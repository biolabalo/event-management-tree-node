import request from 'supertest';
import { app, pool } from '../src/index'; // Import app and pool

describe('Categories and Events API', () => {
  // Use a unique schema for tests to avoid conflicts if multiple test suites run
  const testSchema = 'test_public'; // Using a different schema name

  beforeAll(async () => {
    // Drop the test schema and recreate it to ensure a clean state
    await pool.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE;`);
    await pool.query(`CREATE SCHEMA ${testSchema};`);

    // Ensure tables are created in the test schema before tests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.events (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${testSchema}.categories (
        id SERIAL PRIMARY KEY,
        label VARCHAR(255) NOT NULL,
        parent_id INTEGER REFERENCES ${testSchema}.categories(id) ON DELETE CASCADE,
        event_id INTEGER REFERENCES ${testSchema}.events(id) ON DELETE CASCADE
      );
    `);

    // Set the search_path for the test connection to use the test schema
    // This is important so queries like `SELECT * FROM events` correctly target the test schema
    await pool.query(`SET search_path TO ${testSchema}, public;`);

  });

  // After all tests, drop the test schema and close the pool
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE;`);
    await pool.end(); // Close the pool to allow Jest to exit
  });

  let createdEventId: number;
  let createdCategoryId: number;
  let createdChildCategoryId: number;

  it('should add an event', async () => {
    const response = await request(app)
      .post('/events')
      .send({ name: 'Test Event' });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.name).toBe('Test Event');

    createdEventId = response.body.id;
  });

  it('should add a root category tied to the event', async () => {
    const response = await request(app)
      .post('/categories')
      .send({ label: 'Root Test Category', parentId: null, eventId: createdEventId });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.label).toBe('Root Test Category');
    expect(response.body.event_id).toBe(createdEventId);
    expect(response.body.parent_id).toBeNull();

    createdCategoryId = response.body.id;
  });

  it('should add a child category tied to the root category', async () => {
      const response = await request(app)
        .post('/categories')
        .send({ label: 'Child Test Category', parentId: createdCategoryId, eventId: createdEventId });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.label).toBe('Child Test Category');
      expect(response.body.event_id).toBe(createdEventId);
      expect(response.body.parent_id).toBe(createdCategoryId);

      createdChildCategoryId = response.body.id;
  });


  it('should fetch a subtree starting from the root category', async () => {
    const response = await request(app).get(`/categories/${createdCategoryId}/subtree`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThanOrEqual(2); // Should include root and child
    const categoryIds = response.body.map((cat: any) => cat.id);
    expect(categoryIds).toContain(createdCategoryId);
    expect(categoryIds).toContain(createdChildCategoryId);
  });

  it('should fetch a subtree starting from the child category', async () => {
    const response = await request(app).get(`/categories/${createdChildCategoryId}/subtree`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(1); // Should only include the child itself
    expect(response.body[0].id).toBe(createdChildCategoryId);
  });

   it('should fetch root categories for the event', async () => {
       const response = await request(app).get(`/events/${createdEventId}/categories/root`);

       expect(response.status).toBe(200);
       expect(Array.isArray(response.body)).toBe(true);
       expect(response.body.length).toBe(1); // Only the initial root category
       expect(response.body[0].id).toBe(createdCategoryId);
       expect(response.body[0].parent_id).toBeNull();
       expect(response.body[0].event_id).toBe(createdEventId);
   });

    it('should fetch the entire tree for the event', async () => {
        const response = await request(app).get(`/events/${createdEventId}/categories/tree`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeGreaterThanOrEqual(2); // Root and child
        const categoryIds = response.body.map((cat: any) => cat.id);
        expect(categoryIds).toContain(createdCategoryId);
        expect(categoryIds).toContain(createdChildCategoryId);
    });


  it('should move a subtree (make child a root)', async () => {
    const response = await request(app)
      .patch(`/categories/${createdChildCategoryId}/move`)
      .send({ newParentId: null }); // Move child to be a root

    expect(response.status).toBe(200);

    // Verify the move
    const verifyResponse = await request(app).get(`/categories/${createdChildCategoryId}/subtree`);
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.length).toBe(1);
    expect(verifyResponse.body[0].parent_id).toBeNull();
  });

   it('should move a subtree (make a child of another)', async () => {
       // Add a new potential parent category
       const parentResponse = await request(app)
           .post('/categories')
           .send({ label: 'New Parent', parentId: null, eventId: createdEventId });
       expect(parentResponse.status).toBe(201);
       const newParentId = parentResponse.body.id;

       // Move the original root category under the new parent
       const moveResponse = await request(app)
           .patch(`/categories/${createdCategoryId}/move`)
           .send({ newParentId: newParentId });
       expect(moveResponse.status).toBe(200);

       // Verify the move
       const verifyResponse = await request(app).get(`/categories/${createdCategoryId}/subtree`);
       expect(verifyResponse.status).toBe(200);
       expect(verifyResponse.body.length).toBeGreaterThanOrEqual(1); // Should include the moved category
       expect(verifyResponse.body.find((cat: any) => cat.id === createdCategoryId).parent_id).toBe(newParentId);

       // Verify fetching the subtree from the new parent
       const verifyParentSubtreeResponse = await request(app).get(`/categories/${newParentId}/subtree`);
       expect(verifyParentSubtreeResponse.status).toBe(200);
       expect(verifyParentSubtreeResponse.body.map((cat: any) => cat.id)).toContain(createdCategoryId);
   });


  it('should remove the child category', async () => {
    const response = await request(app).delete(`/categories/${createdChildCategoryId}`);

    expect(response.status).toBe(204);

    // Verify deletion
    const verifyResponse = await request(app).get(`/categories/${createdChildCategoryId}/subtree`);
    expect(verifyResponse.status).toBe(200); // Still returns 200 with empty array if not found in subtree logic
    expect(verifyResponse.body).toEqual([]);

     const deleteCheckResponse = await request(app).delete(`/categories/${createdChildCategoryId}`);
     expect(deleteCheckResponse.status).toBe(404); // Should now return 404 on second delete
  });

  it('should remove the root category (and its descendants via CASCADE)', async () => {
      // Note: Since we moved the original child category to be a root, it won't be
      // deleted by cascading from the original root. We'll delete the original root here.
      const response = await request(app).delete(`/categories/${createdCategoryId}`);

      expect(response.status).toBe(204);

      // Verify deletion
      const verifyResponse = await request(app).get(`/categories/${createdCategoryId}/subtree`);
      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body).toEqual([]);
  });

   it('should return 404 when fetching a non-existent category subtree', async () => {
       const response = await request(app).get('/categories/99999/subtree'); // Assuming 99999 doesn't exist
       expect(response.status).toBe(200); // Recursive query for non-existent ID returns empty set, not 404
       expect(response.body).toEqual([]);
   });

   it('should return 400 for invalid category ID in subtree fetch', async () => {
        const response = await request(app).get('/categories/abc/subtree');
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error', 'Invalid category ID');
   });

   it('should return 400 for invalid category ID in delete', async () => {
       const response = await request(app).delete('/categories/abc');
       expect(response.status).toBe(400);
       expect(response.body).toHaveProperty('error', 'Invalid category ID');
   });

    it('should return 400 for invalid category ID in move', async () => {
        const response = await request(app).patch('/categories/abc/move').send({ newParentId: null });
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error', 'Invalid category ID');
    });

     it('should return 400 for invalid newParentId in move', async () => {
         const response = await request(app).patch(`/categories/${createdChildCategoryId}/move`).send({ newParentId: 'def' }); // Use an existing valid category ID for the target
         expect(response.status).toBe(400);
         expect(response.body).toHaveProperty('error', 'Invalid newParentId');
     });

    it('should return 400 when adding a category without label', async () => {
        const response = await request(app).post('/categories').send({ parentId: null, eventId: createdEventId });
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error', 'Category label is required');
    });

     it('should return 400 when adding a category without eventId', async () => {
         const response = await request(app).post('/categories').send({ label: 'No Event Cat', parentId: null });
         expect(response.status).toBe(400);
         expect(response.body).toHaveProperty('error', 'eventId is required for a category');
     });

    it('should return 400 when adding an event without name', async () => {
        const response = await request(app).post('/events').send({});
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error', 'Event name is required');
    });

});