import { formatName } from "./utils";

export interface Authenticatable {
  isAuthenticated(): boolean;
}

export class User implements Authenticatable {
  constructor(private name: string) {}

  isAuthenticated(): boolean {
    return this.name.length > 0;
  }
}

export class Admin extends User {
  constructor(name: string) {
    super(name);
  }

  override isAuthenticated(): boolean {
    return true;
  }
}
