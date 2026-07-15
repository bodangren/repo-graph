import { formatName } from "./utils";

/** Contract for objects that report authentication state. */
export interface Authenticatable {
  isAuthenticated(): boolean;
}

/** A user that can report authentication state. */
export class User implements Authenticatable {
  /**
   * Create a user.
   *
   * @param name User name.
   */
  constructor(private name: string) {}

  /**
   * Check whether the user has a non-empty name.
   *
   * @returns Whether the user is authenticated.
   */
  isAuthenticated(): boolean {
    return this.name.length > 0;
  }
}

/** An administrator that is always authenticated. */
export class Admin extends User {
  /**
   * Create an administrator.
   *
   * @param name Administrator name.
   */
  constructor(name: string) {
    super(name);
  }

  /**
   * Report administrator authentication state.
   *
   * @returns Always `true` for an administrator.
   */
  override isAuthenticated(): boolean {
    return true;
  }
}
