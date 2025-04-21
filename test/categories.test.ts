import request from 'supertest';
import app from '../src/index';
import pool from '../src/index';

describe('Categories API', () => {
  afterAll(async () => {
    await pool.end();
  });

  let createdEventId: number;
  let createdCategoryId: number;

  it('should add an event', async () => {
    const response = await request(app)
      .post('/events')
      .send({ name: 'Test Event' });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.name).toBe('Test Event');

    createdEventId = response.body.id;
  });

  it('should add a category tied to the event', async () => {
    const response = await request(app)
      .post('/categories')
      .send({ label: 'Test Category', parentId: null, eventId: createdEventId });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.label).toBe('Test Category');
    expect(response.body.event_id).toBe(createdEventId);

    createdCategoryId = response.body.id;
  });

  it('should fetch a subtree tied to the event', async () => {
    const response = await request(app).get(`/categories/${createdCategoryId}/subtree`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('should move a subtree tied to the event', async () => {
    const response = await request(app)
      .patch(`/categories/${createdCategoryId}/move`)
      .send({ newParentId: null });

    expect(response.status).toBe(200);
  });

  it('should remove a category tied to the event', async () => {
    const response = await request(app).delete(`/categories/${createdCategoryId}`);

    expect(response.status).toBe(204);
  });
});