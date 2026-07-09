import { describe, it, expect } from "vitest";
import { classValidatorResolver } from "../../src/form/resolver.form";
import { IsEmail, MinLength, IsNotEmpty } from "class-validator";

// Test DTOs with decorators
class LoginDto {
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}

describe("classValidatorResolver", () => {
  describe("Valid data", () => {
    it("should return values for valid data", async () => {
      const resolver = classValidatorResolver(LoginDto);
      const result = await resolver({
        email: "test@example.com",
        password: "password123",
      });

      expect(result.values).toBeDefined();
      expect(result.errors).toEqual({});
    });
  });

  describe("Invalid data", () => {
    it("should return errors for invalid email", async () => {
      const resolver = classValidatorResolver(LoginDto);
      const result = await resolver({
        email: "invalid-email",
        password: "password123",
      });

      expect(result.errors).toBeDefined();
      expect(Object.keys(result.errors).length).toBeGreaterThan(0);
    });

    it("should return errors for short password", async () => {
      const resolver = classValidatorResolver(LoginDto);
      const result = await resolver({
        email: "test@example.com",
        password: "123",
      });

      expect(result.errors).toBeDefined();
      expect(Object.keys(result.errors).length).toBeGreaterThan(0);
    });

    it("should return multiple field errors", async () => {
      const resolver = classValidatorResolver(LoginDto);
      const result = await resolver({
        email: "invalid",
        password: "123",
      });

      expect(result.errors).toBeDefined();
      expect(Object.keys(result.errors).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Snake case conversion", () => {
    it("should convert constraint codes to snake_case", async () => {
      const resolver = classValidatorResolver(LoginDto);
      const result = await resolver({
        email: "invalid",
        password: "123",
      });

      // Check that error types are in snake_case
      const errorKeys = Object.keys(result.errors);
      for (const key of errorKeys) {
        const error = (result.errors as Record<string, { type: string }>)[key];
        expect(error.type).toMatch(/^[\w_]+$/);
        expect(error.type).not.toMatch(/[A-Z]/);
      }
    });
  });

  describe("Edge cases", () => {
    it("should handle empty object", async () => {
      const resolver = classValidatorResolver(LoginDto);
      const result = await resolver({} as any);

      expect(result.errors).toBeDefined();
    });
  });
});
