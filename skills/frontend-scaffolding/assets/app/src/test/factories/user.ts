import { faker } from "@faker-js/faker";
import type { UserResponse } from "@/api/generated/api";

/** A valid user; pass every field a test asserts on. */
export function buildUser(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    name: faker.person.fullName(),
    created_at: "2026-11-01T09:30:00Z",
    ...overrides,
  };
}
