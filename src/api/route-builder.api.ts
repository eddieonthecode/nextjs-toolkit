import { ApiResponse, type Cookie } from "@e12e/ts-omni/response";
import { validateObject } from "@e12e/ts-omni/validation";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Authenticated user info extracted by a guard.
 */
export type AuthUser = Record<string, unknown>;

/**
 * Result of a guard check — either pass with user info, or fail with a response to return.
 * The failed response uses `ApiResponse`, which is automatically converted to `NextResponse` internally.
 */
export type GuardResult =
  | { passed: true; user: AuthUser }
  | { passed: false; response: ApiResponse };

/**
 * A guard function that runs before the handler.
 * Receives the request and the user extracted by previous guards (if any).
 * Use it for auth, role checking, rate-limiting, etc.
 *
 * @param req - The incoming Next.js request
 * @param user - User info from previous guards (undefined for the first guard)
 */
export type Guard = (
  req: NextRequest,
  user?: AuthUser,
) => GuardResult | Promise<GuardResult>;

/**
 * Context passed to the handler after guards and validation have run.
 *
 * @example
 * ```ts
 * const ctx: HandlerContext<LoginDto> = {
 *   user: { id: "123" },
 *   data: { email: "test@example.com", password: "secret" },
 *   params: { id: "456" },
 * };
 * ```
 */
export interface HandlerContext<T = unknown> {
  user?: AuthUser;
  data?: T;
  params: Record<string, string>;
}

/**
 * The actual route handler. Receives the request + context with user/data/params.
 * Must return an `ApiResponse` (from `@e12e/ts-omni/response`).
 */
export type HandlerFn<T = unknown> = (
  req: NextRequest,
  ctx: HandlerContext<T>,
) => ApiResponse | Promise<ApiResponse>;

/**
 * Final handler shape compatible with Next.js App Router route handlers.
 */
export type NextRouteHandler = (
  req: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

/**
 * Interceptor that wraps the validation and handler execution.
 * Runs after guards but before validation — can modify request before validation,
 * skip handler entirely, or transform the response.
 *
 * Pipeline order: guards → interceptors → validation → handler
 *
 * @param req - The incoming request
 * @param handler - The next handler to call (or skip). Returns `ApiResponse`.
 * @returns The API response (original or transformed)
 *
 * @example
 * ```ts
 * // Transform request body before validation
 * const lowercaseEmail: Interceptor = async (req, handler) => {
 *   if (req.body?.email) {
 *     req.body.email = req.body.email.toLowerCase();
 *   }
 *   return handler();
 * };
 * ```
 *
 * @example
 * ```ts
 * // Audit logging interceptor
 * const auditLog: Interceptor = async (req, handler) => {
 *   const start = Date.now();
 *   const response = await handler();
 *   console.log(`${req.method} ${req.url} - ${Date.now() - start}ms`);
 *   return response;
 * };
 * ```
 */
export type Interceptor = (
  req: NextRequest,
  handler: () => Promise<ApiResponse>,
) => Promise<ApiResponse>;

/**
 * Global error handler config.
 *
 * @example
 * ```ts
 * const options: NextRouteBuilderOptions = {
 *   onError: (error, req) => {
 *     console.error(error);
 *     return ApiResponse.json({ success: false, message: "Server error" }, { status: 500 });
 *   },
 * };
 * ```
 */
export interface NextRouteBuilderOptions {
  onError?: (error: unknown, req: NextRequest) => ApiResponse;
  guards?: Guard[];
  interceptors?: Interceptor[];
}

function toNextResponse(input: ApiResponse): NextResponse {
  const s = input as any;
  const body = s.body;
  const init = s.responseInit ?? {};

  const response = NextResponse.json(body, {
    status: init.status ?? 200,
    headers: init.headers,
  });

  (init.cookies ?? []).forEach((c: Cookie) => {
    response.cookies.set(c.name, c.value, c.options as any);
  });

  return response;
}

/**
 * Fluent builder for Next.js App Router route handlers.
 *
 * Supports guard chaining (auth, permissions), request body validation via
 * class-validator DTOs, and global error handling out of the box.
 *
 * @example
 * ```ts
 * // app/api/admin/route.ts
 * import { NextRouteBuilder, Guard } from "@e12e/nextjs-toolkit/api";
 * import { ApiResponse } from "@e12e/ts-omni/response";
 *
 * const requireAuth: Guard = (req) => {
 *   const token = req.cookies.get("session")?.value;
 *   if (!token) {
 *     return { passed: false, response: ApiResponse.json({ success: false, message: "Unauthorized" }, { status: 401 }) };
 *   }
 *   return { passed: true, user: { id: "123", role: "admin" } };
 * };
 *
 * // This guard receives the user from requireAuth
 * const requireAdmin: Guard = (req, user) => {
 *   if (user?.role !== "admin") {
 *     return { passed: false, response: ApiResponse.json({ success: false, message: "Forbidden" }, { status: 403 }) };
 *   }
 *   return { passed: true, user };
 * };
 *
 * export const POST = new NextRouteBuilder()
 *   .useGuard(requireAuth)
 *   .useGuard(requireAdmin)
 *   .handle((req, { user }) => {
 *     return ApiResponse.json({ success: true, data: { message: `Hello admin ${user.id}` } });
 *   });
 * ```
 */
export class NextRouteBuilder {
  private guards: Guard[] = [];
  private interceptors: Interceptor[] = [];
  private dtoClass?: new () => object;
  private readonly globalErrorHandler?: (
    error: unknown,
    req: NextRequest,
  ) => ApiResponse;

  constructor(options?: NextRouteBuilderOptions) {
    this.globalErrorHandler = options?.onError;
    this.guards = options?.guards ? [...options.guards] : [];
    this.interceptors = options?.interceptors ? [...options.interceptors] : [];
  }

  /**
   * Register a guard that runs before the handler.
   * Multiple guards run in registration order. If any guard returns `{ passed: false }`,
   * its response is returned immediately and the handler never executes.
   */
  useGuard(guard: Guard): this {
    this.guards.push(guard);
    return this;
  }

  /**
   * Register an interceptor that wraps the validation and handler execution.
   * Interceptors run after guards but before validation.
   * Pipeline order: guards → interceptors → validation → handler
   */
  useInterceptor(interceptor: Interceptor): this {
    this.interceptors.push(interceptor);
    return this;
  }

  /**
   * Register a DTO class for request body validation.
   * - For POST/PUT/PATCH: parses `req.json()` and validates.
   * - For GET/DELETE: parses `req.nextUrl.searchParams` and validates.
   *
   * On validation failure, a 400 response with field-level errors is returned.
   */
  validate<T extends object>(dtoClass: new () => T): this {
    this.dtoClass = dtoClass;
    return this;
  }

  /**
   * Finalize the pipeline and produce a Next.js-compatible route handler.
   * The execution order is: guards → interceptors → validation → handler.
   * Errors thrown in the handler or interceptors are caught and forwarded to `onError` if set,
   * otherwise a generic 500 is returned.
   */
  handle<T>(handler: HandlerFn<T>): NextRouteHandler {
    const guards = [...this.guards];
    const interceptors = [...this.interceptors];
    const dtoClass = this.dtoClass;
    const onError = this.globalErrorHandler;

    return async (req, routeContext) => {
      try {
        let user: AuthUser | undefined;

        for (const guard of guards) {
          const result = await guard(req, user);
          if (!result.passed) {
            return toNextResponse(result.response);
          }
          user = result.user;
        }

        // Build interceptor chain — interceptors wrap validation + handler
        const wrappedHandler: () => Promise<ApiResponse> = interceptors.reduceRight<
          () => Promise<ApiResponse>
        >(
          (next, interceptor) => () => interceptor(req, next),
          async () => {
            // Validation runs inside interceptor chain
            let data: T | undefined = undefined;
            if (dtoClass) {
              const rawBody =
                req.method === "GET" || req.method === "DELETE"
                  ? (Object.fromEntries(
                      Array.from(req.nextUrl.searchParams as any),
                    ) as Record<string, string>)
                  : await req.json();

              const result = await validateObject(dtoClass, rawBody as any);
              if (!result.success) {
                return ApiResponse.json(
                  {
                    success: false,
                    message: "Validation failed",
                    error: { type: "validation_error", fields: result.errors },
                  },
                  { status: 400 },
                );
              }
              data = result.data as T;
            }

            const params = await routeContext.params;
            return handler(req, { user, data, params });
          },
        );

        const apiResponse = await wrappedHandler();
        return toNextResponse(apiResponse);
      } catch (error) {
        if (onError) {
          return toNextResponse(onError(error, req));
        }

        const message =
          error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ success: false, message }, { status: 500 });
      }
    };
  }
}

/**
 * Factory function that creates a new `NextRouteBuilder` instance on each call.
 *
 * Useful for sharing default config (onError, guards) across multiple routes
 * without state leaking between instances.
 *
 * @param options - Default options applied to every instance
 * @returns A function that returns a fresh NextRouteBuilder instance
 *
 * @example
 * ```ts
 * // lib/route-builder.ts
 * import { createRouteBuilder } from "@e12e/nextjs-toolkit/api";
 * import { ApiResponse } from "@e12e/ts-omni/response";
 * import { requireAuth } from "@/guards/auth.guard";
 *
 * // Global route — shared error handler for all routes
 * const globalRoute = createRouteBuilder({
 *   onError: (error) => {
 *     console.error(error);
 *     return ApiResponse.json(
 *       { success: false, message: "Server error" },
 *       { status: 500 },
 *     );
 *   },
 * });
 *
 * // Authorized route — factory function that adds auth guard
 * // Must be a function (not instance) to avoid state leak between routes
 * export const authorizedRoute = () =>
 *   globalRoute().useGuard(requireAuth);
 *
 * export { globalRoute };
 * ```
 *
 * ```ts
 * // app/api/health/route.ts — public route
 * import { globalRoute } from "@/lib/route-builder";
 * import { ApiResponse } from "@e12e/ts-omni/response";
 *
 * export const GET = globalRoute()
 *   .handle(() => {
 *     return ApiResponse.json({ success: true, data: { status: "ok" } });
 *   });
 * ```
 *
 * ```ts
 * // app/api/users/route.ts — protected route
 * import { authorizedRoute } from "@/lib/route-builder";
 * import { ApiResponse } from "@e12e/ts-omni/response";
 *
 * export const GET = authorizedRoute()
 *   .handle((req, { user }) => {
 *     return ApiResponse.json({ success: true, data: { id: user.id } });
 *   });
 *
 * export const POST = authorizedRoute()
 *   .validate(CreateUserDto)
 *   .handle((req, { data }) => {
 *     return ApiResponse.json({ success: true, data });
 *   });
 * ```
 */
export function createRouteBuilder(
  defaults?: NextRouteBuilderOptions,
): () => NextRouteBuilder {
  return () => new NextRouteBuilder(defaults);
}
