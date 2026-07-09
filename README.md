# @e12e/nextjs-toolkit

Next.js toolkit for **form handling** and **API routes** — less boilerplate, clean code.

## Installation

```bash
npm install @e12e/nextjs-toolkit
# or
pnpm add @e12e/nextjs-toolkit
```

**Peer dependencies** (must be installed separately):

```bash
npm install class-transformer class-validator react-hook-form
```

## Related Packages

For common TypeScript application features (pagination, i18n, DTO transformation), check out [`@e12e/ts-omni`](https://www.npmjs.com/package/@e12e/ts-omni) — included as a dependency.

## Table of Contents

- [Usage](#usage)
  - [API Route Builder](#1-api-route-builder)
    - [Pipeline](#pipeline)
    - [Guards](#guards)
    - [HTTP Exceptions](#http-exceptions)
    - [Interceptors](#interceptors)
    - [Validation](#validation)
    - [Error Handling](#error-handling)
  - [Form Resolver](#2-form-resolver)
- [API Reference](#api-reference)
- [License](#license)

## Usage

Package provides 2 modules:

- `@e12e/nextjs-toolkit/api` — Route builder for Next.js App Router
- `@e12e/nextjs-toolkit/form` — Resolver for react-hook-form

---

### 1. API Route Builder

Build route handlers with a fluent builder API, guard chaining, and automatic validation.

```ts
// app/api/users/route.ts
import { NextRouteBuilder } from "@e12e/nextjs-toolkit/api";
import { ApiResponse } from "@e12e/ts-omni/response";
import { IsEmail, MinLength } from "class-validator";

class CreateUserDto {
  @IsEmail()
  email!: string;

  @MinLength(6)
  password!: string;
}

export const POST = new NextRouteBuilder()
  .validate(CreateUserDto)
  .handle((req, { data }) => {
    // data is already validated and type-safe
    return ApiResponse.json({
      success: true,
      data: { message: `Created user ${data.email}` },
    });
  });
```

#### Pipeline

Request flows through the pipeline in this order:

```
Guards → Interceptors → Validation → Handler
```

1. **Guards** — Auth, permissions, rate-limiting
2. **Interceptors** — Logging, caching, request transformation
3. **Validation** — DTO validation with class-validator
4. **Handler** — Your business logic

Errors thrown at any stage are caught by the global error handler.

#### Guards

Guards run before the handler — use them for auth, rate-limiting, permissions, etc.

Each guard receives the request and the user from previous guards (if any), allowing chained authorization checks.

```ts
import { Guard } from "@e12e/nextjs-toolkit/api";
import { ApiResponse } from "@e12e/ts-omni/response";

const requireAuth: Guard = (req) => {
  const token = req.cookies.get("session")?.value;
  if (!token) {
    return {
      passed: false,
      response: ApiResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      ),
    };
  }
  // Return user info — passed to next guards and handler via ctx.user
  return { passed: true, user: { id: "123", role: "admin" } };
};

// Second guard receives user from requireAuth
const requireAdmin: Guard = (req, user) => {
  if (user?.role !== "admin") {
    return {
      passed: false,
      response: ApiResponse.json(
        { success: false, message: "Forbidden" },
        { status: 403 }
      ),
    };
  }
  return { passed: true, user };
};

export const POST = new NextRouteBuilder()
  .useGuard(requireAuth)    // user = { id: "123", role: "admin" }
  .useGuard(requireAdmin)   // receives user from requireAuth
  .validate(CreateUserDto)
  .handle((req, { user, data }) => {
    // user.id = "123"
    return ApiResponse.json({ success: true });
  });
```

#### HTTP Exceptions

For cleaner error handling, install `@e12e/http-exception`:

```bash
npm install @e12e/http-exception
```

Then throw exceptions instead of manually creating responses:

```ts
import { UnauthorizedException, ForbiddenException } from "@e12e/http-exception";

const requireAuth: Guard = (req) => {
  const token = req.cookies.get("session")?.value;
  if (!token) throw new UnauthorizedException("No session token");
  return { passed: true, user: { id: "123" } };
};

const requireAdmin: Guard = (req, user) => {
  if (user?.role !== "admin") throw new ForbiddenException("Admin only");
  return { passed: true, user };
};
```

Update your error handler to handle HTTP exceptions properly:

```ts
import { HttpException } from "@e12e/http-exception";

export const globalRoute = createRouteBuilder({
  onError: (error) => {
    if (error instanceof HttpException) {
      return ApiResponse.json(
        { success: false, message: error.message },
        { status: error.status }
      );
    }
    return ApiResponse.json(
      { success: false, message: "Server error" },
      { status: 500 }
    );
  },
});
```

#### Interceptors

Interceptors run after guards but before validation — use them for logging, caching, request transformation, etc.

Pipeline order: `guards → interceptors → validation → handler`

```ts
import { Interceptor } from "@e12e/nextjs-toolkit/api";
import { ApiResponse } from "@e12e/ts-omni/response";

// Transform request body before validation
const lowercaseEmail: Interceptor = async (req, handler) => {
  if (req.body?.email) {
    req.body.email = req.body.email.toLowerCase();
  }
  return handler();
};

// Audit logging interceptor
const auditLog: Interceptor = async (req, handler) => {
  const start = Date.now();
  const response = await handler();
  console.log(`${req.method} ${req.url} - ${Date.now() - start}ms`);
  return response;
};

export const POST = new NextRouteBuilder()
  .useInterceptor(lowercaseEmail)  // runs before validation
  .useInterceptor(auditLog)
  .validate(CreateUserDto)
  .handle((req, { data }) => {
    return ApiResponse.json({ success: true, data });
  });
```

Use `createRouteBuilder` to share interceptors across routes:

```ts
// lib/route-builder.ts
export const globalRoute = createRouteBuilder({
  onError: (error) => { /* ... */ },
  interceptors: [auditLog, addTimestamp],
});

// app/api/users/route.ts
export const POST = globalRoute()
  .validate(CreateUserDto)
  .handle((req, { data }) => {
    return ApiResponse.json({ success: true, data });
  });
```

#### Validation

- **POST / PUT / PATCH**: Parses `req.json()` and validates
- **GET / DELETE**: Parses `req.nextUrl.searchParams` and validates

On validation failure, returns 400 with field-level errors:

```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "type": "validation_error",
    "fields": {
      "email": { "message": "email must be an email" }
    }
  }
}
```

#### Error handling

Use `createRouteBuilder` to define a global error handler shared across routes:

```ts
// lib/route-builder.ts
import { createRouteBuilder } from "@e12e/nextjs-toolkit/api";
import { ApiResponse } from "@e12e/ts-omni/response";

export const globalRoute = createRouteBuilder({
  onError: (error) => {
    console.error(error);
    return ApiResponse.json(
      { success: false, message: "Server error" },
      { status: 500 }
    );
  },
});
```

```ts
// app/api/users/route.ts
import { globalRoute } from "@/lib/route-builder";

export const POST = globalRoute()
  .validate(CreateUserDto)
  .handle((req, { data }) => {
    throw new Error("Something went wrong"); // Caught and forwarded to onError
  });
```

For protected routes, create a factory function that adds guards:

```ts
// lib/route-builder.ts
import { requireAuth } from "@/guards/auth.guard";

// Factory function — call it each time to get a fresh instance
export const authorizedRoute = () =>
  globalRoute().useGuard(requireAuth);
```

```ts
// app/api/users/route.ts
import { authorizedRoute } from "@/lib/route-builder";

export const GET = authorizedRoute()
  .handle((req, { user }) => {
    return ApiResponse.json({ success: true, data: { id: user.id } });
  });
```

---

### 2. Form Resolver

Resolver for `react-hook-form` powered by class-validator + class-transformer.

```tsx
import { useForm } from "react-hook-form";
import { classValidatorResolver } from "@e12e/nextjs-toolkit/form";
import { IsEmail, MinLength } from "class-validator";

class LoginDto {
  @IsEmail()
  email!: string;

  @MinLength(6)
  password!: string;
}

function LoginForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<LoginDto>({
    resolver: classValidatorResolver(LoginDto),
  });

  return (
    <form onSubmit={handleSubmit((data) => console.log(data))}>
      <input {...register("email")} />
      {errors.email && <span>{errors.email.message}</span>}

      <input {...register("password")} />
      {errors.password && <span>{errors.password.message}</span>}

      <button type="submit">Submit</button>
    </form>
  );
}
```

#### Error types

Each field error includes `types` — a map of all constraint codes to messages (auto-converted to snake_case):

```ts
// errors.email.types?.is_email     → "email must be an email"
// errors.email.types?.is_not_empty → "email should not be empty"
// errors.email.type = "is_email"
```

No need to set `criteriaMode: "all"` — the resolver always returns all constraints.

---

## API Reference

### `NextRouteBuilder`

| Method | Description |
|--------|-------------|
| `useGuard(guard)` | Add a guard function |
| `useInterceptor(interceptor)` | Add an interceptor that wraps the handler |
| `validate(dtoClass)` | Set DTO class for request body validation |
| `handle(handler)` | Finalize and return a Next.js route handler |

### `createRouteBuilder(options?)`

| Option | Type | Description |
|--------|------|-------------|
| `onError` | `(error, req) => ApiResponse` | Global error handler for all routes |
| `guards` | `Guard[]` | Default guards applied to all routes |
| `interceptors` | `Interceptor[]` | Default interceptors applied to all routes |

Returns a factory function that creates fresh `NextRouteBuilder` instances on each call.

```ts
const globalRoute = createRouteBuilder({
  onError: (error) => { /* ... */ },
  interceptors: [auditLog],
});

// Each call returns a new instance — no state leak between routes
const route1 = globalRoute();
const route2 = globalRoute(); // independent from route1
```

### `classValidatorResolver<T>(targetClass)`

Returns a resolver function for `useForm` from react-hook-form.

## License

MIT
