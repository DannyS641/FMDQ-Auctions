import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, Navigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { register as registerUser } from "@/api/auth";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/context/auth-context";

const schema = z
  .object({
    displayName: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name is too long"),
    email: z.string().email("Enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type FormData = z.infer<typeof schema>;

export default function SignUp() {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();

  if (isSignedIn) return <Navigate to="/bidding" replace />;

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const { mutate, isPending } = useMutation({
    mutationFn: (data: FormData) =>
      registerUser(data.displayName, data.email, data.password),
    onSuccess: () => {
      toast.success("Account created! Check your email to verify your account.");
      navigate("/signin");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        // Generic message to avoid user enumeration
        toast.info("If this email is not registered, your account has been created. Check your inbox.");
        navigate("/signin");
      } else {
        setError("root", {
          message: err instanceof Error ? err.message : "Registration failed. Please try again.",
        });
      }
    },
  });

  return (
    <AuthLayout
      title="Create your account"
      description="Join the FMDQ auction portal to start bidding."
    >
      <form onSubmit={handleSubmit((data) => mutate(data))} noValidate className="flex flex-col gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate">Register</p>
        <Input
          id="displayName"
          label="Full name"
          placeholder="Your full name"
          autoComplete="name"
          error={errors.displayName?.message}
          {...register("displayName")}
        />
        <Input
          id="email"
          type="email"
          label="Email address"
          placeholder="you@example.com"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <PasswordInput
          id="password"
          label="Password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <PasswordInput
          id="confirmPassword"
          label="Confirm password"
          placeholder="Repeat your password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />
        {errors.root && (
          <p className="text-xs text-red-500">{errors.root.message}</p>
        )}
        <p className="text-xs text-slate">
          By creating an account you agree to our terms of service and privacy policy.
        </p>
        <Button type="submit" isLoading={isPending} className="mt-2 w-full">
          Create account
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => navigate("/signin")}
        >
          Sign in instead
        </Button>
      </form>
    </AuthLayout>
  );
}
