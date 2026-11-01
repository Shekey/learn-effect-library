import type { Post, User } from "../../domain/profile"

// Port. Return types say nothing about failures.
export interface UserClient {
  getUser(id: number): Promise<User>
  getPosts(id: number): Promise<readonly Post[]>
}
