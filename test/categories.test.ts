import request from 'supertest';
import app from '../src/index';
import pool from '../src/index';



describe('Categories API', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('should add a category', async () => {
    const response = await request(app)
      .post('/categories')
      .send({ label: 'Test Category', parentId: null });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.label).toBe('Test Category');
  });

  it('should fetch a subtree', async () => {
    const response = await request(app).get('/categories/1/subtree');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should move a subtree', async () => {
    const response = await request(app)
      .patch('/categories/1/move')
      .send({ newParentId: 2 });

    expect(response.status).toBe(200);
  });

  it('should remove a category', async () => {
    const response = await request(app).delete('/categories/1');

    expect(response.status).toBe(204);
  });

  it('should add an event', async () => {
    const response = await request(app)
      .post('/events')
      .send({ name: 'Test Event', categoryId: 1 });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.name).toBe('Test Event');
  });

  it('should fetch events by category', async () => {
    const response = await request(app).get('/categories/1/events');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});