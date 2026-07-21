import { randomUUID } from 'crypto';
import { applicationEvents } from '../events/applicationEvents';

/**
 * In-memory store for demonstration purposes.
 * A real service would use Prisma / Kysely with a database.
 */
const orders: Array<{ id: string; productId: string; quantity: number }> = [];

export function createOrder(productId: string, quantity: number) {
  const order = { id: `ord-${randomUUID().slice(0, 8)}`, productId, quantity };
  orders.push(order);

  console.log(`Order created: ${order.id}`);

  // Emit the event — listeners run synchronously in registration order
  applicationEvents.emit('order:created', {
    orderId: order.id,
    productId,
    quantity,
  });

  return order;
}

export function listOrders() {
  return orders;
}
