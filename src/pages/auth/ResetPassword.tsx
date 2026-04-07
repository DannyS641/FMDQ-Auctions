import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { requestPasswordReset, resetPassword } from "@/api/auth";

// ── Request mode ─────────────────────────────────────────────────────────────

const requestSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

type RequestData = z.infer<typeof requestSchema>;

function RequestForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RequestData>({ resolver: zodResolver(requestSchema) });

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: (data: RequestData) => requestPasswordReset(data.email),
  });

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <p className="text-sm text-ink">
          If that email is registered, a password reset link has been sent. Check your inbox.
        </p>
        <Link to="/signin">
          <Button variant="secondary">Back to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit((d) => mutate(d))} noValidate className="flex flex-col gap-4">
      <Input
        id="email"
        type="email"
        label="Email address"
        placeholder="you@example.com"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Button type="submit" isLoading={isPending} className="mt-2 w-full">
        Send reset link
      </Button>
      <div className="text-center">
        <Link to="/signin" className="text-xs text-slate hover:text-neon hover:underline">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}

// ── Reset mode ────────────────────────────────────────────────────────────────

const resetSchema = z
  .object({
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

type ResetData = z.infer<typeof resetSchema>;

function ResetForm({ token }: { token: string }) {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetData>({ resolver: zodResolver(resetSchema) });

  const { mutate, isPending } = useMutation({
    mutationFn: (data: ResetData) => resetPassword(token, data.password),
    onSuccess: () => {
      toast.success("Password reset successfully. You can now sign in.");
      navigate("/signin");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Reset failed. The link may have expired.");
    },
  });

  return (
    <form onSubmit={handleSubmit((d) => mutate(d))} noValidate className="flex flex-col gap-4">
      <PasswordInput
        id="password"
        label="New password"
        placeholder="At least 8 characters"
        autoComplete="new-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <PasswordInput
        id="confirmPassword"
        label="Confirm new password"
        placeholder="Repeat your password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />
      <Button type="submit" isLoading={isPending} className="mt-2 w-full">
        Reset password
      </Button>
    </form>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");

  return (
    <AuthLayout
      title={token ? "Set new password" : "Reset your password"}
      description={
        token
          ? "Choose a strong new password for your account."
          : "Enter your email and we'll send you a reset link."
      }
    >
      {token ? <ResetForm token={token} /> : <RequestForm />}
    </AuthLayout>
  );
}
