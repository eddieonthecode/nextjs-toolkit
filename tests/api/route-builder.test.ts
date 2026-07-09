import { describe, it, expect, vi } from "vitest";
import { NextRouteBuilder, createRouteBuilder, type Guard, type Interceptor } from "../../src/api/route-builder.api";
import { ApiResponse } from "@e12e/ts-omni/response";
import { NextRequest } from "next/server";

// Mock NextRequest
function createMockRequest(options: {
  method?: string;
  body?: Record<string, unknown>;
  searchParams?: Record<string, string>;
  cookies?: Record<string, string>;
} = {}): NextRequest {
  const { method = "GET", body, searchParams, cookies } = options;

  const url = new URL("http://localhost/api/test");
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const headers = new Headers();
  if (cookies) {
    headers.set(
      "Cookie",
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")
    );
  }

  const req = new NextRequest(url, {
    method,
    headers,
  });

  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    req.json = vi.fn().mockResolvedValue(body);
  }

  return req;
}

// Mock route context
function createMockContext(params: Record<string, string> = {}) {
  return {
    params: Promise.resolve(params),
  };
}

describe("NextRouteBuilder", () => {
  describe("Basic handler", () => {
    it("should return response from handler", async () => {
      const builder = new NextRouteBuilder();
      const handler = builder.handle(() => {
        return ApiResponse.json({ success: true, data: "hello" });
      });

      const req = createMockRequest();
      const ctx = createMockContext();
      const response = await handler(req, ctx);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ success: true, data: "hello" });
    });

    it("should pass params to handler", async () => {
      const builder = new NextRouteBuilder();
      const handler = builder.handle((req, { params }) => {
        return ApiResponse.json({ success: true, data: { id: params.id } });
      });

      const req = createMockRequest();
      const ctx = createMockContext({ id: "123" });
      const response = await handler(req, ctx);
      const body = await response.json();

      expect(body).toEqual({ success: true, data: { id: "123" } });
    });
  });

  describe("Guards", () => {
    it("should pass guard and provide user to handler", async () => {
      const requireAuth: Guard = (req) => {
        const token = req.headers.get("Authorization");
        if (!token) {
          return {
            passed: false,
            response: ApiResponse.json(
              { success: false, message: "Unauthorized" },
              { status: 401 }
            ),
          };
        }
        return { passed: true, user: { id: "123", role: "admin" } };
      };

      const builder = new NextRouteBuilder().useGuard(requireAuth);
      const handler = builder.handle((req, { user }) => {
        return ApiResponse.json({ success: true, data: { userId: user?.id } });
      });

      const req = createMockRequest();
      req.headers.set("Authorization", "Bearer token123");
      const ctx = createMockContext();
      const response = await handler(req, ctx);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ success: true, data: { userId: "123" } });
    });

    it("should reject when guard fails", async () => {
      const requireAuth: Guard = () => {
        return {
          passed: false,
          response: ApiResponse.json(
            { success: false, message: "Unauthorized" },
            { status: 401 }
          ),
        };
      };

      const builder = new NextRouteBuilder().useGuard(requireAuth);
      const handler = builder.handle(() => {
        return ApiResponse.json({ success: true });
      });

      const req = createMockRequest();
      const ctx = createMockContext();
      const response = await handler(req, ctx);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ success: false, message: "Unauthorized" });
    });

    it("should chain multiple guards", async () => {
      const requireAuth: Guard = () => {
        return { passed: true, user: { id: "123", role: "admin" } };
      };

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

      const builder = new NextRouteBuilder()
        .useGuard(requireAuth)
        .useGuard(requireAdmin);

      const handler = builder.handle((req, { user }) => {
        return ApiResponse.json({ success: true, data: { role: user?.role } });
      });

      const req = createMockRequest();
      const ctx = createMockContext();
      const response = await handler(req, ctx);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ success: true, data: { role: "admin" } });
    });

    it("should stop at first failing guard", async () => {
      const guard1: Guard = () => {
        return { passed: true, user: { id: "123" } };
      };

      const guard2: Guard = () => {
        return {
          passed: false,
          response: ApiResponse.json(
            { success: false, message: "Forbidden" },
            { status: 403 }
          ),
        };
      };

      const guard3 = vi.fn<Guard>().mockReturnValue({ passed: true, user: {} });

      const builder = new NextRouteBuilder()
        .useGuard(guard1)
        .useGuard(guard2)
        .useGuard(guard3);

      const handler = builder.handle(() => {
        return ApiResponse.json({ success: true });
      });

      const req = createMockRequest();
      const ctx = createMockContext();
      const response = await handler(req, ctx);

      expect(response.status).toBe(403);
      expect(guard3).not.toHaveBeenCalled();
    });
  });

  describe("Interceptors", () => {
    it("should run interceptor before handler", async () => {
      const logs: string[] = [];

      const loggingInterceptor: Interceptor = async (req, handler) => {
        logs.push("before");
        const response = await handler();
        logs.push("after");
        return response;
      };

      const builder = new NextRouteBuilder().useInterceptor(loggingInterceptor);
      const handler = builder.handle(() => {
        logs.push("handler");
        return ApiResponse.json({ success: true });
      });

      const req = createMockRequest();
      const ctx = createMockContext();
      await handler(req, ctx);

      expect(logs).toEqual(["before", "handler", "after"]);
    });

    it("should allow interceptor to skip handler", async () => {
      const cacheInterceptor: Interceptor = async (req, handler) => {
        // Simulate cache hit
        return ApiResponse.json({ success: true, data: "cached" });
      };

      const builder = new NextRouteBuilder().useInterceptor(cacheInterceptor);
      const handlerFn = vi.fn().mockReturnValue(
        ApiResponse.json({ success: true, data: "fresh" })
      );

      const handler = builder.handle(handlerFn);
      const req = createMockRequest();
      const ctx = createMockContext();
      const response = await handler(req, ctx);
      const body = await response.json();

      expect(body).toEqual({ success: true, data: "cached" });
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it("should chain multiple interceptors", async () => {
      const logs: string[] = [];

      const interceptor1: Interceptor = async (req, handler) => {
        logs.push("interceptor1-before");
        const response = await handler();
        logs.push("interceptor1-after");
        return response;
      };

      const interceptor2: Interceptor = async (req, handler) => {
        logs.push("interceptor2-before");
        const response = await handler();
        logs.push("interceptor2-after");
        return response;
      };

      const builder = new NextRouteBuilder()
        .useInterceptor(interceptor1)
        .useInterceptor(interceptor2);

      const handler = builder.handle(() => {
        logs.push("handler");
        return ApiResponse.json({ success: true });
      });

      const req = createMockRequest();
      const ctx = createMockContext();
      await handler(req, ctx);

      expect(logs).toEqual([
        "interceptor1-before",
        "interceptor2-before",
        "handler",
        "interceptor2-after",
        "interceptor1-after",
      ]);
    });
  });

  describe("Error handling", () => {
    it("should catch errors and return 500", async () => {
      const builder = new NextRouteBuilder();
      const handler = builder.handle(() => {
        throw new Error("Something went wrong");
      });

      const req = createMockRequest();
      const ctx = createMockContext();
      const response = await handler(req, ctx);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        success: false,
        message: "Something went wrong",
      });
    });

    it("should use custom onError handler", async () => {
      const onError = vi.fn().mockReturnValue(
        ApiResponse.json(
          { success: false, message: "Custom error" },
          { status: 503 }
        )
      );

      const builder = new NextRouteBuilder({ onError });
      const handler = builder.handle(() => {
        throw new Error("Something went wrong");
      });

      const req = createMockRequest();
      const ctx = createMockContext();
      const response = await handler(req, ctx);
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).toEqual({ success: false, message: "Custom error" });
      expect(onError).toHaveBeenCalled();
    });

    it("should handle non-Error thrown values", async () => {
      const builder = new NextRouteBuilder();
      const handler = builder.handle(() => {
        throw "string error";
      });

      const req = createMockRequest();
      const ctx = createMockContext();
      const response = await handler(req, ctx);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        success: false,
        message: "Internal server error",
      });
    });
  });

  describe("Fluent API", () => {
    it("should support method chaining", () => {
      const builder = new NextRouteBuilder()
        .useGuard(() => ({ passed: true, user: {} }))
        .useInterceptor(async (req, handler) => handler());

      expect(builder).toBeInstanceOf(NextRouteBuilder);
    });
  });
});

describe("createRouteBuilder", () => {
  it("should create new instance on each call", () => {
    const createRoute = createRouteBuilder({
      onError: () =>
        ApiResponse.json({ success: false, message: "error" }, { status: 500 }),
    });

    const route1 = createRoute();
    const route2 = createRoute();

    expect(route1).not.toBe(route2);
    expect(route1).toBeInstanceOf(NextRouteBuilder);
    expect(route2).toBeInstanceOf(NextRouteBuilder);
  });

  it("should share default options across instances", async () => {
    const onError = vi.fn().mockReturnValue(
      ApiResponse.json({ success: false, message: "global error" }, { status: 500 })
    );

    const createRoute = createRouteBuilder({ onError });

    const handler1 = createRoute().handle(() => {
      throw new Error("error1");
    });

    const handler2 = createRoute().handle(() => {
      throw new Error("error2");
    });

    const req = createMockRequest();
    const ctx = createMockContext();

    await handler1(req, ctx);
    await handler2(req, ctx);

    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("should not share guards between instances", async () => {
    const guard = vi.fn<Guard>().mockReturnValue({ passed: true, user: {} });

    const createRoute = createRouteBuilder({
      guards: [guard],
    });

    const handler1 = createRoute().handle(() => {
      return ApiResponse.json({ success: true });
    });

    const handler2 = createRoute().handle(() => {
      return ApiResponse.json({ success: true });
    });

    const req = createMockRequest();
    const ctx = createMockContext();

    await handler1(req, ctx);
    await handler2(req, ctx);

    // guard should be called twice (once per instance)
    expect(guard).toHaveBeenCalledTimes(2);
  });
});
