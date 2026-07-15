/** Stable user identifier. */
export type UserID = string;

/** Supported user roles. */
export type UserRole = "admin" | "user" | "guest";

/** Base user profile fixture. */
export interface UserProfile {
  id: UserID;
  role: UserRole;
  name: string;
}

/** Administrator profile fixture. */
export interface AdminProfile extends UserProfile {
  permissions: string[];
}
