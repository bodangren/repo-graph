import { api } from "../../convex/src/api";

/**
 * Configure the fixture API during application startup.
 *
 * @returns Nothing.
 */
export function bootstrap(): void {
  api.configure();
}
