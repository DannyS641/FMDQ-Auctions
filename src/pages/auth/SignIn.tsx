import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, Navigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { login } from "@/api/auth";
import { queryKeys } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/context/auth-context";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormData = z.infer<typeof schema>;

export default function SignIn() {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const from = "/";

  if (isSignedIn) return <Navigate to="/bidding" replace />;

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const { mutate, isPending } = useMutation({
    mutationFn: ({ email, password }: FormData) => login(email, password),
    onSuccess: (session) => {
      // Write the new session immediately so every subscriber sees the right user/role
      queryClient.setQueryData(queryKeys.auth.session(), session);
      // Flush any data cached for the previous user
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      navigate(from, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        setError("password", { message: "Invalid email or password" });
      } else if (err instanceof ApiError && err.status === 403) {
        toast.error("Your account is not yet verified. Check your email for the verification link.");
      } else {
        toast.error(err instanceof Error ? err.message : "Sign in failed. Please try again.");
      }
    },
  });

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to continue to the bidding desk."
    >
      <form onSubmit={handleSubmit((data) => mutate(data))} noValidate className="flex flex-col gap-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate">Sign in</p>
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
          placeholder="Your password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password")}
        />
        <div className="flex justify-end">
          <a href="/reset-password" className="text-xs text-slate hover:text-neon hover:underline">
            Forgot password?
          </a>
        </div>
        <Button type="submit" isLoading={isPending} className="mt-2 w-full">
          Sign in
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => navigate("/signup")}
        >
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
