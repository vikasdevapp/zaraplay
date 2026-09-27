import { redis } from "./redis";
import { gateway } from "./ggusonepay";

// GGUSOnePay has no "which channels are live" API, so a deposit method that the gateway
// rejects as unavailable (maintenance, channel closed, ...) is hidden from users for a while
// and offered again afterwards, in case the channel has come back.
const DOWN_SECONDS = 30 * 60;
const key = (wayCode: string) => `paymethod:down:${wayCode}`;

export async function availablePayMethods(): Promise<string[]> {
  const methods = gateway.payWayCodes;
  if (!methods.length) return [];
  const down = await redis.mget(...methods.map(key));
  return methods.filter((_, i) => !down[i]);
}

export async function markPayMethodDown(wayCode: string) {
  await redis.set(key(wayCode), "1", "EX", DOWN_SECONDS);
}
