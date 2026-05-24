import { api } from "../../convex/src/api";

export function bootstrap(): void {
  api.configure();
}
