export type UserID = string;

export type UserRole = "admin" | "user" | "guest";

export interface UserProfile {
  id: UserID;
  role: UserRole;
  name: string;
}

export interface AdminProfile extends UserProfile {
  permissions: string[];
}
