import { toSnakeCase } from "@e12e/ts-omni/validation";
import { plainToInstance } from "class-transformer";
import { validate, type ValidationError } from "class-validator";
import type { FieldError, ResolverResult } from "react-hook-form";

/**
 * Creates a react-hook-form resolver powered by class-validator + class-transformer.
 *
 * Use it as the `resolver` option in `useForm` to automatically validate form data
 * against a DTO class decorated with class-validator decorators.
 *
 * @example
 * ```tsx
 * import { useForm } from "react-hook-form";
 * import { classValidatorResolver } from "@e12e/nextjs-toolkit/form";
 * import { IsEmail, MinLength } from "class-validator";
 *
 * class LoginDto {
 *   \@IsEmail()
 *   email!: string;
 *
 *   \@MinLength(6)
 *   password!: string;
 * }
 *
 * function LoginForm() {
 *   const { register, handleSubmit, formState: { errors } } = useForm<LoginDto>({
 *     resolver: classValidatorResolver(LoginDto),
 *   });
 *
 *   // Each field error also exposes `types` — a map of all constraint codes → messages:
 *   // (codes are automatically converted to snake_case)
 *   //   errors.email.types?.is_email     → "email must be an email"
 *   //   errors.email.types?.is_not_empty → "email should not be empty"
 *   //   errors.email.type                = "is_email"
 *   // No need for `criteriaMode: "all"` — the resolver always returns all constraints.
 *
 *   return (
 *     <form onSubmit={handleSubmit((data) => console.log(data))}>
 *       <input {...register("email")} />
 *       {errors.email && <span>{errors.email.message}</span>}
 *
 *       <input {...register("password")} />
 *       {errors.password && <span>{errors.password.message}</span>}
 *
 *       <button type="submit">Submit</button>
 *     </form>
 *   );
 * }
 * ```
 */
export function classValidatorResolver<T extends object>(
  targetClass: new () => T,
) {
  return async (data: T): Promise<ResolverResult<T>> => {
    const instance = plainToInstance(targetClass, data);
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length === 0) {
      return { values: instance as T, errors: {} };
    }

    const fieldErrors: Record<string, FieldError> = {};
    const flattenErrors = (errs: ValidationError[], parentKey?: string) => {
      for (const err of errs) {
        const fieldName = parentKey
          ? `${parentKey}.${err.property}`
          : err.property;
        if (err.constraints) {
          const errorCodes = err.constraints || {};
          const [firstCode] = Object.keys(err.constraints);
          fieldErrors[fieldName] = {
            type: toSnakeCase(firstCode),
            message: Object.values(err.constraints)[0],
            types: Object.keys(errorCodes).reduce(
              (acc, code) => {
                acc[toSnakeCase(code)] = errorCodes[code];
                return acc;
              },
              {} as Record<string, string>,
            ),
          };
        }
        if (err.children?.length) {
          flattenErrors(err.children, fieldName);
        }
      }
    };
    flattenErrors(errors);

    return { values: data, errors: fieldErrors as Record<string, never> };
  };
}
